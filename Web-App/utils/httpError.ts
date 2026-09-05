import { sendeFehler } from './fehlerTexte';
import { FEHLER, fehlerText, antwortSprache } from './fehlerTexte';
import type { FehlerCode } from './fehlerTexte';
/**
 * Zentrale Fehlerbehandlung für Routen.
 *
 * Vorher: ~95 Catch-Blöcke schickten e.message direkt an den Client — bei
 * unerwarteten Fehlern leakt das Interna (SQL-Fehlertexte, Pfade, Stacktraces
 * in der Message). Jetzt: Der volle Fehler wird geloggt (landet via
 * Log-Interceptor in app_logs), aber der Client bekommt bei 5xx in Produktion
 * nur eine generische Meldung. Bewusst geworfene Client-Fehler (4xx via
 * e.status) behalten ihre Message — die ist für den Nutzer gedacht.
 */
/**
 * @param res    Express-Response
 * @param e      Fehler (Error oder beliebig geworfen)
 * @param status expliziter HTTP-Status, sonst e.status || 500
 */
function handleRouteError(res: any, e: any, status?: number, req?: any) {
  const code = status || e?.status || 500;
  // Vollständig loggen — inkl. Stack für die Fehlersuche
  console.error(`[route-error] ${code}:`, e?.stack || e?.message || e);
  if (res.headersSent) return;
  const isServerError = code >= 500;
  // ── Trägt der Fehler einen Code, gilt der (Nachtrag 130) ──────────────────
  //
  // Helfer wie utils/household.ts und utils/setMove.ts werfen mit
  // fehlerWerfen() und geben damit den GRUND mit, nicht den Satz. Erst hier —
  // wo der Request bekannt ist — wird daraus ein Satz in der Sprache des
  // Anfragenden.
  //
  // Ohne Code bleibt alles wie bisher: Ein technischer Fehler ist keine
  // Nutzermeldung, und bei 5xx in der Produktion steht ohnehin ein
  // allgemeiner Satz da.
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
 *
 * ── Warum es das gibt ───────────────────────────────────────────────────────
 * Ein leerer Catch-Block sagt zwei Dinge gleichzeitig: „darf scheitern" und
 * „niemand erfährt davon". Das erste ist oft richtig, das zweite fast nie —
 * eine Spiegelung, die seit Wochen jedes Mal scheitert, sieht von aussen
 * identisch aus wie eine, die funktioniert. Der Fehler landet über den
 * Log-Interceptor in app_logs und ist im Log-Viewer auffindbar; der Ablauf
 * läuft weiter wie vorher.
 *
 * NICHT verwenden für Schritte innerhalb einer Transaktion: Postgres bricht
 * die Transaktion beim ersten Fehler ab, alle folgenden Statements laufen dann
 * ins Leere. Dort muss der Fehler durch (siehe utils/txLock.ts).
 *
 * @param kontext kurze Herkunftsangabe, z. B. 'parts:image_local'
 */
function logAndContinue(kontext: string) {
  return (e: any) => {
    console.warn(`[weiter-trotz-fehler] ${kontext}:`, e?.message || e);
  };
}

/**
 * Dasselbe fuer try/catch statt fuer .catch().
 *
 * logAndContinue() gibt einen RUECKRUF zurueck und passt damit an ein
 * Versprechen; in einem catch-Block laese sich das als
 * `logAndContinue('x')(e)`. Diese Form nimmt den Fehler direkt und benutzt
 * darunter denselben Helfer — es gibt also weiterhin genau EIN Format fuer
 * diese Meldungen, und eine Suche nach `[weiter-trotz-fehler]` findet beide.
 *
 * Gedacht fuer Stellen, an denen der Ablauf bewusst weitergeht, der Fehlschlag
 * aber jemanden interessiert: ein uebersprungener Datensatz in einem
 * Hintergrundjob, eine nicht verschickte Mail, ein nicht neu geplanter Zeitplan.
 * NICHT fuer Aufraeumarbeiten — ein `c.end()` auf einer schon toten Verbindung
 * darf schweigen.
 */
function meldeUndWeiter(kontext: string, e: unknown) {
  logAndContinue(kontext)(e);
}

/**
 * Der lesbare Text eines gefangenen Fehlers — egal was geworfen wurde.
 *
 * ── Warum das mehr ist als eine Typ-Beruhigung ──────────────────────────────
 * `catch (e) { … e.message … }` stand an 91 Stellen. In JavaScript darf aber
 * ALLES geworfen werden, nicht nur ein Error: eine Zeichenkette, ein Objekt
 * ohne `message`, bei einem abgelehnten Versprechen auch `undefined`. In genau
 * diesen Faellen war `e.message` seinerseits `undefined` — und beim Nutzer
 * stand dann „Fehler: undefined", also die eine Meldung, mit der niemand
 * etwas anfangen kann.
 *
 * Die Reihenfolge ist die der Nuetzlichkeit:
 *   1. `message` einer Error-artigen Ausnahme — der Normalfall.
 *   2. Der Wert selbst, wenn eine Zeichenkette geworfen wurde.
 *   3. `String(e)` als letzter Ausweg; fuer `null`/`undefined` ein fester
 *      Text, weil „null" als Fehlermeldung nichts erklaert.
 *
 * Absichtlich KEINE Serialisierung des ganzen Objekts: Ein geworfener
 * Datenbankfehler traegt gern die vollstaendige Abfrage samt Parametern, und
 * die gehoert nicht in eine Meldung, die bis zur Oberflaeche laufen kann.
 */
function fehlertext(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  if (e && typeof e === 'object' && typeof (e as any).message === 'string' && (e as any).message)
    return (e as any).message;
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
  const c = (e as any)?.code;
  return typeof c === 'string' || typeof c === 'number' ? String(c) : undefined;
}

/**
 * Ein Routen-Parameter, den der Pfad garantiert.
 *
 * ── Warum es diesen Helfer gibt ─────────────────────────────────────────────
 * Express fuellt `req.params.setNumber`, sonst waere die Route gar nicht
 * angesprungen: `/:setNumber` matcht nur, wenn dort etwas steht. Der Typ sagt
 * das aber nicht — `ParamsDictionary` ist eine Index-Signatur, und unter
 * noUncheckedIndexedAccess liest der Pruefer daraus `string | undefined`.
 *
 * Eine Augmentierung loest das NICHT: Auch `Record<string, string>` traegt eine
 * Index-Signatur, der Schalter greift genauso. Die saubere Alternative waere
 * `Request<{ setNumber: string }>` je Route — elf Signaturen, die beim naechsten
 * Pfad wieder nachgezogen werden muessen.
 *
 * Deshalb ein benannter Zugriff: Er sagt aus, dass der Router die Garantie
 * gibt, und der leere String ist der ehrliche Rueckfall fuer den Fall, den es
 * nach dem Routing nicht geben kann. `''` faellt bei jeder Pruefung darunter
 * sauber durch — anders als ein `!`, das im Fehlerfall einen Absturz erzeugt.
 */
function pfadParam(req: { params: Record<string, string | undefined> }, name: string): string {
  return req.params[name] ?? '';
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

export { handleRouteError, logAndContinue, meldeUndWeiter, fehlertext, fehlerCode, pfadParam, vorDem };

/**
 * Eine Datei an die Antwort streamen — mit Fehlerbehandlung.
 *
 * ── Warum es diesen Helfer gibt (Nachtrag 30) ───────────────────────────────
 * `fs.createReadStream(p).pipe(res)` sieht harmlos aus, ist aber die gleiche
 * Falle wie beim pgNotify-Absturz (Nachtrag 27): `.pipe()` hängt KEINEN
 * 'error'-Zuhörer an die Quelle, und ein 'error'-Ereignis ohne Zuhörer ist in
 * Node kein Logeintrag, sondern eine geworfene Ausnahme. Nachgestellt: Ein
 * Lesestrom auf eine fehlende Datei beendet den Prozess mit ENOENT.
 *
 * Erreichbar ist das überall dort, wo zwischen „Datei ist da" und „Datei
 * öffnen" Zeit vergeht — und das ist an allen drei Fundstellen so:
 *   • PDF-Download: existsSync, dann räumt cleanOldPdfJobs (10-Minuten-TTL)
 *     genau dazwischen auf
 *   • Bild-Proxy (Vorschau und Cache): access()/stat(), dann kann die
 *     Cache-Pflege die Datei entfernen
 * Ein voller Datenträger oder entzogene Rechte lösen dasselbe aus.
 *
 * Statt Absturz: Fehler protokollieren und, solange noch keine Kopfzeilen
 * raus sind, mit 404 antworten. Sind sie schon draussen (Fehler mitten im
 * Strom), lässt sich nichts mehr melden — dann wird die Verbindung sauber
 * beendet, statt den Worker mitzunehmen.
 *
 * onEnd läuft nur bei vollständiger Auslieferung (z.B. Aufräumen nach dem
 * PDF-Download) — bei einem Fehler ausdrücklich nicht.
 */
/**
 * @param req Nur fuer die Sprache der Fehlermeldung (Nachtrag 130). Optional,
 *        weil dieser Helfer auch an einer nackten http-Antwort laeuft, wo es
 *        keinen Express-Request gibt — dann antwortet er auf Deutsch, wie
 *        bisher.
 */
function streamFileToResponse(res: any, filePath: string, onEnd?: () => void, req?: any) {
  const fs = require('fs');
  const stream = fs.createReadStream(filePath);
  stream.on('error', (e: any) => {
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
