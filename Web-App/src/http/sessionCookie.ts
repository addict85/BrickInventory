import type { CookieOptions, Request } from 'express';
import { cookieSafe, config, type AppConfig } from '../infra/config';

const NAME_TLS = '__Host-bim.sid';
const NAME_WITHOUT_TLS = 'bim.sid';

/** `__Host-` locks out neighboring subdomains; without TLS the browser would not accept it. */
export function sessionCookieName(k: AppConfig = config()): string {
  return cookieSafe(k) ? NAME_TLS : NAME_WITHOUT_TLS;
}

/** For deleting too: without Secure the browser discards the delete command. No maxAge.
 * Strict: no link from a foreign page carries the session along. The UI
 * fetches everything from its own site and thus stays logged in even after a
 * mail link; mail links themselves need no session. */
export function sessionCookieOptions(k: AppConfig = config()): CookieOptions & { path: '/' } {
  return { path: '/', httpOnly: true, sameSite: 'strict', secure: cookieSafe(k) };
}

/** Over http express-session sets no Secure cookie; the response says so instead of guessing "expired". */
export function cookieStaysFrom(req: Pick<Request, 'secure'>, k: AppConfig = config()): boolean {
  return cookieSafe(k) && !req.secure;
}

/** Both names: every session cookie counts for the origin check. */
export function carriesSessionCookie(header: string): boolean {
  return /(?:^|;\s*)(?:__Host-)?bim\.sid=/.test(header);
}
