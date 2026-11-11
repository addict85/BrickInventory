import { buildChart } from '../chartData';
import type { KurvenPunkt } from './kurve';

/** Alle Beschriftungen entstehen auf dem Server, damit Webapp und App gleich aussehen. */
export function baueDiagrammdaten(rawPoints: KurvenPunkt[], currency: string, downsampled: boolean) {
function fmtX(point: { day?: string }) {
  const d = (point.day||'').toString();
  if (d.length===10 && d[4]==='-' && d[7]==='-') {
    return d.slice(8)+'.'+d.slice(5,7);   // DD.MM  (daily resolution)
  }
  if (d.length===7 && d[4]==='-') {
    return d.slice(5)+'/'+d.slice(2,4);   // MM/YY  (monthly resolution)
  }
  return d;
}

const vals   = rawPoints.map(p => p.total);
const vRawMin = Math.min(...vals);
const vRawMax = Math.max(...vals);
const spread = vRawMax - vRawMin;
const pad2   = spread > 0 ? spread * 0.15 : vRawMax * 0.10;
const vMin   = Math.max(0, vRawMin - pad2);
const vMax   = vRawMax + pad2;

const sym = currency==='CHF' ? 'CHF'
          : currency==='USD' ? '$'
          : currency==='GBP' ? '£' : '€';
function fmtY(v: number) {
  const n = Math.round(v);
  const s = n.toLocaleString('de-CH').replace(/\./g,"'");
  return `${sym} ${s}`;
}

const y_axis: { label: string; value: number; frac: number }[] = [];
for (let t = 0; t <= 4; t++) {
  const frac  = t / 4;
  const value = vMin + frac * (vMax - vMin);
  y_axis.push({ label: fmtY(value), value: parseFloat(value.toFixed(2)), frac });
}
// y_axis[0] = unten, y_axis[4] = oben.

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
      // Monatsauflösung: erster Punkt mit exaktem Datum, letzter = heute.
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

const firstVal   = rawPoints[0]?.total ?? 0;
const currentVal = rawPoints.at(-1)?.total ?? 0;
const period_change_pct = rawPoints.length >= 2 && firstVal > 0
  ? parseFloat(((currentVal - firstVal) / firstVal * 100).toFixed(2))
  : null;

// Eine Linie, weil hier der GESAMTWERT steht; die Trennung nach Zustand gehört
// in die Tabelle darunter.
const chart = buildChart([{
  name: 'total',
  rows: rawPoints.map(p => ({
    recorded_at: String(p.fullDay || p.day || ''),
    avg_price: p.total,
  })),
}]);

  return { points, y_axis, period_change_pct, chart };
}
