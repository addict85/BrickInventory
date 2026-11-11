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
/** Mehr Absender merkt sich die Minute nicht; wer danach kommt, wird verworfen. */
const HOECHSTENS_ADRESSEN = 1000;
let _fensterSeit = Date.now();
let _gedrosselt = 0;
const _jeAdresse = new Map<string, number>();

/** Ohne gemeinsame Quote: Sonst schöpfte ein Fremder sie aus, und echte Berichte
 * gingen in seiner Flut unter. IPv6 je /64, weil ein Anschluss so viele hat. */
function absender(adresse: string): string {
  return adresse.includes(':') ? adresse.split(':').slice(0, 4).join(':') : adresse;
}

function cspMeldungFrei(adresse: string, jetzt = Date.now()): boolean {
  if (jetzt - _fensterSeit >= FENSTER_MS) {
    if (_gedrosselt) console.warn(`[csp] ${_gedrosselt} gedrosselt`);
    _jeAdresse.clear();
    _gedrosselt = 0;
    _fensterSeit = jetzt;
  }
  const a = absender(adresse);
  const n = (_jeAdresse.get(a) ?? 0) + 1;
  const frei = n <= JE_ADRESSE && (_jeAdresse.has(a) || _jeAdresse.size < HOECHSTENS_ADRESSEN);
  if (_jeAdresse.has(a) || _jeAdresse.size < HOECHSTENS_ADRESSEN) _jeAdresse.set(a, n);
  if (!frei) _gedrosselt++;
  return frei;
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

/** Was der Browser hier schreibt, hat eine feste Form; alles andere ist kein
 * echter Bericht und käme sonst als Freitext ins Protokoll. */
const DIREKTIVE = /^[a-z][a-z-]{1,39}$/;
const STICHWORT = /^(inline|eval|wasm-eval|self|data|blob|trusted-types-(sink|policy))$/;

function direktive(v: unknown): string | null {
  const erstes =
    String(v ?? '')
      .trim()
      .split(/\s/)[0] ?? '';
  return DIREKTIVE.test(erstes) ? erstes : null;
}

/** Nur http(s)/ws(s) und ohne Anfrageteil: Eine Adresse kann einen Rücksetz- oder Bestätigungslink tragen. */
function adresse(v: unknown, stichwort = false): string {
  const s = String(v ?? '');
  if (stichwort && STICHWORT.test(s)) return s;
  try {
    const u = new URL(s);
    if (!/^(https?|wss?):$/.test(u.protocol)) return /^(data|blob):$/.test(u.protocol) ? u.protocol.slice(0, -1) : '?';
    return (u.origin + u.pathname).slice(0, 160);
  } catch {
    return '?';
  }
}

/** Die Probe zeigt, welche Zuweisung Trusted Types abwies; sonst ist sie fremder Text. */
function probe(regel: string, v: unknown): string {
  if (!regel.includes('trusted-types') || typeof v !== 'string') return '';
  return v.replace(/[^\x20-\x7e]/g, ' ').slice(0, 80);
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
  for (const v of verstoesse(daten)) {
    const regel = direktive(v.regel);
    if (!regel) continue;
    const p = probe(regel, v.probe);
    console.warn(
      `[csp] ${regel} blockierte ${adresse(v.blockiert, true)} auf ${adresse(v.seite)}${p ? ` (${p})` : ''}`,
    );
  }
});

router.use(fehlerAntwort);

export = Object.assign(router, { cspMeldungFrei });
