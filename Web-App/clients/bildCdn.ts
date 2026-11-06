/** Bilder von den CDNs (Rebrickable, BrickLink, Brickset, LEGO): Host-Liste,
 * Kopfzeilen und Verbindungspool an einer Stelle statt je Aufrufer. */
import https from 'https';
import { oeffneHttps, holeHttps, type AbrufStrom, type AbrufAntwort } from '../src/infra/abruf';
import { ERLAUBTE_BILD_HOSTS } from '../src/infra/fremdeAdressen';

const BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BILD_ANNAHME = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';

/** Ohne Browser-Kennung und Referer weist das Rebrickable-CDN Bildabrufe ab. */
export const BILD_KOPFZEILEN: Readonly<Record<string, string>> = {
  'User-Agent': BROWSER,
  Referer: 'https://rebrickable.com/',
  Accept: BILD_ANNAHME,
};
/** Der zweite Satz ohne Referer: Der Hotlink-Schutz antwortet auf einen unpassenden mit 404. */
export const BILD_KOPFZEILEN_OHNE_REFERER: Readonly<Record<string, string>> = {
  'User-Agent': BROWSER,
  Accept: BILD_ANNAHME,
};

/** Begrenzt, damit eine Kachelwand nicht beliebig viele TLS-Verbindungen öffnet;
 * IPv4, weil Abrufe ohne IPv6-Route sonst stumm bis zur Frist liefen.
 * Ausführlich: docs/begruendungen/clients/bildCdn.ts.md#cdnagent */
const POOL = new https.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 16, timeout: 30_000, family: 4 });

export interface BildAbruf {
  maxBytes: number;
  zeitlimitMs?: number;
  kopfzeilen?: Record<string, string>;
  hosts?: readonly string[];
  umleitungen?: number;
  /** Der Bild-Proxy hält Verbindungen offen; Einzelabrufe brauchen das nicht. */
  pool?: boolean;
  signal?: AbortSignal;
}

const optionen = (o: BildAbruf) => ({
  hosts: o.hosts ?? ERLAUBTE_BILD_HOSTS,
  maxBytes: o.maxBytes,
  zeitlimitMs: o.zeitlimitMs ?? 30_000,
  kopfzeilen: o.kopfzeilen ?? { ...BILD_KOPFZEILEN },
  ...(o.umleitungen !== undefined ? { umleitungen: o.umleitungen } : {}),
  ...(o.pool ? { agent: POOL } : {}),
  ...(o.signal ? { signal: o.signal } : {}),
});

/** Kopf und begrenzter Strom: für den Proxy und Dateien. */
export function oeffneBild(url: string, o: BildAbruf): Promise<AbrufStrom> {
  return oeffneHttps(url, optionen(o));
}

/** Das ganze Bild im Speicher: für kleine Set-Bilder. */
export function holeBild(url: string, o: BildAbruf): Promise<AbrufAntwort> {
  return holeHttps(url, optionen(o));
}
