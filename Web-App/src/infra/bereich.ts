import type { Db, TxOptionen } from '../../db/database';
import { imSystemkontext, zeilenKontext } from './kontoKontext';

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

/** Wie mit(), aber im Systemrahmen: Der Grund steht am Aufruf, auffindbar per `imSystem(`. */
export function imSystem<Z extends { inTransaktion(): boolean }, A extends unknown[], R>(
  zugang: Z,
  grund: string,
  f: (z: Z, ...a: A) => R,
): (...a: A) => R {
  return (...a) => imSystemrahmen(zugang, grund, () => f(zugang, ...a));
}

/** Gebundene Repositories, Dienste tieferer Bereiche und die Arbeitseinheit. `transaktion` reicht
 * `t`, ganz über der Verbindung der Transaktion gebaut: Alles darin fragt über sie, ohne Umweg. */
export type Kontext<A extends { db: Db }, Z> = A &
  Z & {
    transaktion<T>(fn: (t: Kontext<A, Z>) => Promise<T>, o?: TxOptionen): Promise<T>;
  };

/** Der Kontext eines Bereichs bleibt drinnen: erzeugeX gibt nur Dienste heraus. Nur die
 * Testhilfen sehen hinein (test/helpers/sources.js), über diesen Rückruf an der Fabrik. */
export type Einblick<K> = (k: K) => void;

/** Ein Satz Dienste, der sich über einer Transaktion neu baut; Zustand (Fächer, Drosseln) bleibt geteilt. */
export type Bereich<D> = D & { ueber(db: Db): Bereich<D> };

function istUmbaubar(w: unknown): w is { ueber(db: Db): unknown } {
  return typeof w === 'object' && w !== null && typeof (w as { ueber?: unknown }).ueber === 'function';
}

/** Die Abhängigkeiten über `db`: der Zugang und jeder umbaubare Satz Dienste; alles andere bleibt. */
function umbau<A extends { db: Db }>(a: A, db: Db): A {
  const aus: Record<string, unknown> = {};
  for (const [name, wert] of Object.entries(a)) aus[name] = istUmbaubar(wert) ? wert.ueber(db) : wert;
  aus.db = db;
  return aus as A;
}

export function baueKontext<A extends { db: Db }, Z extends object>(a: A, zugang: (db: Db) => Z): Kontext<A, Z> {
  return {
    ...a,
    ...zugang(a.db),
    transaktion: (fn, o) => a.db.transaction(tx => fn(baueKontext(umbau(a, tx.db), zugang)), o),
  };
}

/** Die Fabrik eines Bereichs: `dienste` schliesst über den Kontext `k`. Je Verbindung
 * entsteht der Satz einmal; `ueber(tx.db)` baut ihn für eine Transaktion. */
export function baueBereich<A extends { db: Db }, Z extends object, D extends object>(
  a: A,
  zugang: (db: Db) => Z,
  dienste: (k: Kontext<A, Z>) => D,
  einblick?: Einblick<Kontext<A, Z>>,
): Bereich<D> {
  const jeDb = new WeakMap<Db, Bereich<D>>();
  const bau = (abh: A, zeige?: Einblick<Kontext<A, Z>>): Bereich<D> => {
    const k = baueKontext(abh, zugang);
    zeige?.(k);
    const d: Bereich<D> = Object.assign(dienste(k), {
      ueber: (db: Db): Bereich<D> => {
        if (db === abh.db) return d;
        const da = jeDb.get(db);
        if (da) return da;
        const neu = bau(umbau(abh, db));
        jeDb.set(db, neu);
        return neu;
      },
    });
    return d;
  };
  return bau(a, einblick);
}
