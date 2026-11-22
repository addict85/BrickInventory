/** A bounded store with expiry. When it is full, the oldest entry gives way
 * (insertion order of the Map): clearing everything at once would bring the full
 * load of recomputation precisely at the moment of highest load. */
export class Cache<K, V> {
  private readonly entries = new Map<K, { wert: V; bis: number }>();

  constructor(
    private readonly max: number,
    private readonly fristMs = Number.POSITIVE_INFINITY,
  ) {}

  hole(k: K): V | undefined {
    const e = this.entries.get(k);
    if (!e) return undefined;
    if (e.bis <= Date.now()) {
      this.entries.delete(k);
      return undefined;
    }
    return e.wert;
  }

  /** fristMs only applies to this entry (e.g. shorter for a failure). */
  set(k: K, wert: V, fristMs = this.fristMs): void {
    this.entries.delete(k);
    if (this.entries.size >= this.max) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(k, { wert, bis: Date.now() + fristMs });
  }

  remove(k: K): void {
    this.entries.delete(k);
  }

  empty(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** State an area keeps for its access (caches from the
 * database, lock connections): one set per factory, not per process. The
 * service creates the compartments on first use; the area does not know their types. */
export class Compartments {
  private readonly content = new Map<string, unknown>();

  slot<T>(name: string, create: () => T): T {
    if (!this.content.has(name)) this.content.set(name, create());
    return this.content.get(name) as T;
  }
}
