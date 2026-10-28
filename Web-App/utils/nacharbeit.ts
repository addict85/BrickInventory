/**
 * Arbeit, die utils/ anstösst und jobs/ ausführt. utils/ importiert jobs/
 * nicht; jobs/verdrahtung.ts setzt die Ausführung beim Start jedes Prozesses
 * ein. Ohne Verdrahtung (Skripte) entfällt sie: Sie ist Nacharbeit, nie
 * Voraussetzung für eine Antwort.
 */
export interface Nacharbeit {
  /** Teile, Figuren, Anleitung und Bilder zu einem erfassten Set nachziehen. */
  zieheNach(setNumber: string, userId: number): void;
  zieheNachNeuanlage(setNumber: string, userId: number): void;
  /** Den Preis-Job anstossen, etwa nach einem Währungswechsel. */
  preisJobAnstossen(): void;
  /** Den Marktpreis eines Sets jetzt holen und in den Cache schreiben. */
  preisFuerSetHolen(setNumber: string, userId: number, zustand: string | null): Promise<void>;
  /** Ein Bild beim Bild-Job zum Herunterladen vormerken. */
  bildVormerken(url: string, setNumber: string | null): void;
}

const OHNE: Nacharbeit = {
  zieheNach() {}, zieheNachNeuanlage() {}, preisJobAnstossen() {},
  async preisFuerSetHolen() {}, bildVormerken() {},
};

let _aktuell: Nacharbeit = OHNE;

export function verdrahteNacharbeit(n: Nacharbeit): void { _aktuell = n; }

export function nacharbeit(): Nacharbeit { return _aktuell; }
