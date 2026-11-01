/** `sameSite: lax` hält fremde Websites ab, aber keine Nachbar-Subdomain.
 * Fehlt bei einer Cookie-Sitzung jede Herkunftsangabe, wird abgelehnt;
 * Bearer-Token schickt kein Browser von selbst mit. */
import type { Request, Response, NextFunction } from 'express';
import { sendeFehler } from './fehlerTexte';
import { konfig } from './konfig';

const LESEND = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostVon(adresse: string): string | null {
  try {
    const u = new URL(adresse);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.host.toLowerCase() : null;
  } catch { return null; }
}

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
  // Mit Cookie entscheidet die Sitzung; ein Bearer-Kopf daneben schaltet nichts ab.
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
  // Ein Browser, der nichts meldet, ist nicht prüfbar.
  return mitSitzung ? fremd() : next();
}
