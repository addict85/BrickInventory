/** As soon as ONE acquisition is used, the set counts as used — the same
 * rule as the display, so that price and profit calculation do not diverge. */
export function effectiveCondition(set: { acq_count?: unknown; used_count?: unknown } | null | undefined): 'N' | 'U' {
  const acqCount = parseInt(String(set?.acq_count), 10) || 0;
  const usedCount = parseInt(String(set?.used_count), 10) || 0;
  if (acqCount > 0) return usedCount > 0 ? 'U' : 'N';
  return 'N';
}
