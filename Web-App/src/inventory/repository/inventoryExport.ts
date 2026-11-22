import type { DbInterface } from '../../../db/database';
import { acquisitionDaySql } from '../../../db/stockQuantity';
import type { InventoryReadContract } from '../readContract';
import { partViewJoin, minifigViewJoin, PART, MINIFIG } from '../../../db/catalogView';

// One row per acquisition in one query instead of one per part.
const partsCsvSql = (l: InventoryReadContract) => `
  SELECT p.part_number,
         -- Die Menge der ERFASSUNG, ohne Rueckfall auf die Zeile: Migration
         -- 0038 hat p.quantity geloescht, und dieser Export liefert eine
         -- Zeile JE ERFASSUNG (source='manual' unten). Ohne Erfassung gibt
         -- es keine Zeile und damit keine Menge — 0 statt leer, dieselbe
         -- Lesart wie im Sets-Export (src/sets/service.ts).
         COALESCE(a.quantity, 0) AS quantity,
         p.color_id,
         COALESCE(${PART.colorName},'') AS color_name,
         a.unit_price,
         COALESCE(a.condition, 'N') AS condition,
         CASE WHEN a.id IS NULL THEN ''
              ELSE TO_CHAR(${acquisitionDaySql('a')}, 'YYYY-MM-DD') END AS acquired_at
    FROM parts p
    LEFT JOIN ${l.partAcquisitions('= $1')} a
           ON a.user_id = p.user_id
          AND a.part_number = p.part_number
          AND a.color_id = p.color_id
    ${partViewJoin('p.user_id', 'p.part_number', 'p.color_id')}
   WHERE p.user_id = $1 AND p.source = 'manual'
   ORDER BY ${PART.name} ASC, p.part_number ASC, a.created_at ASC, a.id ASC`;

// An acquisition WITHOUT a price gets an empty field, not the price of the
// figure row — hence `a.id IS NULL` instead of COALESCE over the values.
const figsCsvSql = (l: InventoryReadContract) => `
  SELECT f.fig_number,
         -- Die BrickLink-Nummer aus der Zuordnung (Migration 0037); hier
         -- stand COALESCE(f.bl_fig_number,''), eine Abschrift je Konto.
         -- Das leere Feld bleibt die Ausgabe fuer „keine abweichende
         -- Nummer" — in der Zuordnung ist das eine leere bl_id.
         COALESCE(CASE WHEN ze.rb_id IS NULL THEN z.bl_id ELSE NULLIF(ze.bl_id, f.fig_number) END, '') AS bl_fig_number,
         -- Der Rueckfall auf die Stammzeile ist weg: Migration 0035 hat
         -- f.unit_price und f.condition geloescht und traegt fuer jede
         -- manuelle Figur eine Erfassung nach. Dieselbe Aenderung wie bei
         -- partsCsvSql in routes/parts.ts, wo sie ausgeschrieben steht.
         -- Ohne Rueckfall auf f.quantity: Migration 0038 hat die Spalte
         -- geloescht. Siehe partsCsvSql in routes/parts.ts.
         COALESCE(a.quantity, 0) AS quantity,
         a.unit_price,
         COALESCE(a.condition, 'N') AS condition,
         CASE WHEN a.id IS NULL THEN ''
              ELSE TO_CHAR(${acquisitionDaySql('a')}, 'YYYY-MM-DD') END AS acquired_at
    FROM minifigs f
    LEFT JOIN bl_mapping z ON z.type = 'fig' AND z.rb_id = f.fig_number
    LEFT JOIN bl_mapping_custom ze ON ze.user_id = f.user_id AND ze.type = 'fig' AND ze.rb_id = f.fig_number
    LEFT JOIN ${l.figAcquisitions('= $1')} a
           ON a.user_id = f.user_id AND a.fig_number = f.fig_number
    ${minifigViewJoin('f.user_id', 'f.fig_number')}
   WHERE f.user_id = $1 AND f.source = 'manual'
   ORDER BY ${MINIFIG.name} ASC, f.fig_number ASC, a.created_at ASC, a.id ASC`;

export function partsForCsv(db: DbInterface, l: InventoryReadContract, uid: number) {
  return db.all<Record<string, unknown> & { unit_price: number | null }>(partsCsvSql(l), [uid]);
}

export function minifigsForCsv(db: DbInterface, l: InventoryReadContract, uid: number) {
  return db.all<Record<string, unknown> & { unit_price: number | null }>(figsCsvSql(l), [uid]);
}
