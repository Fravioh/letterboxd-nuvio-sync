export class TemporaryCache<T> {
  private readonly values = new Map<string, { value: T; expires: number }>();
  constructor(
    private readonly limit = 20000,
    private readonly ttlMs = 3600000,
    private readonly now = Date.now,
  ) {}
  get(key: string): T | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.values.delete(key);
      return undefined;
    }
    return entry.value;
  }
  set(key: string, value: T) {
    if (this.values.size >= this.limit) {
      const first = this.values.keys().next().value;
      if (first !== undefined) this.values.delete(first);
    }
    this.values.set(key, { value, expires: this.now() + this.ttlMs });
  }
  clear() {
    this.values.clear();
  }
  purgeExpired() {
    for (const [key, entry] of this.values)
      if (entry.expires <= this.now()) this.values.delete(key);
  }
}
