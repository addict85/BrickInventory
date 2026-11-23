// Price history, value development and market price rows as SVG/HTML. Pure rendering without fetches; set detail,
// wishlist, part detail and finances draw the same axes and the same crosshair with it.
import { accountCurrency } from './state.js';
import { G, setHtml } from './dom.js';
import { fmtDate, fmtN } from './format.js';
import { detailRow, pnlBadge } from './components.js';
import { locale, t, tRaw } from '../i18n.js';
import { html, rawHtml, joinHtml } from './escaping.js';
import { crosshairParts } from './crosshair.js';
import { timeSplit } from './time-axis.js';

/**
 * Market price and development per condition. The server only delivers conditions with an acquisition; reloaded after every save,
 * a new row thus appears by itself.
 * @param {{ by_condition?: import('../../frontend-types/contract').PriceByCondition }} ph
 */
export function renderMarketRows(ph, targetId = 'm-market-rows') {
  const el = G(targetId);
  if (!el) return;
  const LABEL = { N: t('common.condition_new'), U: t('common.condition_used') };
  /** @type {('N' | 'U')[]} */
  const STATES = ['N', 'U'];
  // In the set dialog value and profit are at the top as a header: they are what one looks for there.
  if (el.dataset.header) {
    const parts = STATES.flatMap(c => {
      const d = ph?.by_condition?.[c];
      return d ? [{ c, d }] : [];
    }).map(({ c, d }) => {
      const value = d.market_price != null ? fmtN(d.market_price, accountCurrency) : tRaw('detail.no_market_price');
      const pnl = pnlBadge(d.pnl_pct, d.purchase_price);
      const basis =
        pnl && d.pnl_pct != null && !/pnl-gift/.test(String(pnl))
          ? html` <span class="wk-basis">${tRaw('detail.to_purchase_price')}</span>`
          : '';
      return html`${html`<div class="wk-row"><span class="wk-label">${t('detail.market_price')} · ${LABEL[c]}</span>`}${html`<span class="wk-value${d.market_price != null ? ' price' : ''}">${value}</span>${pnl ? html`<span class="wk-guv">${pnl}${basis}</span>` : ''}</div>`}`;
    });
    setHtml(
      el,
      parts.length
        ? joinHtml(parts)
        : html`<div class="wk-row"><span class="wk-label">${t('detail.market_price')}</span><span class="wk-value text-mut">${tRaw('detail.no_market_price')}</span></div>`,
    );
    return;
  }
  const rows = STATES.flatMap(c => {
    const d = ph?.by_condition?.[c];
    return d ? [{ c, d }] : [];
  }).map(({ c, d }) => {
    const price =
      d.market_price != null
        ? html`<span class="price price-strong">${fmtN(d.market_price, accountCurrency)}</span>`
        : html`<span data-style="color:var(--mut)">—</span>`;
    const pnl = pnlBadge(d.pnl_pct, d.purchase_price);
    return detailRow(html`${tRaw('detail.market_price')} (${LABEL[c]})`, html`${price}${pnl}`, {
      valueStyle: 'display:flex;align-items:center;gap:8px',
    });
  });
  setHtml(el, joinHtml(rows));
}

/**
 * Width of the chart in pixels: the viewBox gets the width of the container, so that a font of 12
 * units is also 12 px on the phone (before: 700 units on 390 px, i.e. about 5 px). Without layout
 * (jsdom) 700.
 * @param {Element|null} el
 */
export function chartWidth(el, fallback = 700) {
  const b = Math.round(el?.clientWidth || 0);
  return b > 0 ? Math.max(220, Math.min(2400, b)) : fallback;
}

/**
 * The page's font enlargement (200 % → 2). Font and margins of the charts grow with it; the width
 * stays that of the container, otherwise the whole picture would shrink instead of giving the font more room.
 */
export function fontFactor() {
  const root =
    typeof getComputedStyle === 'function' && typeof document !== 'undefined'
      ? parseFloat(getComputedStyle(document.documentElement).fontSize)
      : 16;
  return Math.min(3, Math.max(1, (root || 16) / 16));
}

/**
 * Room on the left for the amounts of the y axis: as wide as the longest one, not fixed.
 * @param {Split} division
 * @param {string} cur
 * @param {number} fs
 */
function axesEdge(division, cur, fs) {
  const step = division.values.length > 1 ? division.values[1] - division.values[0] : 1;
  const longest = Math.max(...division.values.map(v => axesAmount(v, step, cur, fs >= 18).length));
  return Math.ceil(longest * fs * 0.62 + fs * 1.2);
}

/**
 * Left margin and position of the axis amounts. If less than a good half remained next to them for the curve
 * (phone, large font), the amounts state inside above their grid lines: otherwise at 320 px and
 * 200 % 15 px of curve would remain.
 * @param {Split} division
 * @param {string} cur
 * @param {number} fs
 * @param {number} W
 * @param {number} right
 */
function axesSituation(division, cur, fs, W, right) {
  const border = axesEdge(division, cur, fs);
  const inside = W - border - right < Math.max(160, W * 0.55);
  return { inside, links: inside ? Math.round(fs * 0.5) : border };
}

// ── Chart axes ──────────────────────────────────────────────────────────────
// Values in steps of 1, 2 or 5 times a power of ten (nobody reads 4'219 / 4'441), time as a real
// axis instead of by index — otherwise a month would be as wide as a day.

/** Axis division: first and last tick, all values in between. @typedef {{ of: number, bis: number, values: number[] }} Split */

/**
 * Division by 1-2-5 over [min, max] with at most about `target` ticks.
 * @param {number} min @param {number} max @param {number} [target]
 * @returns {Split}
 */
export function niceSplit(min, max, target = 5) {
  if (!(max > min)) {
    const d = Math.abs(max) * 0.1 || 1;
    min -= d;
    max += d;
  }
  const raw = (max - min) / Math.max(1, target - 1);
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(f => f * p).find(x => x >= raw * 0.999) ?? 10 * p;
  const of = Math.floor(min / step + 1e-9) * step,
    bis = Math.ceil(max / step - 1e-9) * step;
  const values = [];
  for (let i = 0; of + i * step <= bis + step / 2; i++) values.push(Number((of + i * step).toPrecision(12)));
  return { of, bis, values: values };
}

/**
 * Point in time from "YYYY-MM-DD", "YYYY-MM", "YYYY-MM-DD HH" or ISO; otherwise NaN.
 * @param {string} s
 */
export function moment(s) {
  const t = String(s ?? '');
  const month = /^(\d{4})-(\d{2})$/.exec(t);
  if (month) return new Date(+month[1], +month[2] - 1, 1).getTime();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}))?$/.exec(t);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0)).getTime();
  return new Date(t).getTime();
}

/**
 * A label at the edge ends or begins there instead of sticking out halfway.
 * @param {number} x
 * @param {number} right
 */
function borderAnchor(x, right, f = 1) {
  return x > right - 28 * f ? 'end' : x < 28 * f ? 'start' : 'middle';
}

/**
 * Time axis: ticks whose label would touch the previous one are dropped (narrow and large font).
 * @param {{ x: number, text: string }[]} stripes
 * @param {number} y
 * @param {number} right
 * @param {number} f
 * @param {number} fs
 */
function xLabel(stripes, y, right, f, fs) {
  let free = -Infinity;
  return stripes.map(({ x, text }) => {
    const anchor = borderAnchor(x, right, f),
      width = String(text).length * fs * 0.6;
    const links = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
    if (links < free) return '';
    free = links + width + 8 * f;
    return html`<text x="${x.toFixed(1)}" y="${y}" font-size="${fs}" fill="var(--mut)" text-anchor="${anchor}" font-family="inherit">${text}</text>`;
  });
}

// ── Shared parts of the two charts ──────────────────────────────────────────
// Price history and value chart share axes, cost basis line and crosshair, so that the same quantity looks
// the same in both and is operated the same way.

/**
 * Amount on the y axis: with currency, decimal places only for steps below 1.
 * @param {number} v
 * @param {number} step
 * @param {string} cur
 */
export function axesAmount(v, step, cur, short = false) {
  // With a large font thousands are abbreviated: "2 600 €" took half the width on the phone.
  if (short && step >= 100 && Math.abs(v) >= 1000) {
    const char =
      new Intl.NumberFormat(locale(), { style: 'currency', currency: cur || accountCurrency || 'EUR' })
        .formatToParts(0)
        .find(p => p.type === 'currency')?.value || cur;
    return tRaw('chart.thousand', {
      number: new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(v / 1000),
      cur: char,
    });
  }
  const places = step > 0 && step < 1 ? 2 : 0;
  return new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: cur || accountCurrency || 'EUR',
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  }).format(v);
}

/**
 * Grid and labels of the y axis. If it does not start at 0, it carries an axis break at the bottom: otherwise
 * a movement of 5 % would read as a doubling.
 * @param {Split} division
 * @param {number} min
 * @param {(v: number) => number} yOf
 * @param {number} links
 * @param {number} right
 * @param {number} top
 * @param {number} bottom
 * @param {string} cur
 */
function yAxis(division, min, yOf, links, right, top, bottom, cur, f = 1, inside = false) {
  const step = division.values.length > 1 ? division.values[1] - division.values[0] : 1;
  const stripes = division.values
    .filter((/** @type {number} */ v) => v >= min)
    .map(v => {
      const y = yOf(v).toFixed(1);
      return html`${html`<line x1="${links}" y1="${y}" x2="${right}" y2="${y}" stroke="var(--mut)" stroke-opacity=".22" stroke-width="1"/>`}${inside ? '' : html`<text x="${links - 8 * f}" y="${(yOf(v) + 4 * f).toFixed(1)}" font-size="${12 * f}" fill="var(--mut)" text-anchor="end" font-family="inherit">${axesAmount(v, step, cur, f >= 1.5)}</text>`}`;
    });
  const axis = html`<line x1="${links}" y1="${top}" x2="${links}" y2="${bottom}" stroke="var(--mut)" stroke-width="1"/>`;
  const fraction =
    min > 0
      ? html`<g class="axis-break"><rect x="${links - 6}" y="${bottom - 12}" width="12" height="7" fill="var(--sur)"/>
        <path d="M${links - 6},${bottom - 9} l12,-4 M${links - 6},${bottom - 4} l12,-4" stroke="var(--mut)" stroke-width="1.2" fill="none"/></g>`
      : '';
  return html`${stripes}${axis}${fraction}`;
}

/**
 * The amounts inside (axesSituation): only the lowest and highest line, drawn after the curve and with a border in
 * the card color; none where the label of a reference line stands (`avoid`, y values).
 * @param {Split} division
 * @param {number} min
 * @param {(v: number) => number} yOf
 * @param {number} links
 * @param {string} cur
 * @param {number} f
 * @param {number[]} [avoid]
 */
function yAmountsInner(division, min, yOf, links, cur, f, avoid = []) {
  const step = division.values.length > 1 ? division.values[1] - division.values[0] : 1;
  const values = division.values.filter((/** @type {number} */ v) => v >= min);
  return [values[0], values[values.length - 1]]
    .filter((v, i, a) => a.indexOf(v) === i)
    .filter(v => avoid.every(y => Math.abs(yOf(v) - y) > 30 * f))
    .map(
      v =>
        html`<text x="${links + 4 * f}" y="${(yOf(v) - 5 * f).toFixed(1)}" font-size="${12 * f}" fill="var(--mut)" font-family="inherit"
      paint-order="stroke" stroke="var(--sur)" stroke-width="${4 * f}" stroke-linejoin="round">${axesAmount(v, step, cur, f >= 1.5)}</text>`,
    );
}

/**
 * Lines for a label in `space` px. 0.68 em per character: with 0.62 a label like "purchase price 205.00 €"
 * fit into one line by calculation and was cut off on the left.
 * @param {string} text @param {number} space @param {number} f
 */
function wrap(text, space, f) {
  const char = 12 * f * 0.68;
  /** @type {string[]} */
  const rows = [];
  for (const word of String(text).split(' ')) {
    const z = rows.length ? rows[rows.length - 1] + ' ' + word : word;
    if (rows.length && z.length * char <= space) rows[rows.length - 1] = z;
    else rows.push(word);
  }
  return rows;
}

/**
 * Labels of reference lines that would wrap inside the picture state below the chart: multi-line they lay
 * over the curve and end point. `height` is the room the chart adds at the bottom for them.
 * @param {{ text: string, color: string }[]} entries @param {number} W @param {number} f
 */
function referenceLegend(entries, W, f) {
  let y = 0;
  const parts = entries.map(e => {
    const rows = wrap(e.text, W - 8 - 22 * f, f);
    const top = y;
    y += rows.length * 14 * f + 4 * f;
    return { e, rows, top };
  });
  /** @param {number} start top edge of the area */
  const svg = start =>
    parts.map(({ e, rows, top }) => {
      const b = start + top + 12 * f,
        x = 4 + 22 * f;
      const tspans = rows.map((z, i) => (i ? html`<tspan x="${x}" dy="${14 * f}">${z}</tspan>` : z));
      return html`<g data-legend="basis"><line x1="4" y1="${(b - 4 * f).toFixed(1)}" x2="${4 + 16 * f}" y2="${(b - 4 * f).toFixed(1)}" stroke="${e.color}" stroke-width="1.5" stroke-dasharray="6 4"/>
      <text x="${x}" y="${b.toFixed(1)}" font-size="${12 * f}" font-weight="600" fill="var(--txt)" font-family="inherit">${tspans}</text></g>`;
    });
  return { height: parts.length ? y + 6 * f : 0, svg };
}

/** Does the label of a reference line fit into one line above the area? @param {string} text @param {number} links @param {number} right @param {number} f */
const inImage = (text, links, right, f) => wrap(text, right - links - 8, f).length === 1;

/**
 * Horizontal, dashed reference line (cost basis, purchase price) with a label at the right end. `endY` is
 * the height of the curve there: if the text would lie on it, it stands on the other side of the line.
 * @param {number} value
 * @param {(v: number) => number} yOf
 * @param {number} links
 * @param {number} right
 * @param {string} text
 * @param {string} [color]
 */
function referenceLine(
  value,
  yOf,
  links,
  right,
  text,
  color = 'var(--txt)',
  /** @type {number | null} */ endY = null,
  /** @type {number} */ f = 1,
  /** @type {number} */ bottom = Infinity,
) {
  const y = yOf(value);
  const line = html`<line x1="${links}" y1="${y.toFixed(1)}" x2="${right}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="6 4"/>`;
  if (!text) return html`<g class="cost-basis-line">${line}</g>`;
  const rows = wrap(text, right - links - 8, f);
  const height = 14 * f * (rows.length - 1);
  // Above the line, unless the curve ends there or there is no room at the top (line at the top edge).
  const topNoSpace = y - 6 * f - height - 12 * f < 0; // 12 px per factor: the ascender of the font
  // Below only if there is room there: two lines at the bottom edge would otherwise run out of the chart.
  const below =
    (endY != null && endY < y && y - endY < 26 * f + height && y + 16 * f + height + 4 * f <= bottom) || topNoSpace;
  const first = below ? y + 16 * f : y - 6 * f - height;
  const tspans = rows.map((z, i) => (i ? html`<tspan x="${right - 4}" dy="${14 * f}">${z}</tspan>` : z));
  return html`<g class="cost-basis-line">${line}
    <text x="${right - 4}" y="${first.toFixed(1)}" font-size="${12 * f}" font-weight="600" fill="var(--txt)" text-anchor="end" font-family="inherit"
      paint-order="stroke" stroke="var(--sur)" stroke-width="4" stroke-linejoin="round">${tspans}</text></g>`;
}

/** Response of /v2/…/price-history, as far as the charts read it.
 * @typedef {Partial<Pick<import('../../frontend-types/contract').PriceHistoryResponse, 'chart' | 'history_new' | 'history_used' | 'by_condition'>> | null | undefined} PriceData */

/**
 * The series of the price history per condition, from the server's chart data (src/finances/chartData.ts). Before
 * firstRealIndex there are padded zeros; the purchase price on the purchase day is not a market price and stands as a point
 * there.
 * @param {PriceData} data @returns {{ key: string, name: string, color: string, pts: { x: string, y: number }[], purchase: number, purchaseTag: string | null }[]}
 */
function priceRows(data) {
  /** @type {Record<string, string>} */
  const NAMES = { N: tRaw('common.condition_new'), U: tRaw('common.condition_used') };
  // Colors from the theme; var() also works in inline SVG in stroke and stop-color.
  /** @type {Record<string, string>} */
  const COLORS = { N: 'var(--chart-new)', U: 'var(--chart-used)' };
  const purchaseDays = (/** @type {string} */ k) =>
    new Set(
      ((k === 'U' ? data?.history_used : data?.history_new) || [])
        .filter(p => p?.is_purchase_price)
        .map(p => String(p.recorded_at)),
    );
  return (data?.chart?.values || [])
    .map(sd => {
      const days = purchaseDays(sd.name);
      return {
        key: sd.name,
        name: NAMES[sd.name] || sd.name,
        color: COLORS[sd.name] || 'var(--mut)',
        pts: (sd.values || []).slice(sd.firstRealIndex ?? 0).filter(pt => pt.y > 0 && !days.has(String(pt.x))),
        purchase: Number(sd.name === 'N' || sd.name === 'U' ? data?.by_condition?.[sd.name]?.purchase_price : 0) || 0,
        purchaseTag: [...days][0] || null,
      };
    })
    .filter(sd => sd.pts.length > 0);
}

/**
 * A series as a line with a gradient area; a single point as a circle.
 * `gid` is unique per chart, otherwise a second SVG would take the first gradient.
 * @param {{ color: string, pts: { x: string, y: number }[] }} sd @param {string} gid
 * @param {(d: string) => number} xOf @param {(v: number) => number} yOf @param {number} bottom @param {number} f
 */
function priceLine(sd, gid, xOf, yOf, bottom, f) {
  const pts = sd.pts.map(p => `${xOf(p.x).toFixed(1)},${yOf(p.y).toFixed(1)}`);
  if (pts.length < 2) {
    const [cx, cy] = pts[0].split(',');
    return html`<circle cx="${cx}" cy="${cy}" r="${3.5 * f}" fill="${sd.color}"/>`;
  }
  const area = `${xOf(sd.pts[0].x).toFixed(1)},${bottom} ${pts.join(' ')} ${xOf(sd.pts[sd.pts.length - 1].x).toFixed(1)},${bottom}`;
  return html`<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${sd.color}" stop-opacity=".16"/>
        <stop offset="100%" stop-color="${sd.color}" stop-opacity="0"/>
      </linearGradient></defs>
      <polygon points="${area}" fill="url(#${gid})"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="${sd.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
}

/** Identifiers of the gradients in the SVG; a counter is enough, they only need to be unique on the page. */
let _nextId = 0;

/**
 * Price history with two lines (new and used) on a common scale. The x position comes from the date,
 * not from the index: used prices often start later, and stretched series would show a comparison that
 * does not exist.
 * @param {PriceData} data
 *   Response of /v2/sets/:number/price-history
 * @param {string} [uid]  abbreviation for the gradient IDs in the SVG
 * @param {number} [width]
 * @param {Set<string>} [medium] conditions whose purchase price is the average of several purchases ("Ø purchase price")
 * @returns {import('./escaping.js').SafeHtml} SVG markup or a hint text
 */
export function priceChartSVG(data, uid = `p${++_nextId}`, width = 700, medium = new Set()) {
  const axis = data?.chart?.x || [];
  const series = priceRows(data);

  if (!series.length || axis.length < 2) {
    return html`<span data-style="color:var(--mut);font-size:var(--fs-1)">${tRaw('detail.no_history')}</span>`;
  }

  const toTime = moment;
  // The axis starts at the first market price; an earlier purchase stands as a point at the left edge.
  const firstPoint = series.flatMap(sd => sd.pts.map(p => p.x)).sort((a, b) => toTime(a) - toTime(b))[0];
  const first = toTime(firstPoint) < toTime(axis[axis.length - 1]) ? firstPoint : axis[0],
    last = axis[axis.length - 1];
  const span = Math.max(1, toTime(last) - toTime(first));

  const purchases = series.filter(sd => sd.purchase > 0);
  const vals = [...series.flatMap(sd => sd.pts.map(p => p.y)), ...purchases.map(sd => sd.purchase)];
  const division = niceSplit(Math.min(...vals), Math.max(...vals), 4);
  const min = Math.max(0, division.of),
    max = division.bis,
    range = max - min || 1;
  const f = fontFactor(),
    fs = 12 * f;
  const W = width;
  const situation = axesSituation(division, accountCurrency, fs, W, 14 * f);
  const PAD = {
    l: situation.links,
    r: situation.inside ? 6 * f : 14 * f,
    t: situation.inside ? 22 * f : 12 * f,
    b: 46 * f,
  };
  const purchaseText = (/** @type {{ key: string, name: string, purchase: number }} */ sd) =>
    `${tRaw(medium.has(sd.key) ? 'detail.purchase_price_avg' : 'detail.purchase_price')}${series.length > 1 ? ' ' + sd.name : ''} ${fmtN(sd.purchase, accountCurrency)}`;
  const refLegend = referenceLegend(
    purchases
      .filter(sd => !inImage(purchaseText(sd), PAD.l, W - PAD.r, f))
      .map(sd => ({ text: purchaseText(sd), color: sd.color })),
    W,
    f,
  );
  const hCurve = Math.round(200 * (1 + (f - 1) * 0.6)),
    H = hCurve + refLegend.height;
  PAD.b += refLegend.height;
  const iw = W - PAD.l - PAD.r,
    ih = H - PAD.t - PAD.b,
    bottom = PAD.t + ih;
  const yOf = (/** @type {number} */ v) => PAD.t + ih - ((v - min) / range) * ih;
  const xOf = (/** @type {string} */ d) => PAD.l + ((toTime(d) - toTime(first)) / span) * iw;

  const parts = series.map((sd, i) => priceLine(sd, `pg-${uid}-${i}`, xOf, yOf, bottom, f));

  const purchaseLines = purchases.map(sd =>
    referenceLine(
      sd.purchase,
      yOf,
      PAD.l,
      W - PAD.r,
      inImage(purchaseText(sd), PAD.l, W - PAD.r, f) ? purchaseText(sd) : '',
      sd.color,
      yOf(sd.pts[sd.pts.length - 1].y),
      f,
      hCurve,
    ),
  );

  const purchasePoints = purchases
    .flatMap(sd => (sd.purchaseTag ? [{ ...sd, purchaseTag: sd.purchaseTag }] : []))
    .map(
      sd =>
        html`<circle cx="${Math.max(PAD.l, xOf(sd.purchaseTag)).toFixed(1)}" cy="${yOf(sd.purchase).toFixed(1)}" r="${4.5 * f}" fill="var(--sur)" stroke="${sd.color}" stroke-width="2" class="purchase-dot"><title>${tRaw('detail.purchase_price')} ${fmtN(sd.purchase, accountCurrency)}</title></circle>`,
    );

  const fmtDay = (/** @type {string} */ d) => fmtDate(new Date(toTime(d)));
  const xTicks = xLabel(
    timeSplit(toTime(first), toTime(last), Math.floor(iw / (80 * f))).map(s => ({
      x: PAD.l + ((s.t - toTime(first)) / span) * iw,
      text: s.text,
    })),
    hCurve - 26 * f,
    W - PAD.r,
    f,
    fs,
  );
  const legend = series.map(
    (sd, i) =>
      // From the left edge instead of from the axis: with a large font the axis margin is so wide that "Neuware" would otherwise break off on the right.
      html`<g transform="translate(${4 + i * Math.min(120 * f, (W - 8) / series.length)}, ${hCurve - 6 * f})">
       <line x1="0" y1="${-4 * f}" x2="${16 * f}" y2="${-4 * f}" stroke="${sd.color}" stroke-width="2.5" stroke-linecap="round"/>
       <text x="${22 * f}" y="0" font-size="${fs}" fill="var(--txt)" font-family="inherit">${sd.name}</text>
     </g>`,
  );

  // Crosshair: per day of the axis the values of all series that have a point there.
  const days = [...new Set(series.flatMap(sd => sd.pts.map(p => p.x)))].sort((a, b) => toTime(a) - toTime(b));
  const dots = days.map(tag => {
    const values = series.map(sd => sd.pts.find(p => p.x === tag)?.y ?? null);
    return {
      x: +xOf(tag).toFixed(1),
      y: values.map(v => (v == null ? null : +yOf(v).toFixed(1))),
      t: [
        fmtDay(tag),
        ...series
          .map((sd, k) =>
            values[k] == null ? null : (series.length > 1 ? sd.name + ' ' : '') + fmtN(values[k], accountCurrency),
          )
          .filter(z => z !== null),
      ],
    };
  });
  const fk = crosshairParts(
    dots,
    series.map(sd => sd.color),
    PAD.t,
    bottom,
    f,
  );

  const summary = [
    tRaw('detail.chart.summary', {
      title: tRaw('detail.price_history'),
      of: fmtDay(first),
      bis: fmtDay(last),
      rows: series
        .map(sd =>
          tRaw('detail.chart.series', { name: sd.name, value: fmtN(sd.pts[sd.pts.length - 1].y, accountCurrency) }),
        )
        .join('; '),
    }),
    min > 0 ? tRaw('chart.axis_from', { value: fmtN(min, accountCurrency) }) : '',
    tRaw('chart.keys'),
  ]
    .filter(Boolean)
    .join('. ');
  return html`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="chart chart-price" role="img" aria-label="${summary}" data-surface="${iw.toFixed(0)}"${rawHtml(fk.attr)}>
    ${yAxis(division, min, yOf, PAD.l, W - PAD.r, PAD.t, bottom, accountCurrency, f, situation.inside)}
    ${parts}
    ${purchaseLines}
    ${purchasePoints}
    ${
      situation.inside
        ? yAmountsInner(
            division,
            min,
            yOf,
            PAD.l,
            accountCurrency,
            f,
            purchases.map(sd => yOf(sd.purchase)),
          )
        : ''
    }
    ${xTicks}
    ${legend}${refLegend.svg(hCurve)}
    ${fk.svg}
  </svg>`;
}

/** Day labels by index, about 70 px per label, so that they do not overlap on the phone.
 * @param {{ day?: string }[]} data @param {(i: number) => number} px
 * @param {{ iw: number, f: number, fs: number, y: number }} o */
function dayLabels(data, px, o) {
  const n = data.length;
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.min(7, Math.floor(o.iw / (70 * o.f))))));
  /** @type {import('./escaping.js').Markup} */
  let labels = html``;
  for (let i = 0; i < n; i += step)
    if (data[i].day)
      labels = html`${labels}${html`<text x="${px(i).toFixed(1)}" y="${o.y}" text-anchor="middle" font-size="${o.fs}" fill="var(--mut)" font-family="inherit">${data[i].day}</text>`}`;
  return labels;
}

/** The text alternative of the value curve. @param {(i: number) => string | undefined} when
 * @param {number[]} vals @param {string} cur @param {string} costLine @param {number} min */
function portfolioSummary(when, vals, cur, costLine, min) {
  const n = vals.length;
  return [
    tRaw('finance.chart.summary', {
      title: tRaw('finance.chart.label'),
      of: when(0),
      bis: when(n - 1),
      start: fmtN(vals[0], cur),
      end: fmtN(vals[n - 1], cur),
    }),
    costLine,
    min > 0 ? tRaw('chart.axis_from', { value: fmtN(min, cur) }) : '',
    tRaw('chart.keys'),
  ]
    .filter(Boolean)
    .join('. ');
}

/** Sizes of the value curve: margins, legend below the image when the reference text does not fit in it.
 * Narrow, only "purchase price": the addition ("only valued items") is in the metric below.
 * @param {ReturnType<typeof niceSplit>} division @param {string} cur @param {number} width @param {string} referenceText */
function portfolioLayout(division, cur, width, referenceText) {
  const f = fontFactor(),
    fs = 12 * f;
  const W = width,
    situation = axesSituation(division, cur, fs, W, 16 * f);
  const PAD = {
    l: situation.links,
    r: situation.inside ? 6 * f : 16 * f,
    t: situation.inside ? 24 * f : 14 * f,
    b: 32 * f,
  };
  const belowTheImage = !!referenceText && !inImage(referenceText, PAD.l, W - PAD.r, f);
  const refLegend = referenceLegend(belowTheImage ? [{ text: referenceText, color: 'var(--txt)' }] : [], W, f);
  const hCurve = Math.round(180 * (1 + (f - 1) * 0.6)),
    H = hCurve + refLegend.height;
  PAD.b += refLegend.height;
  const iw = W - PAD.l - PAD.r,
    ih = H - PAD.t - PAD.b,
    bottom = PAD.t + ih;

  return { f, fs, W, situation, PAD, referenceText, belowTheImage, refLegend, hCurve, H, iw, ih, bottom };
}

/**
 * @param {{ day: string, total: number, time?: number }[]} data
 *   `time` (ms) puts the points on a real time axis; if missing, by index.
 * @param {number} [costBasis] sum of the purchase prices; > 0 draws the cost basis line.
 * @param {string} [costText] name of the cost basis line
 * @param {string} _period
 */
export function portfolioChartSVG(
  data,
  _period,
  width = 700,
  costBasis = 0,
  cur = accountCurrency,
  costText = tRaw('finance.stat.purchase'),
) {
  const vals = data.map(d => d.total || 0);
  if (vals.length < 2) return chartEmpty();

  const withCost = costBasis > 0;
  const division = niceSplit(
    Math.min(...vals, ...(withCost ? [costBasis] : [])),
    Math.max(...vals, ...(withCost ? [costBasis] : [])),
    5,
  );
  const min = Math.max(0, division.of),
    max = division.bis,
    range = max - min || 1;
  const { f, fs, W, situation, PAD, referenceText, belowTheImage, refLegend, hCurve, H, iw, ih, bottom } =
    portfolioLayout(
      division,
      cur,
      width,
      withCost ? `${width < 560 ? tRaw('finance.chart.purchase_price') : costText} ${fmtN(costBasis, cur)}` : '',
    );

  const color = 'var(--chart-value, var(--chart-new))';
  const n = vals.length;
  const times = data.map(d => d.time ?? NaN);
  const withTime = times.every(Number.isFinite) && times[n - 1] > times[0];
  const t0 = withTime ? times[0] : 0,
    timeSpan = withTime ? times[n - 1] - t0 : 1;

  /**
   * @param {number} t
   */
  function pxTime(t) {
    return PAD.l + ((t - t0) / timeSpan) * iw;
  }
  /**
   * @param {number} i
   */
  function px(i) {
    return withTime ? pxTime(times[i]) : PAD.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  }
  /**
   * @param {number} v
   */
  function py(v) {
    return PAD.t + ih - ((v - min) / range) * ih;
  }

  const pts = vals.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const area = `${px(0).toFixed(1)},${bottom} ${pts} ${px(n - 1).toFixed(1)},${bottom}`;

  const xLabels = withTime
    ? xLabel(
        timeSplit(t0, times[n - 1], Math.floor(iw / (70 * f))).map(s => ({ x: pxTime(s.t), text: s.text })),
        hCurve - 8 * f,
        W - PAD.r,
        f,
        fs,
      )
    : dayLabels(data, px, { iw, f, fs, y: hCurve - 8 * f });

  const when = (/** @type {number} */ i) => (withTime ? fmtDate(new Date(times[i])) : data[i].day);
  const last = html`<circle cx="${px(n - 1).toFixed(1)}" cy="${py(vals[n - 1]).toFixed(1)}" r="${4 * f}" fill="${color}" stroke="var(--sur)" stroke-width="1.5"/>`;
  const line = withCost
    ? referenceLine(
        costBasis,
        py,
        PAD.l,
        W - PAD.r,
        belowTheImage ? '' : referenceText,
        'var(--txt)',
        py(vals[n - 1]),
        f,
        hCurve,
      )
    : '';
  const fk = crosshairParts(
    vals.map((v, i) => ({ x: +px(i).toFixed(1), y: [+py(v).toFixed(1)], t: [when(i), fmtN(v, cur)] })),
    [color],
    PAD.t,
    bottom,
    f,
  );

  const summary = portfolioSummary(when, vals, cur, withCost ? `${costText} ${fmtN(costBasis, cur)}` : '', min);
  return html`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="chart chart-value" role="img" aria-label="${summary}" data-surface="${iw.toFixed(0)}"${rawHtml(fk.attr)}>
  <defs><linearGradient id="pcg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${color}" stop-opacity=".15"/>
    <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
  </linearGradient></defs>
  ${yAxis(division, min, py, PAD.l, W - PAD.r, PAD.t, bottom, cur, f, situation.inside)}${xLabels}
  <polygon points="${area}" fill="url(#pcg)"/>
  <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${line}${last}${refLegend.svg(hCurve)}
  ${situation.inside ? yAmountsInner(division, min, py, PAD.l, cur, f, withCost ? [py(costBasis)] : []) : ''}
  ${fk.svg}
</svg>`;
}

/** Empty state of the value chart (also from portfolioChartSVG). */
export function chartEmpty() {
  return html`<div class="chart-empty" role="status"><strong>${tRaw('finance.chart.too_few_title')}</strong><span>${tRaw('finance.chart.too_few_text')}</span></div>`;
}
