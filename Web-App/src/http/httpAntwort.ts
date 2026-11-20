// Der eine Weg vom Fehler zur HTTP-Antwort. Express kennen nur src/http, die
// HTTP-Seiten der Bereiche und die Routen; db/, clients/ und die Dienste
// melden über fehler.ts und Fachfehler.
import fs from 'node:fs';
import type { Request, Response, NextFunction } from 'express';
import type { ServerResponse } from 'node:http';
import { konfig } from '../infra/konfig';
import {
  FEHLER,
  Fachfehler,
  errorText,
  responseLanguage,
  fileError,
  type ErrorKind,
  type ErrorCode,
} from '../infra/fehlerTexte';
import { fehlertext } from '../infra/fehler';
import { STATUS_THE_KIND, statusOf } from './fehlerArt';

export interface ErrorTarget {
  headersSent: boolean;
  status(code: number): { json(body: unknown): unknown };
}
export interface ErrorSource {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers?: Record<string, unknown>;
}

/** `code` steht neben dem Satz, damit ein Client reagieren kann, ohne Text zu
 * vergleichen. Den Status wählt die Art (STATUS_THE_KIND), nicht der Aufrufer. */
export function sendError(
  req: { headers?: Record<string, unknown> } | undefined,
  res: { status(c: number): { json(b: unknown): unknown } },
  art: ErrorKind,
  code: ErrorCode,
  vars?: Record<string, string | number>,
): void {
  res.status(STATUS_THE_KIND[art]).json({
    success: false,
    error: errorText(code, responseLanguage(req), vars),
    code,
  });
}

interface Thrown {
  status?: unknown;
  code?: unknown;
  vars?: Record<string, string | number>;
  stack?: unknown;
  message?: unknown;
}

// Interna ins Protokoll, nicht zum Client.
export function handleRouteError(res: ErrorTarget, fehler: unknown, status?: number, req?: ErrorSource): void {
  const e = asUploadError(fehler) as Thrown | null | undefined;
  const code = status || statusOf(e);
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
      ...(e instanceof Fachfehler ? e.zusatz : undefined),
      success: false,
      code: e.code,
      error: errorText(e.code as ErrorCode, responseLanguage(req), e.vars),
    });
    return;
  }
  // Der Text einer Bibliothek nennt Parser, Pfade oder Bytes; er bleibt im Protokoll.
  if (!isServerError) {
    const ersatz: ErrorCode = code === 404 ? 'nicht_gefunden' : code === 413 ? 'anfrage_zu_gross' : 'anfrage_ungueltig';
    res.status(code).json({ success: false, code: ersatz, error: errorText(ersatz, responseLanguage(req)) });
    return;
  }
  // Jede Fehlerantwort trägt einen Code, damit die Apps nicht am Satz raten.
  // Den Text der Ausnahme sieht nur die Entwicklung; im Betrieb nennt er Interna.
  const kennung: ErrorCode = isServerError ? 'interner_fehler' : 'anfrage_ungueltig';
  const message =
    isServerError && konfig().operation ? errorText('interner_fehler', responseLanguage(req)) : fehlertext(e);
  res.status(code).json({ success: false, code: kennung, error: message });
}

/** SQLSTATE der Integritätsregeln → Antwort. Das Protokoll nennt weiter die verletzte Regel. */
const DB_RULES: Record<string, [ErrorCode, ErrorKind]> = {
  '22003': ['wert_ungueltig', 'ungueltig'], // numeric_value_out_of_range
  '22P02': ['wert_ungueltig', 'ungueltig'], // invalid_text_representation
  '23502': ['wert_ungueltig', 'ungueltig'], // not_null_violation
  '23514': ['wert_ungueltig', 'ungueltig'], // check_violation
  '23505': ['schon_vorhanden', 'konflikt'], // unique_violation
  '23503': ['bezug_fehlt', 'konflikt'], // foreign_key_violation
};

/** Ohne Status sähe eine zu grosse Datei wie ein Serverfehler aus; hier wird
 * daraus 413 bzw. 400 mit Code. */
function asUploadError<T>(e: T): T | Error {
  const m = e as { name?: unknown; code?: unknown; type?: unknown } | null;
  // Fehler des Body-Parsers: Sein Text nennt Parser und Zeichenposition.
  if (m?.type === 'entity.parse.failed') return fileError('ungueltig', 'anfrage_json_ungueltig');
  // Zweite Linie hinter dem Vertrag: Was erst an einer Regel der Datenbank
  // scheitert, ist eine falsche Eingabe oder ein Wettlauf, kein Serverfehler.
  if (typeof m?.code === 'string' && m.code in DB_RULES) {
    const [code, art] = DB_RULES[m.code]!;
    return fileError(art, code);
  }
  if (m?.type === 'entity.too.large') return fileError('zu_gross', 'anfrage_zu_gross');
  if (
    typeof m?.type === 'string' &&
    /^(charset|encoding)\.unsupported$|^request\.aborted$|^entity\.verify\.failed$/.test(m.type)
  )
    return fileError('ungueltig', 'anfrage_unlesbar');
  if (m?.name !== 'MulterError') return e;
  const zuGross = m.code === 'LIMIT_FILE_SIZE';
  return fileError(zuGross ? 'zu_gross' : 'ungueltig', zuGross ? 'datei_zu_gross' : 'upload_ungueltig');
}

// Express 5 liefert Platzhalter auch als Array; verbunden wird mit / statt Komma.
export function pathParam(req: { params: Record<string, string | string[] | undefined> }, name: string): string {
  const wert = req.params[name];
  return Array.isArray(wert) ? wert.join('/') : (wert ?? '');
}

/** Die Abschnitte eines Platzhalters `*name` ohne leere. */
export function pathSegments(req: { params: Record<string, string | string[] | undefined> }, name: string): string[] {
  const wert = req.params[name];
  return (Array.isArray(wert) ? wert : wert ? [wert] : []).filter(Boolean);
}

/** Express 5 reicht auch abgelehnte Promises hierher; ein try/catch je Route
 * braucht es nicht. */
export function errorResponse(e: unknown, req: Request, res: Response, _next: NextFunction): void {
  handleRouteError(res, e, undefined, req);
}

/** Hinter allen Routen unter /api: Ein Tippfehler im Pfad bekommt dieselbe
 * Fehlerform wie jede andere Antwort, nicht die index.html. */
export function unknownApiPath(req: Request, res: Response): void {
  sendError(req, res, 'nicht_gefunden', 'nicht_gefunden');
}

/** @param req nur für die Sprache der Meldung; ohne ihn Deutsch. */
export function streamFileToResponse(
  res: ServerResponse,
  filePath: string,
  onEnd?: () => void,
  req?: { headers?: Record<string, unknown> },
) {
  const stream = fs.createReadStream(filePath);
  stream.on('error', (e: NodeJS.ErrnoException) => {
    console.error(`[stream] ${filePath}: ${e?.code || e?.message}`);
    if (!res.headersSent) {
      // Nicht auf Express-Methoden verlassen: Der Helfer läuft auch an einer nackten
      // http-Antwort.
      if ('status' in res && typeof res.status === 'function')
        sendError(req, res as Response, 'nicht_gefunden', 'datei_nicht_verfuegbar');
      else {
        res.statusCode = 404;
        res.end();
      }
    } else {
      res.end();
    }
    stream.destroy();
  });
  if (onEnd) stream.on('end', onEnd);
  stream.pipe(res);
  return stream;
}
