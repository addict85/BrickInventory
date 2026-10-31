// Ausführlich: docs/begruendungen/src/infra/sseRegistry.ts.md#offen

const _offen = new Set<any>();

/** @returns Funktion zum Abmelden — im Aufräumpfad der Route aufrufen. */
export function registerSse(res: any): () => void {
  _offen.add(res);
  // Trennt der Client, ohne dass die Route aufräumt, bliebe ein toter Eintrag.
  res.on?.('close', () => _offen.delete(res));
  return () => { _offen.delete(res); };
}

/** VOR `httpServer.close()`: Offene Ströme enden nie von selbst.
 * Ausführlich: docs/begruendungen/src/infra/sseRegistry.ts.md#closeallsse */
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
