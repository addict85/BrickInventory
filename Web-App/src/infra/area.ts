import type { TxOptions, Access } from './access';
import { inSystemContext, rowsContext } from './accountContext';

/** Binds the access (database or context) to a function; the compiler checks that
 * it takes it as the first parameter. `mit(k)(f)` keeps the type parameters of a generic f. */
export function bound<Z>(access: Z): <A extends unknown[], R>(f: (z: Z, ...a: A) => R) => (...a: A) => R;
export function bound<Z, A extends unknown[], R>(access: Z, f: (z: Z, ...a: A) => R): (...a: A) => R;
export function bound<Z>(access: Z, f?: (z: Z, ...a: unknown[]) => unknown): unknown {
  const an =
    <A extends unknown[], R>(g: (z: Z, ...a: A) => R) =>
    (...a: A) =>
      g(access, ...a);
  return f ? an(f) : an;
}

/** Like mit(), plus the read contract as second parameter: what an area reads from tables of higher
 * ones is handed to it (docs/architecture.md), its repository takes it after the access. */
export function withContract<Z, L>(access: Z, l: L) {
  return <A extends unknown[], R>(f: (z: Z, l: L, ...a: A) => R) =>
    (...a: A) =>
      f(access, l, ...a);
}

/** Within a transaction the connection already belongs to a role: silently without a system frame the
 * call would run under row security where it expects all accounts. Enter the frame beforehand. */
export class SystemFrameInTransaction extends Error {
  constructor(grund: string) {
    super(`Systemrahmen „${grund}“ in einer Transaktion ohne Systemrahmen: vor der Transaktion betreten.`);
  }
}

export function inSystemFrame<R>(access: { inTransaction(): boolean }, grund: string, f: () => R): R {
  if (!access.inTransaction()) return inSystemContext(grund, f);
  if (rowsContext().system) return f();
  throw new SystemFrameInTransaction(grund);
}

/** Like mit(), but in the system frame: the reason stands at the call, findable via `imSystem(`. */
export function imSystem<Z extends { inTransaction(): boolean }, A extends unknown[], R>(
  access: Z,
  grund: string,
  f: (z: Z, ...a: A) => R,
): (...a: A) => R {
  return (...a) => inSystemFrame(access, grund, () => f(access, ...a));
}

/** Bound repositories, services of lower areas and the unit of work. `transaktion` passes
 * `t`, built entirely on top of the transaction's connection: everything in it asks via that, without detour. */
export type Context<A extends { db: object }, Z> = A &
  Z & {
    transact<T>(fn: (t: Context<A, Z>) => Promise<T>, o?: TxOptions): Promise<T>;
  };

/** An area's context stays inside: erzeugeX only hands out services. Only the
 * test helpers look inside (test/helpers/sources.js), via this callback on the factory. */
export type Inspect<K> = (k: K) => void;

/** A set of services that rebuilds itself on top of a transaction; state (compartments, throttles) stays shared. */
export type Area<D, Z = unknown> = D & { over(db: Z): Area<D, Z> };

function isRebuildBar(w: unknown): w is { over(db: unknown): unknown } {
  return typeof w === 'object' && w !== null && typeof (w as { over?: unknown }).over === 'function';
}

/** The dependencies via `db`: the access and every rebuildable set of services; everything else stays. */
function rebuild<Z, A extends { db: Z }>(a: A, db: Z): A {
  const from: Record<string, unknown> = {};
  for (const [name, wert] of Object.entries(a)) from[name] = isRebuildBar(wert) ? wert.over(db) : wert;
  from.db = db;
  return from as A;
}

/** `t` is created once per connection: the outermost level's access is the same per connection
 * (db/database.ts, connectionAccess), only savepoints bring a new one. */
export function buildContext<D extends Access<D> & object, A extends { db: D }, Z extends object>(
  a: A,
  access: (db: D) => Z,
): Context<A, Z> {
  const jeDb = new WeakMap<D, Context<A, Z>>();
  const over = (db: D): Context<A, Z> => {
    const da = jeDb.get(db);
    if (da) return da;
    const t = buildContext(rebuild(a, db), access);
    jeDb.set(db, t);
    return t;
  };
  return {
    ...a,
    ...access(a.db),
    transact: (fn, o) => a.db.transaction(tx => fn(over(tx.db)), o),
  };
}

/** An area's factory: `dienste` closes over the context `k`. Per connection
 * the set is created once; `ueber(tx.db)` builds it for a transaction. */
export function buildArea<B extends Access<B> & object, A extends { db: B }, Z extends object, D extends object>(
  a: A,
  access: (db: B) => Z,
  services: (k: Context<A, Z>) => D,
  inspect?: Inspect<Context<A, Z>>,
): Area<D, B> {
  const jeDb = new WeakMap<B, Area<D, B>>();
  const build = (abh: A, show?: Inspect<Context<A, Z>>): Area<D, B> => {
    const k = buildContext(abh, access);
    show?.(k);
    const d: Area<D, B> = Object.assign(services(k), {
      over: (db: B): Area<D, B> => {
        if (db === abh.db) return d;
        const da = jeDb.get(db);
        if (da) return da;
        const fresh = build(rebuild(abh, db));
        jeDb.set(db, fresh);
        return fresh;
      },
    });
    return d;
  };
  return build(a, inspect);
}
