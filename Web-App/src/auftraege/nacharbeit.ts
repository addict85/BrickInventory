/** src/ importiert jobs/ nicht; jobs/verdrahtung.ts setzt die Ausführung
 * beim Start ein. Ohne Verdrahtung (Skripte) entfällt sie: Nacharbeit ist nie
 * Voraussetzung für eine Antwort. */
export interface Nacharbeit {
  /** Etwa nach einem Währungswechsel. */
  preisJobAnstossen(): void;
  preisFuerSetHolen(setNumber: string, userId: number, zustand: string | null): Promise<void>;
  bildVormerken(url: string, setNumber: string | null): void;
  setTeileAnreichern(setNumber: string): Promise<unknown>;
  figurenAnreichern(setNumber: string): Promise<unknown>;
  setBilderLaden(setNumber: string): Promise<unknown>;
}

const OHNE: Nacharbeit = {
  preisJobAnstossen() {},
  async preisFuerSetHolen() {}, bildVormerken() {},
  async setTeileAnreichern() {}, async figurenAnreichern() {}, async setBilderLaden() {},
};

let _aktuell: Nacharbeit = OHNE;

export function verdrahteNacharbeit(n: Nacharbeit): void { _aktuell = n; }

export function nacharbeit(): Nacharbeit { return _aktuell; }

export const setTeileAnreichern = (setNumber: string) => _aktuell.setTeileAnreichern(setNumber);
