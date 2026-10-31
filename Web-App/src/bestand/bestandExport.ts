/**
 * CSV-Export der manuell erfassten Teile und Figuren. Die Einstellungen
 * (ZIP-Export) und die Routen brauchen dieselben Funktionen; hier liegen sie,
 * damit keine Route eine andere importiert.
 */
import * as repo from './repository/bestandExport';
import { toCsv } from '../infra/csvExport';


export async function buildPartsCsv(uid: number) {
  // Ohne zweite Abfrage als Rueckfall — siehe die Begruendung bei
  // PARTS_CSV_SQL. Scheitert sie, soll der Fehler sichtbar werden, statt eine
  // Abfrage zu versuchen, die auf geloeschte Spalten zeigt.
  const rows = (await repo.teileFuerCsv(uid))
    .map((r: any) => ({ ...r, unit_price: r.unit_price ?? '' }));

  return toCsv(
    ['part_number', 'quantity', 'color_id', 'color_name', 'unit_price', 'condition', 'acquired_at'],
    rows
  );
}


export async function buildFigsCsv(uid: number) {
  // Ohne zweite Abfrage als Rueckfall — sie zeigte auf f.unit_price und
  // f.condition, die Migration 0035 geloescht hat. Siehe buildPartsCsv oben.
  const acqRows = (await repo.figurenFuerCsv(uid))
    .map((r: any) => ({ ...r, unit_price: r.unit_price ?? '' }));

  // Die Abfrage liefert die Felder bereits in der Form, die der Export braucht
  // (COALESCE auf '' beziehungsweise 'N' steht oben im SQL) — das frueher hier
  // stehende zweite Mapping war damit eine zweite Fassung derselben Regel.
  return toCsv(
    ['fig_number', 'bl_fig_number', 'quantity', 'unit_price', 'condition', 'acquired_at'],
    acqRows);
}

