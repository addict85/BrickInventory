import { prozessweit } from '../infra/prozessweit';
// Damit das Herunterfahren Ströme beendet.

/** Was hier von einer offenen Antwort gebraucht wird. */
interface Strom {
  writableEnded?: boolean;
  write(s: string): unknown;
  end(): unknown;
  on?(e: 'close', f: () => void): unknown;
}

const _open = prozessweit('offeneStroeme', () => new Set<Strom>());

/** @returns Funktion zum Abmelden — im Aufräumpfad der Route aufrufen. */
export function registerSse(res: Strom): () => void {
  _open.add(res);
  // Trennt der Client, ohne dass die Route aufräumt, bliebe ein toter Eintrag.
  res.on?.('close', () => _open.delete(res));
  return () => {
    _open.delete(res);
  };
}

/** VOR `httpServer.close()`: Offene Ströme enden nie von selbst. */
export function closeAllSse(): number {
  const anzahl = _open.size;
  for (const res of [..._open]) {
    try {
      if (!res.writableEnded) res.write('event: shutdown\ndata: {"reason":"shutdown"}\n\n');
      res.end();
    } catch (_) {
      /* Antwort war schon tot — nur der Eintrag muss weg */
    }
    _open.delete(res);
  }
  return anzahl;
}
