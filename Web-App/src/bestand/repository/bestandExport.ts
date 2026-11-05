import * as db from '../../../db/database';
import { erfassungsTagSql } from '../../../db/bestandsmenge';
import { teilSichtJoin, figurSichtJoin, TEIL, FIGUR } from '../../../db/katalogSicht';

// Eine Zeile je Erfassung in einer Abfrage statt einer je Teil.
// Ausführlich: docs/begruendungen/src/teile/manuelleTeile.ts.md#parts-csv-sql
const PARTS_CSV_SQL = `
  SELECT p.part_number,
         -- Die Menge der ERFASSUNG, ohne Rueckfall auf die Zeile: Migration
         -- 0038 hat p.quantity geloescht, und dieser Export liefert eine
         -- Zeile JE ERFASSUNG (source='manual' unten). Ohne Erfassung gibt
         -- es keine Zeile und damit keine Menge — 0 statt leer, dieselbe
         -- Lesart wie im Sets-Export (src/sets/setService.ts).
         COALESCE(a.quantity, 0) AS quantity,
         p.color_id,
         COALESCE(${TEIL.farbname},'') AS color_name,
         a.unit_price,
         COALESCE(a.condition, 'N') AS condition,
         CASE WHEN a.id IS NULL THEN ''
              ELSE TO_CHAR(${erfassungsTagSql('a')}, 'YYYY-MM-DD') END AS acquired_at
    FROM parts p
    LEFT JOIN part_acquisitions a
           ON a.user_id = p.user_id
          AND a.part_number = p.part_number
          AND a.color_id = p.color_id
    ${teilSichtJoin('p.user_id', 'p.part_number', 'p.color_id')}
   WHERE p.user_id = $1 AND p.source = 'manual'
   ORDER BY ${TEIL.name} ASC, p.part_number ASC, a.created_at ASC, a.id ASC`;

// Zu einer Erfassung OHNE Preis gehört ein leeres Feld, nicht der Preis der
// Figuren-Zeile — deshalb `a.id IS NULL` statt COALESCE über die Werte.
const FIGS_CSV_SQL = `
  SELECT f.fig_number,
         -- Die BrickLink-Nummer aus der Zuordnung (Migration 0037); hier
         -- stand COALESCE(f.bl_fig_number,''), eine Abschrift je Konto.
         -- Das leere Feld bleibt die Ausgabe fuer „keine abweichende
         -- Nummer" — in der Zuordnung ist das eine leere bl_id.
         COALESCE(CASE WHEN ze.rb_id IS NULL THEN z.bl_id ELSE NULLIF(ze.bl_id, f.fig_number) END, '') AS bl_fig_number,
         -- Der Rueckfall auf die Stammzeile ist weg: Migration 0035 hat
         -- f.unit_price und f.condition geloescht und traegt fuer jede
         -- manuelle Figur eine Erfassung nach. Dieselbe Aenderung wie bei
         -- PARTS_CSV_SQL in routes/parts.ts, wo sie ausgeschrieben steht.
         -- Ohne Rueckfall auf f.quantity: Migration 0038 hat die Spalte
         -- geloescht. Siehe PARTS_CSV_SQL in routes/parts.ts.
         COALESCE(a.quantity, 0) AS quantity,
         a.unit_price,
         COALESCE(a.condition, 'N') AS condition,
         CASE WHEN a.id IS NULL THEN ''
              ELSE TO_CHAR(${erfassungsTagSql('a')}, 'YYYY-MM-DD') END AS acquired_at
    FROM minifigs f
    LEFT JOIN bl_zuordnung z ON z.art = 'fig' AND z.rb_id = f.fig_number
    LEFT JOIN bl_zuordnung_eigen ze ON ze.user_id = f.user_id AND ze.art = 'fig' AND ze.rb_id = f.fig_number
    LEFT JOIN minifig_acquisitions a
           ON a.user_id = f.user_id AND a.fig_number = f.fig_number
    ${figurSichtJoin('f.user_id', 'f.fig_number')}
   WHERE f.user_id = $1 AND f.source = 'manual'
   ORDER BY ${FIGUR.name} ASC, f.fig_number ASC, a.created_at ASC, a.id ASC`;

export function teileFuerCsv(uid: number) {
  return db.all(PARTS_CSV_SQL, [uid]);
}

export function figurenFuerCsv(uid: number) {
  return db.all(FIGS_CSV_SQL, [uid]);
}
