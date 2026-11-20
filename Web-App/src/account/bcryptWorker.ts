/** Läuft in einem Worker-Thread (bcryptPool.ts): Hier blockiert bcrypt niemanden. */
import { parentPort } from 'node:worker_threads';
import bcrypt from 'bcryptjs';

parentPort?.on('message', (a: { id: number; art: 'hash' | 'vergleich'; passwort: string; wert: string | number }) => {
  try {
    const ergebnis =
      a.art === 'hash' ? bcrypt.hashSync(a.passwort, Number(a.wert)) : bcrypt.compareSync(a.passwort, String(a.wert));
    parentPort!.postMessage({ id: a.id, ergebnis });
  } catch (e) {
    parentPort!.postMessage({ id: a.id, fehler: e instanceof Error ? e.message : String(e) });
  }
});
