import { sendeFehler } from './fehlerTexte';
import { FEHLER, fehlerText, antwortSprache } from './fehlerTexte';
import type { FehlerCode } from './fehlerTexte';
/**
 * Zentrale Fehlerbehandlung für Routen.
 * Ausführlich: docs/begruendungen/utils/httpError.ts.md#handlerouteerror
 */
/**
 * @param res    Express-Response
 * @param e      Fehler (Error oder beliebig geworfen)
 * @param status expliziter HTTP-Status, sonst e.status || 500
 */
function handleRouteError(res: any, e: any, status?: number, req?: any) {
  const code = status || e?.status || 500;
  // Die Anfrage gehört in die Zeile: Dieselbe Stelle bedient oft mehrere
  // Pfade (Teile und Figuren), und erst der Pfad sagt, welcher es war.
  // Ausführlich: docs/begruendungen/utils/httpError.ts.md#handlerouteerror-wo
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
  // Helfer wie utils/household.ts und utils/setMove.ts werfen mit
  // fehlerWerfen() und geben damit den GRUND mit, nicht den Satz. Erst hier —
  // wo der Request bekannt ist — wird daraus ein Satz in der Sprache des …
  // Ausführlich: docs/begruendungen/utils/httpError.ts.md#handlerouteerror-2
  if (e?.code && typeof e.code === 'string' && e.code in FEHLER) {
    return res.status(code).json({
      success: false, code: e.code,
      error: fehlerText(e.code as FehlerCode, antwortSprache(req)),
    });
  }
  const message = (isServerError && process.env.NODE_ENV === 'production')
    ? 'Interner Serverfehler'
    : (e?.message || 'Unbekannter Fehler');
  res.status(code).json({ success: false, error: message });
}

/**
 * Ersatz für `.catch(() => {})` bei Schritten, die absichtlich nicht die
 * Anfrage scheitern lassen sollen (Cache-Pflege, Aufräumen, Einzelzeilen eines
 * Massenimports).
 * Ausführlich: docs/begruendungen/utils/httpError.ts.md#logandcontinue
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
 * Ausführlich: docs/begruendungen/utils/httpError.ts.md#meldeundweiter
 */
function meldeUndWeiter(kontext: string, e: unknown) {
  logAndContinue(kontext)(e);
}

/**
 * Der lesbare Text eines gefangenen Fehlers — egal was geworfen wurde.
 * Ausführlich: docs/begruendungen/utils/httpError.ts.md#fehlertext
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

/**
 * Der Fehlercode einer Ausnahme, falls sie einen traegt.
 *
 * Node-Systemfehler (ENOENT, ECONNREFUSED, 23505 von Postgres) fuehren ihn in
 * `code`. Die drei Stellen, die danach verzweigen, brauchen ihn typsicher —
 * und `undefined` ist die richtige Antwort, wenn kein Code da ist, weil jeder
 * Vergleich damit sauber fehlschlaegt.
 */
function fehlerCode(e: unknown): string | undefined {
  const c = (e as { code?: unknown } | null | undefined)?.code;
  return typeof c === 'string' || typeof c === 'number' ? String(c) : undefined;
}

/**
 * Ein Routen-Parameter, den der Pfad garantiert.
 * Ausführlich: docs/begruendungen/utils/httpError.ts.md#abschnitt
 */
/*
 * Der Typ nimmt seit Express 5 auch `string[]` an (05.10.).
 * Ausführlich: docs/begruendungen/utils/httpError.ts.md#pfadparam
 */
function pfadParam(req: { params: Record<string, string | string[] | undefined> },
                   name: string): string {
  const wert = req.params[name];
  return Array.isArray(wert) ? wert.join('/') : (wert ?? '');
}

/**
 * Der Teil vor dem ersten Trenner.
 *
 * `'a;b'.split(';')[0]` ist immer da — auch `''.split(';')` liefert `['']`.
 * Der Pruefer weiss das nicht: Eine Index-Signatur ist fuer ihn immer
 * moeglicherweise leer. Statt an sechs Stellen `?? ''` anzuhaengen, steht die
 * Zusicherung einmal hier, mit dem Grund dabei.
 */
function vorDem(s: string, trenner: string): string {
  return s.split(trenner)[0] ?? '';
}

export { handleRouteError, logAndContinue, meldeUndWeiter, meldeUndLiefere, ohneFehlendeDatei, fehlertext, fehlerCode, pfadParam, vorDem };

/**
 * Eine Datei an die Antwort streamen — mit Fehlerbehandlung.
 * Ausführlich: docs/begruendungen/utils/httpError.ts.md#abschnitt-2
 */
/**
 * @param req Nur fuer die Sprache der Fehlermeldung. Optional,
 *        weil dieser Helfer auch an einer nackten http-Antwort laeuft, wo es
 *        keinen Express-Request gibt — dann antwortet er auf Deutsch, wie
 *        bisher.
 */
function streamFileToResponse(res: any, filePath: string, onEnd?: () => void, req?: any) {
  const fs = require('fs');
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
