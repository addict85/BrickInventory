/**
 * Kaufpreis-Erfassungen schreiben — für Sets, manuelle Teile und Minifiguren.
 *
 *   Pro Tag, Element und Benutzer gibt es genau EINEN Kaufpreis.
 *
 * Ausführlich: docs/begruendungen/utils/acquisitions.ts.md#abschnitt
 */
import * as db from '../db/database';

export type AcquisitionKind = 'set' | 'part' | 'fig';

export interface AcquisitionInput {
  quantity: number;
  /** Kaufpreis pro Stück; null = nicht erfasst. */
  price?: number | null;
  condition?: string | null;
  /** Tag der Erfassung (ISO). Fehlt er, zählt heute. */
  createdAt?: string | null;
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
  const day   = input.createdAt || null;

  const keyWhere = shape.keys.map((c, i) => `${c} = $${i + 2}`).join(' AND ');

  // Bestehende Zeile dieses Tages IM SELBEN ZUSTAND.
  // Ausführlich: docs/begruendungen/utils/acquisitions.ts.md#recordacquisitionforday-existing
  const existing = await dbh.get(
    `SELECT id, quantity, condition, ${shape.price} AS price
       FROM ${shape.table}
      WHERE user_id = $1 AND ${keyWhere}
        AND (created_at AT TIME ZONE 'UTC')::date
            = COALESCE($${shape.keys.length + 2}::date, (NOW() AT TIME ZONE 'UTC')::date)
        AND COALESCE(condition, 'N') = $${shape.keys.length + 3}
      ORDER BY id ASC LIMIT 1`,
    [userId, ...keyValues, day, cond]
  ).catch(() => null);

  if (existing) {
    const oldQty   = Math.max(0, parseInt(String(existing.quantity)) || 0);
    const oldPrice = num(existing.price);
    const newQty   = oldQty + qty;
    // Mengengewichtet — siehe Modulkommentar. Auf vier Stellen gerundet, damit
    // die NUMERIC-Spalte keine Fliesskomma-Reste sammelt.
    const mergedPrice = (oldPrice != null && price != null)
      ? Math.round(((oldPrice * oldQty + price * qty) / (newQty || 1)) * 10000) / 10000
      : (price ?? oldPrice);
    // Der Zustand bleibt, wie er ist: Gefunden wurde die Zeile GENAU über ihn
    // (siehe oben). Hier stand `gebraucht gewinnt`, und das war die Stelle, an
    // der ein neuer Kauf einen gebrauchten aus demselben Tag mitnahm —
    // zusammen mit einem Mischpreis aus zwei verschiedenen Käufen. Er wird
    // trotzdem mitgeschrieben, damit eine Altzeile ohne Zustand den Vorgabewert
    // bekommt, unter dem sie gefunden wurde.
    await dbh.run(
      `UPDATE ${shape.table} SET quantity = $1, ${shape.price} = $2, condition = $3 WHERE id = $4`,
      [newQty, mergedPrice, cond, existing.id]
    );
    return { merged: true };
  }

  const cols = ['user_id', ...shape.keys, 'quantity', shape.price, 'condition', 'created_at'];
  const vals = [userId, ...keyValues, qty, price, cond];
  const ph   = vals.map((_, i) => `$${i + 1}`);
  await dbh.run(
    `INSERT INTO ${shape.table} (${cols.join(', ')})
     VALUES (${ph.join(', ')}, COALESCE($${vals.length + 1}::timestamptz, NOW()))
     ON CONFLICT DO NOTHING`,
    [...vals, day]
  );
  return { merged: false };
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
  dbh: any = db
): Promise<number | null> {
  const shape = SHAPES[kind];
  const keyWhere = shape.keys.map((c, i) => `${c} = $${i + 2}`).join(' AND ');
  const n = shape.keys.length;
  const cond = ['N', 'U'].includes(String(condition)) ? String(condition) : 'N';
  const row = await dbh.get(
    `SELECT id FROM ${shape.table}
      WHERE user_id = $1 AND ${keyWhere}
        AND id <> $${n + 2} AND (created_at AT TIME ZONE 'UTC')::date = $${n + 3}::date
        AND COALESCE(condition, 'N') = $${n + 4}
      LIMIT 1`,
    [userId, ...keyValues, excludeId ?? -1, day, cond]
  ).catch(() => null);
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
