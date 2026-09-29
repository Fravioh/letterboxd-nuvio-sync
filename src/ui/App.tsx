import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileArchive,
  Film,
  KeyRound,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { safeError } from '../errors';
import { readExport } from '../letterboxd/worker-client';
import { MovieMatcher } from '../matching/movie-matcher';
import { TmdbProvider } from '../metadata/tmdb';
import { getProfiles, signIn, signOut, type Profile, type Session } from '../nuvio/auth';
import { NuvioWatchHistoryDestination } from '../nuvio/client';
import { buildPlan, sync } from '../sync/sync-engine';
import type {
  Candidate,
  ImportResult,
  Match,
  MetadataProvider,
  SyncPlan,
  SyncProgress,
  SyncReport,
  WatchHistoryDestination,
  WatchedItem,
} from '../types';
import { DemoDestination, DemoMetadata, demoImport } from './demo';

function MoviePoster({
  title,
  posterPath,
  className = '',
}: {
  title: string;
  posterPath?: string;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = posterPath
    ? posterPath.startsWith('http') || posterPath.startsWith('data:')
      ? posterPath
      : `https://image.tmdb.org/t/p/w92${posterPath}`
    : undefined;

  return (
    <span className={`movie-icon ${className} ${loaded ? 'has-poster' : ''}`}>
      {src && !failed ? (
        <img
          src={src}
          alt={title}
          className={`poster-img ${loaded ? 'loaded' : ''}`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <Film size={15} />
      )}
    </span>
  );
}

function ConfirmDialog({
  plan,
  close,
  confirm,
}: {
  plan: SyncPlan;
  close(): void;
  confirm(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const unknown = plan.pending.filter((entry) => !entry.source.watchedDates.length).length;
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={close} aria-labelledby="confirm-title">
      <div className="dialog-head">
        <span className="eyebrow">CONFIRM SYNC</span>
        <button className="icon-button" onClick={close} aria-label="Close confirmation">
          <X size={20} />
        </button>
      </div>
      <h2 id="confirm-title">Confirm the import</h2>
      <p>
        Add <strong>{plan.pending.length.toLocaleString()} movies</strong> to the selected Nuvio
        profile. Existing watched entries will be skipped. Completed writes cannot be undone here.
      </p>
      {unknown > 0 && (
        <div className="notice">
          <AlertTriangle size={18} className="notice-icon" />
          <strong>{unknown} movies have no known watch date.</strong>
          <p>
            Nuvio requires a timestamp. We send its backend default, 0, instead of inventing a date.
            Some Nuvio clients may display this as 1970.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            Import these movies with an unknown date
          </label>
        </div>
      )}
      <div className="actions">
        <button className="button secondary" onClick={close}>
          Back to review
        </button>
        <button
          className="button primary"
          disabled={unknown > 0 && !acknowledged}
          onClick={confirm}
        >
          Confirm sync <ArrowRight size={17} />
        </button>
      </div>
    </dialog>
  );
}

function ManualReview({
  match,
  provider,
  onChoose,
  disabled,
}: {
  match: Match;
  provider: MetadataProvider;
  onChoose(movie: Candidate): void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState(match.source.title);
  const [candidates, setCandidates] = useState(match.candidates);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function search(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      setCandidates(
        /^\d+$/.test(query) ? [await provider.movie(Number(query))] : await provider.search(query),
      );
    } catch (err) {
      setError(safeError(err).message);
    } finally {
      setBusy(false);
    }
  }
  async function choose(candidate: Candidate) {
    setBusy(true);
    setError('');
    try {
      onChoose(await provider.movie(candidate.tmdb));
    } catch (err) {
      setError(safeError(err).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="review-item">
      <summary>
        <span>
          <strong>{match.source.title}</strong>{' '}
          <span className="muted">{match.source.year ?? 'Year unknown'}</span>
          <small>{match.reason}</small>
        </span>
        <span className={`badge ${match.confidence.toLowerCase()}`}>
          {match.confidence === 'MEDIUM' ? 'Confirm match' : 'Needs review'}
        </span>
      </summary>
      <div className="review-content">
        <form onSubmit={search} className="search-form">
          <label className="sr-only" htmlFor={`query-${match.source.key}`}>
            Search for {match.source.title}
          </label>
          <input
            id={`query-${match.source.key}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Movie title or TMDB ID"
            maxLength={500}
          />
          <button className="button secondary" disabled={busy || disabled || !query.trim()}>
            Search
          </button>
        </form>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {!candidates.length && (
          <p className="muted">No candidates yet. Try the original title or a TMDB movie ID.</p>
        )}
        <div className="candidates">
          {candidates.map((movie) => (
            <div className="candidate" key={movie.tmdb}>
              <div className="candidate-media">
                <MoviePoster title={movie.title} posterPath={movie.posterPath} />
                <div>
                  <strong>{movie.title}</strong>
                  <small>
                    {movie.year ?? 'Year unknown'} · TMDB {movie.tmdb}
                    {movie.originalTitle !== movie.title ? ` · ${movie.originalTitle}` : ''}
                  </small>
                </div>
              </div>
              <button
                className="button secondary small"
                disabled={busy || disabled}
                onClick={() => void choose(movie)}
              >
                Use this match
              </button>
            </div>
          ))}
        </div>
        <p className="muted small-text">
          Choosing a match only updates your preview. Sync still requires confirmation.
        </p>
      </div>
    </details>
  );
}

export function App() {
  const [imported, setImported] = useState<ImportResult>();
  const [fileName, setFileName] = useState('');
  const [demo, setDemo] = useState(false);
  const [destination, setDestination] = useState<WatchHistoryDestination>();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState(0);
  const [matches, setMatches] = useState<Match[]>([]);
  const [remote, setRemote] = useState<WatchedItem[]>([]);
  const [plan, setPlan] = useState<SyncPlan>();
  const [report, setReport] = useState<SyncReport>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [confirming, setConfirming] = useState(false);
  const [tab, setTab] = useState<'new' | 'review' | 'existing'>('new');
  const [page, setPage] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [tmdbConfigured, setTmdbConfigured] = useState(false);
  const [tmdbTokenInput, setTmdbTokenInput] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [tokenError, setTokenError] = useState('');
  const provider = useRef<MetadataProvider>(new TmdbProvider());
  const tmdbCredential = useRef('');
  const session = useRef<Session | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const operationLock = useRef(false);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [busy]);
  function clearAnalysis() {
    setPlan(undefined);
    setReport(undefined);
    setMatches([]);
    setRemote([]);
    setPage(0);
    setNotice('');
  }
  async function loadFile(file?: File) {
    if (!file || operationLock.current) return;
    operationLock.current = true;
    setBusy('Reading your export locally');
    setProgress({ done: 0, total: 0 });
    setError('');
    clearAnalysis();
    try {
      const result = await readExport(file);
      setImported(result);
      setFileName(file.name);
    } catch (err) {
      setImported(undefined);
      setError(safeError(err).message);
    } finally {
      operationLock.current = false;
      setBusy('');
    }
  }
  function startDemo() {
    clearAnalysis();
    setError('');
    setDemo(true);
    provider.current = new DemoMetadata();
    setImported(demoImport());
    setFileName('Sample Letterboxd export');
    setDestination(new DemoDestination());
    setProfiles([]);
    setProfileId(1);
  }
  async function disconnect() {
    const current = session.current;
    session.current = undefined;
    setDestination(undefined);
    setProfiles([]);
    setProfileId(0);
    clearAnalysis();
    setError('');
    if (demo) {
      setDemo(false);
      setImported(undefined);
      setFileName('');
      provider.current = new TmdbProvider(tmdbCredential.current);
      return;
    }
    if (current) {
      try {
        await signOut(current);
      } catch {
        setNotice(
          'Local credentials were cleared. Nuvio could not confirm session revocation; manage active sessions in Nuvio if needed.',
        );
      }
    }
  }
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operationLock.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get('email') ?? '');
    const password = String(data.get('password') ?? '');
    form.reset();
    operationLock.current = true;
    setBusy('Connecting directly to Nuvio');
    setProgress({ done: 0, total: 0 });
    setError('');
    let authenticated: Session | undefined;
    try {
      authenticated = await signIn(email, password);
      const available = await getProfiles(authenticated);
      session.current = authenticated;
      setProfiles(available);
      setProfileId(0);
      clearAnalysis();
    } catch (err) {
      if (authenticated) void signOut(authenticated).catch(() => undefined);
      setError(safeError(err).message);
    } finally {
      operationLock.current = false;
      setBusy('');
    }
  }
  function selectProfile(value: number) {
    clearAnalysis();
    setProfileId(value);
    const profile = profiles.find((item) => item.profile_index === value);
    setDestination(
      session.current && profile && !profile.pin_enabled
        ? new NuvioWatchHistoryDestination(session.current, value)
        : undefined,
    );
  }
  async function analyze(verifiedNow = false) {
    if (!destination || !imported || operationLock.current) return;
    if (!demo && !verifiedNow && !tmdbConfigured) {
      setError('A verified TMDB API credential is required before analysis.');
      return;
    }
    const manual = new Map(
      matches
        .filter((match) => match.manual && match.selected)
        .map((match) => [match.source.key, match]),
    );
    operationLock.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setError('');
    setNotice('');
    clearAnalysis();
    setBusy('Matching your movies');
    setProgress({ done: 0, total: imported.movies.length });
    try {
      const current = await destination.read(abort.signal);
      const resolved = await new MovieMatcher(provider.current).analyze(
        imported.movies.filter((movie) => !manual.has(movie.key)),
        (done) => setProgress({ done: done + manual.size, total: imported.movies.length }),
        abort.signal,
      );
      const byKey = new Map([
        ...resolved.map((match) => [match.source.key, match] as const),
        ...manual,
      ]);
      const results = imported.movies.flatMap((movie) => {
        const match = byKey.get(movie.key);
        return match ? [match] : [];
      });
      setRemote(current);
      setMatches(results);
      setPlan(buildPlan(results, current, destination.identity));
      setTab('new');
    } catch (err) {
      const safe = safeError(err);
      if (safe.code === 'METADATA_NOT_CONFIGURED') setTmdbConfigured(false);
      setError(safe.message);
    } finally {
      setBusy('');
      operationLock.current = false;
    }
  }

  async function handleSaveToken(tokenToSave: string) {
    if (!tokenToSave.trim() || savingToken) return;
    setSavingToken(true);
    setTokenError('');
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenToSave.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; code?: string };
      if (!res.ok) {
        throw new Error(
          data.error ||
            (data.code === 'ORIGIN_NOT_ALLOWED'
              ? 'This local address is not allowed. Restart the app and open the URL shown in the terminal.'
              : 'Failed to verify TMDB token. Please check and try again.'),
        );
      }
      tmdbCredential.current = tokenToSave.trim();
      provider.current = new TmdbProvider(tmdbCredential.current);
      setTmdbConfigured(true);
      setTmdbTokenInput('');
      setError('');
      setNotice('Your TMDB credential was verified and will remain only in this tab.');
      if (destination && imported && !operationLock.current) {
        void analyze(true);
      }
    } catch (err: unknown) {
      setTokenError(err instanceof Error ? err.message : 'Could not verify TMDB token.');
    } finally {
      setSavingToken(false);
    }
  }
  function chooseMatch(index: string, movie: Candidate) {
    if (!destination) return;
    const next = matches.map((match) =>
      match.source.key === index
        ? { ...match, selected: movie, manual: true, reason: 'Confirmed by you' }
        : match,
    );
    setMatches(next);
    setPlan(buildPlan(next, remote, destination.identity));
    setReport(undefined);
    setPage(0);
  }
  async function runSync(dryRun: boolean) {
    if (!plan || !destination || operationLock.current) return;
    operationLock.current = true;
    setConfirming(false);
    setError('');
    setNotice('');
    setReport(undefined);
    const abort = new AbortController();
    controller.current = abort;
    setBusy(dryRun ? 'Validating your dry run' : 'Syncing your Letterboxd history');
    setProgress({ done: 0, total: plan.pending.length });
    try {
      const result = await sync(plan, destination, {
        dryRun,
        confirmed: !dryRun,
        signal: abort.signal,
        onProgress: (p: SyncProgress) => setProgress({ done: p.completed, total: p.total }),
        batchSize: demo ? 3 : 100,
      });
      setReport(result);
      if (dryRun)
        setNotice(
          `Dry run complete. ${result.remaining} movies would be added. No writes were sent.`,
        );
      else
        setNotice(
          result.cancelled
            ? 'Sync stopped. Completed batches are saved. Analyze again to continue.'
            : 'Analyze again to verify your current Nuvio history or retry remaining movies.',
        );
    } catch (err) {
      setError(safeError(err).message);
    } finally {
      setBusy('');
      operationLock.current = false;
    }
  }
  function downloadReport() {
    if (!report || !plan) return;
    const body = {
      version: 1,
      demo,
      dryRun: report.dryRun,
      sourceMovies: plan.sourceTotal,
      alreadyInNuvio: plan.already.length + report.already,
      added: report.added,
      failed: report.failed,
      uncertain: report.uncertain,
      remaining: report.remaining,
      needsReview: plan.review.map((match) => ({
        title: match.source.title,
        year: match.source.year,
        reason: match.reason,
      })),
      addedMovies: report.addedEntries.map((entry) => ({
        title: entry.movie.title,
        tmdb: entry.movie.tmdb,
        imdb: entry.movie.imdb,
        watchedDate: entry.source.watchedDates.at(-1) ?? null,
      })),
      failures: report.failures.map((failure) => ({
        title: failure.entry.source.title,
        code: failure.code,
      })),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'letterboxd-nuvio-report.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const currentStep = report && !report.dryRun ? 4 : plan ? 3 : imported ? 2 : 1;
  const reviewRows = plan
    ? tab === 'review'
      ? plan.review
      : tab === 'existing'
        ? plan.already
        : plan.pending
    : [];
  const pageCount = Math.max(1, Math.ceil(reviewRows.length / 20));
  return (
    <>
      <a className="skip-link" href="#workspace">
        Skip to import
      </a>
      <header className="site-header">
        <a className="brand" href="./" aria-label="Letterboxd to Nuvio home">
          <span className="brand-mark">
            <Film size={19} />
            <ArrowRight size={15} />
          </span>
          Letterboxd <span className="brand-light">→ Nuvio</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#privacy">
            Privacy <ArrowUpRight size={13} />
          </a>
        </nav>
      </header>
      <main>
        <section className="hero">
          <div className="eyebrow">HISTORY IMPORT</div>
          <h1>
            <span className="hero-from">Letterboxd</span> <span className="hero-arrow">⟶</span>{' '}
            <span className="hero-to">Nuvio</span>
            <span className="period">.</span>
          </h1>
          <p>Review your Letterboxd history and sync missing films to Nuvio.</p>
          <span className="hero-sub">Nothing is written until you confirm the import.</span>
        </section>
        <ol className="steps" aria-label="Sync steps">
          {['Import Letterboxd', 'Connect Nuvio', 'Review', 'Sync'].map((label, index) => (
            <li
              key={label}
              className={
                currentStep === index + 1 ? 'active' : currentStep > index + 1 ? 'complete' : ''
              }
              aria-current={currentStep === index + 1 ? 'step' : undefined}
            >
              <span className="step-number">
                {currentStep > index + 1 ? <Check size={15} /> : `0${index + 1}`}
              </span>
              <span>{label}</span>
              {index < 3 && <span className="step-line" />}
            </li>
          ))}
        </ol>
        {demo && (
          <div className="demo-banner">
            <Sparkles size={17} />
            <span>Demo mode · Fictional movies. No accounts connected. No external requests.</span>
            <button disabled={Boolean(busy)} onClick={() => void disconnect()}>
              Exit demo <X size={14} />
            </button>
          </div>
        )}
        {error && (
          <div className="alert error" role="alert">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={18} />
              <strong>Request failed.</strong>
            </div>
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="alert info" role="status">
            {notice}
          </div>
        )}
        <div className="workspace" id="workspace">
          <div className="main-column">
            <section className="panel import-panel" aria-labelledby="import-title">
              <div className="panel-top">
                <div>
                  <span className="eyebrow">01 / YOUR LETTERBOXD HISTORY</span>
                  <h2 id="import-title">
                    {imported ? 'Export loaded successfully.' : 'Start with your export.'}
                  </h2>
                </div>
                <span className="local-badge">
                  <LockKeyhole size={13} /> Processed locally
                </span>
              </div>
              {!demo && (
                <input
                  ref={fileInput}
                  id="file-input"
                  className="sr-only"
                  type="file"
                  accept=".zip,application/zip,.csv,text/csv"
                  aria-label="Choose Letterboxd export ZIP"
                  disabled={Boolean(busy)}
                  onChange={(event) => {
                    void loadFile(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
              )}
              {imported ? (
                <div className="file-summary">
                  <span className="file-icon">
                    <FileArchive size={26} />
                  </span>
                  <div>
                    <strong>{fileName}</strong>
                    <span>
                      {imported.movies.length.toLocaleString()} watched movies ·{' '}
                      {imported.duplicates} duplicate rows removed
                    </span>
                  </div>
                  <CheckCircle2 size={23} className="green" />
                </div>
              ) : (
                <div
                  className={`dropzone ${dragging ? 'dragging' : ''}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    if (!busy) void loadFile(event.dataTransfer.files[0]);
                  }}
                >
                  <span className="upload-icon">
                    <Upload size={26} />
                  </span>
                  <h3>Drop your Letterboxd export here</h3>
                  <p>Your export stays on this device. ZIP or watched.csv supported.</p>
                  <button
                    className="button primary"
                    disabled={Boolean(busy)}
                    onClick={() => fileInput.current?.click()}
                  >
                    Choose file <ArrowRight size={16} />
                  </button>
                  <span className="file-hint">.ZIP UP TO 50 MB · .CSV UP TO 16 MB</span>
                </div>
              )}
              <div className="import-footer">
                <span>
                  Need your export?{' '}
                  <a
                    href="https://letterboxd.com/user/exportdata/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Get it from Letterboxd <ArrowUpRight size={13} />
                  </a>
                </span>
                {imported && !demo && (
                  <button
                    className="text-button"
                    disabled={Boolean(busy)}
                    onClick={() => fileInput.current?.click()}
                  >
                    Change file
                  </button>
                )}
              </div>
              {imported?.warnings.map((warning) => (
                <p className="small-text muted" key={warning}>
                  {warning}
                </p>
              ))}
            </section>
            {imported && !demo && (
              <section className="panel connect-panel" aria-labelledby="connect-title">
                <div className="panel-top">
                  <div>
                    <span className="eyebrow">02 / YOUR DESTINATION</span>
                    <h2 id="connect-title">Connect Nuvio</h2>
                  </div>
                  {profiles.length > 0 && (
                    <span className="local-badge">
                      <Check size={14} /> Connected
                    </span>
                  )}
                </div>
                {profiles.length ? (
                  <>
                    <label htmlFor="profile">Choose the profile to update</label>
                    <select
                      id="profile"
                      value={profileId}
                      disabled={Boolean(busy)}
                      onChange={(event) => selectProfile(Number(event.target.value))}
                    >
                      <option value={0} disabled>
                        Select a Nuvio profile
                      </option>
                      {profiles.map((profile) => (
                        <option
                          key={profile.profile_index}
                          value={profile.profile_index}
                          disabled={profile.pin_enabled}
                        >
                          {profile.name}
                          {profile.pin_enabled ? ' · PIN protected (unsupported)' : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      className="text-button disconnect"
                      disabled={Boolean(busy)}
                      onClick={() => void disconnect()}
                    >
                      <LogOut size={14} /> Disconnect and clear credentials
                    </button>
                    <p className="small-text muted">
                      PIN-protected profiles are unavailable because a public third-party PIN
                      verification flow is not documented.
                    </p>
                    <p className="small-text muted">
                      Use Nuvio Sync as the watched-history source in your Nuvio client. An active
                      external tracker can override what the client displays.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="muted">
                      Sign in directly with Nuvio. Credentials go only to{' '}
                      <strong>api.nuvio.tv</strong>; the access token stays in this tab’s memory.
                    </p>
                    <form onSubmit={(event) => void connect(event)}>
                      <div className="form-grid">
                        <label>
                          Email
                          <input
                            name="email"
                            type="email"
                            autoComplete="username"
                            required
                            maxLength={254}
                            disabled={Boolean(busy)}
                          />
                        </label>
                        <label>
                          Password
                          <input
                            name="password"
                            type="password"
                            autoComplete="current-password"
                            required
                            maxLength={1024}
                            disabled={Boolean(busy)}
                          />
                        </label>
                      </div>
                      <button className="button secondary" disabled={Boolean(busy)}>
                        Connect Nuvio <ArrowRight size={16} />
                      </button>
                    </form>
                    <p className="small-text muted">
                      Nuvio currently documents password sign-in for external clients, without a
                      third-party OAuth flow. Use a deployment you trust. The app does not store
                      your password.
                    </p>
                  </>
                )}
              </section>
            )}
            {destination && imported && !busy && (
              <div className="analysis-gate">
                {!demo && !tmdbConfigured ? (
                  <form
                    className="metadata-token-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleSaveToken(tmdbTokenInput);
                    }}
                  >
                    <div className="metadata-token-copy">
                      <span className="metadata-token-icon">
                        <KeyRound size={18} />
                      </span>
                      <div>
                        <strong>TMDB credential required</strong>
                        <p>
                          Use your own free API Read Access Token or v3 API key. It stays in this
                          tab and is used for your requests only.
                        </p>
                      </div>
                      <a
                        href="https://www.themoviedb.org/settings/api"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Get token <ExternalLink size={12} />
                      </a>
                    </div>
                    <label htmlFor="analysis-tmdb-token">TMDB API credential</label>
                    <div className="metadata-token-entry">
                      <input
                        id="analysis-tmdb-token"
                        type="password"
                        autoComplete="off"
                        placeholder="Paste your TMDB token or API key"
                        value={tmdbTokenInput}
                        onChange={(event) => setTmdbTokenInput(event.target.value)}
                        disabled={savingToken}
                        maxLength={1500}
                        required
                      />
                      <button
                        type="submit"
                        className="button primary"
                        disabled={savingToken || !tmdbTokenInput.trim()}
                      >
                        {savingToken ? 'Verifying…' : 'Verify token and analyze'}
                      </button>
                    </div>
                    {tokenError && (
                      <p className="metadata-token-error" role="alert">
                        {tokenError}
                      </p>
                    )}
                  </form>
                ) : (
                  <div className="analysis-action">
                    <span>
                      <ShieldCheck size={17} />
                      {demo
                        ? 'Analysis is read-only. Nothing changes yet.'
                        : 'Your TMDB credential is ready. Analysis is read-only.'}
                    </span>
                    <button className="button primary" onClick={() => void analyze()}>
                      {plan ? 'Analyze again' : 'Analyze my history'} <ArrowRight size={17} />
                    </button>
                  </div>
                )}
              </div>
            )}
            {busy && (
              <section className="panel progress-panel" aria-label="Operation progress">
                <div className="panel-top">
                  <h3>{busy}</h3>
                  {progress.total > 0 && (
                    <span>{Math.round((progress.done / progress.total) * 100)}%</span>
                  )}
                </div>
                <progress max={progress.total || 1} value={progress.done} aria-label={busy} />
                <div className="progress-footer">
                  <span role="status" aria-live="polite">
                    {progress.total > 0
                      ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} movies`
                      : 'Please wait…'}
                  </span>
                  {!busy.startsWith('Connecting') && !busy.startsWith('Reading') && (
                    <button className="text-button" onClick={() => controller.current?.abort()}>
                      Cancel {busy.startsWith('Syncing') ? 'sync' : 'analysis'}
                    </button>
                  )}
                </div>
              </section>
            )}
          </div>
          <aside className="side-column">
            <section className="privacy-card" id="privacy">
              <div className="bridge-visual" aria-hidden="true">
                <span className="letterboxd-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="bridge-track">
                  <i />
                  <i />
                  <i />
                  <ArrowRight size={15} />
                </span>
                <span className="nuvio-mark">
                  <img src="/nuvio-logo.png" alt="" />
                </span>
              </div>
              <span className="eyebrow">PRIVACY</span>
              <h2>Data handling</h2>
              <p>The Letterboxd ZIP or CSV is parsed in your browser.</p>
              <ul className="trust-list">
                <li>
                  <Check size={16} /> Export files are processed locally
                </li>
                <li>
                  <Check size={16} /> Only missing movies are selected
                </li>
                <li>
                  <Check size={16} /> Nuvio credentials remain in tab memory
                </li>
                <li>
                  <Check size={16} /> No analytics or application database
                </li>
              </ul>
              <div className="privacy-detail">
                <LockKeyhole size={16} />
                <span>
                  Film titles, years and IDs go to the metadata service and TMDB for matching. Your
                  confirmed selections go directly to Nuvio. Posters load from TMDB’s image service.
                </span>
              </div>
            </section>
            {!imported && (
              <section className="demo-card">
                <span className="eyebrow">DEMO</span>
                <h3>Test without an account</h3>
                <p>Uses local sample data and makes no external requests.</p>
                <button className="text-button" disabled={Boolean(busy)} onClick={startDemo}>
                  Start demo <ArrowUpRight size={16} />
                </button>
              </section>
            )}
            <p className="session-note">
              Everything in this tab is temporary. Refreshing clears your file, matches and
              connection.
            </p>
          </aside>
        </div>
        {plan && (
          <section className="panel results-panel" aria-labelledby="review-title">
            <div className="panel-top">
              <div>
                <span className="eyebrow">03 / THE PREVIEW</span>
                <h2 id="review-title">Review your matches.</h2>
              </div>
              <span className="badge high">Nothing written during analysis</span>
            </div>
            <div className="stats">
              {[
                [plan.sourceTotal, 'Letterboxd movies'],
                [plan.remoteTotal, 'Nuvio watched IDs'],
                [plan.already.length, 'Already watched'],
                [plan.pending.length, 'Ready to sync'],
                [plan.review.length, 'Need your review'],
              ].map(([number, label]) => (
                <div key={label} className={label === 'Ready to sync' ? 'highlight-stat' : ''}>
                  <strong>{number?.toLocaleString()}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            {plan.duplicates > 0 && (
              <p className="small-text muted">
                {plan.duplicates} source entries resolve to movies already represented in this
                preview.
              </p>
            )}
            <div className="result-toolbar">
              <div role="tablist" aria-label="Movie results">
                {(
                  [
                    ['new', 'Ready to sync', plan.pending.length],
                    ['review', 'Needs review', plan.review.length],
                    ['existing', 'Already watched', plan.already.length],
                  ] as const
                ).map(([value, label, count]) => (
                  <button
                    role="tab"
                    id={`tab-${value}`}
                    aria-controls="movie-results"
                    tabIndex={tab === value ? 0 : -1}
                    aria-selected={tab === value}
                    key={value}
                    className={tab === value ? 'selected' : ''}
                    onClick={() => {
                      setTab(value);
                      setPage(0);
                    }}
                    onKeyDown={(event) => {
                      const order = ['new', 'review', 'existing'] as const;
                      const index = order.indexOf(value);
                      const next =
                        event.key === 'ArrowRight'
                          ? order[(index + 1) % 3]
                          : event.key === 'ArrowLeft'
                            ? order[(index + 2) % 3]
                            : event.key === 'Home'
                              ? order[0]
                              : event.key === 'End'
                                ? order[2]
                                : undefined;
                      if (next) {
                        event.preventDefault();
                        setTab(next);
                        setPage(0);
                        document.getElementById(`tab-${next}`)?.focus();
                      }
                    }}
                  >
                    {label} <span>{count}</span>
                  </button>
                ))}
              </div>
              <span className="small-text muted">{plan.matched} matched</span>
            </div>
            <div
              className="movie-list"
              id="movie-results"
              role="tabpanel"
              aria-labelledby={`tab-${tab}`}
              tabIndex={0}
            >
              {reviewRows.length === 0 && (
                <div className="empty-state">
                  <CheckCircle2 size={27} />
                  <p>
                    {tab === 'review'
                      ? 'No movies need review.'
                      : tab === 'new'
                        ? 'You’re all caught up. No new movies to add.'
                        : 'No existing matches in this profile.'}
                  </p>
                </div>
              )}
              {tab === 'review'
                ? plan.review
                    .slice(page * 20, page * 20 + 20)
                    .map((match) => (
                      <ManualReview
                        key={match.source.key}
                        match={match}
                        provider={provider.current}
                        disabled={Boolean(busy)}
                        onChoose={(movie) => chooseMatch(match.source.key, movie)}
                      />
                    ))
                : (tab === 'new' ? plan.pending : plan.already)
                    .slice(page * 20, page * 20 + 20)
                    .map((entry) => (
                      <div className="movie-row" key={entry.source.key}>
                        <MoviePoster
                          title={entry.movie.title}
                          posterPath={entry.movie.posterPath}
                        />
                        <div className="movie-name">
                          <strong>{entry.movie.title}</strong>
                          <small>
                            {entry.movie.year ?? 'Year unknown'} ·{' '}
                            {entry.movie.imdb ?? `TMDB ${entry.movie.tmdb}`}
                          </small>
                        </div>
                        <span className="movie-date">
                          {entry.source.watchedDates.at(-1) ?? 'Watch date unknown'}
                        </span>
                        <span className={`badge ${tab === 'existing' ? '' : 'high'}`}>
                          {tab === 'existing'
                            ? 'Already watched'
                            : matches.find((match) => match.source.key === entry.source.key)?.manual
                              ? 'Confirmed by you'
                              : 'High confidence'}
                        </span>
                      </div>
                    ))}
            </div>
            {pageCount > 1 && (
              <div className="pagination">
                <button
                  className="icon-button"
                  aria-label="Previous page"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <span>
                  Page {page + 1} of {pageCount}
                </span>
                <button
                  className="icon-button"
                  aria-label="Next page"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            )}
            <div className="sync-footer">
              <div>
                <strong>
                  {plan.pending.length
                    ? `${plan.pending.length.toLocaleString()} movies ready for Nuvio`
                    : 'Your watched history is up to date'}
                </strong>
                <small>Only confirmed matches. Existing entries stay as they are.</small>
              </div>
              <div className="actions">
                <button
                  className="button secondary"
                  disabled={Boolean(busy)}
                  onClick={() => void runSync(true)}
                >
                  Dry run
                </button>
                <button
                  className="button primary"
                  disabled={
                    Boolean(busy) || plan.pending.length === 0 || Boolean(report && !report.dryRun)
                  }
                  onClick={() => setConfirming(true)}
                >
                  Sync {plan.pending.length.toLocaleString()} movies <ArrowRight size={17} />
                </button>
              </div>
            </div>
          </section>
        )}
        {report && plan && (
          <section className="panel report-panel" aria-labelledby="report-title">
            <span className="report-icon">
              <CheckCircle2 size={27} />
            </span>
            <div className="panel-top">
              <div>
                <span className="eyebrow">04 / REPORT</span>
                <h2 id="report-title">
                  {report.dryRun
                    ? 'Dry run complete.'
                    : report.cancelled
                      ? 'Sync cancelled.'
                      : report.failed || report.remaining
                        ? 'Sync needs attention.'
                        : 'Sync complete.'}
                </h2>
              </div>
              <button className="button secondary" onClick={downloadReport}>
                <Download size={16} /> Save report
              </button>
            </div>
            <p>
              {demo ? 'Demo result · ' : ''}
              {report.added} synchronized · {plan.already.length + report.already} already watched ·{' '}
              {plan.review.length} need review · {report.failed} failed · {report.remaining}{' '}
              remaining
            </p>
            {report.uncertain > 0 && (
              <p className="error-text">
                {report.uncertain} writes could not be confirmed. They may have reached Nuvio.
                Analyze again before retrying.
              </p>
            )}
            {report.failures.length > 0 && (
              <details>
                <summary>View failed or unconfirmed movies ({report.failures.length})</summary>
                <ul>
                  {report.failures.map((failure) => (
                    <li key={failure.entry.source.key}>
                      {failure.entry.source.title}: {failure.code}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {plan.review.length > 0 && (
              <button
                className="text-button"
                onClick={() => {
                  setTab('review');
                  setPage(0);
                  document.getElementById('review-title')?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                Review unmatched movies <ArrowUpRight size={16} />
              </button>
            )}
          </section>
        )}
        <section className="how-section" id="how-it-works">
          <div>
            <span className="eyebrow">HOW IT WORKS</span>
            <h2>Import in three steps</h2>
          </div>
          <div className="how-grid">
            <article>
              <span>01</span>
              <h3>Import the export</h3>
              <p>
                Download your official Letterboxd export from Settings → Data. Drop the original ZIP
                here.
              </p>
            </article>
            <article>
              <span>02</span>
              <h3>Connect and compare</h3>
              <p>Choose a Nuvio profile and analyze which movies are missing.</p>
            </article>
            <article>
              <span>03</span>
              <h3>Review and sync</h3>
              <p>Check the matches and confirm before the app writes to Nuvio.</p>
            </article>
          </div>
        </section>
        <footer>
          <div className="footer-top">
            <span className="brand">Letterboxd → Nuvio</span>
            <a href="#privacy">
              Privacy <ShieldCheck size={14} />
            </a>
          </div>
          <p>An independent open-source project. Not affiliated with Letterboxd or Nuvio.</p>
          <div className="tmdb-credit">
            <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
              <img src="./tmdb.svg" width="76" height="16" alt="TMDB" />
            </a>
            <span>This product uses the TMDB API but is not endorsed or certified by TMDB.</span>
          </div>
        </footer>
      </main>
      {confirming && plan && (
        <ConfirmDialog
          plan={plan}
          close={() => setConfirming(false)}
          confirm={() => void runSync(false)}
        />
      )}
    </>
  );
}
