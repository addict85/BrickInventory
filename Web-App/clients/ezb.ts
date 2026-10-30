/**
 * Referenzkurse der Europäischen Zentralbank: einmal die ganze Reihe als ZIP,
 * danach täglich die Kurse des letzten Arbeitstags. Nur HTTPS, nur der Host
 * der EZB, keine Umleitungen — ein Kurs aus fremder Quelle verfälschte still
 * jede Bewertung.
 */
import { inflateRawSync } from 'zlib';
import { hostErlaubt } from '../utils/fremdeAdressen';

export const EZB_HISTORIE = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip';
export const EZB_TAGESKURSE = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
export const ERLAUBTE_KURS_HOSTS = ['www.ecb.europa.eu'] as const;

/** Ein Kurs: so viele Einheiten `waehrung` kostet ein Euro am `tag`. */
export interface Kurs { tag: string; waehrung: string; je_eur: number }

/** Lädt eine Adresse; im Test ersetzt durch einen lokalen Server. */
export type Abruf = (url: string) => Promise<Buffer>;

/** Der echte Abruf: lehnt alles ausser HTTPS auf den Host der EZB ab. */
export const ezbAbruf: Abruf = async (url) => {
  if (!url.startsWith('https://') || !hostErlaubt(url, ERLAUBTE_KURS_HOSTS))
    throw new Error(`Kursabruf nur von https://${ERLAUBTE_KURS_HOSTS.join(', ')}: ${url.slice(0, 120)}`);
  const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`EZB ${r.status} für ${url}`);
  return Buffer.from(await r.arrayBuffer());
};

const WAEHRUNG = /^[A-Z]{3}$/;
const TAG = /^\d{4}-\d{2}-\d{2}$/;

/** Die Tagesdatei: <Cube time="…"><Cube currency="USD" rate="1.08"/>…</Cube>. */
export function tageskurseLesen(xml: string): Kurs[] {
  const aus: Kurs[] = [];
  for (const tagBlock of xml.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g)) {
    for (const k of (tagBlock[2] ?? '').matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g)) {
      const je = Number(k[2]);
      if (Number.isFinite(je) && je > 0) aus.push({ tag: tagBlock[1] ?? '', waehrung: k[1] ?? '', je_eur: je });
    }
  }
  return aus;
}

/** Die Historie als CSV: Kopf „Date,USD,JPY,…“, fehlende Werte als „N/A“ oder leer. */
export function historieLesen(csv: string): Kurs[] {
  const zeilen = csv.split(/\r?\n/).filter(z => z.trim());
  const kopf = (zeilen.shift() ?? '').split(',').map(s => s.trim());
  const aus: Kurs[] = [];
  for (const z of zeilen) {
    const felder = z.split(',').map(s => s.trim());
    const tag = felder[0] ?? '';
    if (!TAG.test(tag)) continue;
    for (let i = 1; i < kopf.length; i++) {
      const w = kopf[i] ?? '', je = Number(felder[i]);
      if (WAEHRUNG.test(w) && w !== 'EUR' && felder[i] && Number.isFinite(je) && je > 0) aus.push({ tag, waehrung: w, je_eur: je });
    }
  }
  return aus;
}

/**
 * Die erste Datei eines ZIP-Archivs entpacken. Die EZB legt genau eine CSV
 * hinein; ein eigener kleiner Leser statt eines Pakets, weil nur „gespeichert“
 * und „deflate“ vorkommen. Die Grössen stehen im zentralen Verzeichnis, der
 * lokale Kopf darf sie (Bit 3) auslassen.
 */
export function ersteZipDatei(zip: Buffer): Buffer {
  const ende = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (ende < 0) throw new Error('kein ZIP-Archiv');
  const verzeichnis = zip.readUInt32LE(ende + 16);
  if (zip.readUInt32LE(verzeichnis) !== 0x02014b50) throw new Error('ZIP: zentrales Verzeichnis fehlt');
  const methode = zip.readUInt16LE(verzeichnis + 10);
  const gepackt = zip.readUInt32LE(verzeichnis + 20);
  const lokal = zip.readUInt32LE(verzeichnis + 42);
  if (zip.readUInt32LE(lokal) !== 0x04034b50) throw new Error('ZIP: lokaler Kopf fehlt');
  const daten = lokal + 30 + zip.readUInt16LE(lokal + 26) + zip.readUInt16LE(lokal + 28);
  const roh = zip.subarray(daten, daten + gepackt);
  if (methode === 0) return Buffer.from(roh);
  if (methode === 8) return inflateRawSync(roh);
  throw new Error(`ZIP: Kompression ${methode} unbekannt`);
}
