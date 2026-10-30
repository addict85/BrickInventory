/**
 * Schreibende Anfragen nur von der eigenen Seite. Das Sitzungscookie ist
 * `sameSite: lax` — das hält fremde Websites ab, aber nicht eine Nachbar-
 * Subdomain derselben Site. Browser melden die Herkunft in Sec-Fetch-Site,
 * ältere in Origin oder Referer; fehlt bei einer Cookie-Sitzung beides,
 * wird abgelehnt. Bearer-Token schickt kein Browser von selbst mit.
 */
import type { Request, Response, NextFunction } from 'express';
import { sendeFehler } from './fehlerTexte';
import { konfig } from './konfig';

const LESEND = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Host (mit Port) einer Adresse, oder null für „null", Unlesbares und Fremdschemata. */
function hostVon(adresse: string): string | null {
  try {
    const u = new URL(adresse);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.host.toLowerCase() : null;
  } catch { return null; }
}

/** Unter diesen Namen ist der Server erreichbar: Host-Kopf und APP_BASE_URL. */
function eigeneHosts(req: Request): Set<string> {
  const hosts = new Set<string>();
  const kopf = String(req.headers.host || '').toLowerCase();
  if (kopf) hosts.add(kopf);
  const adresse = konfig().appBaseUrl;
  const basis = adresse ? hostVon(adresse) : null;
  if (basis) hosts.add(basis);
  return hosts;
}

export function nurEigeneHerkunft(req: Request, res: Response, next: NextFunction) {
  if (LESEND.has(req.method)) return next();
  // Nur ohne Sitzungs-Cookie gilt die Anfrage als Token-Anfrage. Mit Cookie
  // entscheidet die Sitzung, und ein Bearer-Kopf daneben schaltet nichts ab.
  const mitSitzung = /(?:^|;\s*)connect\.sid=/.test(String(req.headers.cookie || ''));
  if (!mitSitzung && String(req.headers.authorization || '').startsWith('Bearer ')) return next();
  const fremd = () => sendeFehler(req, res, 403, 'fremde_herkunft');

  const herkunft = String(req.headers['sec-fetch-site'] || '');
  if (herkunft) return herkunft === 'same-origin' || herkunft === 'none' ? next() : fremd();

  const quelle = req.headers.origin ?? req.headers.referer;
  if (quelle !== undefined) {
    const host = hostVon(String(quelle));
    return host && eigeneHosts(req).has(host) ? next() : fremd();
  }
  // Weder Kopf noch Herkunft: Skripte und die App ohne Sitzung dürfen, eine
  // Cookie-Sitzung nicht — ein Browser, der nichts meldet, ist nicht prüfbar.
  return mitSitzung ? fremd() : next();
}
