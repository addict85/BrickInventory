/** Verstösse gegen die CSP (report-uri und report-to) landen im Protokoll: Eine
 * abgewiesene Trusted-Types-Zuweisung oder ein fremdes Skript fiele sonst nur im
 * Browser auf. Öffentlich, weil der Browser ohne Anmeldung meldet; deshalb klein,
 * gedrosselt und ohne Antwortinhalt. */
import express from 'express';
import type { Request, Response } from 'express';
import { fehlerAntwort } from './httpAntwort';

const router = express.Router();

const FENSTER_MS = 60_000;
const JE_ADRESSE = 10;
const INSGESAMT = 60;
let _fensterSeit = Date.now();
let _insgesamt = 0;
const _jeAdresse = new Map<string, number>();

function cspMeldungFrei(adresse: string, jetzt = Date.now()): boolean {
  if (jetzt - _fensterSeit >= FENSTER_MS) {
    _jeAdresse.clear();
    _insgesamt = 0;
    _fensterSeit = jetzt;
  }
  const n = (_jeAdresse.get(adresse) ?? 0) + 1;
  if (_jeAdresse.has(adresse) || _jeAdresse.size < 1000) _jeAdresse.set(adresse, n);
  return n <= JE_ADRESSE && ++_insgesamt <= INSGESAMT;
}

type Verstoss = { regel: unknown; blockiert: unknown; seite: unknown; probe: unknown };

const feld = (o: unknown, k: string): unknown =>
  o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined;

/** report-uri schickt { "csp-report": {…} }, report-to eine Liste von { type, body }. */
function verstoesse(daten: unknown): Verstoss[] {
  return (Array.isArray(daten) ? daten : [daten]).slice(0, 5).flatMap((e: unknown) => {
    const alt = feld(e, 'csp-report');
    if (alt)
      return [
        {
          regel: feld(alt, 'effective-directive') ?? feld(alt, 'violated-directive'),
          blockiert: feld(alt, 'blocked-uri'),
          seite: feld(alt, 'document-uri'),
          probe: feld(alt, 'script-sample'),
        },
      ];
    const b = feld(e, 'type') === 'csp-violation' ? feld(e, 'body') : null;
    return b
      ? [
          {
            regel: feld(b, 'effectiveDirective'),
            blockiert: feld(b, 'blockedURL'),
            seite: feld(b, 'documentURL'),
            probe: feld(b, 'sample'),
          },
        ]
      : [];
  });
}

/** Ohne Anfrageteil: Eine Adresse kann einen Rücksetz- oder Bestätigungslink tragen. */
function kurz(v: unknown): string {
  const s = String(v ?? '')
    .replace(/[?#].*$/s, '')
    .replace(/[\p{Cc}\u2028\u2029]/gu, ' ');
  return s.slice(0, 160);
}

router.post('/csp-bericht', express.raw({ type: () => true, limit: '8kb' }), (req: Request, res: Response) => {
  res.status(204).end();
  if (!cspMeldungFrei(req.ip ?? '?')) return;
  let daten: unknown;
  try {
    daten = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '');
  } catch {
    return;
  }
  for (const v of verstoesse(daten))
    console.warn(
      `[csp] ${kurz(v.regel)} blockierte ${kurz(v.blockiert) || '?'} auf ${kurz(v.seite) || '?'}` +
        (v.probe ? ` (${kurz(v.probe)})` : ''),
    );
});

router.use(fehlerAntwort);

export = Object.assign(router, { cspMeldungFrei });
