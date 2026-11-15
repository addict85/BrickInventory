/** src/ importiert jobs/ nicht; startup/verdrahtung.ts gibt die Ausführung jedem
 * Bereich als Teil seines Kontexts. Wer bewusst ohne läuft (Skripte, Tests), gibt
 * OHNE_NACHARBEIT ausdrücklich. */
export interface Nacharbeit {
  /** Etwa nach einem Währungswechsel. */
  preisJobAnstossen(): void;
  preisFuerSetHolen(setNumber: string, userId: number, zustand: string | null): Promise<void>;
  bildVormerken(url: string, setNumber: string | null): void;
  setTeileAnreichern(setNumber: string): Promise<unknown>;
  figurenAnreichern(setNumber: string): Promise<unknown>;
  setBilderLaden(setNumber: string): Promise<unknown>;
  /** Das geladene Set-Bild im Katalog eintragen: Die Bilder liegen unter dem Katalog. */
  setBildLokalEintragen(setNumber: string, quelle: string | null): Promise<void>;
}

export const OHNE_NACHARBEIT: Nacharbeit = Object.freeze({
  preisJobAnstossen() {},
  async preisFuerSetHolen() {},
  bildVormerken() {},
  async setTeileAnreichern() {},
  async figurenAnreichern() {},
  async setBilderLaden() {},
  async setBildLokalEintragen() {},
});
