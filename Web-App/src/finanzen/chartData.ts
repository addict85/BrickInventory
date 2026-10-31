/** Eine Form für alle Verlaufs-Endpunkte, damit beide Oberflächen einen
 * Diagrammbauer brauchen.
 * Ausführlich: docs/begruendungen/src/finanzen/chartData.ts.md#chartpoint */

export interface ChartPoint { x: string; y: number }

export interface ChartSeries {
  name: string;
  values: ChartPoint[];
  /** Index des ersten echten Wertes; davor stehen aufgefüllte Nullen. */
  firstRealIndex: number;
}

/** @param inputs Je Reihe ein Name und die rohen Zeilen (recorded_at, avg_price). */
export function buildChart(inputs: Array<{ name: string; rows: any[] }>) {
  const valueOf = (r: any) => {
    const v = r?.avg_price ?? r?.qty_avg_price;
    const n = parseFloat(String(v ?? 0));
    return Number.isFinite(n) ? n : 0;
  };

  // Nur Tage, an denen eine Reihe einen Wert hat: Die Achse zeigt Messpunkte,
  // nicht jeden Kalendertag.
  const x = [...new Set(
    inputs.flatMap(s => (s.rows || []).map(r => String(r.recorded_at)))
  )].sort();

  const values: ChartSeries[] = inputs.map(s => {
    const byDay = new Map<string, number>();
    for (const r of s.rows || []) byDay.set(String(r.recorded_at), valueOf(r));
    const pts = x.map(day => ({ x: day, y: byDay.has(day) ? byDay.get(day)! : 0 }));
    const firstRealIndex = pts.findIndex(p => byDay.has(p.x));
    return { name: s.name, values: pts, firstRealIndex: firstRealIndex < 0 ? pts.length : firstRealIndex };
  });

  return { values, x };
}
