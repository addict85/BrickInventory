/** Sobald EINE Erfassung gebraucht ist, gilt das Set als gebraucht — dieselbe
 * Regel wie die Anzeige, damit Preis und Gewinnrechnung nicht abweichen. */
export function effectiveCondition(set: { acq_count?: unknown; used_count?: unknown } | null | undefined): 'N' | 'U' {
  const acqCount = parseInt(String(set?.acq_count), 10) || 0;
  const usedCount = parseInt(String(set?.used_count), 10) || 0;
  if (acqCount > 0) return usedCount > 0 ? 'U' : 'N';
  return 'N';
}
