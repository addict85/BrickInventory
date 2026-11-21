/** The time of a set of services (`k.uhr`): domain areas ask it here instead of `Date.now()`, so that
 * a test can set it instead of waiting. The database has its own (`NOW()`). */
export interface Uhr {
  /** Milliseconds since 1970, like Date.now(). */
  jetzt(): number;
  /** The present as a Date. */
  datum(): Date;
}

export const systemClock: Uhr = { jetzt: () => Date.now(), datum: () => new Date() };

/** Runs with the system time but can be set ahead: a test jumps over a deadline instead of waiting for it. */
export interface StellbareClock extends Uhr {
  vor(ms: number): void;
  zurueck(): void;
}

export function stellbareClock(): StellbareClock {
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
