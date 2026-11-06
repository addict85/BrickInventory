/** Hier, damit keine Route eine andere importiert. */
import * as repo from './repository/bestandExport';
import { toCsv } from '../infra/csvExport';


export async function buildPartsCsv(uid: number) {
  // Kein Rückfall: Scheitert die Abfrage, soll der Fehler sichtbar werden.
  const rows = (await repo.teileFuerCsv(uid))
    .map(r => ({ ...r, unit_price: r.unit_price ?? '' }));

  return toCsv(
    ['part_number', 'quantity', 'color_id', 'color_name', 'unit_price', 'condition', 'acquired_at'],
    rows
  );
}


export async function buildFigsCsv(uid: number) {
  const acqRows = (await repo.figurenFuerCsv(uid))
    .map(r => ({ ...r, unit_price: r.unit_price ?? '' }));

  return toCsv(
    ['fig_number', 'bl_fig_number', 'quantity', 'unit_price', 'condition', 'acquired_at'],
    acqRows);
}

