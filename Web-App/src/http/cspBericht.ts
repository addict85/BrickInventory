/** Verstösse gegen die CSP (report-uri und report-to) landen im Protokoll: Eine
 * abgewiesene Trusted-Types-Zuweisung oder ein fremdes Skript fiele sonst nur im
 * Browser auf. Öffentlich, weil der Browser ohne Anmeldung meldet; deshalb klein,
 * gedrosselt und ohne Antwortinhalt. */
import express from 'express';
import type { Request, Response } from 'express';
import { prozessweit } from '../infra/prozessweit';
import { drosselAdresse } from '../infra/drosselAdresse';

const WINDOW_MS = 60_000;
const JE_ADDRESS = 10;
/** Mehr Absender merkt sich die Minute nicht; wer danach kommt, wird verworfen. */
const AT_MOST_ADDRESSES = 1000;
const F = prozessweit('cspBericht', () => ({ seit: Date.now(), gedrosselt: 0, jeAddress: new Map<string, number>() }));

export function cspMessageFree(adresse: string, jetzt = Date.now()): boolean {
  const _jeAddress = F.jeAddress;
  if (jetzt - F.seit >= WINDOW_MS) {
    if (F.gedrosselt) console.warn(`[csp] ${F.gedrosselt} gedrosselt`);
    _jeAddress.clear();
    F.gedrosselt = 0;
    F.seit = jetzt;
  }
  // Je Absender statt gemeinsam, sonst gingen echte Berichte in fremder Flut unter; IPv6 je /64.
  const a = drosselAdresse(adresse);
  const n = (_jeAddress.get(a) ?? 0) + 1;
  const frei = n <= JE_ADDRESS && (_jeAddress.has(a) || _jeAddress.size < AT_MOST_ADDRESSES);
  if (_jeAddress.has(a) || _jeAddress.size < AT_MOST_ADDRESSES) _jeAddress.set(a, n);
  if (!frei) F.gedrosselt++;
  return frei;
}

type Violation = { regel: unknown; blockiert: unknown; seite: unknown; probe: unknown };

const feld = (o: unknown, k: string): unknown =>
  o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined;

/** report-uri schickt { "csp-report": {…} }, report-to eine Liste von { type, body }. */
function violations(daten: unknown): Violation[] {
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
const DIRECTIVE = /^[a-z][a-z-]{1,39}$/;
const KEYWORD = /^(inline|eval|wasm-eval|self|data|blob|trusted-types-(sink|policy))$/;

function directive(v: unknown): string | null {
  const erstes =
    String(v ?? '')
      .trim()
      .split(/\s/)[0] ?? '';
  return DIRECTIVE.test(erstes) ? erstes : null;
}

/** Nur http(s)/ws(s) und ohne Anfrageteil: Eine Adresse kann einen Rücksetz- oder Bestätigungslink tragen. */
function reportAddress(v: unknown, keyword = false): string {
  const s = String(v ?? '');
  if (keyword && KEYWORD.test(s)) return s;
  try {
    const u = new URL(s);
    if (!/^(https?|wss?):$/.test(u.protocol)) return /^(data|blob):$/.test(u.protocol) ? u.protocol.slice(0, -1) : '?';
    return (u.origin + u.pathname).slice(0, 160);
  } catch {
    return '?';
  }
}

/** Öffnet der Browser ein Rasterbild direkt, stylt er seine eigene Bildansicht inline;
 * unsere CSP am Bild blockiert das. Kein Angriff, keine Zeile. SVG bleibt gemeldet. */
function imageView(seite: unknown): boolean {
  try {
    return /\.(jpe?g|png|gif|webp|avif)$/i.test(new URL(String(seite ?? '')).pathname);
  } catch {
    return false;
  }
}

/** Die Probe zeigt, welche Zuweisung Trusted Types abwies; sonst ist sie fremder Text. */
function probe(regel: string, v: unknown): string {
  if (!regel.includes('trusted-types') || typeof v !== 'string') return '';
  return v.replace(/[^\x20-\x7e]/g, ' ').slice(0, 80);
}

export function buildCspReportRouter() {
  return express
    .Router()
    .post('/csp-bericht', express.raw({ type: () => true, limit: '8kb' }), (req: Request, res: Response) => {
      res.status(204).end();
      if (!cspMessageFree(req.ip ?? '?')) return;
      let daten: unknown;
      try {
        daten = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '');
      } catch {
        return;
      }
      for (const v of violations(daten)) {
        const regel = directive(v.regel);
        if (!regel || imageView(v.seite)) continue;
        const p = probe(regel, v.probe);
        // Die Teile sind schon gefiltert; das Ersetzen ist die Form, die CodeQL als Schutz erkennt.
        console.warn(
          `[csp] ${regel} blockierte ${reportAddress(v.blockiert, true)} auf ${reportAddress(v.seite)}${p ? ` (${p})` : ''}`.replace(
            /\n|\r/g,
            '',
          ),
        );
      }
    });
}
