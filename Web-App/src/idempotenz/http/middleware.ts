/** Hinter der Anmeldung (der Schlüssel gilt je Konto). Gespeichert wird,
 * BEVOR die Antwort hinausgeht: Reisst die Verbindung ab, findet die
 * Wiederholung sie schon vor. */
import type { Request, Response, NextFunction } from 'express';
import { nutzerId } from '../../konto/http/anmeldung';
import { meldeFehler } from '../../infra/fehler';
import * as dienst from '../dienst';
import { routeFuerAnfrage } from '../../vertrag';
import { nichtWiederholbar } from '../../vertrag/grund';
import { sendeFehler } from '../../http/httpAntwort';

const SCHREIBEND = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Antworten geheimer oder bestätigter Routen (Vertrag: `geheim`,
 * `bestaetigung`) landen nie in der Tabelle, auch nicht verschlüsselt. Ihre
 * Wiederholung bekommt 409 statt eines zweiten Laufs oder der alten Antwort. */
export function antwortIstGeheim(methode: string, pfad: string): boolean {
  return nichtWiederholbar(routeFuerAnfrage(methode, pfad));
}

/** Nur Routen mit Vertragseintrag: Ohne ihn ist nicht bekannt, ob die Antwort
 * geheim ist, also wird nichts gespeichert und nichts wiederholt. */
export async function idempotenz(req: Request, res: Response, next: NextFunction) {
  const schluessel = req.get('Idempotency-Key');
  if (schluessel === undefined || !SCHREIBEND.has(req.method)) return next();
  const route = routeFuerAnfrage(req.method, req.baseUrl + req.path);
  if (!route) return next();
  if (!dienst.SCHLUESSEL_MUSTER.test(schluessel)) return sendeFehler(req, res, 400, 'idempotenz_schluessel_ungueltig');
  const uid = nutzerId(req);
  if (uid === null) return next();

  const ausgang = await dienst.beginne(uid, schluessel, dienst.fingerabdruck(req.method, req.originalUrl, req.body));
  if (ausgang.art === 'anders') return sendeFehler(req, res, 422, 'idempotenz_schluessel_anders');
  if (ausgang.art === 'laeuft') {
    res.set('Retry-After', '1');
    return sendeFehler(req, res, 409, 'idempotenz_laeuft');
  }
  if (ausgang.art === 'nicht_wiederholbar') return sendeFehler(req, res, 409, 'idempotenz_nicht_wiederholbar');
  if (ausgang.art === 'wiederholung') {
    res.set('Idempotent-Replay', 'true');
    return res.status(ausgang.status).type('application/json').send(ausgang.antwort);
  }

  const geheim = nichtWiederholbar(route);
  let gemerkt = false;
  const json = res.json.bind(res);
  res.json = (rumpf: unknown) => {
    gemerkt = true;
    void dienst
      .beende(uid, schluessel, res.statusCode, geheim ? null : JSON.stringify(rumpf))
      .catch((e: unknown) => meldeFehler('idempotenz:merken', e))
      .finally(() => json(rumpf));
    return res;
  };
  // Keine JSON-Antwort (Datei, Strom): nichts zu wiederholen, der Schlüssel wird frei.
  res.on('finish', () => {
    if (!gemerkt)
      dienst.gibFrei(uid, schluessel, res.statusCode).catch((e: unknown) => meldeFehler('idempotenz:freigeben', e));
  });
  // Jede Transaktion der Route vermerkt ihre Wirkung am Schlüssel, im selben COMMIT.
  dienst.mitWirkungsVermerk(uid, schluessel, next);
}
