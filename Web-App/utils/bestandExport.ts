/**
 * CSV-Export der manuell erfassten Teile und Figuren. Die Einstellungen
 * (ZIP-Export) und die Routen brauchen dieselben Funktionen; hier liegen sie,
 * damit keine Route eine andere importiert.
 */
import * as db from '../db/database';
import { toCsv } from './csvExport';

// Shared logic to build the Teile CSV export content (manuell erfasst only).
// Used by both the standalone CSV download and the combined ZIP export in settings.js.
// Ausführlich: docs/begruendungen/routes/parts.ts.md#parts-csv-sql
const PARTS_CSV_SQL = `
  SELECT p.part_number,
         -- Die Menge der ERFASSUNG, ohne Rueckfall auf die Zeile: Migration
         -- 0038 hat p.quantity geloescht, und dieser Export liefert eine
         -- Zeile JE ERFASSUNG (source='manual' unten). Ohne Erfassung gibt
         -- es keine Zeile und damit keine Menge — 0 statt leer, dieselbe
         -- Lesart wie im Sets-Export (utils/setService.ts).
         COALESCE(a.quantity, 0) AS quantity,
         COALESCE(p.color_id, 0) AS color_id,
         COALESCE(pcc.color_name,'') AS color_name,
         a.unit_price,
         COALESCE(a.condition, 'N') AS condition,
         CASE WHEN a.id IS NULL THEN ''
              ELSE TO_CHAR(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') END AS acquired_at
    FROM parts p
    LEFT JOIN part_acquisitions a
           ON a.user_id = p.user_id
          AND a.part_number = p.part_number
          AND COALESCE(a.color_id, 0) = COALESCE(p.color_id, 0)
    -- Name und Farbbezeichnung aus den Katalogen (Migration 0034). LEFT JOIN,
    -- damit ein Teil ohne Katalogzeile nicht aus dem Export faellt.
    LEFT JOIN part_catalog pc ON pc.part_number = p.part_number
    LEFT JOIN part_color_catalog pcc ON pcc.part_number = p.part_number
                                    AND pcc.color_id    = p.color_id
   WHERE p.user_id = $1 AND p.source = 'manual'
   ORDER BY pc.part_name ASC, p.part_number ASC, a.created_at ASC, a.id ASC`;

async function buildPartsCsv(uid: number) {
  // Ohne zweite Abfrage als Rueckfall — siehe die Begruendung bei
  // PARTS_CSV_SQL. Scheitert sie, soll der Fehler sichtbar werden, statt eine
  // Abfrage zu versuchen, die auf geloeschte Spalten zeigt.
  const rows = (await db.all(PARTS_CSV_SQL, [uid]))
    .map((r: any) => ({ ...r, unit_price: r.unit_price ?? '' }));

  return toCsv(
    ['part_number', 'quantity', 'color_id', 'color_name', 'unit_price', 'condition', 'acquired_at'],
    rows
  );
}

// Shared logic to build the Minifiguren CSV export content (manuell erfasst only).
// Used by both the standalone CSV download and the combined ZIP export in settings.js.
// Dieselbe Bauart wie SETS_CSV_SQL in utils/setService.ts, aus demselben Grund:
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
              ELSE TO_CHAR(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') END AS acquired_at
    FROM minifigs f
    LEFT JOIN bl_zuordnung z ON z.art = 'fig' AND z.rb_id = f.fig_number
    LEFT JOIN minifig_acquisitions a
           ON a.user_id = f.user_id AND a.fig_number = f.fig_number
    -- Der Figurenname steht seit Migration 0034 im Katalog. LEFT JOIN, damit
    -- eine Figur ohne Katalogzeile nicht aus dem Export faellt.
    LEFT JOIN minifigs_catalog mc ON mc.fig_number = f.fig_number
   WHERE f.user_id = $1 AND f.source = 'manual'
   ORDER BY mc.fig_name ASC, f.fig_number ASC, a.created_at ASC, a.id ASC`;

async function buildFigsCsv(uid: number) {
  // Ohne zweite Abfrage als Rueckfall — sie zeigte auf f.unit_price und
  // f.condition, die Migration 0035 geloescht hat. Siehe buildPartsCsv oben.
  const acqRows = (await db.all(FIGS_CSV_SQL, [uid]))
    .map((r: any) => ({ ...r, unit_price: r.unit_price ?? '' }));

  // Die Abfrage liefert die Felder bereits in der Form, die der Export braucht
  // (COALESCE auf '' beziehungsweise 'N' steht oben im SQL) — das frueher hier
  // stehende zweite Mapping war damit eine zweite Fassung derselben Regel.
  return toCsv(
    ['fig_number', 'bl_fig_number', 'quantity', 'unit_price', 'condition', 'acquired_at'],
    acqRows);
}

export { buildPartsCsv, buildFigsCsv };
