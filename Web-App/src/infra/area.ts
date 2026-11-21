import type { TxOptions, Zugang } from './access';
import { inSystemContext, rowsContext } from './accountContext';

/** Binds the access (database or context) to a function; the compiler checks that
 * it takes it as the first parameter. `mit(k)(f)` keeps the type parameters of a generic f. */
export function mit<Z>(zugang: Z): <A extends unknown[], R>(f: (z: Z, ...a: A) => R) => (...a: A) => R;
export function mit<Z, A extends unknown[], R>(zugang: Z, f: (z: Z, ...a: A) => R): (...a: A) => R;
export function mit<Z>(zugang: Z, f?: (z: Z, ...a: unknown[]) => unknown): unknown {
  const an =
    <A extends unknown[], R>(g: (z: Z, ...a: A) => R) =>
    (...a: A) =>
      g(zugang, ...a);
  return f ? an(f) : an;
}

/** Like mit(), plus the read contract as second parameter: what an area reads from tables of higher
 * ones is handed to it (docs/architektur.md), its repository takes it after the access. */
export function withContract<Z, L>(zugang: Z, l: L) {
  return <A extends unknown[], R>(f: (z: Z, l: L, ...a: A) => R) =>
    (...a: A) =>
      f(zugang, l, ...a);
}

/** Within a transaction the connection already belongs to a role: silently without a system frame the
 * call would run under row security where it expects all accounts. Enter the frame beforehand. */
export class SystemrahmenInTransaction extends Error {
  constructor(grund: string) {
    super(`Systemrahmen „${grund}“ in einer Transaktion ohne Systemrahmen: vor der Transaktion betreten.`);
  }
}

export function imSystemrahmen<R>(zugang: { inTransaction(): boolean }, grund: string, f: () => R): R {
  if (!zugang.inTransaction()) return inSystemContext(grund, f);
  if (rowsContext().system) return f();
  throw new SystemrahmenInTransaction(grund);
}

/** Like mit(), but in the system frame: the reason stands at the call, findable via `imSystem(`. */
export function imSystem<Z extends { inTransaction(): boolean }, A extends unknown[], R>(
  zugang: Z,
  grund: string,
  f: (z: Z, ...a: A) => R,
): (...a: A) => R {
  return (...a) => imSystemrahmen(zugang, grund, () => f(zugang, ...a));
}

/** Bound repositories, services of lower areas and the unit of work. `transaktion` passes
 * `t`, built entirely on top of the transaction's connection: everything in it asks via that, without detour. */
export type Kontext<A extends { db: object }, Z> = A &
  Z & {
    transaktion<T>(fn: (t: Kontext<A, Z>) => Promise<T>, o?: TxOptions): Promise<T>;
  };

/** An area's context stays inside: erzeugeX only hands out services. Only the
 * test helpers look inside (test/helpers/sources.js), via this callback on the factory. */
export type Inspect<K> = (k: K) => void;

/** A set of services that rebuilds itself on top of a transaction; state (compartments, throttles) stays shared. */
export type Bereich<D, Z = unknown> = D & { ueber(db: Z): Bereich<D, Z> };

function isRebuildBar(w: unknown): w is { ueber(db: unknown): unknown } {
  return typeof w === 'object' && w !== null && typeof (w as { ueber?: unknown }).ueber === 'function';
}

/** The dependencies via `db`: the access and every rebuildable set of services; everything else stays. */
function rebuild<Z, A extends { db: Z }>(a: A, db: Z): A {
  const aus: Record<string, unknown> = {};
  for (const [name, wert] of Object.entries(a)) aus[name] = isRebuildBar(wert) ? wert.ueber(db) : wert;
  aus.db = db;
  return aus as A;
}

/** `t` is created once per connection: the outermost level's access is the same per connection
 * (db/database.ts, connectionAccess), only savepoints bring a new one. */
export function buildContext<D extends Zugang<D> & object, A extends { db: D }, Z extends object>(
  a: A,
  zugang: (db: D) => Z,
): Kontext<A, Z> {
  const jeDb = new WeakMap<D, Kontext<A, Z>>();
  const ueber = (db: D): Kontext<A, Z> => {
    const da = jeDb.get(db);
    if (da) return da;
    const t = buildContext(rebuild(a, db), zugang);
    jeDb.set(db, t);
    return t;
  };
  return {
    ...a,
    ...zugang(a.db),
    transaktion: (fn, o) => a.db.transaction(tx => fn(ueber(tx.db)), o),
  };
}

/** An area's factory: `dienste` closes over the context `k`. Per connection
 * the set is created once; `ueber(tx.db)` builds it for a transaction. */
export function buildArea<B extends Zugang<B> & object, A extends { db: B }, Z extends object, D extends object>(
  a: A,
  zugang: (db: B) => Z,
  dienste: (k: Kontext<A, Z>) => D,
  inspect?: Inspect<Kontext<A, Z>>,
): Bereich<D, B> {
  const jeDb = new WeakMap<B, Bereich<D, B>>();
  const bau = (abh: A, zeige?: Inspect<Kontext<A, Z>>): Bereich<D, B> => {
    const k = buildContext(abh, zugang);
    zeige?.(k);
    const d: Bereich<D, B> = Object.assign(dienste(k), {
      ueber: (db: B): Bereich<D, B> => {
        if (db === abh.db) return d;
        const da = jeDb.get(db);
        if (da) return da;
        const neu = bau(rebuild(abh, db));
        jeDb.set(db, neu);
        return neu;
      },
    });
    return d;
  };
  return bau(a, inspect);
}
