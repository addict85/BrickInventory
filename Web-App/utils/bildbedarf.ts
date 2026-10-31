import * as db from '../db/database';
import { logAndContinue, meldeUndLiefere } from '../src/infra/httpError';
import { stelleAuftragEin } from './auftraege';

/**
 * Der Bildbedarf (Tabelle image_wanted): welche Set-Bilder gebraucht wurden
 * und noch nicht lokal liegen. Das sind Daten, keine Warteschlange — je
 * Adresse eine Zeile, die der Proxy in schneller Folge (gepuffert) schreibt
 * und der Knopf „Katalogbilder holen" zu Tausenden. Abgearbeitet wird er vom
 * EINEN Auftrag 'bildbedarf' (jobs/imageQueue.ts), der in Stapeln mit
 * Rücksicht auf das CDN holt, solange Bedarf da ist.
 */

/** Zehn Bilder je Durchgang, alle 20 Sekunden ein Durchgang: dreissig Anfragen je Minute. */
export const STAPEL = 10;
export const TAKT_MS = 20_000;
/** Ältere Notizen als diese verfallen: Was seit Tagen niemand ansah, eilt nicht. */
export const NOTIZ_GILT_MS = 3 * 24 * 60 * 60 * 1000;
export const BILDBEDARF_SCHLUESSEL = 'bildbedarf';

/** Wie viele CDN-Anfragen der Job je Minute stellt — für Schätzungen an anderer Stelle. */
export function anfragenJeMinute(): number {
  return STAPEL * (60_000 / TAKT_MS);
}

/** Den Abarbeiter einstellen; steht er schon offen, bleibt es bei einem. */
export async function bildbedarfAnstossen(): Promise<void> {
  await stelleAuftragEin('bildbedarf', {}, { schluessel: BILDBEDARF_SCHLUESSEL, maxVersuche: 3 });
}

/**
 * Ein Puffer je Prozess: Ein INSERT je Bildanfrage leerte bei einer Kachelwand
 * den Pool für alle anderen Routen. Was bei einem Absturz darin liegt, fragt
 * der nächste Aufruf derselben Seite wieder an.
 */
const _puffer = new Map<string, string>();   // url → set_number

/** Notieren, dass ein Bild gebraucht wurde. Hält die Anfrage nie auf. */
export function merkeGebraucht(url: string, setNumber: string | null): void {
  if (!setNumber) return;
  if (_puffer.size < 500) _puffer.set(url, setNumber);
}

/** Bedarf in einer Anweisung notieren; schon notierte Adressen bleiben, wie sie sind. */
export async function notiereBildbedarf(urls: string[], sets: string[]): Promise<void> {
  await db.run(
    `INSERT INTO image_wanted (url, set_number)
       SELECT * FROM unnest($1::text[], $2::text[])
       ON CONFLICT (url) DO NOTHING`, [urls, sets]);
}

/** Den Puffer in einer Anweisung wegschreiben und den Abarbeiter wecken. */
export async function schreibePuffer(): Promise<void> {
  if (!_puffer.size) return;
  const urls = [..._puffer.keys()];
  const sets = urls.map(u => _puffer.get(u)!);
  _puffer.clear();
  await notiereBildbedarf(urls, sets).catch(logAndContinue('bild-job:sets'));
  await bildbedarfAnstossen().catch(logAndContinue('bild-job:anstossen'));
}

/** In jedem Prozess, der Bilder ausliefert: den Puffer im Takt wegschreiben. */
export async function initImageQueue(): Promise<void> {
  setInterval(() => { schreibePuffer().catch(logAndContinue('bild-job:schreibePuffer')); }, 10_000).unref();
}

/**
 * Verfallene Notizen löschen.
 * Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#loescheverfallene
 */
export async function loescheVerfallene(): Promise<number> {
  const r = await db.run(
    `DELETE FROM image_wanted
      WHERE requested_at <= NOW() - ($1 || ' milliseconds')::interval`,
    [String(NOTIZ_GILT_MS)]
  ).catch(meldeUndLiefere('bild-job:r', null));
  return r?.changes || 0;
}

/** Wie viele Bilder noch gebraucht werden. */
export async function offenerBildbedarf(): Promise<number> {
  return (await db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM image_wanted'))?.n ?? 0;
}

/** Den ganzen Bedarf verwerfen (Verwaltung: Warteschlange leeren). @returns wie viele */
export async function leereBildbedarf(): Promise<number> {
  return (await db.run('DELETE FROM image_wanted'))?.changes ?? 0;
}
