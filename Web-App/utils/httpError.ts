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
function handleRouteError(res: any, e: any, status?: number) {
  const code = status || e?.status || 500;
  // Vollständig loggen — inkl. Stack für die Fehlersuche
  console.error(`[route-error] ${code}:`, e?.stack || e?.message || e);
  if (res.headersSent) return;
  const isServerError = code >= 500;
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

export { handleRouteError, logAndContinue, meldeUndWeiter };

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
function streamFileToResponse(res: any, filePath: string, onEnd?: () => void) {
  const fs = require('fs');
  const stream = fs.createReadStream(filePath);
  stream.on('error', (e: any) => {
    console.error(`[stream] ${filePath}: ${e?.code || e?.message}`);
    if (!res.headersSent) {
      // Nicht auf Express-Methoden verlassen: Dieser Helfer läuft auch an
      // einer nackten http-Antwort (und genau daran ist die erste Fassung
      // gescheitert — res.status war dort nicht vorhanden, und der Absturz,
      // den der Helfer verhindern sollte, kam aus dem Helfer selbst).
      if (typeof res.status === 'function') res.status(404).json({ success: false, error: 'Datei nicht verfügbar' });
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
