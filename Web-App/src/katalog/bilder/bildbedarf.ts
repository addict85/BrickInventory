import { logAndContinue, meldeUndLiefere } from '../../infra/fehler';
import { stelleAuftragEin } from '../../auftraege/dienst';
import * as repo from '../repository/bildbedarf';

/** Daten, keine Warteschlange: je Adresse eine Zeile. Abgearbeitet vom EINEN
 * Auftrag 'bildbedarf', der in Stapeln mit Rücksicht auf das CDN holt. */

/** Zehn Bilder je Durchgang, alle 20 Sekunden: dreissig Anfragen je Minute. */
export const STAPEL = 10;
export const TAKT_MS = 20_000;
/** Was seit Tagen niemand ansah, eilt nicht. */
export const NOTIZ_GILT_MS = 3 * 24 * 60 * 60 * 1000;
export const BILDBEDARF_SCHLUESSEL = 'bildbedarf';

export function anfragenJeMinute(): number {
  return STAPEL * (60_000 / TAKT_MS);
}

/** Steht er schon offen, bleibt es bei einem. */
export async function bildbedarfAnstossen(): Promise<void> {
  await stelleAuftragEin('bildbedarf', {}, { schluessel: BILDBEDARF_SCHLUESSEL, maxVersuche: 3 });
}

/** Ein INSERT je Bildanfrage leerte bei einer Kachelwand den Pool. Was bei
 * einem Absturz im Puffer liegt, fragt der nächste Aufruf wieder an. */
const _puffer = new Map<string, string>();   // url → set_number

/** Hält die Anfrage nie auf. */
export function merkeGebraucht(url: string, setNumber: string | null): void {
  if (!setNumber) return;
  if (_puffer.size < 500) _puffer.set(url, setNumber);
}

export async function notiereBildbedarf(urls: string[], sets: string[]): Promise<void> {
  await repo.merkeBildwuensche(urls, sets);
}

export async function schreibePuffer(): Promise<void> {
  if (!_puffer.size) return;
  const urls = [..._puffer.keys()];
  const sets = urls.map(u => _puffer.get(u)!);
  _puffer.clear();
  await notiereBildbedarf(urls, sets).catch(logAndContinue('bild-job:sets'));
  await bildbedarfAnstossen().catch(logAndContinue('bild-job:anstossen'));
}

export async function initImageQueue(): Promise<void> {
  setInterval(() => { schreibePuffer().catch(logAndContinue('bild-job:schreibePuffer')); }, 10_000).unref();
}

// Ausführlich: docs/begruendungen/src/katalog/bilder/bildbedarf.ts.md#loescheverfallene
export async function loescheVerfallene(): Promise<number> {
  const r = await repo.loescheAlteBildwuensche(String(NOTIZ_GILT_MS)).catch(meldeUndLiefere('bild-job:r', null));
  return r?.changes || 0;
}

export async function offenerBildbedarf(): Promise<number> {
  return (await repo.zaehleBildwuensche())?.n ?? 0;
}

export async function leereBildbedarf(): Promise<number> {
  return (await repo.loescheAlleBildwuensche())?.changes ?? 0;
}

/** In einem Schritt herausgenommen, damit zwei Läufe nicht dieselben Bilder holen. */
export function nimmBildwuensche(gueltigMs: number, anzahl: number): Promise<{ url: string; set_number: string | null }[]> {
  return repo.entnimmBildwuensche(String(gueltigMs), anzahl);
}
