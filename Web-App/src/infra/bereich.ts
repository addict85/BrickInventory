import type { Db, DbSchnittstelle, TxGriff, TxOptionen } from '../../db/database';
import { imSystemkontext, zeilenKontext } from './kontoKontext';

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

/** In einer Transaktion gehört die Verbindung schon einer Rolle: Still ohne Systemrahmen liefe
 * der Aufruf unter Zeilenschutz, wo er alle Konten erwartet. Den Rahmen vorher betreten. */
export class SystemrahmenInTransaktion extends Error {
  constructor(grund: string) {
    super(`Systemrahmen „${grund}“ in einer Transaktion ohne Systemrahmen: vor der Transaktion betreten.`);
  }
}

export function imSystemrahmen<R>(zugang: { inTransaktion(): boolean }, grund: string, f: () => R): R {
  if (!zugang.inTransaktion()) return imSystemkontext(grund, f);
  if (zeilenKontext().system) return f();
  throw new SystemrahmenInTransaktion(grund);
}

/** Bindet jede Funktion; im Systemrahmen nur die in `system` genannten, jede mit Begründung.
 * Die übrigen laufen unter dem Zeilenschutz des anfragenden Kontos. */
export function bindeJeFunktion<
  Z extends { inTransaktion(): boolean },
  M extends object,
  S extends keyof Gebunden<M, Z> & keyof M & string,
>(zugang: Z, modul: M, grund: string, system: Record<S, string>): Gebunden<M, Z> {
  const gebunden = bindeZugang(zugang, modul) as Record<string, (...a: unknown[]) => unknown>;
  const aus: Record<string, unknown> = { ...gebunden };
  for (const name of Object.keys(system)) {
    const f = gebunden[name];
    if (!f) throw new Error(`bindeJeFunktion: ${name} fehlt im Modul`);
    aus[name] = (...a: unknown[]) => imSystemrahmen(zugang, grund, () => f(...a));
  }
  return aus as Gebunden<M, Z>;
}

/** Wie bindeZugang, ganz im Systemrahmen; in einer Transaktion nur, wenn sie selbst darin läuft. */
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
    aus[name] = (...a: unknown[]) => imSystemrahmen(zugang, grund, () => f(...a));
  return aus;
}

/** Was ein Dienst eines Bereichs bekommt: die gebundenen Repositories (`zugang`),
 * die Dienste tieferer Bereiche und die Arbeitseinheit. `transaktion` reicht einen
 * Kontext `t` weiter, dessen Repositories und Dienste an die Transaktion gebunden
 * sind; `k` fragt in ihr nicht mehr (db/transaktion.ts: UngebundeneAbfrage). */
export type Kontext<A extends { db: Db }, Z> = A &
  Z & {
    transaktion<T>(fn: (t: Kontext<A, Z>) => Promise<T>, o?: TxOptionen): Promise<T>;
  };

/** Der Kontext eines Bereichs bleibt drinnen: erzeugeX gibt nur Dienste heraus. Nur die
 * Testhilfen sehen hinein (test/helpers/sources.js), über diesen Rückruf an der Fabrik. */
export type Einblick<K> = (k: K) => void;

export function baueKontext<A extends { db: Db }, Z extends object>(a: A, zugang: (db: Db) => Z): Kontext<A, Z> {
  return {
    ...a,
    ...zugang(a.db),
    transaktion: (fn, o) =>
      a.db.transaction(tx => fn(baueKontext({ ...gebundenAn(a, tx), db: anTransaktion(a.db, tx) }, zugang)), o),
  };
}

/** Jeder Dienstaufruf über `t` (auch t.bestand.lagerortDienst.…) läuft in der Transaktion. */
function gebundenAn<A extends { db: Db }>(a: A, tx: TxGriff): A {
  const aus: Record<string, unknown> = {};
  for (const [name, wert] of Object.entries(a)) aus[name] = name === 'db' ? wert : huelle(wert, tx);
  return aus as A;
}

function huelle(wert: unknown, tx: TxGriff): unknown {
  if (typeof wert === 'function')
    return (...x: unknown[]) => tx.gebunden(() => (wert as (...y: unknown[]) => unknown)(...x));
  if (wert === null || typeof wert !== 'object' || Array.isArray(wert)) return wert;
  return new Proxy(wert, {
    get(ziel, name) {
      const v: unknown = Reflect.get(ziel, name, ziel);
      if (typeof v === 'function')
        return (...x: unknown[]) => tx.gebunden(() => (v as (...y: unknown[]) => unknown).apply(ziel, x));
      const proto: unknown = v !== null && typeof v === 'object' ? Object.getPrototypeOf(v) : undefined;
      return proto === Object.prototype || proto === null ? huelle(v, tx) : v;
    },
  });
}

/** Abfragen über die Verbindung der Transaktion; eine innere wird ein Sicherungspunkt. */
function anTransaktion(db: Db, tx: TxGriff): Db {
  return {
    ...db,
    all: tx.all,
    get: tx.get,
    run: tx.run,
    exec: tx.exec,
    transaction: (fn, o) => tx.gebunden(() => db.transaction(fn, o)),
    benachrichtigung: huelle(db.benachrichtigung, tx) as Db['benachrichtigung'],
    inTransaktion: () => true,
  };
}
