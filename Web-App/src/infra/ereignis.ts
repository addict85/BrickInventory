/** Ein tieferer Bereich meldet, ein höherer horcht: So kennt der tiefere den höheren nicht.
 * Ein scheiternder Horcher wird protokolliert und hält weder den Melder noch die anderen auf. */
import crypto from 'node:crypto';
import { meldeFehler } from './fehler';

type Horcher<A extends unknown[]> = (...a: A) => unknown;

export interface Ereignis<A extends unknown[] = []> {
  horche(f: Horcher<A>): () => void;
  /** Erfüllt sich, wenn alle Horcher fertig sind, mit false, wenn einer scheiterte; wirft nie. */
  melde(...a: A): Promise<boolean>;
}

export interface Signalweg {
  listen(kanal: string, h: (nutzlast?: string) => unknown): void;
  unlisten(kanal: string, h: (nutzlast?: string) => unknown): void;
  notify(kanal: string, nutzlast?: string): Promise<void>;
}

async function rufe<A extends unknown[]>(name: string, horcher: Iterable<Horcher<A>>, a: A): Promise<boolean> {
  const r = await Promise.allSettled([...horcher].map(async f => f(...a)));
  for (const x of r) if (x.status === 'rejected') meldeFehler(`ereignis:${name}`, x.reason);
  return r.every(x => x.status === 'fulfilled');
}

/** Nur in diesem Prozess; der Bereich hält es in einem Fach, damit zwei Zugänge einander nicht hören. */
export function ereignis<A extends unknown[] = []>(name: string): Ereignis<A> {
  const horcher = new Set<Horcher<A>>();
  return {
    horche(f) {
      horcher.add(f);
      return () => {
        horcher.delete(f);
      };
    },
    melde: (...a) => rufe(name, horcher, a),
  };
}

/** Prozessübergreifend über NOTIFY: hier sofort, anderswo nach dem COMMIT des Signalwegs. */
export interface ProzessEreignis {
  horche(f: () => unknown): () => void;
  melde(ueber: Signalweg): Promise<boolean>;
  verbinde(s: Signalweg): () => void;
}

export function prozessEreignis(name: string, kanal: string): ProzessEreignis {
  const hier = ereignis(name);
  // Das eigene NOTIFY kommt zurück; hier gilt es schon.
  const absender = crypto.randomBytes(6).toString('hex');
  return {
    horche: f => hier.horche(f),
    melde: async ueber => {
      const [ok, gesendet] = await Promise.all([hier.melde(), rufe(name, [() => ueber.notify(kanal, absender)], [])]);
      return ok && gesendet;
    },
    verbinde(s) {
      const h = (n?: string) => (n === absender ? undefined : hier.melde());
      s.listen(kanal, h);
      return () => s.unlisten(kanal, h);
    },
  };
}

/** Nur über NOTIFY, auch für den eigenen Prozess: Ein Wecksignal, das erst nach dem COMMIT gilt. */
export interface Signal {
  horche(s: Signalweg, f: (nutzlast?: string) => unknown): () => void;
  melde(ueber: Signalweg, nutzlast?: string): Promise<void>;
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
