import type { DbSchnittstelle } from '../../db/database';

/** Nur Funktionen, deren erster Parameter den Zugang nimmt, und zwar ohne ihn. */
export type Gebunden<M, Z = DbSchnittstelle> = {
  [K in keyof M as M[K] extends (z: Z, ...a: never[]) => unknown ? K : never]: M[K] extends (
    z: Z,
    ...a: infer A
  ) => infer R
    ? (...a: A) => R
    : never;
};

/** Bindet den Zugang an jede Funktion des Moduls, oder nur an die genannten,
 * wenn das Modul auch Funktionen ohne Zugang ausführt (die zur Laufzeit nicht
 * zu unterscheiden sind). Gesucht wird beim Aufruf, damit ein Test eine
 * Funktion des Moduls ersetzen kann. */
export function bindeZugang<Z, M extends object>(zugang: Z, modul: M): Gebunden<M, Z>;
export function bindeZugang<Z, M extends object, N extends keyof Gebunden<M, Z> & keyof M & string>(
  zugang: Z,
  modul: M,
  namen: readonly N[],
): Gebunden<Pick<M, N>, Z>;
export function bindeZugang<Z, M extends object>(zugang: Z, modul: M, namen?: readonly string[]): unknown {
  const gebunden: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(modul))
    if (typeof f === 'function' && (!namen || namen.includes(name)))
      gebunden[name] = (...a: unknown[]) =>
        ((modul as Record<string, unknown>)[name] as (z: Z, ...x: unknown[]) => unknown)(zugang, ...a);
  return gebunden;
}

/** Die Dienste eines Bereichs im Prozess, gebaut beim ersten Gebrauch aus dem,
 * was der Einstieg (startup/verdrahtung.ts) übergibt. Ohne Verdrahtung ist ein
 * Aufruf ein Fehler: Ein stiller Rückfall auf einen Zugang verdeckte, wer fehlt.
 * Der Zustand liegt im Rückgabewert, nicht in einem modulweiten let. */
export function prozessStelle<T>(name: string) {
  const stand: { bau: (() => T) | null; dienste: T | null } = { bau: null, dienste: null };
  return {
    verdrahte(bau: (() => T) | null): void {
      stand.bau = bau;
      stand.dienste = null;
    },
    hole(): T {
      if (!stand.bau) throw new Error(`Der Bereich ${name} ist nicht verdrahtet (startup/verdrahtung.ts, verdrahte())`);
      stand.dienste ??= stand.bau();
      return stand.dienste;
    },
  };
}
