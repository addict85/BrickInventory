import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

/** bcryptjs computes in JavaScript; in the main thread every check would hold up all other
 * requests for up to 100 ms. Workers are created only on demand and keep the
 * process alive only while they compute. If the file is missing (source instead of build), the
 * main thread computes as before. */
type Job = { kind: 'hash' | 'vergleich'; password: string; value: string | number };
type Pending = { job: Job; ok: (v: unknown) => void; error: (e: Error) => void };

export interface Pool {
  hash(password: string, rounds: number): Promise<string>;
  compare(password: string, hash: string): Promise<boolean>;
  state(): { worker: number; free: number; waiting: number; mainThread: boolean };
  finish(): Promise<void>;
}

const inMainThread = (a: Job) =>
  a.kind === 'hash' ? bcrypt.hash(a.password, Number(a.value)) : bcrypt.compare(a.password, String(a.value));
const NO_WORKER = '[bcrypt] Worker-Thread startet nicht, Prüfungen laufen im Hauptthread:';

/** The free workers with their idle timer: one that waits longer than idleMs ends and frees its memory. */
function idleWorkers(idleMs: number) {
  const free: Worker[] = [];
  const rest = new Map<Worker, NodeJS.Timeout>();
  const drop = (w: Worker) => {
    clearTimeout(rest.get(w));
    rest.delete(w);
    if (free.includes(w)) free.splice(free.indexOf(w), 1);
  };
  return {
    size: () => free.length,
    park(w: Worker) {
      w.unref();
      free.push(w);
      rest.set(
        w,
        setTimeout(() => {
          drop(w);
          void w.terminate();
        }, idleMs).unref(),
      );
    },
    take(): Worker | undefined {
      const w = free.pop();
      if (w) drop(w);
      return w;
    },
    drop,
  };
}

/** idleMs: an idle worker ends after that and frees its memory. */
export function newPool(size: number, file = path.join(__dirname, 'bcryptWorker.js'), idleMs = 60_000): Pool {
  let mainThread = !fs.existsSync(file);
  const idle = idleWorkers(idleMs);
  const all = new Set<Worker>(),
    queue: Pending[] = [];
  const running = new Map<Worker, { id: number; o: Pending }>();
  let nextId = 0,
    ended = false;

  const start = (w: Worker, o: Pending) => {
    const id = ++nextId;
    running.set(w, { id, o });
    w.ref();
    w.postMessage({ id, ...o.job });
  };
  const next = (w: Worker) => {
    running.delete(w);
    const o = queue.shift();
    if (o) start(w, o);
    else idle.park(w);
  };
  /** A worker that ended: out of every list; @returns the job it was running. */
  const forget = (w: Worker) => {
    all.delete(w);
    idle.drop(w);
    const l = running.get(w);
    running.delete(w);
    return l;
  };
  const fresh = (): Worker => {
    const w = new Worker(file);
    let answered = false,
      reason: Error | null = null;
    all.add(w);
    w.on('message', (m: { id: number; result?: unknown; error?: string }) => {
      const l = running.get(w);
      if (!l || l.id !== m.id) return;
      answered = true;
      next(w);
      if (m.error !== undefined) l.o.error(new Error(m.error));
      else l.o.ok(m.result);
    });
    w.on('error', (e: Error) => {
      reason = e;
    });
    w.on('exit', () => {
      const l = forget(w);
      if (ended) return;
      // If a worker does not start at all, the next one will not start either.
      if (!answered) {
        mainThread = true;
        console.warn(NO_WORKER, reason?.message ?? 'beendet');
      }
      if (l)
        void (mainThread ? inMainThread(l.o.job) : Promise.reject(reason ?? new Error('bcrypt-Arbeiter beendet'))).then(
          l.o.ok,
          l.o.error,
        );
      for (const o of queue.splice(0)) void job(o.job).then(o.ok, o.error);
    });
    return w;
  };
  const job = (a: Job): Promise<unknown> => {
    if (mainThread) return inMainThread(a);
    return new Promise((ok, error) => {
      const o = { job: a, ok, error };
      const w = idle.take() ?? (all.size < size ? fresh() : undefined);
      if (w) start(w, o);
      else queue.push(o);
    });
  };
  return {
    hash: (password, rounds) => job({ kind: 'hash', password, value: rounds }) as Promise<string>,
    compare: (password, hash) => job({ kind: 'vergleich', password, value: hash }) as Promise<boolean>,
    state: () => ({ worker: all.size, free: idle.size(), waiting: queue.length, mainThread }),
    finish: async () => {
      ended = true;
      await Promise.all([...all].map(w => w.terminate()));
    },
  };
}
