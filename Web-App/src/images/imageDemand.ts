import { reportError } from '../infra/fehler';
import { ereignis } from '../infra/ereignis';
import { Zwischenspeicher } from '../infra/zwischenspeicher';
import type { ImagesContext } from './context';

/** Daten, keine Warteschlange: je Adresse eine Zeile. Abgearbeitet vom EINEN
 * Auftrag 'bildbedarf', der in Stapeln mit Rücksicht auf das CDN holt. */

/** Zehn Bilder je Durchgang, alle 20 Sekunden: dreissig Anfragen je Minute. */
export const STAPEL = 10;
export const TAKT_MS = 20_000;
/** Was seit Tagen niemand ansah, eilt nicht. */
export const NOTIZ_GILT_MS = 3 * 24 * 60 * 60 * 1000;
export const IMAGE_DEMAND_KEY = 'bildbedarf';

export function requestsJeMinute(): number {
  return STAPEL * (60_000 / TAKT_MS);
}

const setBildGeladen = (k: ImagesContext) =>
  k.faecher.fach('setBildGeladen', () => ereignis<[setNummer: string, quelle: string | null]>('setBildGeladen'));
/** Den Eintrag beim Set macht der Katalog (höher); er horcht hier, statt dass die Bilder ihn rufen. */
export function atSetImageLoaded(k: ImagesContext, fn: (setNummer: string, quelle: string | null) => unknown) {
  return setBildGeladen(k).horche(fn);
}

/** @returns false, wenn ein Horcher scheiterte (er ist protokolliert) */
export function reportSetImageLoaded(k: ImagesContext, setNummer: string, quelle: string | null = null) {
  return setBildGeladen(k).melde(setNummer, quelle);
}

/** Steht er schon offen, bleibt es bei einem. */
export async function imageDemandKick(k: ImagesContext): Promise<void> {
  await k.auftraege.placeJobOne('bildbedarf', {}, { schluessel: IMAGE_DEMAND_KEY, maxAttempts: 3 });
}

/** Ein INSERT je Bildanfrage leerte bei einer Kachelwand den Pool. Was bei
 * einem Absturz im Puffer liegt, fragt der nächste Aufruf wieder an. */
const puffer = (k: ImagesContext) => k.faecher.fach('bildbedarf:puffer', () => new Map<string, string>()); // url → set_number
const takte = (k: ImagesContext) => k.faecher.fach('bildbedarf:takte', (): NodeJS.Timeout[] => []);

/** Je Set einmal in 15 Minuten, höchstens 5000 gemerkt: Der Bild-Proxy fragt für jede
 * Kachel, und ein Konto mit erfundenen Nummern füllte sonst die Notizen. */
export function imageOnceReserve(k: ImagesContext, url: string, setNummer: string): void {
  const gemerkt = k.faecher.fach('bildbedarf:vorgemerkt', () => new Zwischenspeicher<string, true>(5000, 15 * 60_000));
  if (gemerkt.hole(setNummer)) return;
  gemerkt.setze(setNummer, true);
  rememberUsed(k, url, setNummer);
}

/** Hält die Anfrage nie auf. */
export function rememberUsed(k: ImagesContext, url: string, setNumber: string | null): void {
  if (!setNumber) return;
  if (puffer(k).size < 500) puffer(k).set(url, setNumber);
}

export async function noteImageDemand(k: ImagesContext, urls: string[], sets: (string | null)[]): Promise<void> {
  await k.bildbedarf.rememberImageRequests(urls, sets);
}

/** Geschrieben über den Kontext dessen, der den Takt gestartet hat (setUpImageDemand). */
export async function schreibePuffer(k: ImagesContext): Promise<void> {
  const _puffer = puffer(k);
  if (!_puffer.size) return;
  const urls = [..._puffer.keys()];
  const sets = urls.map(u => _puffer.get(u)!);
  _puffer.clear();
  // Scheitert das Schreiben, geht der Puffer zurück und der Fehler an den Takt: nichts geht verloren.
  try {
    await noteImageDemand(k, urls, sets);
  } catch (e) {
    for (const [i, u] of urls.entries()) _puffer.set(u, sets[i]!);
    throw e;
  }
  await imageDemandKick(k);
}

export async function setUpImageDemand(k: ImagesContext): Promise<void> {
  const _ticks = takte(k);
  if (_ticks.length) return;
  _ticks.push(
    setInterval(() => {
      schreibePuffer(k).catch(e => reportError('bild-job:schreibePuffer', e));
    }, 10_000),
  );
  _ticks[0]?.unref();
}

/** Vor dem Schliessen des Pools: Was im Puffer liegt, braucht noch eine Verbindung. */
export async function stopImageDemand(k: ImagesContext): Promise<void> {
  for (const t of takte(k).splice(0)) clearInterval(t);
  await schreibePuffer(k);
}

// Sonst bleiben alte Notizen.
export async function deleteExpired(k: ImagesContext): Promise<number> {
  const r = await k.bildbedarf.deleteOldImageRequests(String(NOTIZ_GILT_MS));
  return r?.changes || 0;
}

/** Katalogbilder für den Bildbedarf vormerken; liefert, wie viele neu dazukamen. */
export async function catalogImagesReserve(k: ImagesContext, urls: string[], sets: string[]): Promise<number> {
  return (await k.bildbedarf.seriesCatalogImagesOne(urls, sets))?.n ?? 0;
}

export async function openImageDemand(k: ImagesContext): Promise<number> {
  return (await k.bildbedarf.countImageRequests())?.n ?? 0;
}

export async function emptyImageDemand(k: ImagesContext): Promise<number> {
  return (await k.bildbedarf.deleteAllImageRequests())?.changes ?? 0;
}

/** In einem Schritt herausgenommen, damit zwei Läufe nicht dieselben Bilder holen. */
export function nimmBildwuensche(
  k: ImagesContext,
  validMs: number,
  anzahl: number,
): Promise<{ url: string; set_number: string | null }[]> {
  return k.bildbedarf.entnimmBildwuensche(String(validMs), anzahl);
}
