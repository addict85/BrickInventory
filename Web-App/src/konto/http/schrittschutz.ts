/** Hier wird nur aus dem Request gelesen und geantwortet; die Regeln stehen in
 * src/konto/geraeteChallenge.ts. Browser-Sitzungen bleiben beim Passwort und
 * zweiten Faktor: Sie haben keinen Keystore. */
import type { Request, Response, NextFunction } from 'express';
import { familieAus, pruefeFreigabe, type Schrittaktion } from '../geraeteChallenge';
import { sendeFehler } from '../../infra/fehlerTexte';
import { meldeFehler } from '../../infra/fehler';

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

export function verlangeFreigabe(req: Request, res: Response, next: NextFunction, aktion: Schrittaktion): void {
  if (!istAppToken(req)) {
    next();
    return;
  }
  const f = familieAus(req.apiUser);
  // Ohne Familie (kein created_at) gibt es keinen Schlüssel: zu, nicht offen.
  (f ? pruefeFreigabe(f, aktion) : Promise.resolve('kein_schluessel' as const))
    .then(p => {
      if (p === 'frei') next();
      else sendeFehler(req, res, 403, p === 'kein_schluessel' ? 'geraeteschluessel_fehlt' : 'schritt_freigabe_noetig');
    })
    .catch((e: unknown) => {
      meldeFehler('schrittschutz', e);
      sendeFehler(req, res, 503, 'server_ausgelastet');
    });
}

/** Hinter anmeldungAmEingang, vor dem Lesen des Rumpfs. */
export function schrittschutzAmEingang(req: Request, res: Response, next: NextFunction): void {
  const regel = GESCHUETZT.find(([m, re]) => m === req.method && re.test(req.path));
  if (regel) verlangeFreigabe(req, res, next, regel[2]);
  else next();
}
