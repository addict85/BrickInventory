/** Bilder von den CDNs (Rebrickable, BrickLink, Brickset, LEGO): Host-Liste,
 * Kopfzeilen und Verbindungspool an einer Stelle statt je Aufrufer. */
import https from 'node:https';
import { openHttps, holeHttps, type FetchStream, type FetchResponse } from '../src/infra/fetch';
import { ALLOWED_IMAGE_HOSTS } from '../src/infra/foreignAddresses';
import { publicLookup } from '../src/infra/targetAddress';

const BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const IMAGE_ASSUMPTION = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';

/** Ohne Browser-Kennung und Referer weist das Rebrickable-CDN Bildabrufe ab. */
export const IMAGE_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': BROWSER,
  Referer: 'https://rebrickable.com/',
  Accept: IMAGE_ASSUMPTION,
};
/** Der zweite Satz ohne Referer: Der Hotlink-Schutz antwortet auf einen unpassenden mit 404. */
export const IMAGE_HEADERS_WITHOUT_REFERER: Readonly<Record<string, string>> = {
  'User-Agent': BROWSER,
  Accept: IMAGE_ASSUMPTION,
};

/** Begrenzt, damit eine Kachelwand nicht beliebig viele TLS-Verbindungen öffnet;
 * IPv4, weil Abrufe ohne IPv6-Route sonst stumm bis zur Frist liefen. */
const POOL = new https.Agent({
  keepAlive: true,
  maxSockets: 32,
  maxFreeSockets: 16,
  timeout: 30_000,
  family: 4,
  lookup: publicLookup,
});

export interface ImageFetch {
  maxBytes: number;
  zeitlimitMs?: number;
  kopfzeilen?: Record<string, string>;
  hosts?: readonly string[];
  redirects?: number;
  /** Der Bild-Proxy hält Verbindungen offen; Einzelabrufe brauchen das nicht. */
  pool?: boolean;
  signal?: AbortSignal;
}

const optionen = (o: ImageFetch) => ({
  hosts: o.hosts ?? ALLOWED_IMAGE_HOSTS,
  maxBytes: o.maxBytes,
  zeitlimitMs: o.zeitlimitMs ?? 30_000,
  kopfzeilen: o.kopfzeilen ?? { ...IMAGE_HEADERS },
  ...(o.redirects !== undefined ? { redirects: o.redirects } : {}),
  ...(o.pool ? { agent: POOL } : {}),
  ...(o.signal ? { signal: o.signal } : {}),
});

/** Kopf und begrenzter Strom: für den Proxy und Dateien. */
export function oeffneBild(url: string, o: ImageFetch): Promise<FetchStream> {
  return openHttps(url, optionen(o));
}

/** Das ganze Bild im Speicher: für kleine Set-Bilder. */
export function fetchImage(url: string, o: ImageFetch): Promise<FetchResponse> {
  return holeHttps(url, optionen(o));
}
