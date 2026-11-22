/**
 * Reference rates of the European Central Bank: once the whole series as ZIP,
 * then daily the rates of the last working day. HTTPS only, only the ECB's
 * host, no redirects — a rate from a foreign source would silently falsify
 * every valuation.
 */
import { inflateRawSync } from 'node:zlib';
import { hostAllowed } from '../src/infra/foreignAddresses';
import { holeHttps } from '../src/infra/fetch';

export const ECB_HISTORY = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip';
export const ECB_DAILY_RATES = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
export const ALLOWED_RATE_HOSTS = ['www.ecb.europa.eu'] as const;

/** One rate: how many units of `waehrung` one euro costs on `tag`. */
export interface Kurs {
  tag: string;
  waehrung: string;
  je_eur: number;
}

/** Loads an address; replaced by a local server in tests. */
export type Abruf = (url: string, signal?: AbortSignal) => Promise<Buffer>;

/** The real fetch: rejects everything except HTTPS to the ECB host. */
export const ecbFetch: Abruf = async (url, signal) => {
  if (!url.startsWith('https://') || !hostAllowed(url, ALLOWED_RATE_HOSTS))
    throw new Error(`Kursabruf nur von https://${ALLOWED_RATE_HOSTS.join(', ')}: ${url.slice(0, 120)}`);
  const r = await holeHttps(url, {
    hosts: ALLOWED_RATE_HOSTS,
    maxBytes: 16 * 1024 * 1024,
    zeitlimitMs: 60_000,
    redirects: 0,
    ...(signal ? { signal } : {}),
  });
  if (r.status !== 200) throw new Error(`EZB ${r.status} für ${url}`);
  return r.koerper;
};

const CURRENCY = /^[A-Z]{3}$/;
const TAG = /^\d{4}-\d{2}-\d{2}$/;

/** The daily file: <Cube time="…"><Cube currency="USD" rate="1.08"/>…</Cube>. */
export function readDailyRates(xml: string): Kurs[] {
  const aus: Kurs[] = [];
  for (const tagBlock of xml.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g)) {
    for (const k of (tagBlock[2] ?? '').matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g)) {
      const je = Number(k[2]);
      if (Number.isFinite(je) && je > 0) aus.push({ tag: tagBlock[1] ?? '', waehrung: k[1] ?? '', je_eur: je });
    }
  }
  return aus;
}

/** The history as CSV: header "Date,USD,JPY,…", missing values as "N/A" or empty. */
export function readHistory(csv: string): Kurs[] {
  const zeilen = csv.split(/\r?\n/).filter(z => z.trim());
  const kopf = (zeilen.shift() ?? '').split(',').map(s => s.trim());
  const aus: Kurs[] = [];
  for (const z of zeilen) {
    const felder = z.split(',').map(s => s.trim());
    const tag = felder[0] ?? '';
    if (!TAG.test(tag)) continue;
    for (let i = 1; i < kopf.length; i++) {
      const w = kopf[i] ?? '',
        je = Number(felder[i]);
      if (CURRENCY.test(w) && w !== 'EUR' && felder[i] && Number.isFinite(je) && je > 0)
        aus.push({ tag, waehrung: w, je_eur: je });
    }
  }
  return aus;
}

/**
 * Unpack the first file of a ZIP archive. The ECB puts exactly one CSV
 * in it; a small reader of our own instead of a package, because only "stored"
 * and "deflate" occur. The sizes are in the central directory; the
 * local header may omit them (bit 3).
 */
export function firstZipFile(zip: Buffer): Buffer {
  const ende = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (ende < 0) throw new Error('kein ZIP-Archiv');
  const directory = zip.readUInt32LE(ende + 16);
  if (zip.readUInt32LE(directory) !== 0x02014b50) throw new Error('ZIP: zentrales Verzeichnis fehlt');
  const methode = zip.readUInt16LE(directory + 10);
  const packed = zip.readUInt32LE(directory + 20);
  const lokal = zip.readUInt32LE(directory + 42);
  if (zip.readUInt32LE(lokal) !== 0x04034b50) throw new Error('ZIP: lokaler Kopf fehlt');
  const daten = lokal + 30 + zip.readUInt16LE(lokal + 26) + zip.readUInt16LE(lokal + 28);
  const roh = zip.subarray(daten, daten + packed);
  if (methode === 0) return Buffer.from(roh);
  if (methode === 8) return inflateRawSync(roh);
  throw new Error(`ZIP: Kompression ${methode} unbekannt`);
}
