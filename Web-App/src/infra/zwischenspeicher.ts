/** Ein begrenzter Speicher mit Frist. Ist er voll, weicht der älteste Eintrag
 * (Einfügereihenfolge der Map): Alles auf einmal zu leeren brächte die volle
 * Last der Neuberechnung ausgerechnet im Moment der höchsten Last. */
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

  /** fristMs gilt nur für diesen Eintrag (z. B. kürzer für einen Fehlschlag). */
  setze(k: K, wert: V, fristMs = this.fristMs): void {
    this.eintraege.delete(k);
    if (this.eintraege.size >= this.max) {
      const aeltester = this.eintraege.keys().next();
      if (!aeltester.done) this.eintraege.delete(aeltester.value);
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

/** Zustand, den ein Bereich für seinen Zugang hält (Zwischenspeicher aus der
 * Datenbank, Sperrverbindungen): je Fabrik ein Satz, nicht je Prozess. Die
 * Fächer legt der Dienst beim ersten Gebrauch an, der Bereich kennt ihre Typen nicht. */
export class Faecher {
  private readonly inhalt = new Map<string, unknown>();

  fach<T>(name: string, erzeuge: () => T): T {
    if (!this.inhalt.has(name)) this.inhalt.set(name, erzeuge());
    return this.inhalt.get(name) as T;
  }
}
