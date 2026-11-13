import type { Db, DbSchnittstelle, TxOptionen } from '../../db/database';
import { imSystemkontext } from './kontoKontext';

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

/** Bindet eine generische Funktion; ihre Typparameter bleiben erhalten, was
 * Gebunden<> nicht kann. Überladungen brauchen eine eigene Signatur. */
export function bindeGenerisch<Z>(zugang: Z) {
  return <A extends unknown[], R>(f: (z: Z, ...a: A) => R): ((...a: A) => R) =>
    (...a) =>
      f(zugang, ...a);
}

/** Wie bindeZugang, im Systemrahmen (Anmeldung, Warteschlange, Verwaltung); eine laufende
 * Transaktion behält ihren Rahmen, sonst liefe der Aufruf neben ihr statt mit ihr. */
export function bindeImSystemrahmen<Z extends { inTransaktion(): boolean }, M extends object>(
  zugang: Z,
  modul: M,
  grund: string,
): Gebunden<M, Z>;
export function bindeImSystemrahmen<
  Z extends { inTransaktion(): boolean },
  M extends object,
  N extends keyof Gebunden<M, Z> & keyof M & string,
>(zugang: Z, modul: M, grund: string, namen: readonly N[]): Gebunden<Pick<M, N>, Z>;
export function bindeImSystemrahmen<Z extends { inTransaktion(): boolean }, M extends object>(
  zugang: Z,
  modul: M,
  grund: string,
  namen?: readonly string[],
): unknown {
  const gebunden = (namen ? bindeZugang(zugang, modul, namen as never[]) : bindeZugang(zugang, modul)) as Record<
    string,
    (...a: unknown[]) => unknown
  >;
  const aus: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(gebunden))
    aus[name] = (...a: unknown[]) => (zugang.inTransaktion() ? f(...a) : imSystemkontext(grund, () => f(...a)));
  return aus;
}

/** Was ein Dienst eines Bereichs bekommt: die gebundenen Repositories (`zugang`),
 * die Dienste tieferer Bereiche und die Arbeitseinheit. `transaktion` reicht einen
 * Kontext weiter, dessen Repositories an die Transaktion gebunden sind: So steht am
 * Aufrufort, welche Schritte zusammen gelten (`t` statt `k`). */
export type Kontext<A extends { db: Db }, Z> = A &
  Z & {
    transaktion<T>(fn: (t: Kontext<A, Z>) => Promise<T>, o?: TxOptionen): Promise<T>;
  };

export function baueKontext<A extends { db: Db }, Z extends object>(a: A, zugang: (db: Db) => Z): Kontext<A, Z> {
  return {
    ...a,
    ...zugang(a.db),
    transaktion: (fn, o) => a.db.transaction(tx => fn(baueKontext({ ...a, db: anTransaktion(a.db, tx) }, zugang)), o),
  };
}

/** Der Zugang, dessen Abfragen über die Verbindung der Transaktion gehen. */
function anTransaktion(db: Db, tx: DbSchnittstelle): Db {
  return { ...db, all: tx.all, get: tx.get, run: tx.run, exec: tx.exec, inTransaktion: () => true };
}

/** Die Dienste aller Bereiche im Prozess, gebaut beim ersten Gebrauch aus dem, was
 * der Einstieg übergibt (startup/verdrahtung.ts, baueDienste). Nur für Wege ohne
 * eigenen Kontext (HTTP-Seiten, Fassaden für Tests); ohne Verdrahtung ein Fehler. */
const prozess: { bau: (() => object) | null; dienste: object | null } = { bau: null, dienste: null };
export function verdrahteDienste(bau: (() => object) | null): void {
  prozess.bau = bau;
  prozess.dienste = null;
}
export function prozessDienste(): object {
  if (!prozess.bau) throw new Error('Die Dienste sind nicht verdrahtet (startup/verdrahtung.ts, verdrahte())');
  prozess.dienste ??= prozess.bau();
  return prozess.dienste;
}
export function prozessStelle<T>(name: string): () => T {
  return () => {
    const d = (prozessDienste() as Record<string, T | undefined>)[name];
    if (!d) throw new Error(`Der Bereich ${name} fehlt in baueDienste (startup/verdrahtung.ts)`);
    return d;
  };
}

/** Ausgewählte Dienste eines Bereichs im Prozess, ohne Zugang als Parameter:
 * So erreicht eine Route Dienste, aber weder Repository noch Zugang. Gesucht
 * wird beim Aufruf, damit ein Test neu verdrahten kann. */
export function dienstePerAufruf<T, N extends keyof T & string>(hole: () => T, namen: readonly N[]): Pick<T, N> {
  const raus: Record<string, unknown> = {};
  for (const n of namen) raus[n] = (...a: unknown[]) => (hole()[n] as (...x: unknown[]) => unknown)(...a);
  return raus as Pick<T, N>;
}
