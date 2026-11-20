/** Hier wird nur aus dem Request gelesen und geantwortet; die Regeln stehen in
 * src/devices/deviceChallenge.ts. Browser-Sitzungen bleiben beim Passwort und
 * zweiten Faktor: Sie haben keinen Keystore. */
import type { Request, Response, NextFunction } from 'express';
import { familyFrom, type Schrittaktion } from '../../devices';
import { reportError } from '../../infra/error';
import { sendError } from '../../http/httpResponse';
import { istVerwalter } from './login';
import type { AccountServices } from '../area';
import { routeForRequest } from '../../contract';

/** Ein Bearer-Token ohne Sitzung: So fragt die App. Hat die Anfrage beides, gilt die Sitzung (userIdTheRequest). */
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

/** Wie requireRelease, als Wert: für Routen, die nur für Verwalter mehr tun.
 * Bei `false` ist die Absage schon gesendet. */
export async function released(
  konto: AccountServices,
  req: Request,
  res: Response,
  aktion: Schrittaktion,
): Promise<boolean> {
  if (!isAppToken(req)) return true;
  const f = familyFrom(req.apiUser);
  try {
    // Ohne Familie (kein created_at) gibt es keinen Schlüssel: zu, nicht offen.
    const p = f ? await konto.pruefeFreigabe(f, aktion) : 'kein_schluessel';
    if (p === 'frei') return true;
    sendError(req, res, 'verboten', p === 'kein_schluessel' ? 'geraeteschluessel_fehlt' : 'schritt_freigabe_noetig');
  } catch (e) {
    reportError('schrittschutz', e);
    sendError(req, res, 'nicht_verfuegbar', 'server_ausgelastet');
  }
  return false;
}

/** Für Lesewege, die Verwaltern mehr zeigen: Ein App-Token ohne Freigabe
 * sieht dort, was jedes Konto sieht, statt eine Absage zu bekommen. */
export async function asAdmin(konto: AccountServices, req: Request): Promise<boolean> {
  if (!istVerwalter(req)) return false;
  if (!isAppToken(req)) return true;
  const f = familyFrom(req.apiUser);
  return !!f && (await konto.pruefeFreigabe(f, 'verwaltung')) === 'frei';
}

/** Hinter loginAtInbox, vor dem Lesen des Rumpfs. Welche Schritte geschützt sind, sagt
 * die Marke `schritt` am Vertrag; res.locals.schritt hält fest, was hier freigegeben wurde,
 * damit vertragsRouter an der Route selbst nachsieht (eine zweite Linie, falls die Zuordnung hier fehlgeht). */
export function stepChutzAtInbox(konto: AccountServices) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const aktion = routeForRequest(req.method, req.baseUrl + req.path)?.schritt;
    res.locals.schritt = aktion ?? null;
    if (aktion) requireRelease(konto, req, res, next, aktion);
    else next();
  };
}
