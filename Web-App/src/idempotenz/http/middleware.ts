/** Hinter der Anmeldung (der Schlüssel gilt je Konto). Gespeichert wird,
 * BEVOR die Antwort hinausgeht: Reisst die Verbindung ab, findet die
 * Wiederholung sie schon vor. */
import type { Request, Response, NextFunction } from 'express';
import { nutzerId } from '../../konto/http/anmeldung';
import { sendeFehler } from '../../infra/fehlerTexte';
import { meldeUndWeiter } from '../../infra/httpError';
import * as dienst from '../dienst';

const SCHREIBEND = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function idempotenz(req: Request, res: Response, next: NextFunction) {
  const schluessel = req.get('Idempotency-Key');
  if (schluessel === undefined || !SCHREIBEND.has(req.method)) return next();
  if (!dienst.SCHLUESSEL_MUSTER.test(schluessel)) return sendeFehler(req, res, 400, 'idempotenz_schluessel_ungueltig');
  const uid = nutzerId(req);
  if (uid === null) return next();

  const ausgang = await dienst.beginne(uid, schluessel, dienst.fingerabdruck(req.method, req.originalUrl, req.body));
  if (ausgang.art === 'anders') return sendeFehler(req, res, 422, 'idempotenz_schluessel_anders');
  if (ausgang.art === 'laeuft') { res.set('Retry-After', '1'); return sendeFehler(req, res, 409, 'idempotenz_laeuft'); }
  if (ausgang.art === 'wiederholung') {
    res.set('Idempotent-Replay', 'true');
    return res.status(ausgang.status).type('application/json').send(ausgang.antwort);
  }

  let gemerkt = false;
  const json = res.json.bind(res);
  res.json = (rumpf: unknown) => {
    gemerkt = true;
    dienst.beende(uid, schluessel, res.statusCode, JSON.stringify(rumpf))
      .catch((e: unknown) => meldeUndWeiter('idempotenz:merken', e))
      .finally(() => json(rumpf));
    return res;
  };
  // Keine JSON-Antwort (Datei, Strom): nichts zu wiederholen, der Schlüssel wird frei.
  res.on('finish', () => {
    if (!gemerkt) dienst.gibFrei(uid, schluessel).catch((e: unknown) => meldeUndWeiter('idempotenz:freigeben', e));
  });
  next();
}
