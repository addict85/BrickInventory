import type { CookieOptions, Request } from 'express';
import { cookieSafe, konfig, type Konfig } from '../infra/konfig';

const NAME_TLS = '__Host-bim.sid';
const NAME_WITHOUT_TLS = 'bim.sid';

/** `__Host-` sperrt Nachbar-Subdomains aus; ohne TLS nähme der Browser es nicht an. */
export function sitzungsKeksName(k: Konfig = konfig()): string {
  return cookieSafe(k) ? NAME_TLS : NAME_WITHOUT_TLS;
}

/** Auch fürs Löschen: Ohne Secure verwirft der Browser den Löschbefehl. Kein maxAge.
 * Strict: Kein Link einer fremden Seite trägt die Sitzung mit. Die Oberfläche
 * holt alles per fetch von der eigenen Seite und bleibt so auch nach einem
 * Mail-Link angemeldet; Mail-Links selbst brauchen keine Sitzung. */
export function sessionCookieOptions(k: Konfig = konfig()): CookieOptions & { path: '/' } {
  return { path: '/', httpOnly: true, sameSite: 'strict', secure: cookieSafe(k) };
}

/** Über http setzt express-session kein Secure-Cookie; die Antwort sagt das, statt „abgelaufen“ zu raten. */
export function cookieStaysFrom(req: Pick<Request, 'secure'>, k: Konfig = konfig()): boolean {
  return cookieSafe(k) && !req.secure;
}

/** Beide Namen: Für die Herkunftsprüfung zählt jedes Sitzungscookie. */
export function carriesSessionCookie(kopf: string): boolean {
  return /(?:^|;\s*)(?:__Host-)?bim\.sid=/.test(kopf);
}
