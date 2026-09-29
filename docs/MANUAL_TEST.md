# Manual integration test

Use a dedicated Nuvio account and a personal TMDB credential. Use test history and keep exports, credentials, and network logs private.

## Setup

Prepare a small export with:

- one movie already watched in Nuvio;
- one movie with a Diary date;
- one movie without a known date;
- duplicate watched rows;
- an ambiguous title.

Record the profile's current watched items before starting.

## Read-only checks

1. Import the ZIP and confirm counts and warnings.
2. Confirm the ZIP and CSV contents are absent from network requests.
3. Confirm analysis is disabled until a TMDB credential is validated.
4. Validate an incorrect credential, then a valid one.
5. Reload and confirm the credential is cleared.
6. Connect to Nuvio and select the intended profile.
7. Confirm the password goes only to `api.nuvio.tv`.
8. Analyze and review the ambiguous title.
9. Run a dry run and confirm no watched-write request is sent.

## Write check

1. Review the selected profile and pending movies.
2. Confirm the sync and acknowledge unknown dates if the test accepts that behavior.
3. Check the Nuvio client after the write.
4. Confirm existing dates were not changed and no duplicate was created.
5. Analyze again and confirm there are no remaining additions.
6. Download the report and confirm it contains no account or credential data.

## Failure checks

- Cancel during a multi-batch write and confirm no new batch starts.
- Expire the Nuvio session and confirm the app stops and asks for reconnection.
- Change the selected profile and confirm the existing preview is cleared.
- Reload and confirm the imported file, TMDB credential, and Nuvio session are cleared.
- Check the flow at mobile width and with keyboard navigation.

If an unknown date appears as 1970, document the affected Nuvio client and do not approve unknown-date imports for that client.
