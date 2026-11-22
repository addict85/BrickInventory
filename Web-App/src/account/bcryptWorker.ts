/** Runs in a worker thread (bcryptPool.ts): here bcrypt blocks nobody. */
import { parentPort } from 'node:worker_threads';
import bcrypt from 'bcryptjs';

parentPort?.on('message', (a: { id: number; kind: 'hash' | 'vergleich'; passwort: string; wert: string | number }) => {
  try {
    const ergebnis =
      a.kind === 'hash' ? bcrypt.hashSync(a.passwort, Number(a.wert)) : bcrypt.compareSync(a.passwort, String(a.wert));
    parentPort!.postMessage({ id: a.id, ergebnis });
  } catch (e) {
    parentPort!.postMessage({ id: a.id, error: e instanceof Error ? e.message : String(e) });
  }
});
