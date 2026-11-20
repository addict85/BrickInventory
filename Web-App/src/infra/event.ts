/** A lower area reports, a higher one listens: that way the lower one does not know the higher one.
 * A failing listener is logged and holds up neither the reporter nor the others. */
import crypto from 'node:crypto';
import { reportError } from './error';

type Listener<A extends unknown[]> = (...a: A) => unknown;

export interface Ereignis<A extends unknown[] = []> {
  horche(f: Listener<A>): () => void;
  /** Resolves when all listeners are done, with false if one failed; never throws. */
  melde(...a: A): Promise<boolean>;
}

export interface SignalPath {
  listen(kanal: string, h: (nutzlast?: string) => unknown): void;
  unlisten(kanal: string, h: (nutzlast?: string) => unknown): void;
  notify(kanal: string, nutzlast?: string): Promise<void>;
}

async function rufe<A extends unknown[]>(name: string, listener: Iterable<Listener<A>>, a: A): Promise<boolean> {
  const r = await Promise.allSettled([...listener].map(async f => f(...a)));
  for (const x of r) if (x.status === 'rejected') reportError(`ereignis:${name}`, x.reason);
  return r.every(x => x.status === 'fulfilled');
}

/** Only in this process; the area keeps it in a compartment so that two accesses do not hear each other. */
export function ereignis<A extends unknown[] = []>(name: string): Ereignis<A> {
  const listener = new Set<Listener<A>>();
  return {
    horche(f) {
      listener.add(f);
      return () => {
        listener.delete(f);
      };
    },
    melde: (...a) => rufe(name, listener, a),
  };
}

/** Across processes via NOTIFY: here immediately, elsewhere after the COMMIT of the signal path. */
export interface ProcessEvent {
  horche(f: () => unknown): () => void;
  melde(ueber: SignalPath): Promise<boolean>;
  connect(s: SignalPath): () => void;
}

export function processEvent(name: string, kanal: string): ProcessEvent {
  const hier = ereignis(name);
  // The own NOTIFY comes back; here it already applies.
  const sender = crypto.randomBytes(6).toString('hex');
  return {
    horche: f => hier.horche(f),
    melde: async ueber => {
      const [ok, gesendet] = await Promise.all([hier.melde(), rufe(name, [() => ueber.notify(kanal, sender)], [])]);
      return ok && gesendet;
    },
    connect(s) {
      const h = (n?: string) => (n === sender ? undefined : hier.melde());
      s.listen(kanal, h);
      return () => s.unlisten(kanal, h);
    },
  };
}

/** Only via NOTIFY, also for the own process: a wake-up signal that only applies after the COMMIT. */
export interface Signal {
  horche(s: SignalPath, f: (nutzlast?: string) => unknown): () => void;
  melde(ueber: SignalPath, nutzlast?: string): Promise<void>;
}

export function signal(kanal: string): Signal {
  return {
    horche(s, f) {
      s.listen(kanal, f);
      return () => s.unlisten(kanal, f);
    },
    melde: (ueber, nutzlast) => ueber.notify(kanal, nutzlast),
  };
}
