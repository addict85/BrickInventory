/** Ein tieferer Bereich meldet, ein höherer horcht: So kennt der tiefere den höheren nicht.
 * Ein scheiternder Horcher wird protokolliert und hält weder den Melder noch die anderen auf. */
import crypto from 'node:crypto';
import { reportError } from './error';

type Listener<A extends unknown[]> = (...a: A) => unknown;

export interface Ereignis<A extends unknown[] = []> {
  horche(f: Listener<A>): () => void;
  /** Erfüllt sich, wenn alle Horcher fertig sind, mit false, wenn einer scheiterte; wirft nie. */
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

/** Nur in diesem Prozess; der Bereich hält es in einem Fach, damit zwei Zugänge einander nicht hören. */
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

/** Prozessübergreifend über NOTIFY: hier sofort, anderswo nach dem COMMIT des Signalwegs. */
export interface ProcessEvent {
  horche(f: () => unknown): () => void;
  melde(ueber: SignalPath): Promise<boolean>;
  connect(s: SignalPath): () => void;
}

export function processEvent(name: string, kanal: string): ProcessEvent {
  const hier = ereignis(name);
  // Das eigene NOTIFY kommt zurück; hier gilt es schon.
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

/** Nur über NOTIFY, auch für den eigenen Prozess: Ein Wecksignal, das erst nach dem COMMIT gilt. */
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
