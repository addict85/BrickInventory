import type { CookieOptions } from 'express';
import { cookieSicher, konfig, type Konfig } from './konfig';

const NAME_TLS = '__Host-bim.sid';
const NAME_OHNE_TLS = 'bim.sid';

/** `__Host-` sperrt Nachbar-Subdomains aus; ohne TLS nähme der Browser es nicht an. */
export function sitzungsKeksName(k: Konfig = konfig()): string {
  return cookieSicher(k) ? NAME_TLS : NAME_OHNE_TLS;
}

/** Auch fürs Löschen: Ohne Secure verwirft der Browser den Löschbefehl. Kein maxAge. */
export function sitzungsKeksOptionen(k: Konfig = konfig()): CookieOptions & { path: '/' } {
  return { path: '/', httpOnly: true, sameSite: 'lax', secure: cookieSicher(k) };
}

/** Beide Namen: Für die Herkunftsprüfung zählt jedes Sitzungscookie. */
export function traegtSitzungsKeks(kopf: string): boolean {
  return /(?:^|;\s*)(?:__Host-)?bim\.sid=/.test(kopf);
}
