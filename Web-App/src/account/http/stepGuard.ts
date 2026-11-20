/** Here we only read from the request and answer; the rules live in
 * src/devices/deviceChallenge.ts. Browser sessions stay with password and
 * second factor: they have no keystore. */
import type { Request, Response, NextFunction } from 'express';
import { familyFrom, type Schrittaktion } from '../../devices';
import { reportError } from '../../infra/error';
import { sendError } from '../../http/httpResponse';
import { istVerwalter } from './login';
import type { AccountServices } from '../area';
import { routeForRequest } from '../../contract';

/** A bearer token without a session: that is how the app asks. If the request has both, the session applies (userIdTheRequest). */
export function isAppToken(req: Request): boolean {
  return !req.session?.userId && (req.headers.authorization ?? '').startsWith('Bearer ');
}

export function requireRelease(
  konto: AccountServices,
  req: Request,
  res: Response,
  next: NextFunction,
  aktion: Schrittaktion,
): void {
  void released(konto, req, res, aktion).then(ok => {
    if (ok) next();
  });
}

/** Like requireRelease, as a value: for routes that only do more for administrators.
 * With `false` the rejection has already been sent. */
export async function released(
  konto: AccountServices,
  req: Request,
  res: Response,
  aktion: Schrittaktion,
): Promise<boolean> {
  if (!isAppToken(req)) return true;
  const f = familyFrom(req.apiUser);
  try {
    // Without a family (no created_at) there is no key: closed, not open.
    const p = f ? await konto.pruefeFreigabe(f, aktion) : 'kein_schluessel';
    if (p === 'frei') return true;
    sendError(req, res, 'verboten', p === 'kein_schluessel' ? 'geraeteschluessel_fehlt' : 'schritt_freigabe_noetig');
  } catch (e) {
    reportError('schrittschutz', e);
    sendError(req, res, 'nicht_verfuegbar', 'server_ausgelastet');
  }
  return false;
}

/** For read paths that show administrators more: an app token without release
 * sees there what every account sees instead of getting a rejection. */
export async function asAdmin(konto: AccountServices, req: Request): Promise<boolean> {
  if (!istVerwalter(req)) return false;
  if (!isAppToken(req)) return true;
  const f = familyFrom(req.apiUser);
  return !!f && (await konto.pruefeFreigabe(f, 'verwaltung')) === 'frei';
}

/** Behind loginAtInbox, before reading the body. Which steps are protected is said by
 * the marker `schritt` on the contract; res.locals.schritt records what was released here,
 * so vertragsRouter checks at the route itself (a second line, in case the mapping here goes wrong). */
export function stepChutzAtInbox(konto: AccountServices) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const aktion = routeForRequest(req.method, req.baseUrl + req.path)?.schritt;
    res.locals.schritt = aktion ?? null;
    if (aktion) requireRelease(konto, req, res, next, aktion);
    else next();
  };
}
