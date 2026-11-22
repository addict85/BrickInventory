// The one path from an error to the HTTP response. Only src/http, the
// areas' HTTP sides and the routes know Express; db/, clients/ and the services
// report via fehler.ts and domain errors.
import fs from 'node:fs';
import type { Request, Response, NextFunction } from 'express';
import type { ServerResponse } from 'node:http';
import { konfig } from '../infra/config';
import {
  ERRORS,
  DomainError,
  errorText,
  responseLanguage,
  fileError,
  type ErrorKind,
  type ErrorCode,
} from '../infra/errorTexts';
import { errorMessage } from '../infra/error';
import { STATUS_THE_KIND, statusOf } from './errorKind';

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

/** `code` stands next to the sentence so that a client can react without comparing
 * text. The status is chosen by the kind (STATUS_THE_KIND), not by the caller. */
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

// Internals go to the log, not to the client.
export function handleRouteError(res: ErrorTarget, error: unknown, status?: number, req?: ErrorSource): void {
  const e = asUploadError(error) as Thrown | null | undefined;
  const code = status || statusOf(e);
  // Only the path says which route it was: one place often serves several.
  const wo = req?.originalUrl || req?.url;
  // Without line breaks: a path or text with a line break would otherwise fake a second log line.
  const request = wo ? `${req?.method || '?'} ${String(wo).split('?')[0]} `.replace(/\n|\r/g, '') : '';
  const isServerError = code >= 500;
  // A 4xx is an answer, not a server error: with a stack every wrong
  // input would fill the log and hide the real errors.
  if (isServerError) console.error('[route-error] %s%d:', request, code, e?.stack || e?.message || e);
  else console.warn('[route-warnung] %s%d: %s', request, code, errorMessage(error).replace(/\n|\r/g, ''));
  if (res.headersSent) return;
  // Helpers throw the REASON (code); only here does it become a sentence in the
  // requester's language.
  if (typeof e?.code === 'string' && e.code in ERRORS) {
    res.status(code).json({
      ...(e instanceof DomainError ? e.extra : undefined),
      success: false,
      code: e.code,
      error: errorText(e.code as ErrorCode, responseLanguage(req), e.vars),
    });
    return;
  }
  // A library's text names parsers, paths or bytes; it stays in the log.
  if (!isServerError) {
    const ersatz: ErrorCode = code === 404 ? 'nicht_gefunden' : code === 413 ? 'anfrage_zu_gross' : 'anfrage_ungueltig';
    res.status(code).json({ success: false, code: ersatz, error: errorText(ersatz, responseLanguage(req)) });
    return;
  }
  // Every error response carries a code so that the apps do not guess from the sentence.
  // Only development sees the exception's text; in production it names internals.
  const key: ErrorCode = isServerError ? 'interner_fehler' : 'anfrage_ungueltig';
  const message =
    isServerError && konfig().operation ? errorText('interner_fehler', responseLanguage(req)) : errorMessage(e);
  res.status(code).json({ success: false, code: key, error: message });
}

/** SQLSTATE of the integrity rules → response. The log still names the violated rule. */
const DB_RULES: Record<string, [ErrorCode, ErrorKind]> = {
  '22003': ['wert_ungueltig', 'ungueltig'], // numeric_value_out_of_range
  '22P02': ['wert_ungueltig', 'ungueltig'], // invalid_text_representation
  '23502': ['wert_ungueltig', 'ungueltig'], // not_null_violation
  '23514': ['wert_ungueltig', 'ungueltig'], // check_violation
  '23505': ['schon_vorhanden', 'konflikt'], // unique_violation
  '23503': ['bezug_fehlt', 'konflikt'], // foreign_key_violation
};

/** Without a status a file that is too large would look like a server error; here it
 * becomes 413 or 400 with a code. */
function asUploadError<T>(e: T): T | Error {
  const m = e as { name?: unknown; code?: unknown; type?: unknown } | null;
  // Errors of the body parser: its text names parser and character position.
  if (m?.type === 'entity.parse.failed') return fileError('ungueltig', 'anfrage_json_ungueltig');
  // Second line behind the contract: what only fails at a database rule
  // is a wrong input or a race, not a server error.
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

// Express 5 also delivers placeholders as an array; joined with / instead of a comma.
export function pathParam(req: { params: Record<string, string | string[] | undefined> }, name: string): string {
  const wert = req.params[name];
  return Array.isArray(wert) ? wert.join('/') : (wert ?? '');
}

/** The segments of a placeholder `*name` without empty ones. */
export function pathSegments(req: { params: Record<string, string | string[] | undefined> }, name: string): string[] {
  const wert = req.params[name];
  return (Array.isArray(wert) ? wert : wert ? [wert] : []).filter(Boolean);
}

/** Express 5 also passes rejected promises here; a try/catch per route
 * is not needed. */
export function errorResponse(e: unknown, req: Request, res: Response, _next: NextFunction): void {
  handleRouteError(res, e, undefined, req);
}

/** Behind all routes under /api: a typo in the path gets the same
 * error shape as any other response, not the index.html. */
export function unknownApiPath(req: Request, res: Response): void {
  sendError(req, res, 'nicht_gefunden', 'nicht_gefunden');
}

/** @param req only for the message's language; without it German. */
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
      // Do not rely on Express methods: the helper also runs on a bare
      // http response.
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
