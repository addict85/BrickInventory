/** A lower area reports, a higher one listens: that way the lower one does not know the higher one.
 * A failing listener is logged and holds up neither the reporter nor the others. */
import crypto from 'node:crypto';
import { reportError } from './error';

type Listener<A extends unknown[]> = (...a: A) => unknown;

export interface Event<A extends unknown[] = []> {
  listen(f: Listener<A>): () => void;
  /** Resolves when all listeners are done, with false if one failed; never throws. */
  report(...a: A): Promise<boolean>;
}

export interface SignalPath {
  listen(channel: string, h: (payload?: string) => unknown): void;
  unlisten(channel: string, h: (payload?: string) => unknown): void;
  notify(channel: string, payload?: string): Promise<void>;
}

async function call<A extends unknown[]>(name: string, listener: Iterable<Listener<A>>, a: A): Promise<boolean> {
  const r = await Promise.allSettled([...listener].map(async f => f(...a)));
  for (const x of r) if (x.status === 'rejected') reportError(`ereignis:${name}`, x.reason);
  return r.every(x => x.status === 'fulfilled');
}

/** Only in this process; the area keeps it in a compartment so that two accesses do not hear each other. */
export function event<A extends unknown[] = []>(name: string): Event<A> {
  const listener = new Set<Listener<A>>();
  return {
    listen(f) {
      listener.add(f);
      return () => {
        listener.delete(f);
      };
    },
    report: (...a) => call(name, listener, a),
  };
}

/** Across processes via NOTIFY: here immediately, elsewhere after the COMMIT of the signal path. */
export interface ProcessEvent {
  listen(f: () => unknown): () => void;
  report(over: SignalPath): Promise<boolean>;
  connect(s: SignalPath): () => void;
}

export function processEvent(name: string, channel: string): ProcessEvent {
  const here = event(name);
  // The own NOTIFY comes back; here it already applies.
  const sender = crypto.randomBytes(6).toString('hex');
  return {
    listen: f => here.listen(f),
    report: async over => {
      const [ok, sent] = await Promise.all([here.report(), call(name, [() => over.notify(channel, sender)], [])]);
      return ok && sent;
    },
    connect(s) {
      const h = (n?: string) => (n === sender ? undefined : here.report());
      s.listen(channel, h);
      return () => s.unlisten(channel, h);
    },
  };
}

/** Only via NOTIFY, also for the own process: a wake-up signal that only applies after the COMMIT. */
export interface Signal {
  listen(s: SignalPath, f: (payload?: string) => unknown): () => void;
  report(over: SignalPath, payload?: string): Promise<void>;
}

export function signal(channel: string): Signal {
  return {
    listen(s, f) {
      s.listen(channel, f);
      return () => s.unlisten(channel, f);
    },
    report: (over, payload) => over.notify(channel, payload),
  };
}
