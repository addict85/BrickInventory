import fs from 'fs';
import type { Request, Response, NextFunction } from 'express';
import { konfig } from './konfig';
import { sendeFehler } from './fehlerTexte';
import { FEHLER, fehlerText, antwortSprache, dateiFehler } from './fehlerTexte';
import type { FehlerCode } from './fehlerTexte';
/**
 * Zentrale Fehlerbehandlung für Routen; Status aus `status`, sonst e.status || 500.
 * Ausführlich: docs/begruendungen/src/infra/httpError.ts.md#handlerouteerror
 */
function handleRouteError(res: any, e: any, status?: number, req?: any) {
  e = alsUploadFehler(e);
  const code = status || e?.status || 500;
  // Die Anfrage gehört in die Zeile: Dieselbe Stelle bedient oft mehrere
  // Pfade (Teile und Figuren), und erst der Pfad sagt, welcher es war.
  // Ausführlich: docs/begruendungen/src/infra/httpError.ts.md#handlerouteerror-wo
  const wo = req?.originalUrl || req?.url;
  const anfrage = wo ? `${req.method || '?'} ${String(wo).split('?')[0]} ` : '';
  const isServerError = code >= 500;
  // Ein 4xx ist eine Antwort auf die Anfrage, kein Fehler des Servers: Mit
  // Stack und als Fehler füllte jede falsche Eingabe das Protokoll und
  // verdeckte die echten Fehler darin.
  if (isServerError) console.error(`[route-error] ${anfrage}${code}:`, e?.stack || e?.message || e);
  else console.warn(`[route-warnung] ${anfrage}${code}: ${fehlertext(e)}`);
  if (res.headersSent) return;
  // Trägt der Fehler einen Code, gilt der
  // Helfer wie src/haushalt/haushalt.ts und src/sets/setMove.ts werfen mit
  // fehlerWerfen() und geben damit den GRUND mit, nicht den Satz. Erst hier —
  // wo der Request bekannt ist — wird daraus ein Satz in der Sprache des …
  // Ausführlich: docs/begruendungen/src/infra/httpError.ts.md#handlerouteerror-2
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

/**
 * Multer meldet eine zu grosse oder überzählige Datei ohne Status; als 500
 * sähe sie aus wie ein Serverfehler, und die App zeigte „Interner Fehler“
 * statt „zu gross“. Hier wird daraus 413 bzw. 400 mit Code.
 */
function alsUploadFehler<T>(e: T): T | Error {
  const m = e as { name?: unknown; code?: unknown } | null;
  if (m?.name !== 'MulterError') return e;
  const zuGross = m.code === 'LIMIT_FILE_SIZE';
  return dateiFehler(zuGross ? 'datei_zu_gross' : 'upload_ungueltig', zuGross ? 413 : 400);
}

/**
 * Ersatz für `.catch(() => {})` bei Schritten, die absichtlich nicht die
 * Anfrage scheitern lassen sollen (Cache-Pflege, Aufräumen, Einzelzeilen eines
 * Massenimports).
 * Ausführlich: docs/begruendungen/src/infra/httpError.ts.md#logandcontinue
 * @param kontext kurze Herkunftsangabe, z. B. 'parts:image_local'
 */
function logAndContinue(kontext: string) {
  return (e: any) => {
    console.warn(`[weiter-trotz-fehler] ${kontext}:`, e?.message || e);
  };
}

/**
 * Wie logAndContinue(), liefert aber einen Ersatzwert — für `.catch(() => [])`,
 * wo der Aufrufer mit dem Wert weiterrechnet und der Fehler trotzdem eine
 * Spur hinterlassen soll.
 */
function meldeUndLiefere<T>(kontext: string, ersatz: T) {
  return (e: unknown): T => { logAndContinue(kontext)(e); return ersatz; };
}

/**
 * Für das Aufräumen von Dateien: Eine schon fehlende Datei ist das Ziel, kein
 * Fehler; alles andere (Rechte, volle Platte) wird gemeldet.
 */
function ohneFehlendeDatei(kontext: string): (e: unknown) => void;
function ohneFehlendeDatei<T>(kontext: string, ersatz: T): (e: unknown) => T;
function ohneFehlendeDatei<T>(kontext: string, ersatz?: T) {
  return (e: unknown): T | undefined => { if (fehlerCode(e) !== 'ENOENT') logAndContinue(kontext)(e); return ersatz; };
}

/**
 * Dasselbe fuer try/catch statt fuer .catch().
 * Ausführlich: docs/begruendungen/src/infra/httpError.ts.md#meldeundweiter
 */
function meldeUndWeiter(kontext: string, e: unknown) {
  logAndContinue(kontext)(e);
}

/**
 * Der lesbare Text eines gefangenen Fehlers — egal was geworfen wurde.
 * Ausführlich: docs/begruendungen/src/infra/httpError.ts.md#fehlertext
 */
function fehlertext(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  const m = e && typeof e === 'object' ? (e as { message?: unknown }).message : undefined;
  if (typeof m === 'string' && m) return m;
  if (e === null || e === undefined) return 'Unbekannter Fehler';
  // `String(e)` kann selbst leer sein — `String([])` ergibt den leeren String,
  // und dann staende in der Oberflaeche „Fehler: " mit nichts dahinter. Der
  // Test hat genau diesen Fall gefunden; die erste Fassung hatte ihn nicht.
  return String(e) || 'Unbekannter Fehler';
}

/** Der Fehlercode einer Ausnahme (ENOENT, 23505 …), typsicher; ohne Code undefined. */
function fehlerCode(e: unknown): string | undefined {
  const c = (e as { code?: unknown } | null | undefined)?.code;
  return typeof c === 'string' || typeof c === 'number' ? String(c) : undefined;
}

/**
 * Ein Routen-Parameter, den der Pfad garantiert (Express 5 typisiert ihn auch als string[]).
 * Ausführlich: docs/begruendungen/src/infra/httpError.ts.md#pfadparam
 */
function pfadParam(req: { params: Record<string, string | string[] | undefined> },
                   name: string): string {
  const wert = req.params[name];
  return Array.isArray(wert) ? wert.join('/') : (wert ?? '');
}

/** Der Teil vor dem ersten Trenner; split() liefert immer ein erstes Element, der Typprüfer weiss es nicht. */
function vorDem(s: string, trenner: string): string {
  return s.split(trenner)[0] ?? '';
}

/**
 * Der Fehlerweg der Router: Was ein Handler wirft, wird hier zur Antwort.
 * Express 5 reicht auch abgelehnte Promises hierher; ein try/catch je Route braucht es nicht.
 */
function fehlerAntwort(e: unknown, req: Request, res: Response, _next: NextFunction): void {
  handleRouteError(res, e, undefined, req);
}

export { fehlerAntwort, handleRouteError, logAndContinue, meldeUndWeiter, meldeUndLiefere, ohneFehlendeDatei, fehlertext, fehlerCode, pfadParam, vorDem };

/**
 * Eine Datei an die Antwort streamen — mit Fehlerbehandlung.
 * @param req nur für die Sprache der Meldung; ohne ihn Deutsch.
 */
function streamFileToResponse(res: any, filePath: string, onEnd?: () => void, req?: any) {
  const stream = fs.createReadStream(filePath);
  stream.on('error', (e: NodeJS.ErrnoException) => {
    console.error(`[stream] ${filePath}: ${e?.code || e?.message}`);
    if (!res.headersSent) {
      // Nicht auf Express-Methoden verlassen: Dieser Helfer läuft auch an
      // einer nackten http-Antwort (und genau daran ist die erste Fassung
      // gescheitert — res.status war dort nicht vorhanden, und der Absturz,
      // den der Helfer verhindern sollte, kam aus dem Helfer selbst).
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

export { streamFileToResponse };
