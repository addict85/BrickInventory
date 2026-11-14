import { logAndContinue } from '../infra/fehler';
import { Zwischenspeicher } from '../infra/zwischenspeicher';
import type { BilderKontext } from './kontext';

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
export async function bildbedarfAnstossen(k: BilderKontext): Promise<void> {
  await k.auftraege.stelleAuftragEin('bildbedarf', {}, { schluessel: BILDBEDARF_SCHLUESSEL, maxVersuche: 3 });
}

/** Ein INSERT je Bildanfrage leerte bei einer Kachelwand den Pool. Was bei
 * einem Absturz im Puffer liegt, fragt der nächste Aufruf wieder an. */
const puffer = (k: BilderKontext) => k.faecher.fach('bildbedarf:puffer', () => new Map<string, string>()); // url → set_number
const takte = (k: BilderKontext) => k.faecher.fach('bildbedarf:takte', (): NodeJS.Timeout[] => []);

/** Je Set einmal in 15 Minuten, höchstens 5000 gemerkt: Der Bild-Proxy fragt für jede
 * Kachel, und ein Konto mit erfundenen Nummern füllte sonst die Notizen. */
export function bildEinmalVormerken(k: BilderKontext, url: string, setNummer: string): void {
  const gemerkt = k.faecher.fach('bildbedarf:vorgemerkt', () => new Zwischenspeicher<string, true>(5000, 15 * 60_000));
  if (gemerkt.hole(setNummer)) return;
  gemerkt.setze(setNummer, true);
  k.nacharbeit.bildVormerken(url, setNummer);
}

/** Hält die Anfrage nie auf. */
export function merkeGebraucht(k: BilderKontext, url: string, setNumber: string | null): void {
  if (!setNumber) return;
  if (puffer(k).size < 500) puffer(k).set(url, setNumber);
}

export async function notiereBildbedarf(k: BilderKontext, urls: string[], sets: (string | null)[]): Promise<void> {
  await k.bildbedarf.merkeBildwuensche(urls, sets);
}

/** Geschrieben über den Kontext dessen, der den Takt gestartet hat (initImageQueue). */
export async function schreibePuffer(k: BilderKontext): Promise<void> {
  const _puffer = puffer(k);
  if (!_puffer.size) return;
  const urls = [..._puffer.keys()];
  const sets = urls.map(u => _puffer.get(u)!);
  _puffer.clear();
  // Scheitert das Schreiben, geht der Puffer zurück und der Fehler an den Takt: nichts geht verloren.
  try {
    await notiereBildbedarf(k, urls, sets);
  } catch (e) {
    for (const [i, u] of urls.entries()) _puffer.set(u, sets[i]!);
    throw e;
  }
  await bildbedarfAnstossen(k);
}

export async function initImageQueue(k: BilderKontext): Promise<void> {
  const _takte = takte(k);
  if (_takte.length) return;
  _takte.push(
    setInterval(() => {
      schreibePuffer(k).catch(logAndContinue('bild-job:schreibePuffer'));
    }, 10_000),
  );
  _takte[0]?.unref();
}

/** Vor dem Schliessen des Pools: Was im Puffer liegt, braucht noch eine Verbindung. */
export async function stoppeBildbedarf(k: BilderKontext): Promise<void> {
  for (const t of takte(k).splice(0)) clearInterval(t);
  await schreibePuffer(k);
}

// Sonst bleiben alte Notizen.
export async function loescheVerfallene(k: BilderKontext): Promise<number> {
  const r = await k.bildbedarf.loescheAlteBildwuensche(String(NOTIZ_GILT_MS));
  return r?.changes || 0;
}

/** Katalogbilder für den Bildbedarf vormerken; liefert, wie viele neu dazukamen. */
export async function katalogBilderVormerken(k: BilderKontext, urls: string[], sets: string[]): Promise<number> {
  return (await k.bildbedarf.reiheKatalogBilderEin(urls, sets))?.n ?? 0;
}

export async function offenerBildbedarf(k: BilderKontext): Promise<number> {
  return (await k.bildbedarf.zaehleBildwuensche())?.n ?? 0;
}

export async function leereBildbedarf(k: BilderKontext): Promise<number> {
  return (await k.bildbedarf.loescheAlleBildwuensche())?.changes ?? 0;
}

/** In einem Schritt herausgenommen, damit zwei Läufe nicht dieselben Bilder holen. */
export function nimmBildwuensche(
  k: BilderKontext,
  gueltigMs: number,
  anzahl: number,
): Promise<{ url: string; set_number: string | null }[]> {
  return k.bildbedarf.entnimmBildwuensche(String(gueltigMs), anzahl);
}
