import { prozessweit } from '../infra/prozessweit';
// So that shutting down ends streams.

/** What is needed here from an open response. */
interface Strom {
  writableEnded?: boolean;
  write(s: string): unknown;
  end(): unknown;
  on?(e: 'close', f: () => void): unknown;
}

const _open = prozessweit('offeneStroeme', () => new Set<Strom>());

/** @returns function for unsubscribing — call it in the route's cleanup path. */
export function registerSse(res: Strom): () => void {
  _open.add(res);
  // If the client disconnects without the route cleaning up, a dead entry would remain.
  res.on?.('close', () => _open.delete(res));
  return () => {
    _open.delete(res);
  };
}

/** BEFORE `httpServer.close()`: open streams never end by themselves. */
export function closeAllSse(): number {
  const anzahl = _open.size;
  for (const res of [..._open]) {
    try {
      if (!res.writableEnded) res.write('event: shutdown\ndata: {"reason":"shutdown"}\n\n');
      res.end();
    } catch (_) {
      /* Response was already dead — only the entry has to go */
    }
    _open.delete(res);
  }
  return anzahl;
}
