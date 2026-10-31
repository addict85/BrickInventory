/**
 * Arbeit, die utils/ anstösst und jobs/ ausführt. utils/ importiert jobs/
 * nicht; jobs/verdrahtung.ts setzt die Ausführung beim Start jedes Prozesses
 * ein. Ohne Verdrahtung (Skripte) entfällt sie: Sie ist Nacharbeit, nie
 * Voraussetzung für eine Antwort.
 */
export interface Nacharbeit {
  /** Den Preis-Job anstossen, etwa nach einem Währungswechsel. */
  preisJobAnstossen(): void;
  /** Den Marktpreis eines Sets jetzt holen und in den Cache schreiben. */
  preisFuerSetHolen(setNumber: string, userId: number, zustand: string | null): Promise<void>;
  /** Ein Bild beim Bild-Job zum Herunterladen vormerken. */
  bildVormerken(url: string, setNumber: string | null): void;
  /** Den gemeinsamen Teilekatalog eines Sets jetzt füllen (Name, Farbe, Bild). */
  setTeileAnreichern(setNumber: string): Promise<unknown>;
  /** Die Figuren eines Sets samt ihren Teilen in den Katalog. */
  figurenAnreichern(setNumber: string): Promise<unknown>;
  /** Die noch fehlenden Bilder einer Setliste herunterladen. */
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

/** Kurzform für Aufrufer, die die Anreicherung als Rückruf weitergeben. */
export const setTeileAnreichern = (setNumber: string) => _aktuell.setTeileAnreichern(setNumber);
