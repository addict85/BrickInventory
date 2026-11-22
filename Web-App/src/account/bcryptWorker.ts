/** Runs in a worker thread (bcryptPool.ts): here bcrypt blocks nobody. */
import { parentPort } from 'node:worker_threads';
import bcrypt from 'bcryptjs';

parentPort?.on('message', (a: { id: number; kind: 'hash' | 'vergleich'; password: string; wert: string | number }) => {
  try {
    const result =
      a.kind === 'hash' ? bcrypt.hashSync(a.password, Number(a.wert)) : bcrypt.compareSync(a.password, String(a.wert));
    parentPort!.postMessage({ id: a.id, result });
  } catch (e) {
    parentPort!.postMessage({ id: a.id, error: e instanceof Error ? e.message : String(e) });
  }
});
