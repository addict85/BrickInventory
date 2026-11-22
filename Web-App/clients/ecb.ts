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
export interface Rate {
  tag: string;
  currency: string;
  je_eur: number;
}

/** Loads an address; replaced by a local server in tests. */
export type Fetch = (url: string, signal?: AbortSignal) => Promise<Buffer>;

/** The real fetch: rejects everything except HTTPS to the ECB host. */
export const ecbFetch: Fetch = async (url, signal) => {
  if (!url.startsWith('https://') || !hostAllowed(url, ALLOWED_RATE_HOSTS))
    throw new Error(`Kursabruf nur von https://${ALLOWED_RATE_HOSTS.join(', ')}: ${url.slice(0, 120)}`);
  const r = await holeHttps(url, {
    hosts: ALLOWED_RATE_HOSTS,
    maxBytes: 16 * 1024 * 1024,
    timeoutMs: 60_000,
    redirects: 0,
    ...(signal ? { signal } : {}),
  });
  if (r.status !== 200) throw new Error(`EZB ${r.status} für ${url}`);
  return r.body;
};

const CURRENCY = /^[A-Z]{3}$/;
const TAG = /^\d{4}-\d{2}-\d{2}$/;

/** The daily file: <Cube time="…"><Cube currency="USD" rate="1.08"/>…</Cube>. */
export function readDailyRates(xml: string): Rate[] {
  const from: Rate[] = [];
  for (const tagBlock of xml.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g)) {
    for (const k of (tagBlock[2] ?? '').matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g)) {
      const je = Number(k[2]);
      if (Number.isFinite(je) && je > 0) from.push({ tag: tagBlock[1] ?? '', currency: k[1] ?? '', je_eur: je });
    }
  }
  return from;
}

/** The history as CSV: header "Date,USD,JPY,…", missing values as "N/A" or empty. */
export function readHistory(csv: string): Rate[] {
  const rows = csv.split(/\r?\n/).filter(z => z.trim());
  const header = (rows.shift() ?? '').split(',').map(s => s.trim());
  const from: Rate[] = [];
  for (const z of rows) {
    const fields = z.split(',').map(s => s.trim());
    const tag = fields[0] ?? '';
    if (!TAG.test(tag)) continue;
    for (let i = 1; i < header.length; i++) {
      const w = header[i] ?? '',
        je = Number(fields[i]);
      if (CURRENCY.test(w) && w !== 'EUR' && fields[i] && Number.isFinite(je) && je > 0)
        from.push({ tag, currency: w, je_eur: je });
    }
  }
  return from;
}

/**
 * Unpack the first file of a ZIP archive. The ECB puts exactly one CSV
 * in it; a small reader of our own instead of a package, because only "stored"
 * and "deflate" occur. The sizes are in the central directory; the
 * local header may omit them (bit 3).
 */
export function firstZipFile(zip: Buffer): Buffer {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('kein ZIP-Archiv');
  const directory = zip.readUInt32LE(end + 16);
  if (zip.readUInt32LE(directory) !== 0x02014b50) throw new Error('ZIP: zentrales Verzeichnis fehlt');
  const method = zip.readUInt16LE(directory + 10);
  const packed = zip.readUInt32LE(directory + 20);
  const local = zip.readUInt32LE(directory + 42);
  if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('ZIP: lokaler Kopf fehlt');
  const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const raw = zip.subarray(data, data + packed);
  if (method === 0) return Buffer.from(raw);
  if (method === 8) return inflateRawSync(raw);
  throw new Error(`ZIP: Kompression ${method} unbekannt`);
}
