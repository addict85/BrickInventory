/** Hier wird nur aus dem Request gelesen und geantwortet; die Regeln stehen in
 * src/geraete/geraeteChallenge.ts. Browser-Sitzungen bleiben beim Passwort und
 * zweiten Faktor: Sie haben keinen Keystore. */
import type { Request, Response, NextFunction } from 'express';
import { familieAus, type Schrittaktion } from '../../geraete';
import { meldeFehler } from '../../infra/fehler';
import { sendeFehler } from '../../http/httpAntwort';
import { istVerwalter } from './anmeldung';
import type { KontoDienste } from '../bereich';
import { routeFuerAnfrage } from '../../vertrag';

/** Ein Bearer-Token ohne Sitzung: So fragt die App. Hat die Anfrage beides, gilt die Sitzung (nutzerIdDerAnfrage). */
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
    sendeFehler(req, res, 'verboten', p === 'kein_schluessel' ? 'geraeteschluessel_fehlt' : 'schritt_freigabe_noetig');
  } catch (e) {
    meldeFehler('schrittschutz', e);
    sendeFehler(req, res, 'nicht_verfuegbar', 'server_ausgelastet');
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

/** Hinter anmeldungAmEingang, vor dem Lesen des Rumpfs. Welche Schritte geschützt sind, sagt
 * die Marke `schritt` am Vertrag; res.locals.schritt hält fest, was hier freigegeben wurde,
 * damit vertragsRouter an der Route selbst nachsieht (eine zweite Linie, falls die Zuordnung hier fehlgeht). */
export function schrittschutzAmEingang(konto: KontoDienste) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const aktion = routeFuerAnfrage(req.method, req.baseUrl + req.path)?.schritt;
    res.locals.schritt = aktion ?? null;
    if (aktion) verlangeFreigabe(konto, req, res, next, aktion);
    else next();
  };
}
