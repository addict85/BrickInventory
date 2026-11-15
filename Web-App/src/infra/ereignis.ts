/** Ein tieferer Bereich meldet, ein höherer horcht: So kennt der tiefere den höheren nicht.
 * Ein scheiternder Horcher wird protokolliert und hält weder den Melder noch die anderen auf. */
import crypto from 'node:crypto';
import { meldeFehler } from './fehler';

type Horcher<A extends unknown[]> = (...a: A) => unknown;

export interface Ereignis<A extends unknown[] = []> {
  /** @returns das Abmelden */
  horche(f: Horcher<A>): () => void;
  /** Erfüllt sich, wenn alle Horcher fertig sind, mit false, wenn einer scheiterte; wirft nie. */
  melde(...a: A): Promise<boolean>;
}

/** Was ein Zugang an LISTEN/NOTIFY anbietet (db/pgNotify.ts); hier nur die Form. */
export interface Signalweg {
  listen(kanal: string, h: (nutzlast?: string) => unknown): void;
  unlisten(kanal: string, h: (nutzlast?: string) => unknown): void;
  notify(kanal: string, nutzlast?: string): Promise<void>;
}

async function rufe<A extends unknown[]>(name: string, horcher: Iterable<Horcher<A>>, a: A): Promise<boolean> {
  const ok = await Promise.all(
    [...horcher].map(async f => {
      try {
        await f(...a);
        return true;
      } catch (e) {
        meldeFehler(`ereignis:${name}`, e);
        return false;
      }
    }),
  );
  return ok.every(Boolean);
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

/** Kennzeichen „prozessübergreifend über NOTIFY“: Hier gilt die Meldung sofort, die anderen
 * Prozesse hören sie nach dem COMMIT des Signalwegs, über den gemeldet wurde. */
export interface ProzessEreignis {
  horche(f: () => unknown): () => void;
  melde(ueber: Signalweg): Promise<boolean>;
  /** Ab jetzt hört dieser Prozess die Meldungen der anderen. Auch ohne Nutzlast (neu verbunden). */
  verbinde(s: Signalweg): () => void;
}

export function prozessEreignis(name: string, kanal: string): ProzessEreignis {
  const hier = ereignis(name);
  // Das eigene NOTIFY kommt zurück; hier gilt es schon.
  const absender = crypto.randomBytes(6).toString('hex');
  return {
    horche: f => hier.horche(f),
    async melde(ueber) {
      const ok = await hier.melde();
      try {
        await ueber.notify(kanal, absender);
      } catch (e) {
        meldeFehler(`ereignis:${name}:notify`, e);
      }
      return ok;
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
