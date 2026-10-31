// Ausführlich: docs/begruendungen/src/finanzen/rechnung/abfragen.ts.md#abschnitt

export { kaufpreisIn, kaufpreisSpalten } from '../../../db/geldSql';

export function zaehle(zeilen: Iterable<{ kaufpreis_fremd?: unknown; kaufpreis_umgerechnet?: unknown }>, merkmal: 'kaufpreis_fremd' | 'kaufpreis_umgerechnet'): number {
  let n = 0;
  for (const z of zeilen) if (z[merkmal]) n++;
  return n;
}
