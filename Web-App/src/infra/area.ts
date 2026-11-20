import type { TxOptions, Zugang } from './access';
import { inSystemContext, rowsContext } from './accountContext';

/** Bindet den Zugang (Datenbank oder Kontext) an eine Funktion; der Übersetzer prüft, dass
 * sie ihn als ersten Parameter nimmt. `mit(k)(f)` behält die Typparameter einer generischen f. */
export function mit<Z>(zugang: Z): <A extends unknown[], R>(f: (z: Z, ...a: A) => R) => (...a: A) => R;
export function mit<Z, A extends unknown[], R>(zugang: Z, f: (z: Z, ...a: A) => R): (...a: A) => R;
export function mit<Z>(zugang: Z, f?: (z: Z, ...a: unknown[]) => unknown): unknown {
  const an =
    <A extends unknown[], R>(g: (z: Z, ...a: A) => R) =>
    (...a: A) =>
      g(zugang, ...a);
  return f ? an(f) : an;
}

/** Wie mit(), dazu der Lesevertrag als zweiter Parameter: Was ein Bereich aus Tabellen höherer
 * liest, bekommt er gereicht (docs/architektur.md), sein Repository nimmt es nach dem Zugang. */
export function withContract<Z, L>(zugang: Z, l: L) {
  return <A extends unknown[], R>(f: (z: Z, l: L, ...a: A) => R) =>
    (...a: A) =>
      f(zugang, l, ...a);
}

/** In einer Transaktion gehört die Verbindung schon einer Rolle: Still ohne Systemrahmen liefe
 * der Aufruf unter Zeilenschutz, wo er alle Konten erwartet. Den Rahmen vorher betreten. */
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

/** Wie mit(), aber im Systemrahmen: Der Grund steht am Aufruf, auffindbar per `imSystem(`. */
export function imSystem<Z extends { inTransaction(): boolean }, A extends unknown[], R>(
  zugang: Z,
  grund: string,
  f: (z: Z, ...a: A) => R,
): (...a: A) => R {
  return (...a) => imSystemrahmen(zugang, grund, () => f(zugang, ...a));
}

/** Gebundene Repositories, Dienste tieferer Bereiche und die Arbeitseinheit. `transaktion` reicht
 * `t`, ganz über der Verbindung der Transaktion gebaut: Alles darin fragt über sie, ohne Umweg. */
export type Kontext<A extends { db: object }, Z> = A &
  Z & {
    transaktion<T>(fn: (t: Kontext<A, Z>) => Promise<T>, o?: TxOptions): Promise<T>;
  };

/** Der Kontext eines Bereichs bleibt drinnen: erzeugeX gibt nur Dienste heraus. Nur die
 * Testhilfen sehen hinein (test/helpers/sources.js), über diesen Rückruf an der Fabrik. */
export type Inspect<K> = (k: K) => void;

/** Ein Satz Dienste, der sich über einer Transaktion neu baut; Zustand (Fächer, Drosseln) bleibt geteilt. */
export type Bereich<D, Z = unknown> = D & { ueber(db: Z): Bereich<D, Z> };

function isRebuildBar(w: unknown): w is { ueber(db: unknown): unknown } {
  return typeof w === 'object' && w !== null && typeof (w as { ueber?: unknown }).ueber === 'function';
}

/** Die Abhängigkeiten über `db`: der Zugang und jeder umbaubare Satz Dienste; alles andere bleibt. */
function rebuild<Z, A extends { db: Z }>(a: A, db: Z): A {
  const aus: Record<string, unknown> = {};
  for (const [name, wert] of Object.entries(a)) aus[name] = isRebuildBar(wert) ? wert.ueber(db) : wert;
  aus.db = db;
  return aus as A;
}

/** `t` entsteht je Verbindung einmal: Der Zugang der äussersten Ebene ist je Verbindung derselbe
 * (db/database.ts, connectionAccess), nur Sicherungspunkte bringen einen neuen. */
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

/** Die Fabrik eines Bereichs: `dienste` schliesst über den Kontext `k`. Je Verbindung
 * entsteht der Satz einmal; `ueber(tx.db)` baut ihn für eine Transaktion. */
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
