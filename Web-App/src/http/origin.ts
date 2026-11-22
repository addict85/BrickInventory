/** `sameSite: strict` keeps foreign websites out, but not a neighboring subdomain.
 * If a cookie session lacks any origin information, it is rejected;
 * no browser sends a bearer token on its own. */
import type { Request, Response, NextFunction } from 'express';
import { konfig } from '../infra/config';
import { carriesSessionCookie } from './sitzungsKeks';
import { sendError } from './httpResponse';

const READING = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostOf(address: string): string | null {
  try {
    const u = new URL(address);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

function ownHosts(req: Request): Set<string> {
  const hosts = new Set<string>();
  const header = String(req.headers.host || '').toLowerCase();
  if (header) hosts.add(header);
  const address = konfig().appBaseUrl;
  const basis = address ? hostOf(address) : null;
  if (basis) hosts.add(basis);
  return hosts;
}

export function onlyOwnOrigin(req: Request, res: Response, next: NextFunction) {
  if (READING.has(req.method)) return next();
  // With a cookie the session decides; a bearer header next to it switches nothing off.
  const withSession = carriesSessionCookie(String(req.headers.cookie || ''));
  if (!withSession && String(req.headers.authorization || '').startsWith('Bearer ')) return next();
  const fremd = () => sendError(req, res, 'verboten', 'fremde_herkunft');

  const origin = String(req.headers['sec-fetch-site'] || '');
  if (origin) return origin === 'same-origin' || origin === 'none' ? next() : fremd();

  const source = req.headers.origin ?? req.headers.referer;
  if (source !== undefined) {
    const host = hostOf(String(source));
    return host && ownHosts(req).has(host) ? next() : fremd();
  }
  // A browser that reports nothing cannot be checked.
  return withSession ? fremd() : next();
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const IP_ADDRESS = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/;
const FREE = /^\/(ca\.crt|api\/v1\/health(\/live|\/ready)?)$/;

/** Without a base URL the refusal names the address the request arrived at. */
function ownIp(req: Request): string {
  const ip = (req.socket.localAddress ?? '').replace(/^::ffff:/, '');
  return ip.includes(':') ? `[${ip}]` : ip;
}

/** Only the name from APP_BASE_URL, against DNS rebinding; without it no name at all. Exempt: loopback,
 * IP addresses (the Android app; only a name can be redirected), root certificate, health. */
export function onlyOwnHost(req: Request, res: Response, next: NextFunction) {
  if (FREE.test(req.path)) return next();
  const address = konfig().appBaseUrl;
  const name = (h: string) => h.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const header = name(String(req.headers.host || ''));
  if (LOOPBACK.has(header) || IP_ADDRESS.test(header) || (address && header === name(hostOf(address) ?? '')))
    return next();
  sendError(req, res, 'falscher_host', 'fremder_host', { adresse: address ?? ownIp(req) });
}
