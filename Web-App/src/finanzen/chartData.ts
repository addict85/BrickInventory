/**
 * Diagrammdaten in einer einheitlichen Form — für alle Verlaufs-Endpunkte.
 * Ausführlich: docs/begruendungen/src/finanzen/chartData.ts.md#chartpoint
 */

/** Ein Punkt im Diagramm. */
export interface ChartPoint { x: string; y: number }

/** Eine benannte Linie. */
export interface ChartSeries {
  name: string;
  values: ChartPoint[];
  /** Index des ersten echten Wertes; davor stehen aufgefüllte Nullen. */
  firstRealIndex: number;
}

/**
 * Rohe Verlaufszeilen in Diagrammreihen mit gemeinsamer x-Achse überführen.
 *
 * @param {Array<{name: string, rows: any[]}>} inputs Je Reihe ein Name und die
 *        rohen Zeilen (mit recorded_at und avg_price/qty_avg_price).
 * @returns {{values: ChartSeries[], x: string[]}}
 */
export function buildChart(inputs: Array<{ name: string; rows: any[] }>) {
  const valueOf = (r: any) => {
    const v = r?.avg_price ?? r?.qty_avg_price;
    const n = parseFloat(String(v ?? 0));
    return Number.isFinite(n) ? n : 0;
  };

  // Gemeinsame, sortierte x-Achse über ALLE Reihen. Tage, an denen keine
  // einzige Reihe einen Wert hat, kommen gar nicht vor — die Achse zeigt
  // Messpunkte, nicht jeden Kalendertag.
  const x = [...new Set(
    inputs.flatMap(s => (s.rows || []).map(r => String(r.recorded_at)))
  )].sort();

  const values: ChartSeries[] = inputs.map(s => {
    const byDay = new Map<string, number>();
    for (const r of s.rows || []) byDay.set(String(r.recorded_at), valueOf(r));
    const pts = x.map(day => ({ x: day, y: byDay.has(day) ? byDay.get(day)! : 0 }));
    // Erster echter Wert — siehe den Hinweis zu den Nullen oben.
    const firstRealIndex = pts.findIndex(p => byDay.has(p.x));
    return { name: s.name, values: pts, firstRealIndex: firstRealIndex < 0 ? pts.length : firstRealIndex };
  });

  return { values, x };
}
