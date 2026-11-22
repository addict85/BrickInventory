/** The time of a set of services (`k.uhr`): domain areas ask it here instead of `Date.now()`, so that
 * a test can set it instead of waiting. The database has its own (`NOW()`). */
export interface Clock {
  /** Milliseconds since 1970, like Date.now(). */
  jetzt(): number;
  /** The present as a Date. */
  datum(): Date;
}

export const systemClock: Clock = { jetzt: () => Date.now(), datum: () => new Date() };

/** Runs with the system time but can be set ahead: a test jumps over a deadline instead of waiting for it. */
export interface SettableClock extends Clock {
  vor(ms: number): void;
  back(): void;
}

export function settableClock(): SettableClock {
  let offset = 0;
  const jetzt = () => Date.now() + offset;
  return {
    jetzt,
    datum: () => new Date(jetzt()),
    vor: ms => {
      offset += ms;
    },
    back: () => {
      offset = 0;
    },
  };
}
