// Damit das Herunterfahren Ströme beendet.

/** Was hier von einer offenen Antwort gebraucht wird. */
interface Strom { writableEnded?: boolean; write(s: string): unknown; end(): unknown; on?(e: 'close', f: () => void): unknown }

const _offen = new Set<Strom>();

/** @returns Funktion zum Abmelden — im Aufräumpfad der Route aufrufen. */
export function registerSse(res: Strom): () => void {
  _offen.add(res);
  // Trennt der Client, ohne dass die Route aufräumt, bliebe ein toter Eintrag.
  res.on?.('close', () => _offen.delete(res));
  return () => { _offen.delete(res); };
}

/** VOR `httpServer.close()`: Offene Ströme enden nie von selbst. */
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
