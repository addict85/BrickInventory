/** A bounded store with expiry. When it is full, the oldest entry gives way
 * (insertion order of the Map): clearing everything at once would bring the full
 * load of recomputation precisely at the moment of highest load. */
export class Zwischenspeicher<K, V> {
  private readonly eintraege = new Map<K, { wert: V; bis: number }>();

  constructor(
    private readonly max: number,
    private readonly fristMs = Number.POSITIVE_INFINITY,
  ) {}

  hole(k: K): V | undefined {
    const e = this.eintraege.get(k);
    if (!e) return undefined;
    if (e.bis <= Date.now()) {
      this.eintraege.delete(k);
      return undefined;
    }
    return e.wert;
  }

  /** fristMs only applies to this entry (e.g. shorter for a failure). */
  setze(k: K, wert: V, fristMs = this.fristMs): void {
    this.eintraege.delete(k);
    if (this.eintraege.size >= this.max) {
      const oldest = this.eintraege.keys().next();
      if (!oldest.done) this.eintraege.delete(oldest.value);
    }
    this.eintraege.set(k, { wert, bis: Date.now() + fristMs });
  }

  loesche(k: K): void {
    this.eintraege.delete(k);
  }

  leere(): void {
    this.eintraege.clear();
  }

  get groesse(): number {
    return this.eintraege.size;
  }
}

/** State an area keeps for its access (caches from the
 * database, lock connections): one set per factory, not per process. The
 * service creates the compartments on first use; the area does not know their types. */
export class Faecher {
  private readonly inhalt = new Map<string, unknown>();

  fach<T>(name: string, create: () => T): T {
    if (!this.inhalt.has(name)) this.inhalt.set(name, create());
    return this.inhalt.get(name) as T;
  }
}
