// Der eine Weg vom Fehler zur HTTP-Antwort. Hier und nur hier kennt infra
// Express; db/, clients/ und die Dienste melden über fehler.ts.
import fs from 'fs';
import type { Request, Response, NextFunction } from 'express';
import type { ServerResponse } from 'http';
import { konfig } from '../infra/konfig';
import { FEHLER, fehlerText, antwortSprache, dateiFehler, Meldung, sendeFehler } from '../infra/fehlerTexte';
import type { FehlerCode } from '../infra/fehlerTexte';
import { fehlertext } from '../infra/fehler';

export interface FehlerZiel { headersSent: boolean; status(code: number): { json(body: unknown): unknown } }
export interface FehlerQuelle { method?: string; originalUrl?: string; url?: string; headers?: Record<string, unknown> }

interface Geworfen { status?: unknown; code?: unknown; vars?: Record<string, string | number>; stack?: unknown; message?: unknown }

// Ausführlich: docs/begruendungen/src/http/httpAntwort.ts.md#handlerouteerror
export function handleRouteError(res: FehlerZiel, fehler: unknown, status?: number, req?: FehlerQuelle): void {
  const e = alsUploadFehler(fehler) as Geworfen | null | undefined;
  const code = status || (typeof e?.status === 'number' ? e.status : 500);
  // Erst der Pfad sagt, welche Route es war: Eine Stelle bedient oft mehrere.
  const wo = req?.originalUrl || req?.url;
  // Ohne Zeilenumbrüche: Ein Pfad oder Text mit Umbruch täuschte sonst eine zweite Protokollzeile vor.
  const anfrage = wo ? `${req?.method || '?'} ${String(wo).split('?')[0]} `.replace(/\n|\r/g, '') : '';
  const isServerError = code >= 500;
  // Ein 4xx ist eine Antwort, kein Serverfehler: Mit Stack füllte jede falsche
  // Eingabe das Protokoll und verdeckte die echten Fehler.
  if (isServerError) console.error('[route-error] %s%d:', anfrage, code, e?.stack || e?.message || e);
  else console.warn('[route-warnung] %s%d: %s', anfrage, code, fehlertext(fehler).replace(/\n|\r/g, ''));
  if (res.headersSent) return;
  // Helfer werfen den GRUND (Code), erst hier wird daraus ein Satz in der
  // Sprache des Anfragenden.
  if (typeof e?.code === 'string' && e.code in FEHLER) {
    res.status(code).json({
      success: false, code: e.code,
      error: fehlerText(e.code as FehlerCode, antwortSprache(req), e.vars),
    });
    return;
  }
  // Der Text einer Bibliothek nennt Parser, Pfade oder Bytes; er bleibt im Protokoll.
  if (!isServerError && !(e instanceof Meldung)) {
    const ersatz: FehlerCode = code === 404 ? 'nicht_gefunden' : code === 413 ? 'anfrage_zu_gross' : 'anfrage_ungueltig';
    res.status(code).json({ success: false, code: ersatz, error: fehlerText(ersatz, antwortSprache(req)) });
    return;
  }
  // Jede Fehlerantwort trägt einen Code, damit die Apps nicht am Satz raten.
  // Den Text der Ausnahme sieht nur die Entwicklung; im Betrieb nennt er Interna.
  const kennung: FehlerCode = isServerError ? 'interner_fehler' : 'anfrage_ungueltig';
  const message = (isServerError && konfig().betrieb)
    ? fehlerText('interner_fehler', antwortSprache(req))
    : fehlertext(e);
  res.status(code).json({ success: false, code: kennung, error: message });
}

/** SQLSTATE der Integritätsregeln → Antwort. Das Protokoll nennt weiter die verletzte Regel. */
const DB_REGELN: Record<string, [FehlerCode, number]> = {
  '22003': ['wert_ungueltig', 400],  // numeric_value_out_of_range
  '22P02': ['wert_ungueltig', 400],  // invalid_text_representation
  '23502': ['wert_ungueltig', 400],  // not_null_violation
  '23514': ['wert_ungueltig', 400],  // check_violation
  '23505': ['schon_vorhanden', 409], // unique_violation
  '23503': ['bezug_fehlt', 409],     // foreign_key_violation
};

/** Ohne Status sähe eine zu grosse Datei wie ein Serverfehler aus; hier wird
 * daraus 413 bzw. 400 mit Code. */
function alsUploadFehler<T>(e: T): T | Error {
  const m = e as { name?: unknown; code?: unknown; type?: unknown } | null;
  // Fehler des Body-Parsers: Sein Text nennt Parser und Zeichenposition.
  if (m?.type === 'entity.parse.failed') return dateiFehler('anfrage_json_ungueltig', 400);
  // Zweite Linie hinter dem Vertrag: Was erst an einer Regel der Datenbank
  // scheitert, ist eine falsche Eingabe oder ein Wettlauf, kein Serverfehler.
  if (typeof m?.code === 'string' && m.code in DB_REGELN) {
    const [code, status] = DB_REGELN[m.code]!;
    return dateiFehler(code, status);
  }
  if (m?.type === 'entity.too.large') return dateiFehler('anfrage_zu_gross', 413);
  if (typeof m?.type === 'string' && /^(charset|encoding)\.unsupported$|^request\.aborted$|^entity\.verify\.failed$/.test(m.type))
    return dateiFehler('anfrage_unlesbar', 400);
  if (m?.name !== 'MulterError') return e;
  const zuGross = m.code === 'LIMIT_FILE_SIZE';
  return dateiFehler(zuGross ? 'datei_zu_gross' : 'upload_ungueltig', zuGross ? 413 : 400);
}

// Ausführlich: docs/begruendungen/src/http/httpAntwort.ts.md#pfadparam
export function pfadParam(req: { params: Record<string, string | string[] | undefined> },
                   name: string): string {
  const wert = req.params[name];
  return Array.isArray(wert) ? wert.join('/') : (wert ?? '');
}

/** Die Abschnitte eines Platzhalters `*name` ohne leere. */
export function pfadSegmente(req: { params: Record<string, string | string[] | undefined> }, name: string): string[] {
  const wert = req.params[name];
  return (Array.isArray(wert) ? wert : wert ? [wert] : []).filter(Boolean);
}

/** Express 5 reicht auch abgelehnte Promises hierher; ein try/catch je Route
 * braucht es nicht. */
export function fehlerAntwort(e: unknown, req: Request, res: Response, _next: NextFunction): void {
  handleRouteError(res, e, undefined, req);
}

/** Hinter allen Routen unter /api: Ein Tippfehler im Pfad bekommt dieselbe
 * Fehlerform wie jede andere Antwort, nicht die index.html. */
export function unbekannterApiPfad(req: Request, res: Response): void {
  sendeFehler(req, res, 404, 'nicht_gefunden');
}

/** @param req nur für die Sprache der Meldung; ohne ihn Deutsch. */
export function streamFileToResponse(res: ServerResponse, filePath: string, onEnd?: () => void, req?: { headers?: Record<string, unknown> }) {
  const stream = fs.createReadStream(filePath);
  stream.on('error', (e: NodeJS.ErrnoException) => {
    console.error(`[stream] ${filePath}: ${e?.code || e?.message}`);
    if (!res.headersSent) {
      // Nicht auf Express-Methoden verlassen: Der Helfer läuft auch an einer nackten
      // http-Antwort.
      if ('status' in res && typeof res.status === 'function') sendeFehler(req, res as Response, 404, 'datei_nicht_verfuegbar');
      else { res.statusCode = 404; res.end(); }
    } else {
      res.end();
    }
    stream.destroy();
  });
  if (onEnd) stream.on('end', onEnd);
  stream.pipe(res);
  return stream;
}
