/** `sameSite: strict` hält fremde Websites ab, aber keine Nachbar-Subdomain.
 * Fehlt bei einer Cookie-Sitzung jede Herkunftsangabe, wird abgelehnt;
 * Bearer-Token schickt kein Browser von selbst mit. */
import type { Request, Response, NextFunction } from 'express';
import { sendeFehler } from '../infra/fehlerTexte';
import { konfig } from '../infra/konfig';
import { traegtSitzungsKeks } from './sitzungsKeks';

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
  const mitSitzung = traegtSitzungsKeks(String(req.headers.cookie || ''));
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

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const IP_ADRESSE = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/;
const FREI = /^\/(ca\.crt|api\/v1\/health(\/live|\/ready)?)$/;

/** Mit APP_BASE_URL nur dieser Name, gegen DNS-Rebinding. Frei: Loopback, IP-Adressen
 * (die Android-App; nur ein Name lässt sich umbiegen), Wurzelzertifikat, Gesundheit. */
export function nurEigenerHost(req: Request, res: Response, next: NextFunction) {
  const adresse = konfig().appBaseUrl;
  if (!adresse || FREI.test(req.path)) return next();
  const name = (h: string) => h.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const kopf = name(String(req.headers.host || ''));
  if (LOOPBACK.has(kopf) || IP_ADRESSE.test(kopf) || kopf === name(hostVon(adresse) ?? '')) return next();
  sendeFehler(req, res, 421, 'fremder_host', { adresse });
}
