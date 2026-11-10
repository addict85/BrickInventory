/** src/ importiert jobs/ nicht; startup/verdrahtung.ts setzt die Ausführung
 * beim Start ein. Ohne Verdrahtung wirft ein Aufruf: Eine still ausgelassene
 * Nacharbeit fiel erst auf, wenn Bilder und Preise fehlten. Wer bewusst ohne
 * läuft (Skripte), verdrahtet OHNE_NACHARBEIT ausdrücklich. */
export interface Nacharbeit {
  /** Etwa nach einem Währungswechsel. */
  preisJobAnstossen(): void;
  preisFuerSetHolen(setNumber: string, userId: number, zustand: string | null): Promise<void>;
  bildVormerken(url: string, setNumber: string | null): void;
  setTeileAnreichern(setNumber: string): Promise<unknown>;
  figurenAnreichern(setNumber: string): Promise<unknown>;
  setBilderLaden(setNumber: string): Promise<unknown>;
}

export const OHNE_NACHARBEIT: Nacharbeit = Object.freeze({
  preisJobAnstossen() {},
  async preisFuerSetHolen() {},
  bildVormerken() {},
  async setTeileAnreichern() {},
  async figurenAnreichern() {},
  async setBilderLaden() {},
});

let _aktuell: Nacharbeit | null = null;

export function verdrahteNacharbeit(n: Nacharbeit | null): void {
  _aktuell = n;
}

export function nacharbeit(): Nacharbeit {
  if (!_aktuell) throw new Error('Nacharbeit ist nicht verdrahtet (startup/verdrahtung.ts, verdrahte())');
  return _aktuell;
}
