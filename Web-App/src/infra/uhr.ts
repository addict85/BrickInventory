/** Die Zeit eines Satzes Dienste (`k.uhr`): Fachbereiche fragen sie hier statt `Date.now()`, damit
 * ein Test sie stellen kann, statt zu warten. Die Datenbank hat ihre eigene (`NOW()`). */
export interface Uhr {
  /** Millisekunden seit 1970, wie Date.now(). */
  jetzt(): number;
  /** Die Gegenwart als Date. */
  datum(): Date;
}

export const systemUhr: Uhr = { jetzt: () => Date.now(), datum: () => new Date() };

/** Läuft mit der Systemzeit, lässt sich aber vorstellen: Ein Test springt über eine Frist, statt sie abzuwarten. */
export interface StellbareUhr extends Uhr {
  vor(ms: number): void;
  zurueck(): void;
}

export function stellbareUhr(): StellbareUhr {
  let versatz = 0;
  const jetzt = () => Date.now() + versatz;
  return {
    jetzt,
    datum: () => new Date(jetzt()),
    vor: ms => {
      versatz += ms;
    },
    zurueck: () => {
      versatz = 0;
    },
  };
}
