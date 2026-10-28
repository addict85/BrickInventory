/**
 * Kaufpreis-Erfassungen schreiben — für Sets, manuelle Teile und Minifiguren.
 *
 *   Pro Tag, Element, Zustand, Preis und Währung gibt es genau EINE Zeile;
 *   gleiche Käufe eines Tages werden zusammengezählt.
 *
 * Ausführlich: docs/begruendungen/utils/acquisitions.ts.md#abschnitt
 */
import * as db from '../db/database';

export type AcquisitionKind = 'set' | 'part' | 'fig';

/**
 * SQL-Bedingung: Der Kaufpreis der Zeile ist in der heutigen Währung ihres
 * Kontos erfasst. Für Durchschnitte in der Anzeigewährung; ein älterer Preis
 * aus einer anderen Währung wäre dort ein falscher Betrag. Die Währung kommt
 * aus [kontowaehrungJoin] — einmal je Abfrage statt einer Unterabfrage je Zeile.
 */
export function inKontowaehrung(tabelle: string, alias = 'kw'): string {
  return `${tabelle}.currency = COALESCE(${alias}.value, 'EUR')`;
}

/** Die Kontowährung als JOIN-Quelle für [inKontowaehrung]. */
export function kontowaehrungJoin(tabelle: string, alias = 'kw'): string {
  return `LEFT JOIN user_settings ${alias}
            ON ${alias}.user_id = ${tabelle}.user_id AND ${alias}.key = 'currency'`;
}

export interface AcquisitionInput {
  quantity: number;
  /** Kaufpreis pro Stück; null = nicht erfasst. */
  price?: number | null;
  condition?: string | null;
  /** Tag der Erfassung (ISO). Fehlt er, zählt heute. */
  createdAt?: string | null;
  /** Der Preis ist ein eingesetzter Marktpreis, kein bezahlter Betrag. */
  geschaetzt?: boolean;
  /** Währung des Preises; fehlt sie, setzt die Datenbank die des Kontos. */
  currency?: string | null;
}

/**
 * Tabelle, Preisspalte und Schlüsselspalten je Art — die EINE Stelle, an der
 * steht, was ein „Element" jeweils ausmacht.
 */
const SHAPES = {
  set:  { table: 'set_acquisitions',     price: 'purchase_price', keys: ['set_number'] },
  part: { table: 'part_acquisitions',    price: 'unit_price',     keys: ['part_number', 'color_id'] },
  fig:  { table: 'minifig_acquisitions', price: 'unit_price',     keys: ['fig_number'] },
} as const;

const num = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * Erfassung anlegen — oder die des Tages im selben Zustand aufstocken.
 * Ausführlich: docs/begruendungen/utils/acquisitions.ts.md#recordacquisitionforday
 * @param kind      'set' | 'part' | 'fig'
 * @param userId
 * @param keyValues Schlüsselwerte in der Reihenfolge von SHAPES[kind].keys
 * @param input     Menge, Preis, Zustand, Tag
 * @param dbh       Transaktions-Handle, falls der Aufrufer eines hat
 * @returns { merged } — true, wenn eine bestehende Zeile aufgestockt wurde
 */
export async function recordAcquisitionForDay(
  kind: AcquisitionKind,
  userId: number,
  keyValues: any[],
  input: AcquisitionInput,
  dbh: any = db
): Promise<{ merged: boolean }> {
  const shape = SHAPES[kind];
  const qty   = Math.max(1, parseInt(String(input.quantity)) || 1);
  const price = num(input.price);
  const cond  = ['N', 'U'].includes(String(input.condition)) ? String(input.condition) : 'N';
  const geschaetzt = price != null && !!input.geschaetzt;

  // Eine Anweisung statt Lesen-Rechnen-Schreiben: Zwei gleichzeitige
  // Erfassungen (Web und App) addieren sich so, statt einander zu
  // überschreiben. Zusammengelegt wird nur bei gleichem Preis, gleicher
  // Herkunft und Währung — dann geht keine Information verloren.
  const cols = ['user_id', ...shape.keys, 'quantity', shape.price, 'condition', 'price_estimated', 'currency', 'created_at'];
  const vals = [userId, ...keyValues, qty, price, cond, geschaetzt, input.currency ?? null, input.createdAt || null];
  const ph = vals.map((_, i) => `$${i + 1}`);
  ph[ph.length - 1] = `COALESCE(${ph[ph.length - 1]}::timestamptz, NOW())`;
  const ziel = ['user_id', ...shape.keys, "((created_at AT TIME ZONE 'UTC')::date)", 'condition',
    `(COALESCE(${shape.price}, -1))`, 'price_estimated', 'currency'];
  const row = await dbh.get(
    `INSERT INTO ${shape.table} AS t (${cols.join(', ')}) VALUES (${ph.join(', ')})
     ON CONFLICT (${ziel.join(', ')}) DO UPDATE SET quantity = t.quantity + EXCLUDED.quantity
     RETURNING (xmax <> 0) AS merged`,
    vals
  );
  return { merged: !!row?.merged };
}

/**
 * Gibt es für diesen Tag und Zustand schon eine Erfassung — ausser der
 * angegebenen?
 * Ausführlich: docs/begruendungen/utils/acquisitions.ts.md#findsamedayacquisition
 * @param excludeId die Erfassung, die gerade bearbeitet wird
 * @param condition der Zustand, den die Zeile NACH der Bearbeitung hat
 * @returns die kollidierende id, oder null
 */
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
  const shape = SHAPES[kind];
  const keyWhere = shape.keys.map((c, i) => `${c} = $${i + 2}`).join(' AND ');
  const n = shape.keys.length;
  const cond = ['N', 'U'].includes(String(condition)) ? String(condition) : 'N';
  // Dieselben Spalten wie der eindeutige Index (Migration 0047).
  const row = await dbh.get(
    `SELECT id FROM ${shape.table}
      WHERE user_id = $1 AND ${keyWhere}
        AND id <> $${n + 2} AND (created_at AT TIME ZONE 'UTC')::date = $${n + 3}::date
        AND condition = $${n + 4}
        AND COALESCE(${shape.price}, -1) = COALESCE($${n + 5}::numeric, -1)
        AND price_estimated = $${n + 6}
        AND ($${n + 7}::text IS NULL OR currency = $${n + 7})
      LIMIT 1`,
    [userId, ...keyValues, excludeId ?? -1, day, cond, num(merkmale.preis), !!merkmale.geschaetzt, merkmale.waehrung ?? null]
  );
  return row ? parseInt(row.id) : null;
}

/**
 * Summenzeile einer Erfassungsliste: Stückzahl und Gesamtbetrag.
 * Ausführlich: docs/begruendungen/utils/acquisitions.ts.md#acquisitiontotals
 * @param rows Zeilen aus einer der drei Erfassungstabellen
 * @returns {{quantity:number, amount:number|null, priced_rows:number}}
 */
export function acquisitionTotals(rows: any[]): {
  quantity: number; amount: number | null; priced_rows: number;
} {
  let quantity = 0, amount = 0, priced = 0;
  for (const r of rows || []) {
    const menge = Number(r?.quantity) || 0;
    quantity += menge;
    // Ein Preis kann in der einen Tabelle purchase_price und in der anderen
    // unit_price heissen — die Rückfallregel steht hier EINMAL statt in jedem
    // Client.
    const roh = r?.purchase_price ?? r?.unit_price;
    const preis = roh === null || roh === undefined ? null : Number(roh);
    if (preis !== null && Number.isFinite(preis)) {
      amount += preis * menge;
      priced++;
    }
  }
  return {
    quantity,
    // Auf zwei Stellen runden: Der Betrag ist eine Anzeigesumme, und
    // Gleitkomma liefert sonst 33.980000000000004.
    amount: priced ? Math.round(amount * 100) / 100 : null,
    priced_rows: priced,
  };
}

/**
 * Einen fehlenden Kaufpreis durch einen Marktpreis ersetzen — gekennzeichnet
 * als geschätzt. Gibt es am selben Tag schon eine gleiche Zeile, wandert die
 * Menge dorthin, statt am eindeutigen Index zu scheitern.
 * @returns true, wenn etwas geändert wurde
 */
export async function setzeGeschaetztenPreis(kind: AcquisitionKind, id: number, preis: number): Promise<boolean> {
  const shape = SHAPES[kind];
  return db.transaction(async (tx: any) => {
    const z = await tx.get(
      `SELECT *, ((created_at AT TIME ZONE 'UTC')::date)::text AS tag FROM ${shape.table} WHERE id = $1 FOR UPDATE`, [id]);
    if (!z || z[shape.price] != null) return false;
    const keys = shape.keys.map(k => z[k]);
    const ziel = await findSameDayAcquisition(kind, z.user_id, keys, z.tag, id, z.condition, tx,
      { preis, geschaetzt: true, waehrung: z.currency });
    if (ziel) {
      await tx.run(`UPDATE ${shape.table} SET quantity = quantity + $1 WHERE id = $2`, [z.quantity, ziel]);
      await tx.run(`DELETE FROM ${shape.table} WHERE id = $1`, [id]);
    } else {
      await tx.run(`UPDATE ${shape.table} SET ${shape.price} = $1, price_estimated = true WHERE id = $2`, [preis, id]);
    }
    return true;
  });
}
