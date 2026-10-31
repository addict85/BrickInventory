/**
 * Verzeichnis der offenen Server-Sent-Events-Ströme.
 * Ausführlich: docs/begruendungen/src/infra/sseRegistry.ts.md#offen
 */

/** Offene Antworten. Set, weil dieselbe Antwort nur einmal drin sein soll. */
const _offen = new Set<any>();

/**
 * Eine SSE-Antwort anmelden.
 * @returns Funktion zum Abmelden — im Aufräumpfad der Route aufrufen.
 */
export function registerSse(res: any): () => void {
  _offen.add(res);
  // Doppelte Sicherung: Trennt der Client, ohne dass die Route ihren
  // Aufräumpfad erreicht, bleibt sonst ein toter Eintrag stehen.
  res.on?.('close', () => _offen.delete(res));
  return () => { _offen.delete(res); };
}

/**
 * Alle offenen Ströme beenden. Aus dem Shutdown aufgerufen, BEVOR auf
 * `httpServer.close()` gewartet wird.
 * Ausführlich: docs/begruendungen/src/infra/sseRegistry.ts.md#closeallsse
 * @returns Anzahl beendeter Ströme
 */
export function closeAllSse(): number {
  const anzahl = _offen.size;
  for (const res of [..._offen]) {
    try {
      if (!res.writableEnded) res.write('event: shutdown\ndata: {"reason":"shutdown"}\n\n');
      res.end();
    } catch (_) { /* Antwort war schon tot — nur der Eintrag muss weg */ }
    _offen.delete(res);
  }
  return anzahl;
}
