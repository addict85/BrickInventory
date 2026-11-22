import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

/** bcryptjs computes in JavaScript; in the main thread every check would hold up all other
 * requests for up to 100 ms. Workers are created only on demand and keep the
 * process alive only while they compute. If the file is missing (source instead of build), the
 * main thread computes as before. */
type Job = { kind: 'hash' | 'vergleich'; passwort: string; wert: string | number };
type Pending = { auftrag: Job; ok: (v: unknown) => void; error: (e: Error) => void };

export interface Pool {
  hash(passwort: string, rounds: number): Promise<string>;
  compare(passwort: string, hash: string): Promise<boolean>;
  state(): { worker: number; frei: number; wartend: number; hauptthread: boolean };
  finish(): Promise<void>;
}

const inMainThread = (a: Job) =>
  a.kind === 'hash' ? bcrypt.hash(a.passwort, Number(a.wert)) : bcrypt.compare(a.passwort, String(a.wert));
const NO_WORKER = '[bcrypt] Worker-Thread startet nicht, Prüfungen laufen im Hauptthread:';

/** idleMs: an idle worker ends after that and frees its memory. */
export function newPool(size: number, file = path.join(__dirname, 'bcryptWorker.js'), idleMs = 60_000): Pool {
  let hauptthread = !fs.existsSync(file);
  const free: Worker[] = [],
    all = new Set<Worker>(),
    queue: Pending[] = [];
  const rest = new Map<Worker, NodeJS.Timeout>();
  const running = new Map<Worker, { id: number; o: Pending }>();
  let nextId = 0,
    ended = false;

  const start = (w: Worker, o: Pending) => {
    const id = ++nextId;
    running.set(w, { id, o });
    w.ref();
    w.postMessage({ id, ...o.auftrag });
  };
  const next = (w: Worker) => {
    running.delete(w);
    const o = queue.shift();
    if (o) {
      start(w, o);
      return;
    }
    w.unref();
    free.push(w);
    rest.set(
      w,
      setTimeout(() => {
        rest.delete(w);
        free.splice(free.indexOf(w), 1);
        void w.terminate();
      }, idleMs).unref(),
    );
  };
  const takeFree = (): Worker | undefined => {
    const w = free.pop();
    if (w) {
      clearTimeout(rest.get(w));
      rest.delete(w);
    }
    return w;
  };
  const fresh = (): Worker => {
    const w = new Worker(file);
    let answered = false,
      reason: Error | null = null;
    all.add(w);
    w.on('message', (m: { id: number; ergebnis?: unknown; error?: string }) => {
      const l = running.get(w);
      if (!l || l.id !== m.id) return;
      answered = true;
      next(w);
      if (m.error !== undefined) l.o.error(new Error(m.error));
      else l.o.ok(m.ergebnis);
    });
    w.on('error', (e: Error) => {
      reason = e;
    });
    w.on('exit', () => {
      all.delete(w);
      clearTimeout(rest.get(w));
      rest.delete(w);
      if (free.includes(w)) free.splice(free.indexOf(w), 1);
      const l = running.get(w);
      running.delete(w);
      if (ended) return;
      // If a worker does not start at all, the next one will not start either.
      if (!answered) {
        hauptthread = true;
        console.warn(NO_WORKER, reason?.message ?? 'beendet');
      }
      if (l)
        void (
          hauptthread ? inMainThread(l.o.auftrag) : Promise.reject(reason ?? new Error('bcrypt-Arbeiter beendet'))
        ).then(l.o.ok, l.o.error);
      for (const o of queue.splice(0)) void job(o.auftrag).then(o.ok, o.error);
    });
    return w;
  };
  const job = (a: Job): Promise<unknown> => {
    if (hauptthread) return inMainThread(a);
    return new Promise((ok, error) => {
      const o = { auftrag: a, ok, error };
      const w = takeFree() ?? (all.size < size ? fresh() : undefined);
      if (w) start(w, o);
      else queue.push(o);
    });
  };
  return {
    hash: (passwort, rounds) => job({ kind: 'hash', passwort, wert: rounds }) as Promise<string>,
    compare: (passwort, hash) => job({ kind: 'vergleich', passwort, wert: hash }) as Promise<boolean>,
    state: () => ({ worker: all.size, frei: free.length, wartend: queue.length, hauptthread }),
    finish: async () => {
      ended = true;
      await Promise.all([...all].map(w => w.terminate()));
    },
  };
}
