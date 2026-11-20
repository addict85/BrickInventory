/** `sameSite: strict` hält fremde Websites ab, aber keine Nachbar-Subdomain.
 * Fehlt bei einer Cookie-Sitzung jede Herkunftsangabe, wird abgelehnt;
 * Bearer-Token schickt kein Browser von selbst mit. */
import type { Request, Response, NextFunction } from 'express';
import { konfig } from '../infra/konfig';
import { carriesSessionCookie } from './sitzungsKeks';
import { sendError } from './httpAntwort';

const READING = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostOf(adresse: string): string | null {
  try {
    const u = new URL(adresse);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

function ownHosts(req: Request): Set<string> {
  const hosts = new Set<string>();
  const kopf = String(req.headers.host || '').toLowerCase();
  if (kopf) hosts.add(kopf);
  const adresse = konfig().appBaseUrl;
  const basis = adresse ? hostOf(adresse) : null;
  if (basis) hosts.add(basis);
  return hosts;
}

export function onlyOwnOrigin(req: Request, res: Response, next: NextFunction) {
  if (READING.has(req.method)) return next();
  // Mit Cookie entscheidet die Sitzung; ein Bearer-Kopf daneben schaltet nichts ab.
  const withSession = carriesSessionCookie(String(req.headers.cookie || ''));
  if (!withSession && String(req.headers.authorization || '').startsWith('Bearer ')) return next();
  const fremd = () => sendError(req, res, 'verboten', 'fremde_herkunft');

  const herkunft = String(req.headers['sec-fetch-site'] || '');
  if (herkunft) return herkunft === 'same-origin' || herkunft === 'none' ? next() : fremd();

  const quelle = req.headers.origin ?? req.headers.referer;
  if (quelle !== undefined) {
    const host = hostOf(String(quelle));
    return host && ownHosts(req).has(host) ? next() : fremd();
  }
  // Ein Browser, der nichts meldet, ist nicht prüfbar.
  return withSession ? fremd() : next();
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const IP_ADDRESS = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/;
const FREE = /^\/(ca\.crt|api\/v1\/health(\/live|\/ready)?)$/;

/** Ohne Basis-URL nennt die Absage die Adresse, unter der die Anfrage ankam. */
function ownIp(req: Request): string {
  const ip = (req.socket.localAddress ?? '').replace(/^::ffff:/, '');
  return ip.includes(':') ? `[${ip}]` : ip;
}

/** Nur der Name aus APP_BASE_URL, gegen DNS-Rebinding; ohne sie gar kein Name. Frei: Loopback,
 * IP-Adressen (die Android-App; nur ein Name lässt sich umbiegen), Wurzelzertifikat, Gesundheit. */
export function onlyOwnHost(req: Request, res: Response, next: NextFunction) {
  if (FREE.test(req.path)) return next();
  const adresse = konfig().appBaseUrl;
  const name = (h: string) => h.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const kopf = name(String(req.headers.host || ''));
  if (LOOPBACK.has(kopf) || IP_ADDRESS.test(kopf) || (adresse && kopf === name(hostOf(adresse) ?? ''))) return next();
  sendError(req, res, 'falscher_host', 'fremder_host', { adresse: adresse ?? ownIp(req) });
}
