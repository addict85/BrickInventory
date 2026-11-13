import { logAndContinue } from '../../infra/fehler';
import type { KatalogKontext } from '../kontext';
import { katalog } from '../prozess';

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
export async function bildbedarfAnstossen(k: KatalogKontext): Promise<void> {
  await k.auftraege.stelleAuftragEin('bildbedarf', {}, { schluessel: BILDBEDARF_SCHLUESSEL, maxVersuche: 3 });
}

/** Ein INSERT je Bildanfrage leerte bei einer Kachelwand den Pool. Was bei
 * einem Absturz im Puffer liegt, fragt der nächste Aufruf wieder an. */
const _puffer = new Map<string, string>(); // url → set_number

/** Hält die Anfrage nie auf. */
export function merkeGebraucht(url: string, setNumber: string | null): void {
  if (!setNumber) return;
  if (_puffer.size < 500) _puffer.set(url, setNumber);
}

export async function notiereBildbedarf(k: KatalogKontext, urls: string[], sets: (string | null)[]): Promise<void> {
  await k.bildbedarf.merkeBildwuensche(urls, sets);
}

/** Der Puffer gehört dem Prozess (Nacharbeit merkt vor), also auch sein Zugang. */
export async function schreibePuffer(): Promise<void> {
  if (!_puffer.size) return;
  const urls = [..._puffer.keys()];
  const sets = urls.map(u => _puffer.get(u)!);
  _puffer.clear();
  await notiereBildbedarf(katalog(), urls, sets).catch(logAndContinue('bild-job:sets'));
  await bildbedarfAnstossen(katalog()).catch(logAndContinue('bild-job:anstossen'));
}

const _takte: NodeJS.Timeout[] = [];

export async function initImageQueue(): Promise<void> {
  if (_takte.length) return;
  _takte.push(
    setInterval(() => {
      schreibePuffer().catch(logAndContinue('bild-job:schreibePuffer'));
    }, 10_000),
  );
  _takte[0]?.unref();
}

/** Vor dem Schliessen des Pools: Was im Puffer liegt, braucht noch eine Verbindung. */
export async function stoppeBildbedarf(): Promise<void> {
  for (const t of _takte.splice(0)) clearInterval(t);
  await schreibePuffer();
}

// Sonst bleiben alte Notizen.
export async function loescheVerfallene(k: KatalogKontext): Promise<number> {
  const r = await k.bildbedarf.loescheAlteBildwuensche(String(NOTIZ_GILT_MS));
  return r?.changes || 0;
}

/** Katalogbilder für den Bildbedarf vormerken; liefert, wie viele neu dazukamen. */
export async function katalogBilderVormerken(k: KatalogKontext, urls: string[], sets: string[]): Promise<number> {
  return (await k.bildbedarf.reiheKatalogBilderEin(urls, sets))?.n ?? 0;
}

export async function offenerBildbedarf(k: KatalogKontext): Promise<number> {
  return (await k.bildbedarf.zaehleBildwuensche())?.n ?? 0;
}

export async function leereBildbedarf(k: KatalogKontext): Promise<number> {
  return (await k.bildbedarf.loescheAlleBildwuensche())?.changes ?? 0;
}

/** In einem Schritt herausgenommen, damit zwei Läufe nicht dieselben Bilder holen. */
export function nimmBildwuensche(
  k: KatalogKontext,
  gueltigMs: number,
  anzahl: number,
): Promise<{ url: string; set_number: string | null }[]> {
  return k.bildbedarf.entnimmBildwuensche(String(gueltigMs), anzahl);
}
