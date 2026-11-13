// Preisverlauf, Wertentwicklung und Marktpreiszeilen als SVG/HTML. Reine Darstellung ohne Abrufe; Set-Detail,
// Merkliste, Teile-Detail und Finanzen zeichnen damit dieselben Achsen und dasselbe Fadenkreuz.
import { CURRENCY } from './zustand.js';
import { G, setzeHtml } from './dom.js';
import { fmtDatum, fmtN } from './format.js';
import { detailZeile, pnlBadge } from './bausteine.js';
import { LANG, locale, t, tRaw } from '../i18n.js';
import { html, ungeprueft, verbinde } from './escapen.js';
import { fadenkreuzTeile } from './fadenkreuz.js';

/**
 * Marktpreis und Entwicklung je Zustand. Der Server liefert nur Zustände mit Erfassung; nach jedem Speichern
 * neu geladen, erscheint eine neue Zeile so von selbst.
 * @param {{ by_condition?: import('../../frontend-typen/vertrag').PriceByCondition }} ph
 */
export function renderMarketRows(ph, targetId = 'm-market-rows') {
  const el = G(targetId);
  if (!el) return;
  const LABEL = { N: t('common.condition_new'), U: t('common.condition_used') };
  /** @type {('N' | 'U')[]} */
  const ZUSTAENDE = ['N', 'U'];
  // Im Set-Dialog stehen Wert und Gewinn als Kopf oben: Sie sind, was man dort sucht.
  if (el.dataset.kopf) {
    const teile = ZUSTAENDE.flatMap(c => {
      const d = ph?.by_condition?.[c];
      return d ? [{ c, d }] : [];
    }).map(({ c, d }) => {
      const wert = d.market_price != null ? fmtN(d.market_price, CURRENCY) : tRaw('detail.kein_marktpreis');
      const pnl = pnlBadge(d.pnl_pct, d.purchase_price);
      const bezug =
        pnl && d.pnl_pct != null && !/pnl-geschenk/.test(String(pnl))
          ? html` <span class="wk-bezug">${tRaw('detail.zum_kaufpreis')}</span>`
          : '';
      return html`${html`<div class="wk-zeile"><span class="wk-label">${t('detail.market_price')} · ${LABEL[c]}</span>`}${html`<span class="wk-wert${d.market_price != null ? ' preis' : ''}">${wert}</span>${pnl ? html`<span class="wk-guv">${pnl}${bezug}</span>` : ''}</div>`}`;
    });
    setzeHtml(
      el,
      teile.length
        ? verbinde(teile)
        : html`<div class="wk-zeile"><span class="wk-label">${t('detail.market_price')}</span><span class="wk-wert text-mut">${tRaw('detail.kein_marktpreis')}</span></div>`,
    );
    return;
  }
  const rows = ZUSTAENDE.flatMap(c => {
    const d = ph?.by_condition?.[c];
    return d ? [{ c, d }] : [];
  }).map(({ c, d }) => {
    const price =
      d.market_price != null
        ? html`<span class="preis preis-stark">${fmtN(d.market_price, CURRENCY)}</span>`
        : html`<span data-stil="color:var(--mut)">—</span>`;
    const pnl = pnlBadge(d.pnl_pct, d.purchase_price);
    return detailZeile(html`${tRaw('detail.market_price')} (${LABEL[c]})`, html`${price}${pnl}`, {
      wertStil: 'display:flex;align-items:center;gap:8px',
    });
  });
  setzeHtml(el, verbinde(rows));
}

/**
 * Breite des Diagramms in Pixeln: Die viewBox bekommt die Breite des Behälters, damit eine Schrift von 12
 * Einheiten auch am Telefon 12 px groß ist (vorher 700 Einheiten auf 390 px, also rund 5 px). Ohne Layout
 * (jsdom) 700.
 * @param {Element|null} el
 */
export function diagrammBreite(el, ersatz = 700) {
  const b = Math.round(el?.clientWidth || 0);
  return b > 0 ? Math.max(220, Math.min(2400, b)) : ersatz;
}

/**
 * Die Schriftvergrösserung der Seite (200 % → 2). Schrift und Ränder der Diagramme wachsen damit; die Breite
 * bleibt die des Behälters, sonst schrumpfte das ganze Bild, statt der Schrift mehr Platz zu geben.
 */
export function schriftFaktor() {
  const wurzel =
    typeof getComputedStyle === 'function' && typeof document !== 'undefined'
      ? parseFloat(getComputedStyle(document.documentElement).fontSize)
      : 16;
  return Math.min(3, Math.max(1, (wurzel || 16) / 16));
}

/**
 * Platz links für die Beträge der y-Achse: so breit wie der längste, nicht fest.
 * @param {Teilung} teilung
 * @param {string} cur
 * @param {number} fs
 */
function achsenRand(teilung, cur, fs) {
  const schritt = teilung.werte.length > 1 ? teilung.werte[1] - teilung.werte[0] : 1;
  const laengste = Math.max(...teilung.werte.map(v => achsenBetrag(v, schritt, cur, fs >= 18).length));
  return Math.ceil(laengste * fs * 0.62 + fs * 1.2);
}

/**
 * Linker Rand und Lage der Achsenbeträge. Bliebe neben ihnen weniger als gut die Hälfte für die Kurve
 * (Telefon, grosse Schrift), stehen die Beträge innen über ihren Rasterlinien: Sonst blieben bei 320 px und
 * 200 % 15 px Kurve.
 * @param {Teilung} teilung
 * @param {string} cur
 * @param {number} fs
 * @param {number} W
 * @param {number} rechts
 */
function achsenLage(teilung, cur, fs, W, rechts) {
  const rand = achsenRand(teilung, cur, fs);
  const innen = W - rand - rechts < Math.max(160, W * 0.55);
  return { innen, links: innen ? Math.round(fs * 0.5) : rand };
}

// ── Achsen der Diagramme ─────────────────────────────────────────────────────
// Werte in Schritten von 1, 2 oder 5 mal einer Zehnerpotenz (4'219 / 4'441 liest niemand), die Zeit als echte
// Achse statt nach Index — sonst stünde ein Monat so breit da wie ein Tag.

/** Achsenteilung: erster und letzter Strich, dazwischen alle Werte. @typedef {{ von: number, bis: number, werte: number[] }} Teilung */

/**
 * Teilung nach 1-2-5 über [min, max] mit höchstens etwa `ziel` Strichen.
 * @param {number} min @param {number} max @param {number} [ziel]
 * @returns {Teilung}
 */
export function schoeneTeilung(min, max, ziel = 5) {
  if (!(max > min)) {
    const d = Math.abs(max) * 0.1 || 1;
    min -= d;
    max += d;
  }
  const roh = (max - min) / Math.max(1, ziel - 1);
  const p = 10 ** Math.floor(Math.log10(roh));
  const schritt = [1, 2, 5, 10].map(f => f * p).find(x => x >= roh * 0.999) ?? 10 * p;
  const von = Math.floor(min / schritt + 1e-9) * schritt,
    bis = Math.ceil(max / schritt - 1e-9) * schritt;
  const werte = [];
  for (let i = 0; von + i * schritt <= bis + schritt / 2; i++) werte.push(Number((von + i * schritt).toPrecision(12)));
  return { von, bis, werte };
}

/**
 * Zeitpunkt aus „YYYY-MM-DD“, „YYYY-MM“, „YYYY-MM-DD HH“ oder ISO; sonst NaN.
 * @param {string} s
 */
export function zeitpunkt(s) {
  const t = String(s ?? '');
  const monat = /^(\d{4})-(\d{2})$/.exec(t);
  if (monat) return new Date(+monat[1], +monat[2] - 1, 1).getTime();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}))?$/.exec(t);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0)).getTime();
  return new Date(t).getTime();
}

/**
 * Striche einer Zeitachse mit einheitlicher Beschriftung: Stunden an einem Tag, Tage bis drei Monate, darüber
 * Monate („Nov. 2025“). Tage auf Deutsch in Ziffern wie jedes Datum im Text („13.09.“ zu „13.09.2026“);
 * „13. Sept.“ daneben las sich wie ein zweites Format. Englisch mit Monatsnamen wie fmtDatum.
 * @param {number} von @param {number} bis  Millisekunden
 * @param {number} maxStriche
 * @returns {{ t: number, text: string }[]}
 */
export function zeitTeilung(von, bis, maxStriche) {
  const TAG = 864e5,
    spanne = Math.max(1, bis - von),
    max = Math.max(2, maxStriche);
  const fmt = (/** @type {Intl.DateTimeFormatOptions} */ o) => new Intl.DateTimeFormat(locale(), o);
  const raus = [];
  if (spanne <= 2 * TAG) {
    const h = [1, 2, 3, 6, 12, 24].find(x => spanne / (x * 36e5) <= max) ?? 24;
    const f = fmt({ hour: '2-digit', minute: '2-digit' });
    for (let t = Math.ceil(von / (h * 36e5)) * h * 36e5; t <= bis; t += h * 36e5) raus.push({ t, text: f.format(t) });
  } else if (spanne <= 92 * TAG) {
    const n = [1, 2, 7, 14].find(x => spanne / (x * TAG) <= max) ?? 14;
    const f = fmt(LANG === 'en' ? { day: 'numeric', month: 'short' } : { day: '2-digit', month: '2-digit' });
    const d = new Date(von);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() < von) d.setDate(d.getDate() + 1);
    for (; d.getTime() <= bis; d.setDate(d.getDate() + n)) raus.push({ t: d.getTime(), text: f.format(d) });
  } else {
    const monate = spanne / (30.44 * TAG);
    const n = [1, 2, 3, 6, 12, 24].find(x => monate / x <= max) ?? 24;
    const f = fmt({ month: 'short', year: 'numeric' });
    const d = new Date(von);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() < von) d.setMonth(d.getMonth() + 1);
    while (d.getMonth() % n) d.setMonth(d.getMonth() + 1);
    for (; d.getTime() <= bis; d.setMonth(d.getMonth() + n)) raus.push({ t: d.getTime(), text: f.format(d) });
  }
  // Passt auch der grösste Schritt nicht (schmales Telefon), nur jeden k-ten Strich.
  if (raus.length > max) {
    const k = Math.ceil(raus.length / max);
    return raus.filter((_, i) => i % k === 0);
  }
  return raus;
}

/**
 * Eine Beschriftung am Rand endet bzw. beginnt dort, statt halb hinauszuragen.
 * @param {number} x
 * @param {number} rechts
 */
function randAnker(x, rechts, f = 1) {
  return x > rechts - 28 * f ? 'end' : x < 28 * f ? 'start' : 'middle';
}

/**
 * Zeitachse: Striche, deren Beschriftung die vorige berühren würde, entfallen (schmal und grosse Schrift).
 * @param {{ x: number, text: string }[]} striche
 * @param {number} y
 * @param {number} rechts
 * @param {number} f
 * @param {number} fs
 */
function xBeschriftung(striche, y, rechts, f, fs) {
  let frei = -Infinity;
  return striche.map(({ x, text }) => {
    const anker = randAnker(x, rechts, f),
      breite = String(text).length * fs * 0.6;
    const links = anker === 'start' ? x : anker === 'end' ? x - breite : x - breite / 2;
    if (links < frei) return '';
    frei = links + breite + 8 * f;
    return html`<text x="${x.toFixed(1)}" y="${y}" font-size="${fs}" fill="var(--mut)" text-anchor="${anker}" font-family="inherit">${text}</text>`;
  });
}

// ── Gemeinsame Teile der beiden Diagramme ───────────────────────────────────
// Preisverlauf und Wertdiagramm teilen Achsen, Einstand-Linie und Fadenkreuz, damit dieselbe Grösse in beiden
// gleich aussieht und gleich bedient wird.

/**
 * Betrag an der y-Achse: mit Währung, Nachkommastellen nur bei Schritten unter 1.
 * @param {number} v
 * @param {number} schritt
 * @param {string} cur
 */
export function achsenBetrag(v, schritt, cur, kurz = false) {
  // Bei grosser Schrift Tausender kurz: „2 600 €“ nahm am Telefon die halbe Breite.
  if (kurz && schritt >= 100 && Math.abs(v) >= 1000) {
    const zeichen =
      new Intl.NumberFormat(locale(), { style: 'currency', currency: cur || CURRENCY || 'EUR' })
        .formatToParts(0)
        .find(p => p.type === 'currency')?.value || cur;
    return tRaw('chart.tausend', {
      zahl: new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(v / 1000),
      cur: zeichen,
    });
  }
  const stellen = schritt > 0 && schritt < 1 ? 2 : 0;
  return new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: cur || CURRENCY || 'EUR',
    minimumFractionDigits: stellen,
    maximumFractionDigits: stellen,
  }).format(v);
}

/**
 * Gitter und Beschriftung der y-Achse. Beginnt sie nicht bei 0, trägt sie unten einen Achsenbruch: Sonst läse
 * man eine Bewegung von 5 % als Verdopplung.
 * @param {Teilung} teilung
 * @param {number} min
 * @param {(v: number) => number} yOf
 * @param {number} links
 * @param {number} rechts
 * @param {number} oben
 * @param {number} unten
 * @param {string} cur
 */
function yAchse(teilung, min, yOf, links, rechts, oben, unten, cur, f = 1, innen = false) {
  const schritt = teilung.werte.length > 1 ? teilung.werte[1] - teilung.werte[0] : 1;
  const striche = teilung.werte
    .filter((/** @type {number} */ v) => v >= min)
    .map(v => {
      const y = yOf(v).toFixed(1);
      return html`${html`<line x1="${links}" y1="${y}" x2="${rechts}" y2="${y}" stroke="var(--mut)" stroke-opacity=".22" stroke-width="1"/>`}${innen ? '' : html`<text x="${links - 8 * f}" y="${(yOf(v) + 4 * f).toFixed(1)}" font-size="${12 * f}" fill="var(--mut)" text-anchor="end" font-family="inherit">${achsenBetrag(v, schritt, cur, f >= 1.5)}</text>`}`;
    });
  const achse = html`<line x1="${links}" y1="${oben}" x2="${links}" y2="${unten}" stroke="var(--mut)" stroke-width="1"/>`;
  const bruch =
    min > 0
      ? html`<g class="achsenbruch"><rect x="${links - 6}" y="${unten - 12}" width="12" height="7" fill="var(--sur)"/>
        <path d="M${links - 6},${unten - 9} l12,-4 M${links - 6},${unten - 4} l12,-4" stroke="var(--mut)" stroke-width="1.2" fill="none"/></g>`
      : '';
  return html`${striche}${achse}${bruch}`;
}

/**
 * Die Beträge innen (achsenLage): nur unterste und oberste Linie, nach der Kurve gezeichnet und mit Rand in
 * der Kartenfarbe; keiner dort, wo die Beschriftung einer Bezugslinie steht (`meiden`, y-Werte).
 * @param {Teilung} teilung
 * @param {number} min
 * @param {(v: number) => number} yOf
 * @param {number} links
 * @param {string} cur
 * @param {number} f
 * @param {number[]} [meiden]
 */
function yBetraegeInnen(teilung, min, yOf, links, cur, f, meiden = []) {
  const schritt = teilung.werte.length > 1 ? teilung.werte[1] - teilung.werte[0] : 1;
  const werte = teilung.werte.filter((/** @type {number} */ v) => v >= min);
  return [werte[0], werte[werte.length - 1]]
    .filter((v, i, a) => a.indexOf(v) === i)
    .filter(v => meiden.every(y => Math.abs(yOf(v) - y) > 30 * f))
    .map(
      v =>
        html`<text x="${links + 4 * f}" y="${(yOf(v) - 5 * f).toFixed(1)}" font-size="${12 * f}" fill="var(--mut)" font-family="inherit"
      paint-order="stroke" stroke="var(--sur)" stroke-width="${4 * f}" stroke-linejoin="round">${achsenBetrag(v, schritt, cur, f >= 1.5)}</text>`,
    );
}

/**
 * Zeilen für eine Beschriftung in `platz` px. 0,68 em je Zeichen: Mit 0,62 passte „Kaufpreis 205,00 €“
 * rechnerisch in eine Zeile und wurde links abgeschnitten.
 * @param {string} text @param {number} platz @param {number} f
 */
function umbrechen(text, platz, f) {
  const zeichen = 12 * f * 0.68;
  /** @type {string[]} */
  const zeilen = [];
  for (const wort of String(text).split(' ')) {
    const z = zeilen.length ? zeilen[zeilen.length - 1] + ' ' + wort : wort;
    if (zeilen.length && z.length * zeichen <= platz) zeilen[zeilen.length - 1] = z;
    else zeilen.push(wort);
  }
  return zeilen;
}

/**
 * Beschriftungen von Bezugslinien, die im Bild umbrächen, stehen unter dem Diagramm: Mehrzeilig lagen sie
 * über Kurve und Endpunkt. `hoehe` ist der Platz, den das Diagramm dafür unten anfügt.
 * @param {{ text: string, farbe: string }[]} eintraege @param {number} W @param {number} f
 */
function bezugsLegende(eintraege, W, f) {
  let y = 0;
  const teile = eintraege.map(e => {
    const zeilen = umbrechen(e.text, W - 8 - 22 * f, f);
    const oben = y;
    y += zeilen.length * 14 * f + 4 * f;
    return { e, zeilen, oben };
  });
  /** @param {number} start Oberkante des Bereichs */
  const svg = start =>
    teile.map(({ e, zeilen, oben }) => {
      const b = start + oben + 12 * f,
        x = 4 + 22 * f;
      const tspans = zeilen.map((z, i) => (i ? html`<tspan x="${x}" dy="${14 * f}">${z}</tspan>` : z));
      return html`<g class="bezug-legende"><line x1="4" y1="${(b - 4 * f).toFixed(1)}" x2="${4 + 16 * f}" y2="${(b - 4 * f).toFixed(1)}" stroke="${e.farbe}" stroke-width="1.5" stroke-dasharray="6 4"/>
      <text x="${x}" y="${b.toFixed(1)}" font-size="${12 * f}" font-weight="600" fill="var(--txt)" font-family="inherit">${tspans}</text></g>`;
    });
  return { hoehe: teile.length ? y + 6 * f : 0, svg };
}

/** Passt die Beschriftung einer Bezugslinie in eine Zeile über der Fläche? @param {string} text @param {number} links @param {number} rechts @param {number} f */
const imBild = (text, links, rechts, f) => umbrechen(text, rechts - links - 8, f).length === 1;

/**
 * Waagrechte, gestrichelte Bezugslinie (Einstand, Kaufpreis) mit Beschriftung am rechten Ende. `endeY` ist
 * die Höhe der Kurve dort: Läge die Schrift auf ihr, steht sie auf der anderen Seite der Linie.
 * @param {number} wert
 * @param {(v: number) => number} yOf
 * @param {number} links
 * @param {number} rechts
 * @param {string} text
 * @param {string} [farbe]
 */
function bezugsLinie(
  wert,
  yOf,
  links,
  rechts,
  text,
  farbe = 'var(--txt)',
  /** @type {number | null} */ endeY = null,
  /** @type {number} */ f = 1,
  /** @type {number} */ unten = Infinity,
) {
  const y = yOf(wert);
  const linie = html`<line x1="${links}" y1="${y.toFixed(1)}" x2="${rechts}" y2="${y.toFixed(1)}" stroke="${farbe}" stroke-width="1.5" stroke-dasharray="6 4"/>`;
  if (!text) return html`<g class="einstand-linie">${linie}</g>`;
  const zeilen = umbrechen(text, rechts - links - 8, f);
  const hoehe = 14 * f * (zeilen.length - 1);
  // Über der Linie, ausser die Kurve endet dort oder oben ist kein Platz (Linie am oberen Rand).
  const obenKeinPlatz = y - 6 * f - hoehe - 12 * f < 0; // 12 px je Faktor: die Oberlänge der Schrift
  // Darunter nur, wenn es dort Platz hat: Zwei Zeilen am unteren Rand liefen sonst aus dem Diagramm.
  const darunter =
    (endeY != null && endeY < y && y - endeY < 26 * f + hoehe && y + 16 * f + hoehe + 4 * f <= unten) || obenKeinPlatz;
  const erste = darunter ? y + 16 * f : y - 6 * f - hoehe;
  const tspans = zeilen.map((z, i) => (i ? html`<tspan x="${rechts - 4}" dy="${14 * f}">${z}</tspan>` : z));
  return html`<g class="einstand-linie">${linie}
    <text x="${rechts - 4}" y="${erste.toFixed(1)}" font-size="${12 * f}" font-weight="600" fill="var(--txt)" text-anchor="end" font-family="inherit"
      paint-order="stroke" stroke="var(--sur)" stroke-width="4" stroke-linejoin="round">${tspans}</text></g>`;
}

/** Antwort von /v1/…/price-history, soweit die Diagramme sie lesen.
 * @typedef {Partial<Pick<import('../../frontend-typen/vertrag').PriceHistoryResponse, 'chart' | 'history_new' | 'history_used' | 'by_condition'>> | null | undefined} Preisdaten */

/**
 * Die Reihen des Preisverlaufs je Zustand, aus den Diagrammdaten des Servers (src/finanzen/chartData.ts). Vor
 * firstRealIndex stehen aufgefüllte Nullen; der Kaufpreis am Kauftag ist kein Marktpreis und steht als Punkt
 * da.
 * @param {Preisdaten} data @returns {{ key: string, name: string, color: string, pts: { x: string, y: number }[], kauf: number, kaufTag: string | null }[]}
 */
function preisReihen(data) {
  /** @type {Record<string, string>} */
  const NAMES = { N: tRaw('common.condition_new'), U: tRaw('common.condition_used') };
  // Farben aus dem Design; var() greift in inline-SVG auch in stroke und stop-color.
  /** @type {Record<string, string>} */
  const COLORS = { N: 'var(--chart-new)', U: 'var(--chart-used)' };
  const kaufTage = (/** @type {string} */ k) =>
    new Set(
      ((k === 'U' ? data?.history_used : data?.history_new) || [])
        .filter(p => p?.is_purchase_price)
        .map(p => String(p.recorded_at)),
    );
  return (data?.chart?.values || [])
    .map(sd => {
      const tage = kaufTage(sd.name);
      return {
        key: sd.name,
        name: NAMES[sd.name] || sd.name,
        color: COLORS[sd.name] || 'var(--mut)',
        pts: (sd.values || []).slice(sd.firstRealIndex ?? 0).filter(pt => pt.y > 0 && !tage.has(String(pt.x))),
        kauf: Number(sd.name === 'N' || sd.name === 'U' ? data?.by_condition?.[sd.name]?.purchase_price : 0) || 0,
        kaufTag: [...tage][0] || null,
      };
    })
    .filter(sd => sd.pts.length > 0);
}

/**
 * Eine Reihe als Linie mit Verlaufsfläche; ein einzelner Punkt als Kreis.
 * `gid` ist je Diagramm eindeutig, sonst nähme ein zweites SVG den ersten Verlauf.
 * @param {{ color: string, pts: { x: string, y: number }[] }} sd @param {string} gid
 * @param {(d: string) => number} xOf @param {(v: number) => number} yOf @param {number} unten @param {number} f
 */
function preisLinie(sd, gid, xOf, yOf, unten, f) {
  const pts = sd.pts.map(p => `${xOf(p.x).toFixed(1)},${yOf(p.y).toFixed(1)}`);
  if (pts.length < 2) {
    const [cx, cy] = pts[0].split(',');
    return html`<circle cx="${cx}" cy="${cy}" r="${3.5 * f}" fill="${sd.color}"/>`;
  }
  const area = `${xOf(sd.pts[0].x).toFixed(1)},${unten} ${pts.join(' ')} ${xOf(sd.pts[sd.pts.length - 1].x).toFixed(1)},${unten}`;
  return html`<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${sd.color}" stop-opacity=".16"/>
        <stop offset="100%" stop-color="${sd.color}" stop-opacity="0"/>
      </linearGradient></defs>
      <polygon points="${area}" fill="url(#${gid})"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="${sd.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
}

/** Kennungen der Verläufe im SVG; ein Zähler genügt, sie müssen nur auf der Seite eindeutig sein. */
let _naechsteKennung = 0;

/**
 * Preisverlauf mit zwei Linien (neu und gebraucht) auf gemeinsamer Skala. Die x-Position kommt vom Datum,
 * nicht vom Index: Gebrauchtpreise setzen oft später ein, und gestreckte Reihen zeigten einen Vergleich, den
 * es nicht gibt.
 * @param {Preisdaten} data
 *   Antwort von /v1/sets/:nummer/price-history
 * @param {string} [uid]  Kürzel für die Verlaufs-IDs im SVG
 * @param {number} [breite]
 * @returns {import('./escapen.js').SicheresHtml} SVG-Markup oder ein Hinweistext
 */
export function priceChartSVG(data, uid = `p${++_naechsteKennung}`, breite = 700) {
  const axis = data?.chart?.x || [];
  const series = preisReihen(data);

  if (!series.length || axis.length < 2) {
    return html`<span data-stil="color:var(--mut);font-size:var(--fs-1)">${tRaw('detail.no_history')}</span>`;
  }

  const toTime = zeitpunkt;
  // Die Achse beginnt beim ersten Marktpreis; ein früherer Kauf steht als Punkt am linken Rand.
  const ersterPunkt = series.flatMap(sd => sd.pts.map(p => p.x)).sort((a, b) => toTime(a) - toTime(b))[0];
  const first = toTime(ersterPunkt) < toTime(axis[axis.length - 1]) ? ersterPunkt : axis[0],
    last = axis[axis.length - 1];
  const span = Math.max(1, toTime(last) - toTime(first));

  const kaeufe = series.filter(sd => sd.kauf > 0);
  const vals = [...series.flatMap(sd => sd.pts.map(p => p.y)), ...kaeufe.map(sd => sd.kauf)];
  const teilung = schoeneTeilung(Math.min(...vals), Math.max(...vals), 4);
  const min = Math.max(0, teilung.von),
    max = teilung.bis,
    range = max - min || 1;
  const f = schriftFaktor(),
    fs = 12 * f;
  const W = breite;
  const lage = achsenLage(teilung, CURRENCY, fs, W, 14 * f);
  const PAD = { l: lage.links, r: lage.innen ? 6 * f : 14 * f, t: lage.innen ? 22 * f : 12 * f, b: 46 * f };
  const kaufText = (/** @type {{ name: string, kauf: number }} */ sd) =>
    `${tRaw('detail.purchase_price')}${series.length > 1 ? ' ' + sd.name : ''} ${fmtN(sd.kauf, CURRENCY)}`;
  const legende = bezugsLegende(
    kaeufe
      .filter(sd => !imBild(kaufText(sd), PAD.l, W - PAD.r, f))
      .map(sd => ({ text: kaufText(sd), farbe: sd.color })),
    W,
    f,
  );
  const hKurve = Math.round(200 * (1 + (f - 1) * 0.6)),
    H = hKurve + legende.hoehe;
  PAD.b += legende.hoehe;
  const iw = W - PAD.l - PAD.r,
    ih = H - PAD.t - PAD.b,
    unten = PAD.t + ih;
  const yOf = (/** @type {number} */ v) => PAD.t + ih - ((v - min) / range) * ih;
  const xOf = (/** @type {string} */ d) => PAD.l + ((toTime(d) - toTime(first)) / span) * iw;

  const parts = series.map((sd, i) => preisLinie(sd, `pg-${uid}-${i}`, xOf, yOf, unten, f));

  const kaufLinien = kaeufe.map(sd =>
    bezugsLinie(
      sd.kauf,
      yOf,
      PAD.l,
      W - PAD.r,
      imBild(kaufText(sd), PAD.l, W - PAD.r, f) ? kaufText(sd) : '',
      sd.color,
      yOf(sd.pts[sd.pts.length - 1].y),
      f,
      hKurve,
    ),
  );

  const kaufPunkte = kaeufe
    .flatMap(sd => (sd.kaufTag ? [{ ...sd, kaufTag: sd.kaufTag }] : []))
    .map(
      sd =>
        html`<circle cx="${Math.max(PAD.l, xOf(sd.kaufTag)).toFixed(1)}" cy="${yOf(sd.kauf).toFixed(1)}" r="${4.5 * f}" fill="var(--sur)" stroke="${sd.color}" stroke-width="2" class="kaufpunkt"><title>${tRaw('detail.purchase_price')} ${fmtN(sd.kauf, CURRENCY)}</title></circle>`,
    );

  const fmtDay = (/** @type {string} */ d) => fmtDatum(new Date(toTime(d)));
  const xTicks = xBeschriftung(
    zeitTeilung(toTime(first), toTime(last), Math.floor(iw / (80 * f))).map(s => ({
      x: PAD.l + ((s.t - toTime(first)) / span) * iw,
      text: s.text,
    })),
    hKurve - 26 * f,
    W - PAD.r,
    f,
    fs,
  );
  const legend = series.map(
    (sd, i) =>
      // Ab dem linken Rand statt ab der Achse: Bei grosser Schrift ist der Achsenrand so breit, dass „Neuware“ sonst rechts abbricht.
      html`<g transform="translate(${4 + i * Math.min(120 * f, (W - 8) / series.length)}, ${hKurve - 6 * f})">
       <line x1="0" y1="${-4 * f}" x2="${16 * f}" y2="${-4 * f}" stroke="${sd.color}" stroke-width="2.5" stroke-linecap="round"/>
       <text x="${22 * f}" y="0" font-size="${fs}" fill="var(--txt)" font-family="inherit">${sd.name}</text>
     </g>`,
  );

  // Fadenkreuz: je Tag der Achse die Werte aller Reihen, die dort einen Punkt haben.
  const tage = [...new Set(series.flatMap(sd => sd.pts.map(p => p.x)))].sort((a, b) => toTime(a) - toTime(b));
  const punkte = tage.map(tag => {
    const werte = series.map(sd => sd.pts.find(p => p.x === tag)?.y ?? null);
    return {
      x: +xOf(tag).toFixed(1),
      y: werte.map(v => (v == null ? null : +yOf(v).toFixed(1))),
      t: [
        fmtDay(tag),
        ...series
          .map((sd, k) =>
            werte[k] == null ? null : (series.length > 1 ? sd.name + ' ' : '') + fmtN(werte[k], CURRENCY),
          )
          .filter(z => z !== null),
      ],
    };
  });
  const fk = fadenkreuzTeile(
    punkte,
    series.map(sd => sd.color),
    PAD.t,
    unten,
    f,
  );

  const zusammenfassung = [
    tRaw('detail.chart.summary', {
      titel: tRaw('detail.price_history'),
      von: fmtDay(first),
      bis: fmtDay(last),
      reihen: series
        .map(sd => tRaw('detail.chart.series', { name: sd.name, wert: fmtN(sd.pts[sd.pts.length - 1].y, CURRENCY) }))
        .join('; '),
    }),
    min > 0 ? tRaw('chart.axis_from', { wert: fmtN(min, CURRENCY) }) : '',
    tRaw('chart.keys'),
  ]
    .filter(Boolean)
    .join('. ');
  return html`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="diagramm diagramm-preis" role="img" aria-label="${zusammenfassung}" data-flaeche="${iw.toFixed(0)}"${ungeprueft(fk.attr)}>
    ${yAchse(teilung, min, yOf, PAD.l, W - PAD.r, PAD.t, unten, CURRENCY, f, lage.innen)}
    ${parts}
    ${kaufLinien}
    ${kaufPunkte}
    ${
      lage.innen
        ? yBetraegeInnen(
            teilung,
            min,
            yOf,
            PAD.l,
            CURRENCY,
            f,
            kaeufe.map(sd => yOf(sd.kauf)),
          )
        : ''
    }
    ${xTicks}
    ${legend}${legende.svg(hKurve)}
    ${fk.svg}
  </svg>`;
}

/**
 * @param {{ day: string, total: number, zeit?: number }[]} data
 *   `zeit` (ms) setzt die Punkte auf eine echte Zeitachse; fehlt sie, nach Index.
 * @param {number} [einstand] Summe der Kaufpreise; > 0 zeichnet die Einstand-Linie.
 * @param {string} [einstandText] Name der Einstand-Linie
 * @param {string} _period
 */
export function portfolioChartSVG(
  data,
  _period,
  breite = 700,
  einstand = 0,
  cur = CURRENCY,
  einstandText = tRaw('finance.stat.purchase'),
) {
  const vals = data.map(d => d.total || 0);
  if (vals.length < 2) return diagrammLeer();

  const mitEinstand = einstand > 0;
  const teilung = schoeneTeilung(
    Math.min(...vals, ...(mitEinstand ? [einstand] : [])),
    Math.max(...vals, ...(mitEinstand ? [einstand] : [])),
    5,
  );
  const min = Math.max(0, teilung.von),
    max = teilung.bis,
    range = max - min || 1;
  const f = schriftFaktor(),
    fs = 12 * f;
  const W = breite,
    lage = achsenLage(teilung, cur, fs, W, 16 * f);
  const PAD = { l: lage.links, r: lage.innen ? 6 * f : 16 * f, t: lage.innen ? 24 * f : 14 * f, b: 32 * f };
  // Schmal nur „Kaufpreis“: Der Zusatz („nur bewertete Posten“) steht in der Kennzahl darunter.
  const bezugText = mitEinstand
    ? `${W < 560 ? tRaw('finance.chart.kaufpreis') : einstandText} ${fmtN(einstand, cur)}`
    : '';
  const unterDemBild = !!bezugText && !imBild(bezugText, PAD.l, W - PAD.r, f);
  const legende = bezugsLegende(unterDemBild ? [{ text: bezugText, farbe: 'var(--txt)' }] : [], W, f);
  const hKurve = Math.round(180 * (1 + (f - 1) * 0.6)),
    H = hKurve + legende.hoehe;
  PAD.b += legende.hoehe;
  const iw = W - PAD.l - PAD.r,
    ih = H - PAD.t - PAD.b,
    unten = PAD.t + ih;

  const color = 'var(--chart-wert, var(--chart-new))';
  const n = vals.length;
  const zeiten = data.map(d => d.zeit ?? NaN);
  const mitZeit = zeiten.every(Number.isFinite) && zeiten[n - 1] > zeiten[0];
  const t0 = mitZeit ? zeiten[0] : 0,
    spanne = mitZeit ? zeiten[n - 1] - t0 : 1;

  /**
   * @param {number} t
   */
  function pxZeit(t) {
    return PAD.l + ((t - t0) / spanne) * iw;
  }
  /**
   * @param {number} i
   */
  function px(i) {
    return mitZeit ? pxZeit(zeiten[i]) : PAD.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  }
  /**
   * @param {number} v
   */
  function py(v) {
    return PAD.t + ih - ((v - min) / range) * ih;
  }

  const pts = vals.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const area = `${px(0).toFixed(1)},${unten} ${pts} ${px(n - 1).toFixed(1)},${unten}`;

  // Je Beschriftung rund 70 px, damit sie sich am Telefon nicht überlappen.
  /** @type {import('./escapen.js').Markup} */
  let xLabels = html``;
  if (mitZeit) {
    xLabels = xBeschriftung(
      zeitTeilung(t0, zeiten[n - 1], Math.floor(iw / (70 * f))).map(s => ({ x: pxZeit(s.t), text: s.text })),
      hKurve - 8 * f,
      W - PAD.r,
      f,
      fs,
    );
  } else {
    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.min(7, Math.floor(iw / (70 * f))))));
    for (let i = 0; i < n; i += step)
      if (data[i].day)
        xLabels = html`${xLabels}${html`<text x="${px(i).toFixed(1)}" y="${hKurve - 8 * f}" text-anchor="middle" font-size="${fs}" fill="var(--mut)" font-family="inherit">${data[i].day}</text>`}`;
  }

  const wann = (/** @type {number} */ i) => (mitZeit ? fmtDatum(new Date(zeiten[i])) : data[i].day);
  const letzter = html`<circle cx="${px(n - 1).toFixed(1)}" cy="${py(vals[n - 1]).toFixed(1)}" r="${4 * f}" fill="${color}" stroke="var(--sur)" stroke-width="1.5"/>`;
  const linie = mitEinstand
    ? bezugsLinie(
        einstand,
        py,
        PAD.l,
        W - PAD.r,
        unterDemBild ? '' : bezugText,
        'var(--txt)',
        py(vals[n - 1]),
        f,
        hKurve,
      )
    : '';
  const fk = fadenkreuzTeile(
    vals.map((v, i) => ({ x: +px(i).toFixed(1), y: [+py(v).toFixed(1)], t: [wann(i), fmtN(v, cur)] })),
    [color],
    PAD.t,
    unten,
    f,
  );

  const zusammenfassung = [
    tRaw('finance.chart.summary', {
      titel: tRaw('finance.chart.label'),
      von: wann(0),
      bis: wann(n - 1),
      start: fmtN(vals[0], cur),
      ende: fmtN(vals[n - 1], cur),
    }),
    mitEinstand ? `${einstandText} ${fmtN(einstand, cur)}` : '',
    min > 0 ? tRaw('chart.axis_from', { wert: fmtN(min, cur) }) : '',
    tRaw('chart.keys'),
  ]
    .filter(Boolean)
    .join('. ');
  return html`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="diagramm diagramm-wert" role="img" aria-label="${zusammenfassung}" data-flaeche="${iw.toFixed(0)}"${ungeprueft(fk.attr)}>
  <defs><linearGradient id="pcg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${color}" stop-opacity=".15"/>
    <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
  </linearGradient></defs>
  ${yAchse(teilung, min, py, PAD.l, W - PAD.r, PAD.t, unten, cur, f, lage.innen)}${xLabels}
  <polygon points="${area}" fill="url(#pcg)"/>
  <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${linie}${letzter}${legende.svg(hKurve)}
  ${lage.innen ? yBetraegeInnen(teilung, min, py, PAD.l, cur, f, mitEinstand ? [py(einstand)] : []) : ''}
  ${fk.svg}
</svg>`;
}

/** Leerzustand des Wertdiagramms (auch aus portfolioChartSVG). */
export function diagrammLeer() {
  return html`<div class="diagramm-leer" role="status"><strong>${tRaw('finance.chart.too_few_title')}</strong><span>${tRaw('finance.chart.too_few_text')}</span></div>`;
}
