/** Pro Tag, Element, Zustand, Preis und Währung genau EINE Zeile: Gleiche
 * Käufe eines Tages werden zusammengezählt.
 * Ausführlich: docs/begruendungen/src/bestand/acquisitions.ts.md#abschnitt */
import * as db from '../../db/database';
import type { DbSchnittstelle } from '../../db/database';
import { erfassungsTagSql, preisSpalte, schluesselSpalten } from '../../db/bestandsmenge';
import * as repo from './repository/kaufErfassungen';
export { erfassungsTagSql };

export type AcquisitionKind = 'set' | 'part' | 'fig';

export interface AcquisitionInput {
  quantity: number;
  /** null = nicht erfasst. */
  price?: number | null;
  condition?: string | null;
  /** Fehlt er, zählt heute. */
  createdAt?: string | null;
  /** Ein eingesetzter Marktpreis, kein bezahlter Betrag. */
  geschaetzt?: boolean;
  /** Fehlt sie, setzt die Datenbank die des Kontos. */
  currency?: string | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/** @param keyValues Schlüsselwerte in der Reihenfolge von SHAPES[kind].keys
 * @param dbh       Transaktions-Handle, falls der Aufrufer eines hat
 * @returns { merged } — true, wenn eine bestehende Zeile aufgestockt wurde */
export async function recordAcquisitionForDay(
  kind: AcquisitionKind,
  userId: number,
  keyValues: (string | number)[],
  input: AcquisitionInput,
  dbh: DbSchnittstelle = db
): Promise<{ merged: boolean }> {
  const qty   = Math.max(1, parseInt(String(input.quantity)) || 1);
  const price = num(input.price);
  const cond  = ['N', 'U'].includes(String(input.condition)) ? String(input.condition) : 'N';
  const geschaetzt = price != null && !!input.geschaetzt;

  // Eine Anweisung statt Lesen-Rechnen-Schreiben: Gleichzeitige Erfassungen
  // addieren sich. Zusammengelegt nur bei gleichem Preis, Herkunft und Währung.
  const merged = await repo.fuegeErfassungHinzu(dbh, kind, userId, keyValues,
    { menge: qty, preis: price, zustand: cond, geschaetzt, waehrung: input.currency ?? null, am: input.createdAt || null });
  return { merged };
}

/** Damit eine Bearbeitung nicht am eindeutigen Tagesindex scheitert.
 * @param condition der Zustand, den die Zeile NACH der Bearbeitung hat
 * @returns die kollidierende id, oder null */
export async function findSameDayAcquisition(
  kind: AcquisitionKind,
  userId: number,
  keyValues: any[],
  day: string,
  excludeId: number | null,
  condition: string | null = null,
  dbh: any = db,
  merkmale: { preis?: unknown; geschaetzt?: boolean; waehrung?: string | null } = {}
): Promise<number | null> {
  const cond = ['N', 'U'].includes(String(condition)) ? String(condition) : 'N';
  return repo.gleicheErfassungAmTag(dbh, kind, userId, keyValues, day, excludeId ?? -1,
    { zustand: cond, preis: num(merkmale.preis), geschaetzt: !!merkmale.geschaetzt, waehrung: merkmale.waehrung ?? null });
}

/** @returns {{quantity:number, amount:number|null, priced_rows:number}} */
export function acquisitionTotals(rows: any[]): {
  quantity: number; amount: number | null; priced_rows: number;
} {
  let quantity = 0, amount = 0, priced = 0;
  for (const r of rows || []) {
    const menge = Number(r?.quantity) || 0;
    quantity += menge;
    // purchase_price oder unit_price je Tabelle — die Rückfallregel EINMAL statt
    // in jedem Client.
    const roh = r?.purchase_price ?? r?.unit_price;
    const preis = roh === null || roh === undefined ? null : Number(roh);
    if (preis !== null && Number.isFinite(preis)) {
      amount += preis * menge;
      priced++;
    }
  }
  return {
    quantity,
    // Gleitkomma liefert sonst 33.980000000000004.
    amount: priced ? Math.round(amount * 100) / 100 : null,
    priced_rows: priced,
  };
}

/** Gibt es am selben Tag schon eine gleiche Zeile, wandert die Menge dorthin,
 * statt am eindeutigen Index zu scheitern.
 * @returns true, wenn etwas geändert wurde */
export async function setzeGeschaetztenPreis(kind: AcquisitionKind, id: number, preis: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const z = await repo.erfassungSperren(tx, kind, id);
    if (!z || z[preisSpalte(kind)] != null) return false;
    const keys = schluesselSpalten(kind).map(k => z[k]);
    const ziel = await findSameDayAcquisition(kind, z.user_id, keys, z.tag, id, z.condition, tx,
      { preis, geschaetzt: true, waehrung: z.currency });
    if (ziel) await repo.legeErfassungZusammen(tx, kind, id, ziel, z.quantity);
    else await repo.setzePreisGeschaetzt(tx, kind, id, preis);
    return true;
  });
}

export { setErfassungenOhnePreis, teilErfassungenOhnePreis, figurErfassungenOhnePreis } from './repository/nachtrag';
