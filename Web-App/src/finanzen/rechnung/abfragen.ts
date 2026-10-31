/**
 * Lesezugriffe, die MEHR ALS EINE Schicht des Finanzteils braucht.
 * Ausführlich: docs/begruendungen/src/finanzen/rechnung/abfragen.ts.md#abschnitt
 */

export { kaufpreisIn, kaufpreisSpalten } from '../../../db/geldSql';

/** Wie viele Zeilen ein Merkmal tragen (kaufpreis_fremd bzw. kaufpreis_umgerechnet). */
export function zaehle(zeilen: Iterable<{ kaufpreis_fremd?: unknown; kaufpreis_umgerechnet?: unknown }>, merkmal: 'kaufpreis_fremd' | 'kaufpreis_umgerechnet'): number {
  let n = 0;
  for (const z of zeilen) if (z[merkmal]) n++;
  return n;
}
