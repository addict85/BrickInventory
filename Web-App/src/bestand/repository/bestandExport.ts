import * as db from '../../../db/database';
import { erfassungsTagSql } from '../../../db/bestandsmenge';

/** Die Zeilen der CSV-Exporte manueller Teile und Figuren: eine Zeile je Erfassung. */

// Shared logic to build the Teile CSV export content (manuell erfasst only).
// Used by both the standalone CSV download and the combined ZIP export in settings.js.
// Ausführlich: docs/begruendungen/routes/parts.ts.md#parts-csv-sql
const PARTS_CSV_SQL = `
  SELECT p.part_number,
         -- Die Menge der ERFASSUNG, ohne Rueckfall auf die Zeile: Migration
         -- 0038 hat p.quantity geloescht, und dieser Export liefert eine
         -- Zeile JE ERFASSUNG (source='manual' unten). Ohne Erfassung gibt
         -- es keine Zeile und damit keine Menge — 0 statt leer, dieselbe
         -- Lesart wie im Sets-Export (src/sets/setService.ts).
         COALESCE(a.quantity, 0) AS quantity,
         p.color_id,
         COALESCE(pcc.color_name,'') AS color_name,
         a.unit_price,
         COALESCE(a.condition, 'N') AS condition,
         CASE WHEN a.id IS NULL THEN ''
              ELSE TO_CHAR(${erfassungsTagSql('a')}, 'YYYY-MM-DD') END AS acquired_at
    FROM parts p
    LEFT JOIN part_acquisitions a
           ON a.user_id = p.user_id
          AND a.part_number = p.part_number
          AND a.color_id = p.color_id
    -- Name und Farbbezeichnung aus den Katalogen (Migration 0034). LEFT JOIN,
    -- damit ein Teil ohne Katalogzeile nicht aus dem Export faellt.
    LEFT JOIN part_catalog pc ON pc.part_number = p.part_number
    LEFT JOIN part_color_catalog pcc ON pcc.part_number = p.part_number
                                    AND pcc.color_id    = p.color_id
   WHERE p.user_id = $1 AND p.source = 'manual'
   ORDER BY pc.part_name ASC, p.part_number ASC, a.created_at ASC, a.id ASC`;

// Shared logic to build the Minifiguren CSV export content (manuell erfasst only).
// Used by both the standalone CSV download and the combined ZIP export in settings.js.
// Dieselbe Bauart wie SETS_CSV_SQL in src/sets/setService.ts, aus demselben Grund:
// Hier lief eine Abfrage JE MINIFIGUR. Auch die Falle ist dieselbe — zu einer
// vorhandenen Erfassung OHNE Preis gehoert ein leeres Feld, nicht der Preis der
// Figuren-Zeile. Entschieden wird deshalb an `a.id IS NULL`, nicht mit COALESCE
// ueber die Werte.
const FIGS_CSV_SQL = `
  SELECT f.fig_number,
         -- Die BrickLink-Nummer aus der Zuordnung (Migration 0037); hier
         -- stand COALESCE(f.bl_fig_number,''), eine Abschrift je Konto.
         -- Das leere Feld bleibt die Ausgabe fuer „keine abweichende
         -- Nummer" — in der Zuordnung ist das eine leere bl_id.
         COALESCE(z.bl_id,'') AS bl_fig_number,
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
    LEFT JOIN minifig_acquisitions a
           ON a.user_id = f.user_id AND a.fig_number = f.fig_number
    -- Der Figurenname steht seit Migration 0034 im Katalog. LEFT JOIN, damit
    -- eine Figur ohne Katalogzeile nicht aus dem Export faellt.
    LEFT JOIN minifigs_catalog mc ON mc.fig_number = f.fig_number
   WHERE f.user_id = $1 AND f.source = 'manual'
   ORDER BY mc.fig_name ASC, f.fig_number ASC, a.created_at ASC, a.id ASC`;

export function teileFuerCsv(uid: number) {
  return db.all(PARTS_CSV_SQL, [uid]);
}

export function figurenFuerCsv(uid: number) {
  return db.all(FIGS_CSV_SQL, [uid]);
}
