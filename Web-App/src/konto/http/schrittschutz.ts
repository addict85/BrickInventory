/** Hier wird nur aus dem Request gelesen und geantwortet; die Regeln stehen in
 * src/konto/geraeteChallenge.ts. Browser-Sitzungen bleiben beim Passwort und
 * zweiten Faktor: Sie haben keinen Keystore. */
import type { Request, Response, NextFunction } from 'express';
import { familieAus, type Schrittaktion } from '../geraeteChallenge';
import { meldeFehler } from '../../infra/fehler';
import { sendeFehler } from '../../http/httpAntwort';
import { istVerwalter } from './anmeldung';
import type { KontoDienste } from '../bereich';

/** Die Schritte, vor denen die App ihren Schrittschutz zeigt. Die Verwaltung
 * prüft requireApiAdmin selbst, damit keine Verwalter-Route an der Liste vorbeigeht. */
const GESCHUETZT: ReadonlyArray<readonly [string, RegExp, Schrittaktion]> = [
  ['POST', /^\/vouchers\/\d+\/(klartext|pdf-freigabe)$/, 'gutschein'],
  ['POST', /^\/vouchers\/export\/pdf-freigabe$/, 'gutschein'],
  ['DELETE', /^\/vouchers\/\d+$/, 'gutschein'],
  ['POST', /^\/auth\/zweiter-faktor\/(einrichten|codes)$/, 'zweiter_faktor'],
];

/** Ein Bearer-Token ohne Sitzung: So fragt die App. Hat die Anfrage beides, gilt die Sitzung (resolveUserId). */
export function istAppToken(req: Request): boolean {
  return !req.session?.userId && (req.headers.authorization ?? '').startsWith('Bearer ');
}

export function verlangeFreigabe(
  konto: KontoDienste,
  req: Request,
  res: Response,
  next: NextFunction,
  aktion: Schrittaktion,
): void {
  void freigegeben(konto, req, res, aktion).then(ok => {
    if (ok) next();
  });
}

/** Wie verlangeFreigabe, als Wert: für Routen, die nur für Verwalter mehr tun.
 * Bei `false` ist die Absage schon gesendet. */
export async function freigegeben(
  konto: KontoDienste,
  req: Request,
  res: Response,
  aktion: Schrittaktion,
): Promise<boolean> {
  if (!istAppToken(req)) return true;
  const f = familieAus(req.apiUser);
  try {
    // Ohne Familie (kein created_at) gibt es keinen Schlüssel: zu, nicht offen.
    const p = f ? await konto.pruefeFreigabe(f, aktion) : 'kein_schluessel';
    if (p === 'frei') return true;
    sendeFehler(req, res, 403, p === 'kein_schluessel' ? 'geraeteschluessel_fehlt' : 'schritt_freigabe_noetig');
  } catch (e) {
    meldeFehler('schrittschutz', e);
    sendeFehler(req, res, 503, 'server_ausgelastet');
  }
  return false;
}

/** Für Lesewege, die Verwaltern mehr zeigen: Ein App-Token ohne Freigabe
 * sieht dort, was jedes Konto sieht, statt eine Absage zu bekommen. */
export async function alsVerwalter(konto: KontoDienste, req: Request): Promise<boolean> {
  if (!istVerwalter(req)) return false;
  if (!istAppToken(req)) return true;
  const f = familieAus(req.apiUser);
  return !!f && (await konto.pruefeFreigabe(f, 'verwaltung')) === 'frei';
}

/** Hinter anmeldungAmEingang, vor dem Lesen des Rumpfs. */
export function schrittschutzAmEingang(konto: KontoDienste) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const regel = GESCHUETZT.find(([m, re]) => m === req.method && re.test(req.path));
    if (regel) verlangeFreigabe(konto, req, res, next, regel[2]);
    else next();
  };
}
