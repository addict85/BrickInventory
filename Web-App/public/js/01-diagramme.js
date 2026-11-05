// Preisverlauf, Wertentwicklung und Marktpreiszeilen als SVG/HTML. Reine
// Darstellung ohne Abrufe; Set-Detail, Merkliste, Teile-Detail und Finanzen
// zeichnen damit dieselben Achsen und dasselbe Fadenkreuz.
import { CURRENCY } from './00-zustand.js';
import { G, fmtDatum, fmtN } from './01-core.js';
import { detailZeile, pnlBadge } from './01-bausteine.js';
import { locale, t, tRaw } from '../i18n.js';
import { esc } from './00-escapen.js';

/**
 * Marktpreis und Entwicklung je Zustand in den Detail-Dialog schreiben.
 * Ausführlich: docs/begruendungen/public/js/01-diagramme.js.md#rendermarketrows
 * @param {{by_condition?: Record<string, {market_price: number|null, pnl_pct: number|null, purchase_price?: number|null}>}} ph
 */
export function renderMarketRows(ph, targetId = 'm-market-rows') {
  const el = G(targetId);
  if (!el) return;
  const LABEL = { N: t('common.condition_new'), U: t('common.condition_used') };
  const rows = ['N', 'U']
    .filter(c => ph?.by_condition?.[c])
    .map(c => {
      const d = ph.by_condition[c];
      const price = d.market_price != null
        ? `<span class="preis preis-stark">${esc(fmtN(d.market_price, CURRENCY))}</span>`
        : '<span data-stil="color:var(--mut)">—</span>';
      const pnl = pnlBadge(d.pnl_pct, d.purchase_price);
      return detailZeile(
        `${esc(t('detail.market_price'))} (${esc(LABEL[c])})`,
        `${price}${pnl}`,
        { wertStil: 'display:flex;align-items:center;gap:8px' });
    });
  el.innerHTML = rows.join('');
}

/**
 * Breite des Diagramms in Pixeln: Die viewBox bekommt die Breite des Behälters,
 * damit eine Schrift von 12 Einheiten auch am Telefon 12 px groß ist (vorher
 * 700 Einheiten auf 390 px, also rund 5 px). Ohne Layout (jsdom) 700.
 * @param {Element|null} el
 */
export function diagrammBreite(el, ersatz = 700) {
  const b = Math.round(el?.clientWidth || 0);
  return b > 0 ? Math.max(260, Math.min(1200, b)) : ersatz;
}

// ── Achsen der Diagramme ─────────────────────────────────────────────────────
// Werte in Schritten von 1, 2 oder 5 mal einer Zehnerpotenz (4'219 / 4'441
// liest niemand), die Zeit als echte Achse statt nach Index — sonst stünde
// ein Monat so breit da wie ein Tag.

/**
 * Teilung nach 1-2-5 über [min, max] mit höchstens etwa `ziel` Strichen.
 * @param {number} min @param {number} max @param {number} [ziel]
 * @returns {{ von: number, bis: number, werte: number[] }}
 */
export function schoeneTeilung(min, max, ziel = 5) {
  if (!(max > min)) { const d = Math.abs(max) * 0.1 || 1; min -= d; max += d; }
  const roh = (max - min) / Math.max(1, ziel - 1);
  const p = 10 ** Math.floor(Math.log10(roh));
  const schritt = [1, 2, 5, 10].map(f => f * p).find(x => x >= roh * 0.999) ?? 10 * p;
  const von = Math.floor(min / schritt + 1e-9) * schritt, bis = Math.ceil(max / schritt - 1e-9) * schritt;
  const werte = [];
  for (let i = 0; von + i * schritt <= bis + schritt / 2; i++) werte.push(Number((von + i * schritt).toPrecision(12)));
  return { von, bis, werte };
}

/** Zeitpunkt aus „YYYY-MM-DD“, „YYYY-MM“, „YYYY-MM-DD HH“ oder ISO; sonst NaN. */
export function zeitpunkt(s) {
  const t = String(s ?? '');
  let m;
  if ((m = /^(\d{4})-(\d{2})$/.exec(t))) return new Date(+m[1], +m[2] - 1, 1).getTime();
  if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}))?$/.exec(t))) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0)).getTime();
  return new Date(t).getTime();
}

/**
 * Striche einer Zeitachse mit einheitlicher Beschriftung: Stunden an einem
 * Tag, Tage bis drei Monate („29. Okt.“), darüber Monate („Nov. 25“).
 * @param {number} von @param {number} bis  Millisekunden
 * @param {number} maxStriche
 * @returns {{ t: number, text: string }[]}
 */
export function zeitTeilung(von, bis, maxStriche) {
  const TAG = 864e5, spanne = Math.max(1, bis - von), max = Math.max(2, maxStriche);
  const fmt = (o) => new Intl.DateTimeFormat(locale(), o);
  const raus = [];
  if (spanne <= 2 * TAG) {
    const h = [1, 2, 3, 6, 12, 24].find(x => spanne / (x * 36e5) <= max) ?? 24;
    const f = fmt({ hour: '2-digit', minute: '2-digit' });
    for (let t = Math.ceil(von / (h * 36e5)) * h * 36e5; t <= bis; t += h * 36e5) raus.push({ t, text: f.format(t) });
  } else if (spanne <= 92 * TAG) {
    const n = [1, 2, 7, 14].find(x => spanne / (x * TAG) <= max) ?? 14;
    const f = fmt({ day: 'numeric', month: 'short' });
    const d = new Date(von); d.setHours(0, 0, 0, 0); if (d.getTime() < von) d.setDate(d.getDate() + 1);
    for (; d.getTime() <= bis; d.setDate(d.getDate() + n)) raus.push({ t: d.getTime(), text: f.format(d) });
  } else {
    const monate = spanne / (30.44 * TAG);
    const n = [1, 2, 3, 6, 12, 24].find(x => monate / x <= max) ?? 24;
    const f = fmt({ month: 'short', year: '2-digit' });
    const d = new Date(von); d.setDate(1); d.setHours(0, 0, 0, 0);
    if (d.getTime() < von) d.setMonth(d.getMonth() + 1);
    while (d.getMonth() % n) d.setMonth(d.getMonth() + 1);
    for (; d.getTime() <= bis; d.setMonth(d.getMonth() + n)) raus.push({ t: d.getTime(), text: f.format(d) });
  }
  // Passt auch der grösste Schritt nicht (schmales Telefon), nur jeden k-ten Strich.
  if (raus.length > max) { const k = Math.ceil(raus.length / max); return raus.filter((_, i) => i % k === 0); }
  return raus;
}

/** Eine Beschriftung am rechten Rand endet dort, statt halb hinauszuragen. */
function randAnker(x, rechts) { return x > rechts - 28 ? 'end' : 'middle'; }

// ── Gemeinsame Teile der beiden Diagramme ───────────────────────────────────
// Preisverlauf und Wertdiagramm teilen Achsen, Einstand-Linie und Fadenkreuz,
// damit dieselbe Grösse in beiden gleich aussieht und gleich bedient wird.

/** Betrag an der y-Achse: mit Währung, Nachkommastellen nur bei Schritten unter 1. */
export function achsenBetrag(v, schritt, cur) {
  const stellen = schritt > 0 && schritt < 1 ? 2 : 0;
  return new Intl.NumberFormat(locale(), { style: 'currency', currency: cur || CURRENCY || 'EUR',
    minimumFractionDigits: stellen, maximumFractionDigits: stellen }).format(v);
}

/**
 * Gitter und Beschriftung der y-Achse. Beginnt sie nicht bei 0, trägt sie unten
 * einen Achsenbruch: Sonst läse man eine Bewegung von 5 % als Verdopplung.
 */
function yAchse(teilung, min, yOf, links, rechts, oben, unten, cur) {
  const schritt = teilung.werte.length > 1 ? teilung.werte[1] - teilung.werte[0] : 1;
  const striche = teilung.werte.filter(v => v >= min).map(v => {
    const y = yOf(v).toFixed(1);
    return `<line x1="${links}" y1="${y}" x2="${rechts}" y2="${y}" stroke="var(--mut)" stroke-opacity=".22" stroke-width="1"/>
      <text x="${links - 8}" y="${(yOf(v) + 4).toFixed(1)}" font-size="12" fill="var(--mut)" text-anchor="end" font-family="inherit">${esc(achsenBetrag(v, schritt, cur))}</text>`;
  }).join('');
  const achse = `<line x1="${links}" y1="${oben}" x2="${links}" y2="${unten}" stroke="var(--mut)" stroke-width="1"/>`;
  const bruch = min > 0
    ? `<g class="achsenbruch"><rect x="${links - 6}" y="${unten - 12}" width="12" height="7" fill="var(--sur)"/>
        <path d="M${links - 6},${unten - 9} l12,-4 M${links - 6},${unten - 4} l12,-4" stroke="var(--mut)" stroke-width="1.2" fill="none"/></g>`
    : '';
  return striche + achse + bruch;
}

/** Waagrechte, gestrichelte Bezugslinie (Einstand, Kaufpreis) mit Beschriftung am rechten Ende. */
function bezugsLinie(wert, yOf, links, rechts, text, farbe = 'var(--txt)') {
  const y = yOf(wert);
  return `<g class="einstand-linie"><line x1="${links}" y1="${y.toFixed(1)}" x2="${rechts}" y2="${y.toFixed(1)}" stroke="${farbe}" stroke-width="1.5" stroke-dasharray="6 4"/>
    <text x="${rechts - 4}" y="${(y - 6).toFixed(1)}" font-size="12" font-weight="600" fill="var(--txt)" text-anchor="end" font-family="inherit"
      paint-order="stroke" stroke="var(--sur)" stroke-width="4" stroke-linejoin="round">${esc(text)}</text></g>`;
}

/**
 * Das Fadenkreuz: unsichtbar, bis jemand zeigt, tippt oder mit den Pfeiltasten
 * wandert. Die Punkte stehen als JSON am SVG (x in viewBox-Einheiten, je Reihe
 * ein y, dazu die Beschriftung), damit eine Steuerung für alle Diagramme reicht.
 */
function fadenkreuzTeile(punkte, farben, oben, unten) {
  const json = esc(JSON.stringify(punkte));
  const kreise = farben.map(f => `<circle class="fk-punkt" r="4.5" fill="${f}" stroke="var(--sur)" stroke-width="2"/>`).join('');
  return {
    attr: ` data-punkte="${json}" tabindex="0"`,
    svg: `<g class="fadenkreuz" visibility="hidden" pointer-events="none">
      <line class="fk-linie" y1="${oben}" y2="${unten}" stroke="var(--txt)" stroke-width="1"/>${kreise}
      <rect class="fk-schild" rx="6" height="0" width="0" fill="var(--txt)"/>
      <text class="fk-text" font-size="12" font-weight="600" fill="var(--sur)" font-family="inherit"></text></g>`,
  };
}

/** Die Punkte am SVG, einmal gelesen. */
function punkteVon(svg) {
  if (!svg._punkte) { try { svg._punkte = JSON.parse(svg.dataset.punkte || '[]'); } catch (_) { svg._punkte = []; } }
  return svg._punkte;
}

/** Fadenkreuz eines Diagramms auf Punkt i setzen (null blendet es aus). */
export function zeigeFadenkreuz(svg, i, ansagen = false) {
  const g = svg?.querySelector('.fadenkreuz');
  if (!g) return;
  const punkte = punkteVon(svg);
  if (i == null || !punkte.length) { g.setAttribute('visibility', 'hidden'); return; }
  i = Math.max(0, Math.min(punkte.length - 1, i));
  svg._fk = i;
  const p = punkte[i];
  const linie = g.querySelector('.fk-linie');
  linie.setAttribute('x1', p.x); linie.setAttribute('x2', p.x);
  g.querySelectorAll('.fk-punkt').forEach((c, k) => {
    const y = p.y[k];
    c.setAttribute('visibility', y == null ? 'hidden' : 'visible');
    if (y != null) { c.setAttribute('cx', p.x); c.setAttribute('cy', y); }
  });
  const text = g.querySelector('.fk-text');
  text.replaceChildren(...p.t.map((zeile, k) => {
    const ts = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    ts.setAttribute('dy', k ? '16' : '0');
    if (k) ts.setAttribute('font-weight', '400');
    ts.textContent = zeile;
    return ts;
  }));
  const breiteText = Math.max(...[...text.children].map(ts => (typeof ts.getComputedTextLength === 'function' && ts.getComputedTextLength()) || ts.textContent.length * 7));
  const b = breiteText + 16, h = 16 * p.t.length + 8;
  const vb = svg.viewBox?.baseVal;
  const W = vb?.width || 700;
  const x = p.x + 12 + b > W ? p.x - 12 - b : p.x + 12;
  const y0 = Number(g.querySelector('.fk-linie').getAttribute('y1')) || 0;
  const schild = g.querySelector('.fk-schild');
  schild.setAttribute('x', x); schild.setAttribute('y', y0); schild.setAttribute('width', b); schild.setAttribute('height', h);
  text.setAttribute('x', x + 8); text.setAttribute('y', y0 + 17);
  text.querySelectorAll('tspan').forEach(ts => ts.setAttribute('x', x + 8));
  g.setAttribute('visibility', 'visible');
  if (ansagen) {
    let ansage = svg.parentElement?.querySelector(':scope > .diagramm-ansage');
    if (!ansage && svg.parentElement) {
      ansage = document.createElement('span');
      ansage.className = 'vh diagramm-ansage'; ansage.setAttribute('aria-live', 'polite');
      svg.after(ansage);
    }
    if (ansage) ansage.textContent = p.t.join(', ');
  }
}

function naechsterPunkt(svg, clientX) {
  const punkte = punkteVon(svg);
  const r = svg.getBoundingClientRect();
  const W = svg.viewBox?.baseVal?.width || r.width || 1;
  const x = (clientX - r.left) * W / (r.width || 1);
  let best = 0;
  punkte.forEach((p, k) => { if (Math.abs(p.x - x) < Math.abs(punkte[best].x - x)) best = k; });
  return best;
}

const diagrammVon = (e) => e.target?.closest?.('svg[data-punkte]');

for (const art of ['pointermove', 'pointerdown']) {
  document.addEventListener(art, (e) => {
    const svg = diagrammVon(e);
    if (svg) zeigeFadenkreuz(svg, naechsterPunkt(svg, /** @type {PointerEvent} */ (e).clientX));
  });
}

document.addEventListener('pointerout', (e) => {
  const svg = diagrammVon(e);
  if (svg && !svg.contains(e.relatedTarget) && document.activeElement !== svg && e.pointerType !== 'touch') zeigeFadenkreuz(svg, null);
});

document.addEventListener('focusin', (e) => {
  const svg = diagrammVon(e);
  if (svg) zeigeFadenkreuz(svg, svg._fk ?? punkteVon(svg).length - 1, true);
});

document.addEventListener('focusout', (e) => { const svg = diagrammVon(e); if (svg) zeigeFadenkreuz(svg, null); });

document.addEventListener('keydown', (e) => {
  const svg = diagrammVon(e);
  if (!svg) return;
  const n = punkteVon(svg).length, i = svg._fk ?? n - 1;
  const ziel = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: n - 1 }[e.key];
  if (ziel === undefined) return;
  e.preventDefault();
  zeigeFadenkreuz(svg, ziel, true);
});

/**
 * Preisverlauf mit zwei Linien (neu und gebraucht) auf gemeinsamer Skala. Die
 * x-Position kommt vom Datum, nicht vom Index: Gebrauchtpreise setzen oft
 * später ein, und gestreckte Reihen zeigten einen Vergleich, den es nicht gibt.
 * @param {{ chart?: any, history_new?: any[], history_used?: any[], by_condition?: Record<string, any> }} data
 *   Antwort von /v1/sets/:nummer/price-history
 * @param {string} [uid]  Kürzel für die Verlaufs-IDs im SVG
 * @param {number} [breite]
 * @returns {string} SVG-Markup oder ein Hinweistext
 */
export function priceChartSVG(data, uid = String(Math.random()).slice(2, 8), breite = 700) {
  // Erwartet die fertigen Diagrammdaten des Servers (src/finanzen/chartData.ts):
  //   { values: [ { name, values: [{x, y}], firstRealIndex } ], x: [...] }
  const NAMES  = { N: t('common.condition_new'), U: t('common.condition_used') };
  // Farben aus dem Design; var() greift in inline-SVG auch in stroke und stop-color.
  const COLORS = { N: 'var(--chart-new)', U: 'var(--chart-used)' };

  const chart = data?.chart;
  const axis  = chart?.x || [];
  // Vor firstRealIndex stehen aufgefüllte Nullen; gezeichnet ergäben sie einen Kurssturz.
  // Der Kaufpreis am Kauftag ist kein Marktpreis: Er steht als Punkt und
  // Bezugslinie da, nicht als Anfang der Kurve (UI-Prüfung 6, M4).
  const kaufTage = (k) => new Set(((k === 'U' ? data?.history_used : data?.history_new) || [])
    .filter(p => p?.is_purchase_price).map(p => String(p.recorded_at)));
  const series = (chart?.values || [])
    .map(sd => { const tage = kaufTage(sd.name); return {
      key: sd.name,
      name: NAMES[sd.name] || sd.name,
      color: COLORS[sd.name] || 'var(--mut)',
      pts: (sd.values || []).slice(sd.firstRealIndex ?? 0).filter(pt => pt.y > 0 && !tage.has(String(pt.x))),
      kauf: Number(data?.by_condition?.[sd.name]?.purchase_price) || 0,
      kaufTag: [...tage][0] || null,
    }; })
    .filter(sd => sd.pts.length > 0);

  if (!series.length || axis.length < 2) {
    return `<span data-stil="color:var(--mut);font-size:var(--fs-1)">${t('detail.no_history')}</span>`;
  }

  const W = breite, H = 200, PAD = { l: 76, r: 14, t: 12, b: 46 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b, unten = PAD.t + ih;

  const toTime = zeitpunkt;
  const first = axis[0], last = axis[axis.length - 1];
  const span = Math.max(1, toTime(last) - toTime(first));
  const xOf = d => PAD.l + ((toTime(d) - toTime(first)) / span) * iw;

  const kaeufe = series.filter(sd => sd.kauf > 0);
  const vals = [...series.flatMap(sd => sd.pts.map(p => p.y)), ...kaeufe.map(sd => sd.kauf)];
  const teilung = schoeneTeilung(Math.min(...vals), Math.max(...vals), 4);
  const min = Math.max(0, teilung.von), max = teilung.bis, range = max - min || 1;
  const yOf = v => PAD.t + ih - ((v - min) / range) * ih;

  const parts = series.map((sd, i) => {
    const pts = sd.pts.map(p => `${xOf(p.x).toFixed(1)},${yOf(p.y).toFixed(1)}`);
    if (pts.length < 2) {
      const [cx, cy] = pts[0].split(',');
      return `<circle cx="${cx}" cy="${cy}" r="3.5" fill="${sd.color}"/>`;
    }
    // Eindeutige Verlaufs-ID je Diagramm, sonst nähme ein zweites SVG den ersten Verlauf.
    const gid = `pg-${uid}-${i}`;
    const area = `${xOf(sd.pts[0].x).toFixed(1)},${unten} ${pts.join(' ')} ${xOf(sd.pts[sd.pts.length-1].x).toFixed(1)},${unten}`;
    return `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${sd.color}" stop-opacity=".16"/>
        <stop offset="100%" stop-color="${sd.color}" stop-opacity="0"/>
      </linearGradient></defs>
      <polygon points="${area}" fill="url(#${gid})"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="${sd.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');

  const kaufLinien = kaeufe.map(sd => bezugsLinie(sd.kauf, yOf, PAD.l, W - PAD.r,
    `${tRaw('detail.purchase_price')}${series.length > 1 ? ' ' + sd.name : ''} ${fmtN(sd.kauf, CURRENCY)}`, sd.color)).join('');

  const kaufPunkte = kaeufe.filter(sd => sd.kaufTag).map(sd =>
    `<circle cx="${xOf(sd.kaufTag).toFixed(1)}" cy="${yOf(sd.kauf).toFixed(1)}" r="4.5" fill="var(--sur)" stroke="${sd.color}" stroke-width="2" class="kaufpunkt"><title>${esc(tRaw('detail.purchase_price'))} ${esc(fmtN(sd.kauf, CURRENCY))}</title></circle>`).join('');

  const fmtDay = d => fmtDatum(new Date(toTime(d)));
  const xTicks = zeitTeilung(toTime(first), toTime(last), Math.floor(iw / 80)).map(s => {
    const x = PAD.l + ((s.t - toTime(first)) / span) * iw;
    return `<text x="${x.toFixed(1)}" y="${H - 26}" font-size="12" fill="var(--mut)" text-anchor="${randAnker(x, W - PAD.r)}" font-family="inherit">${esc(s.text)}</text>`; }).join('');
  const legend = series.map((sd, i) =>
    `<g transform="translate(${PAD.l + i * 120}, ${H - 6})">
       <line x1="0" y1="-4" x2="16" y2="-4" stroke="${sd.color}" stroke-width="2.5" stroke-linecap="round"/>
       <text x="22" y="0" font-size="12" fill="var(--txt)" font-family="inherit">${esc(sd.name)}</text>
     </g>`).join('');

  // Fadenkreuz: je Tag der Achse die Werte aller Reihen, die dort einen Punkt haben.
  const tage = [...new Set(series.flatMap(sd => sd.pts.map(p => p.x)))].sort((a, b) => toTime(a) - toTime(b));
  const punkte = tage.map(tag => {
    const werte = series.map(sd => sd.pts.find(p => p.x === tag)?.y ?? null);
    return { x: +xOf(tag).toFixed(1), y: werte.map(v => v == null ? null : +yOf(v).toFixed(1)),
      t: [fmtDay(tag), ...series.map((sd, k) => werte[k] == null ? null : (series.length > 1 ? sd.name + ' ' : '') + fmtN(werte[k], CURRENCY)).filter(Boolean)] };
  });
  const fk = fadenkreuzTeile(punkte, series.map(sd => sd.color), PAD.t, unten);

  const zusammenfassung = [tRaw('detail.chart.summary', { titel: tRaw('detail.price_history'), von: fmtDay(first), bis: fmtDay(last),
    reihen: series.map(sd => tRaw('detail.chart.series', { name: sd.name, wert: fmtN(sd.pts[sd.pts.length - 1].y, CURRENCY) })).join('; ') }),
    min > 0 ? tRaw('chart.axis_from', { wert: fmtN(min, CURRENCY) }) : '', tRaw('chart.keys')].filter(Boolean).join('. ');
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="diagramm diagramm-preis" role="img" aria-label="${esc(zusammenfassung)}"${fk.attr}>
    ${yAchse(teilung, min, yOf, PAD.l, W - PAD.r, PAD.t, unten, CURRENCY)}
    ${parts}
    ${kaufLinien}
    ${kaufPunkte}
    ${xTicks}
    ${legend}
    ${fk.svg}
  </svg>`;
}

/**
 * @param {{ day: string, total: number, zeit?: number }[]} data
 *   `zeit` (ms) setzt die Punkte auf eine echte Zeitachse; fehlt sie, nach Index.
 * @param {number} [einstand] Summe der Kaufpreise; > 0 zeichnet die Einstand-Linie.
 */
export function portfolioChartSVG(data, period, breite = 700, einstand = 0, cur = CURRENCY){
  const W=breite, H=180, PAD={l:84,r:16,t:14,b:32};
  const iw=W-PAD.l-PAD.r, ih=H-PAD.t-PAD.b, unten=PAD.t+ih;
  const vals=data.map(d=>d.total||0);
  if(vals.length<2) return diagrammLeer();

  const mitEinstand = einstand > 0;
  const teilung = schoeneTeilung(Math.min(...vals, ...(mitEinstand ? [einstand] : [])), Math.max(...vals, ...(mitEinstand ? [einstand] : [])), 5);
  const min = Math.max(0, teilung.von), max = teilung.bis, range = max - min || 1;

  const color = 'var(--chart-new)';
  const n = vals.length;
  const mitZeit = data.every(d => Number.isFinite(d.zeit)) && data[n-1].zeit > data[0].zeit;
  const t0 = mitZeit ? data[0].zeit : 0, spanne = mitZeit ? data[n-1].zeit - t0 : 1;

  function pxZeit(t){ return PAD.l + (t - t0) / spanne * iw; }
  function px(i){ return mitZeit ? pxZeit(data[i].zeit) : PAD.l+(n===1 ? iw/2 : i/(n-1)*iw); }
  function py(v){ return PAD.t + ih - ((v-min)/range)*ih; }

  const pts  = vals.map((v,i)=>`${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const area = `${px(0).toFixed(1)},${unten} ${pts} ${px(n-1).toFixed(1)},${unten}`;

  // Je Beschriftung rund 70 px, damit sie sich am Telefon nicht überlappen.
  let xLabels = '';
  if (mitZeit) {
    xLabels = zeitTeilung(t0, data[n-1].zeit, Math.floor(iw/70)).map(s =>
      `<text x="${pxZeit(s.t).toFixed(1)}" y="${H-8}" text-anchor="${randAnker(pxZeit(s.t), W - PAD.r)}" font-size="12" fill="var(--mut)" font-family="inherit">${esc(s.text)}</text>`).join('');
  } else {
    const step  = Math.max(1, Math.ceil(n/Math.max(2, Math.min(7, Math.floor(iw/70)))));
    for(let i=0; i<n; i+=step) if (data[i].day)
      xLabels += `<text x="${px(i).toFixed(1)}" y="${H-8}" text-anchor="middle" font-size="12" fill="var(--mut)" font-family="inherit">${esc(data[i].day)}</text>`;
  }

  const wann = (i) => mitZeit ? fmtDatum(new Date(data[i].zeit)) : data[i].day;
  const letzter = `<circle cx="${px(n-1).toFixed(1)}" cy="${py(vals[n-1]).toFixed(1)}" r="4" fill="${color}" stroke="var(--sur)" stroke-width="1.5"/>`;
  const linie = mitEinstand ? bezugsLinie(einstand, py, PAD.l, W - PAD.r, `${tRaw('finance.stat.purchase')} ${fmtN(einstand, cur)}`) : '';
  const fk = fadenkreuzTeile(vals.map((v, i) => ({ x: +px(i).toFixed(1), y: [+py(v).toFixed(1)], t: [wann(i), fmtN(v, cur)] })), [color], PAD.t, unten);

  const zusammenfassung = [tRaw('finance.chart.summary', { titel: tRaw('finance.chart.label'),
    von: wann(0), bis: wann(n-1), start: fmtN(vals[0], cur), ende: fmtN(vals[n-1], cur) }),
    mitEinstand ? `${tRaw('finance.stat.purchase')} ${fmtN(einstand, cur)}` : '',
    min > 0 ? tRaw('chart.axis_from', { wert: fmtN(min, cur) }) : '', tRaw('chart.keys')].filter(Boolean).join('. ');
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="diagramm diagramm-wert" role="img" aria-label="${esc(zusammenfassung)}"${fk.attr}>
  <defs><linearGradient id="pcg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${color}" stop-opacity=".15"/>
    <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
  </linearGradient></defs>
  ${yAchse(teilung, min, py, PAD.l, W - PAD.r, PAD.t, unten, cur)}${xLabels}
  <polygon points="${area}" fill="url(#pcg)"/>
  <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${linie}${letzter}
  ${fk.svg}
</svg>`;
}

/** Leerzustand des Wertdiagramms (auch aus portfolioChartSVG). */
export function diagrammLeer(){
  return `<div class="diagramm-leer" role="status"><strong>${t('finance.chart.too_few_title')}</strong><span>${t('finance.chart.too_few_text')}</span></div>`;
}
