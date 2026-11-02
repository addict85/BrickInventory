import fs from 'fs';
import type { Request, Response, NextFunction } from 'express';
import { konfig } from './konfig';
import { sendeFehler } from './fehlerTexte';
import { FEHLER, fehlerText, antwortSprache, dateiFehler } from './fehlerTexte';
import type { FehlerCode } from './fehlerTexte';
// Ausführlich: docs/begruendungen/src/infra/httpError.ts.md#handlerouteerror
export function handleRouteError(res: any, e: any, status?: number, req?: any) {
  e = alsUploadFehler(e);
  const code = status || e?.status || 500;
  // Erst der Pfad sagt, welche Route es war: Eine Stelle bedient oft mehrere.
  const wo = req?.originalUrl || req?.url;
  const anfrage = wo ? `${req.method || '?'} ${String(wo).split('?')[0]} ` : '';
  const isServerError = code >= 500;
  // Ein 4xx ist eine Antwort, kein Serverfehler: Mit Stack füllte jede falsche
  // Eingabe das Protokoll und verdeckte die echten Fehler.
  if (isServerError) console.error(`[route-error] ${anfrage}${code}:`, e?.stack || e?.message || e);
  else console.warn(`[route-warnung] ${anfrage}${code}: ${fehlertext(e)}`);
  if (res.headersSent) return;
  // Helfer werfen den GRUND (Code), erst hier wird daraus ein Satz in der
  // Sprache des Anfragenden.
  if (e?.code && typeof e.code === 'string' && e.code in FEHLER) {
    return res.status(code).json({
      success: false, code: e.code,
      error: fehlerText(e.code as FehlerCode, antwortSprache(req), e.vars),
    });
  }
  const message = (isServerError && konfig().produktion)
    ? 'Interner Serverfehler'
    : (e?.message || 'Unbekannter Fehler');
  res.status(code).json({ success: false, error: message });
}

/** Ohne Status sähe eine zu grosse Datei wie ein Serverfehler aus; hier wird
 * daraus 413 bzw. 400 mit Code. */
function alsUploadFehler<T>(e: T): T | Error {
  const m = e as { name?: unknown; code?: unknown; type?: unknown } | null;
  // Fehler des Body-Parsers: Sein Text nennt Parser und Zeichenposition.
  if (m?.type === 'entity.parse.failed') return dateiFehler('anfrage_json_ungueltig', 400);
  // Zweite Linie hinter idWert(): Ein Wert ausserhalb des Spaltentyps ist eine falsche Eingabe.
  if (m?.code === '22003') return dateiFehler('wert_ungueltig', 400);
  if (m?.type === 'entity.too.large') return dateiFehler('anfrage_zu_gross', 413);
  if (typeof m?.type === 'string' && /^(charset|encoding)\.unsupported$|^request\.aborted$|^entity\.verify\.failed$/.test(m.type))
    return dateiFehler('anfrage_unlesbar', 400);
  if (m?.name !== 'MulterError') return e;
  const zuGross = m.code === 'LIMIT_FILE_SIZE';
  return dateiFehler(zuGross ? 'datei_zu_gross' : 'upload_ungueltig', zuGross ? 413 : 400);
}

/** Ersatz für `.catch(() => {})`: Der Schritt soll die Anfrage nicht scheitern
 * lassen, aber eine Spur hinterlassen.
 * @param kontext kurze Herkunftsangabe, z. B. 'parts:image_local' */
export function logAndContinue(kontext: string) {
  return (e: any) => {
    console.warn(`[weiter-trotz-fehler] ${kontext}:`, e?.message || e);
  };
}

/** Mit Ersatzwert, wo der Aufrufer weiterrechnet. */
export function meldeUndLiefere<T>(kontext: string, ersatz: T) {
  return (e: unknown): T => { logAndContinue(kontext)(e); return ersatz; };
}

/** Eine schon fehlende Datei ist das Ziel, kein Fehler. */
export function ohneFehlendeDatei(kontext: string): (e: unknown) => void;
export function ohneFehlendeDatei<T>(kontext: string, ersatz: T): (e: unknown) => T;
export function ohneFehlendeDatei<T>(kontext: string, ersatz?: T) {
  return (e: unknown): T | undefined => { if (fehlerCode(e) !== 'ENOENT') logAndContinue(kontext)(e); return ersatz; };
}

export function meldeUndWeiter(kontext: string, e: unknown) {
  logAndContinue(kontext)(e);
}

// Ausführlich: docs/begruendungen/src/infra/httpError.ts.md#fehlertext
export function fehlertext(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  const m = e && typeof e === 'object' ? (e as { message?: unknown }).message : undefined;
  if (typeof m === 'string' && m) return m;
  if (e === null || e === undefined) return 'Unbekannter Fehler';
  // `String([])` ist leer; sonst stünde „Fehler: " mit nichts dahinter.
  return String(e) || 'Unbekannter Fehler';
}

export function fehlerCode(e: unknown): string | undefined {
  const c = (e as { code?: unknown } | null | undefined)?.code;
  return typeof c === 'string' || typeof c === 'number' ? String(c) : undefined;
}

// Ausführlich: docs/begruendungen/src/infra/httpError.ts.md#pfadparam
export function pfadParam(req: { params: Record<string, string | string[] | undefined> },
                   name: string): string {
  const wert = req.params[name];
  return Array.isArray(wert) ? wert.join('/') : (wert ?? '');
}

/** split() liefert immer ein erstes Element; TypeScript weiss es nicht. */
export function vorDem(s: string, trenner: string): string {
  return s.split(trenner)[0] ?? '';
}

/** Für Ströme und Sammelberichte ohne Statuscode: Ein Fachfehler nennt Code und
 * Satz, alles andere (SQL, Dateipfade, Fremd-APIs) nur das Protokoll. */
export function oeffentlicherFehler(e: unknown, kontext: string, req?: { headers?: Record<string, any> }): { error: string; code: FehlerCode } {
  const code = fehlerCode(e);
  if (code && code in FEHLER) {
    return { code: code as FehlerCode, error: fehlerText(code as FehlerCode, antwortSprache(req), (e as { vars?: Record<string, string | number> }).vars) };
  }
  meldeUndWeiter(kontext, e);
  return { code: 'interner_fehler', error: fehlerText('interner_fehler', antwortSprache(req)) };
}

/** Express 5 reicht auch abgelehnte Promises hierher; ein try/catch je Route
 * braucht es nicht. */
export function fehlerAntwort(e: unknown, req: Request, res: Response, _next: NextFunction): void {
  handleRouteError(res, e, undefined, req);
}

/** @param req nur für die Sprache der Meldung; ohne ihn Deutsch. */
export function streamFileToResponse(res: any, filePath: string, onEnd?: () => void, req?: any) {
  const stream = fs.createReadStream(filePath);
  stream.on('error', (e: NodeJS.ErrnoException) => {
    console.error(`[stream] ${filePath}: ${e?.code || e?.message}`);
    if (!res.headersSent) {
      // Nicht auf Express-Methoden verlassen: Der Helfer läuft auch an einer nackten
      // http-Antwort.
      if (typeof res.status === 'function') sendeFehler(req, res, 404, 'datei_nicht_verfuegbar');
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

