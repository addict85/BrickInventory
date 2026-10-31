/**
 * Der Zustand eines Sets — die eine Regel, nach der Preis UND Gewinnrechnung
 * entscheiden, ob „neu" oder „gebraucht" gilt.
 * Ausführlich: docs/begruendungen/src/finanzen/rechnung/zustand.ts.md#abschnitt
 */

/**
 * Zustand eines Sets nach derselben Regel wie die Anzeige
 * (utils/handlers.ts → getSetConditionAggregate):
 * Sobald EINE Erfassung gebraucht ist, gilt das Set als gebraucht; sonst neu.
 * Ausführlich: docs/begruendungen/src/finanzen/rechnung/zustand.ts.md#effectivecondition
 */
export function effectiveCondition(set: any): 'N' | 'U' {
  const acqCount  = parseInt(set?.acq_count)  || 0;
  const usedCount = parseInt(set?.used_count) || 0;
  if (acqCount > 0) return usedCount > 0 ? 'U' : 'N';
  return 'N';
}

