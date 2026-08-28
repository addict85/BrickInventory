/**
 * Diagrammdaten in einer einheitlichen Form — für alle Verlaufs-Endpunkte.
 *
 * ── Warum der Server das ausrechnet ─────────────────────────────────────────
 * Vorher lieferte jede Route rohe Zeilen, und jeder Client baute daraus selbst
 * eine Zeitachse: die Webapp in priceChartSVG(), Android noch einmal. Zwei
 * Umsetzungen derselben Rechnung — genau das Muster, das in diesem Projekt
 * schon mehrfach auseinandergelaufen ist (Zustandsauflösung, Bild-Allowlist,
 * Preisverlauf-Route).
 *
 * Jetzt liefert der Server fertige Reihen mit gemeinsamer x-Achse. Ein Client
 * muss nur noch zeichnen.
 *
 * ── Form ────────────────────────────────────────────────────────────────────
 *   { values: [ { name: "Neu", values: [ { x: "2026-01-01", y: 12.5 }, … ] },
 *               { name: "Gebraucht", values: [ … ] } ] }
 *
 * Alle Reihen haben dieselben x-Werte in derselben Reihenfolge und damit
 * dieselbe Länge.
 *
 * ── Zu den Nullen ───────────────────────────────────────────────────────────
 * Beginnt eine Reihe später, werden die vorderen Positionen mit 0 aufgefüllt —
 * so angefordert, und für Diagrammbibliotheken, die gleich lange Achsen
 * verlangen, ist das der übliche Weg.
 *
 * ACHTUNG beim Zeichnen: Eine 0 ist hier "kein Wert", nicht "Preis null". Wer
 * sie als Punkt zeichnet, erhält eine Linie, die bei null beginnt und dann
 * senkrecht hochspringt — das sieht aus wie ein Kurssturz, den es nie gab.
 * Renderer sollten führende Nullen überspringen; `firstRealIndex` unten sagt
 * je Reihe, ab wo echte Werte stehen.
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
