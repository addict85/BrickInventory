/**
 * Die Hebel der Verwaltung an den Hintergrund-Jobs. Routen und utils/
 * importieren jobs/ nicht; jobs/verdrahtung.ts setzt die Ausführung beim
 * Start ein. Ohne Verdrahtung (Skripte) tun die Hebel nichts.
 */
export interface Jobsteuerung {
  /** Ein Set für den Anleitungsabruf einreihen. */
  anleitungEinreihen(setNumber: string): Promise<unknown>;
  /** Offene Anleitungsaufträge. */
  anleitungenOffen(): Promise<number>;
  /** Den Primary bitten, die Anleitungswarteschlange abzuarbeiten. */
  anleitungenLaufAnfordern(): Promise<unknown>;
  /** Stand des Preis-Jobs im eigenen Prozess. */
  preisJobStatus(): unknown;
  /** Den Preis-Job jetzt starten; false, wenn er schon läuft. */
  preisJobJetzt(): Promise<boolean>;
  /** Wie viele Bilder der Bild-Job je Minute holt. */
  bilderJeMinute(): number;
  /** Bilder neu laden, deren Datei fehlt (im Hintergrund). */
  fehlendeBilderNachladen(): Promise<unknown>;
  /** Die Brickset-Warteschlange abarbeiten; `sofort` übergeht die Tageszeit. */
  bricksetWarteschlange(sofort: boolean): Promise<unknown>;
  /** Die täglichen Jobs nach geänderten Uhrzeiten neu planen. */
  zeitplanNeu(): Promise<unknown>;
}

const OHNE: Jobsteuerung = {
  async anleitungEinreihen() {}, async anleitungenOffen() { return 0; }, async anleitungenLaufAnfordern() {},
  preisJobStatus() { return null; }, async preisJobJetzt() { return false; },
  bilderJeMinute() { return 0; }, async fehlendeBilderNachladen() {},
  async bricksetWarteschlange() {}, async zeitplanNeu() {},
};

let _aktuell: Jobsteuerung = OHNE;

export function verdrahteJobsteuerung(j: Jobsteuerung): void { _aktuell = j; }
export function jobsteuerung(): Jobsteuerung { return _aktuell; }

/** Die täglichen Jobs mit Vorgabezeit; die Uhrzeit ist die globale Einstellung job_time_<name>. */
export const DAILY_JOBS = [
  { name: 'brickset_retry', monitorKey: 'bricksetRetry', default: '04:00' },
  { name: 'csv_sync',       monitorKey: 'csvImport',     default: '03:00' },
] as const;
