// What valuation and profit both read.

export function zaehle(
  zeilen: Iterable<{ kaufpreis_fremd?: unknown; kaufpreis_umgerechnet?: unknown }>,
  feature: 'kaufpreis_fremd' | 'kaufpreis_umgerechnet',
): number {
  let n = 0;
  for (const z of zeilen) if (z[feature]) n++;
  return n;
}
