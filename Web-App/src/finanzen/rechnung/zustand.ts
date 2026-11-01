
/** Sobald EINE Erfassung gebraucht ist, gilt das Set als gebraucht — dieselbe
 * Regel wie die Anzeige, damit Preis und Gewinnrechnung nicht abweichen.
 * Ausführlich: docs/begruendungen/src/finanzen/rechnung/zustand.ts.md#effectivecondition */
export function effectiveCondition(set: any): 'N' | 'U' {
  const acqCount  = parseInt(set?.acq_count)  || 0;
  const usedCount = parseInt(set?.used_count) || 0;
  if (acqCount > 0) return usedCount > 0 ? 'U' : 'N';
  return 'N';
}

