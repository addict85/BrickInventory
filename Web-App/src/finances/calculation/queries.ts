// What valuation and profit both read.

export function countFlagged(
  rows: Iterable<{ purchase_price_foreign?: unknown; purchase_price_converted?: unknown }>,
  feature: 'purchase_price_foreign' | 'purchase_price_converted',
): number {
  let n = 0;
  for (const z of rows) if (z[feature]) n++;
  return n;
}
