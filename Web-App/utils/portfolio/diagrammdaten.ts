import { buildChart } from '../chartData';

/**
 * Aus den rekonstruierten Rohpunkten die fertigen Diagrammdaten machen:
 * Wertebereich mit Rand, fünf Y-Beschriftungen, X-Beschriftungen und die
 * Prozentänderung über den Zeitraum.
 *
 * ── Warum eigene Datei (Nachtrag 135) ───────────────────────────────────────
 *
 * getPortfolioHistory() war 449 Zeilen und tat drei Dinge nacheinander:
 * entscheiden, in welcher Auflösung gerechnet wird; die Kurve aus dem
 * Preisverlauf JE SET rekonstruieren; und daraus Achsen und Beschriftungen
 * machen. Nur das dritte ist reine Rechnung ohne Datenbank — und damit der
 * Teil, den man beim Suchen nach einem Achsenfehler nicht in zweihundert
 * Zeilen SQL-Rekonstruktion suchen sollte.
 *
 * Die Schnittstelle ist schmal: rein die Rohpunkte und die Währung, raus die
 * fertigen Diagrammdaten. Keine Datenbank, kein Zustand.
 */
export function baueDiagrammdaten(rawPoints: any[], currency: string, downsampled: boolean) {
// X-label formatter — all label logic lives here on the server
function fmtX(point: any) {
  const d = (point.day||'').toString();
  if (d.length===10 && d[4]==='-' && d[7]==='-') {
    return d.slice(8)+'.'+d.slice(5,7);   // DD.MM  (daily resolution)
  }
  if (d.length===7 && d[4]==='-') {
    return d.slice(5)+'/'+d.slice(2,4);   // MM/YY  (monthly resolution)
  }
  return d;
}

// Compute Y axis: 5 evenly spaced values from bottom to top
const vals   = rawPoints.map(p => p.total);
const vRawMin = Math.min(...vals);
const vRawMax = Math.max(...vals);
const spread = vRawMax - vRawMin;
const pad2   = spread > 0 ? spread * 0.15 : vRawMax * 0.10;
const vMin   = Math.max(0, vRawMin - pad2);
const vMax   = vRawMax + pad2;

// Currency symbol
const sym = currency==='CHF' ? 'CHF'
          : currency==='USD' ? '$'
          : currency==='GBP' ? '£' : '€';
function fmtY(v: number) {
  const n = Math.round(v);
  const s = n.toLocaleString('de-CH').replace(/\./g,"'");
  return `${sym} ${s}`;
}

const y_axis: any[] = [];
for (let t = 0; t <= 4; t++) {
  const frac  = t / 4;
  const value = vMin + frac * (vMax - vMin);
  y_axis.push({ label: fmtY(value), value: parseFloat(value.toFixed(2)), frac });
}
// y_axis[0] = bottom, y_axis[4] = top

// Build points with x_label — up to 7 evenly spaced labels
const n = rawPoints.length;
const maxLabels = 7;
const step = Math.max(1, Math.ceil(n / maxLabels));
const labelIdxs = new Set();
for (let i = 0; i < n; i += step) labelIdxs.add(i);
labelIdxs.add(n - 1); // always label last point

const now = new Date();
const pad = (n: number) => String(n).padStart(2,'0');
const todayFmt = `${pad(now.getDate())}.${pad(now.getMonth()+1)}`;

const points = rawPoints.map((p, i) => {
  let xLabel = '';
  if (labelIdxs.has(i)) {
    if (downsampled) {
      // Monatsauflösung: erster Punkt mit exaktem Datum, letzter = heute
      if (i === 0) {
        const fd = (p.fullDay || p.day || '').slice(0,10);
        xLabel = fd.length === 10 ? fd.slice(8)+'.'+fd.slice(5,7) : fmtX(p);
      } else if (i === n - 1) {
        xLabel = todayFmt;
      } else {
        xLabel = fmtX(p);
      }
    } else {
      xLabel = fmtX(p);
    }
  }
  return {
    x_label: xLabel,
    value:   p.total,
    y_frac:  vMax > vMin ? (p.total - vMin) / (vMax - vMin) : 0.5
  };
});

// Period change %
const firstVal   = rawPoints[0].total;
const currentVal = rawPoints[rawPoints.length-1].total;
const period_change_pct = rawPoints.length >= 2 && firstVal > 0
  ? parseFloat(((currentVal - firstVal) / firstVal * 100).toFixed(2))
  : null;

// Diagrammdaten in derselben Form wie die Preisverläufe — siehe
// utils/chartData.ts. Eine Linie, weil hier der GESAMTWERT über die Zeit
// steht; eine Trennung nach Zustand gehört in die Tabelle darunter, nicht
// in dieses Diagramm.
//
// Der Sinn ist derselbe wie dort: Die Oberfläche bekommt fertige Punkte und
// muss keine Achse mehr selbst ausrechnen. `points` bleibt daneben erhalten
// — es trägt x_label und y_frac, die das bestehende SVG benutzt.
const chart = buildChart([{
  name: 'total',
  rows: rawPoints.map((p: any) => ({
    recorded_at: String(p.fullDay || p.day || ''),
    avg_price: p.total,
  })),
}]);

  return { points, y_axis, period_change_pct, chart };
}
