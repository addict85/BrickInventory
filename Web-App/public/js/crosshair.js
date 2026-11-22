import { esc, html, rawHtml } from './escaping.js';

// The crosshair shared by all charts: hover, tap and arrow keys over the same points on the SVG.
/** A crosshair point: x in viewBox units, one y per row, label lines. @typedef {{ x: number, y: (number | null)[], t: string[] }} Point */
/**
 * The crosshair: invisible until someone hovers, taps or moves with the arrow keys. The points sit as JSON
 * on the SVG (x in viewBox units, one y per row, plus the label), so one controller serves every chart.
 * @param {Point[]} points
 * @param {string[]} colors
 * @param {number} top
 * @param {number} bottom
 */
export function crosshairParts(points, colors, top, bottom, f = 1) {
  const json = esc(JSON.stringify(points));
  const circles = colors
    .map(fb => html`<circle class="fk-punkt" r="${4.5 * f}" fill="${fb}" stroke="var(--sur)" stroke-width="2"/>`)
    .join('');
  return {
    attr: ` data-punkte="${json}" data-mass="${f}" tabindex="0"`,
    svg: html`<g class="fadenkreuz" visibility="hidden" pointer-events="none">
      <line class="fk-linie" y1="${top}" y2="${bottom}" stroke="var(--txt)" stroke-width="1"/>${rawHtml(circles)}
      <rect class="fk-schild" rx="6" height="0" width="0" fill="var(--txt)"/>
      <text class="fk-text" font-size="${12 * f}" font-weight="600" fill="var(--sur)" font-family="inherit"></text></g>`,
  };
}

/**
 * The points on the SVG, read once.
 * @param {SVGSVGElement} svg
 */
function pointsOf(svg) {
  if (!svg._punkte) {
    try {
      svg._punkte = JSON.parse(svg.dataset.punkte || '[]');
    } catch (_) {
      svg._punkte = [];
    }
  }
  return svg._punkte ?? [];
}

/**
 * Set a chart's crosshair to point i (null hides it).
 * @param {SVGSVGElement | null | undefined} svg
 * @param {number | null} i
 */
export function showCrosshair(svg, i, announce = false) {
  const g = svg?.querySelector('.fadenkreuz');
  if (!svg || !g) return;
  const points = pointsOf(svg);
  if (i == null || !points.length) {
    g.setAttribute('visibility', 'hidden');
    return;
  }
  i = Math.max(0, Math.min(points.length - 1, i));
  svg._fk = i;
  const f = Number(svg.dataset.mass) || 1;
  const p = points[i];
  const line = g.querySelector('.fk-linie'),
    text = g.querySelector('.fk-text'),
    shield = g.querySelector('.fk-schild');
  if (!line || !text || !shield) return;
  line.setAttribute('x1', String(p.x));
  line.setAttribute('x2', String(p.x));
  g.querySelectorAll('.fk-punkt').forEach((c, k) => {
    const y = p.y[k];
    c.setAttribute('visibility', y == null ? 'hidden' : 'visible');
    if (y != null) {
      c.setAttribute('cx', String(p.x));
      c.setAttribute('cy', String(y));
    }
  });
  text.replaceChildren(
    ...p.t.map((line, k) => {
      const ts = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      ts.setAttribute('dy', k ? String(16 * f) : '0');
      if (k) ts.setAttribute('font-weight', '400');
      ts.textContent = line;
      return ts;
    }),
  );
  const textWidth = Math.max(
    .../** @type {SVGTextContentElement[]} */ ([...text.children]).map(
      ts =>
        (typeof ts.getComputedTextLength === 'function' && ts.getComputedTextLength()) || ts.textContent.length * 7 * f,
    ),
  );
  const b = textWidth + 16 * f,
    h = 16 * f * p.t.length + 8 * f;
  const vb = svg.viewBox?.baseVal;
  const W = vb?.width || 700;
  const x = p.x + 12 * f + b > W ? p.x - 12 * f - b : p.x + 12 * f;
  const y0 = Number(line.getAttribute('y1')) || 0;
  shield.setAttribute('x', String(x));
  shield.setAttribute('y', String(y0));
  shield.setAttribute('width', String(b));
  shield.setAttribute('height', String(h));
  text.setAttribute('x', String(x + 8 * f));
  text.setAttribute('y', String(y0 + 17 * f));
  text.querySelectorAll('tspan').forEach(ts => {
    ts.setAttribute('x', String(x + 8 * f));
  });
  g.setAttribute('visibility', 'visible');
  if (announce) {
    let announcement = svg.parentElement?.querySelector(':scope > .diagramm-ansage');
    if (!announcement && svg.parentElement) {
      announcement = document.createElement('span');
      announcement.className = 'vh diagramm-ansage';
      announcement.setAttribute('aria-live', 'polite');
      svg.after(announcement);
    }
    if (announcement) announcement.textContent = p.t.join(', ');
  }
}

/**
 * @param {SVGSVGElement} svg
 * @param {number} clientX
 */
function nearestPoint(svg, clientX) {
  const points = pointsOf(svg);
  const r = svg.getBoundingClientRect();
  const W = svg.viewBox?.baseVal?.width || r.width || 1;
  const x = ((clientX - r.left) * W) / (r.width || 1);
  let best = 0;
  points.forEach((p, k) => {
    if (Math.abs(p.x - x) < Math.abs(points[best].x - x)) best = k;
  });
  return best;
}

const chartOf = (/** @type {Event} */ e) =>
  /** @type {SVGSVGElement | null | undefined} */ (
    /** @type {Element | null} */ (e.target)?.closest?.('svg[data-punkte]')
  );

for (const kind of ['pointermove', 'pointerdown']) {
  document.addEventListener(kind, e => {
    const svg = chartOf(e);
    if (svg) showCrosshair(svg, nearestPoint(svg, /** @type {PointerEvent} */ (e).clientX));
  });
}

document.addEventListener('pointerout', e => {
  const svg = chartOf(e);
  if (
    svg &&
    !svg.contains(/** @type {Node | null} */ (e.relatedTarget)) &&
    document.activeElement !== svg &&
    e.pointerType !== 'touch'
  )
    showCrosshair(svg, null);
});

document.addEventListener('focusin', e => {
  const svg = chartOf(e);
  if (svg) showCrosshair(svg, svg._fk ?? pointsOf(svg).length - 1, true);
});

document.addEventListener('focusout', e => {
  const svg = chartOf(e);
  if (svg) showCrosshair(svg, null);
});

document.addEventListener('keydown', e => {
  const svg = chartOf(e);
  if (!svg) return;
  const n = pointsOf(svg).length,
    i = svg._fk ?? n - 1;
  const target = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: n - 1 }[e.key];
  if (target === undefined) return;
  e.preventDefault();
  showCrosshair(svg, target, true);
});
