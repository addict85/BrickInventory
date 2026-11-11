import { esc, html, ungeprueft } from './escapen.js';

// Das Fadenkreuz aller Diagramme: Zeigen, Tippen und Pfeiltasten über dieselben Punkte am SVG.
/** Ein Punkt des Fadenkreuzes: x in viewBox-Einheiten, je Reihe ein y, Beschriftungszeilen. @typedef {{ x: number, y: (number | null)[], t: string[] }} Punkt */
/**
 * Das Fadenkreuz: unsichtbar, bis jemand zeigt, tippt oder mit den Pfeiltasten wandert. Die Punkte stehen als
 * JSON am SVG (x in viewBox-Einheiten, je Reihe ein y, dazu die Beschriftung), damit eine Steuerung für alle
 * Diagramme reicht.
 * @param {Punkt[]} punkte
 * @param {string[]} farben
 * @param {number} oben
 * @param {number} unten
 */
export function fadenkreuzTeile(punkte, farben, oben, unten, f = 1) {
  const json = esc(JSON.stringify(punkte));
  const kreise = farben
    .map(fb => html`<circle class="fk-punkt" r="${4.5 * f}" fill="${fb}" stroke="var(--sur)" stroke-width="2"/>`)
    .join('');
  return {
    attr: ` data-punkte="${json}" data-mass="${f}" tabindex="0"`,
    svg: html`<g class="fadenkreuz" visibility="hidden" pointer-events="none">
      <line class="fk-linie" y1="${oben}" y2="${unten}" stroke="var(--txt)" stroke-width="1"/>${ungeprueft(kreise)}
      <rect class="fk-schild" rx="6" height="0" width="0" fill="var(--txt)"/>
      <text class="fk-text" font-size="${12 * f}" font-weight="600" fill="var(--sur)" font-family="inherit"></text></g>`,
  };
}

/**
 * Die Punkte am SVG, einmal gelesen.
 * @param {SVGSVGElement} svg
 */
function punkteVon(svg) {
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
 * Fadenkreuz eines Diagramms auf Punkt i setzen (null blendet es aus).
 * @param {SVGSVGElement | null | undefined} svg
 * @param {number | null} i
 */
export function zeigeFadenkreuz(svg, i, ansagen = false) {
  const g = svg?.querySelector('.fadenkreuz');
  if (!svg || !g) return;
  const punkte = punkteVon(svg);
  if (i == null || !punkte.length) {
    g.setAttribute('visibility', 'hidden');
    return;
  }
  i = Math.max(0, Math.min(punkte.length - 1, i));
  svg._fk = i;
  const f = Number(svg.dataset.mass) || 1;
  const p = punkte[i];
  const linie = g.querySelector('.fk-linie'),
    text = g.querySelector('.fk-text'),
    schild = g.querySelector('.fk-schild');
  if (!linie || !text || !schild) return;
  linie.setAttribute('x1', String(p.x));
  linie.setAttribute('x2', String(p.x));
  g.querySelectorAll('.fk-punkt').forEach((c, k) => {
    const y = p.y[k];
    c.setAttribute('visibility', y == null ? 'hidden' : 'visible');
    if (y != null) {
      c.setAttribute('cx', String(p.x));
      c.setAttribute('cy', String(y));
    }
  });
  text.replaceChildren(
    ...p.t.map((zeile, k) => {
      const ts = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      ts.setAttribute('dy', k ? String(16 * f) : '0');
      if (k) ts.setAttribute('font-weight', '400');
      ts.textContent = zeile;
      return ts;
    }),
  );
  const breiteText = Math.max(
    .../** @type {SVGTextContentElement[]} */ ([...text.children]).map(
      ts =>
        (typeof ts.getComputedTextLength === 'function' && ts.getComputedTextLength()) || ts.textContent.length * 7 * f,
    ),
  );
  const b = breiteText + 16 * f,
    h = 16 * f * p.t.length + 8 * f;
  const vb = svg.viewBox?.baseVal;
  const W = vb?.width || 700;
  const x = p.x + 12 * f + b > W ? p.x - 12 * f - b : p.x + 12 * f;
  const y0 = Number(linie.getAttribute('y1')) || 0;
  schild.setAttribute('x', String(x));
  schild.setAttribute('y', String(y0));
  schild.setAttribute('width', String(b));
  schild.setAttribute('height', String(h));
  text.setAttribute('x', String(x + 8 * f));
  text.setAttribute('y', String(y0 + 17 * f));
  text.querySelectorAll('tspan').forEach(ts => {
    ts.setAttribute('x', String(x + 8 * f));
  });
  g.setAttribute('visibility', 'visible');
  if (ansagen) {
    let ansage = svg.parentElement?.querySelector(':scope > .diagramm-ansage');
    if (!ansage && svg.parentElement) {
      ansage = document.createElement('span');
      ansage.className = 'vh diagramm-ansage';
      ansage.setAttribute('aria-live', 'polite');
      svg.after(ansage);
    }
    if (ansage) ansage.textContent = p.t.join(', ');
  }
}

/**
 * @param {SVGSVGElement} svg
 * @param {number} clientX
 */
function naechsterPunkt(svg, clientX) {
  const punkte = punkteVon(svg);
  const r = svg.getBoundingClientRect();
  const W = svg.viewBox?.baseVal?.width || r.width || 1;
  const x = ((clientX - r.left) * W) / (r.width || 1);
  let best = 0;
  punkte.forEach((p, k) => {
    if (Math.abs(p.x - x) < Math.abs(punkte[best].x - x)) best = k;
  });
  return best;
}

const diagrammVon = (/** @type {Event} */ e) =>
  /** @type {SVGSVGElement | null | undefined} */ (
    /** @type {Element | null} */ (e.target)?.closest?.('svg[data-punkte]')
  );

for (const art of ['pointermove', 'pointerdown']) {
  document.addEventListener(art, e => {
    const svg = diagrammVon(e);
    if (svg) zeigeFadenkreuz(svg, naechsterPunkt(svg, /** @type {PointerEvent} */ (e).clientX));
  });
}

document.addEventListener('pointerout', e => {
  const svg = diagrammVon(e);
  if (
    svg &&
    !svg.contains(/** @type {Node | null} */ (e.relatedTarget)) &&
    document.activeElement !== svg &&
    e.pointerType !== 'touch'
  )
    zeigeFadenkreuz(svg, null);
});

document.addEventListener('focusin', e => {
  const svg = diagrammVon(e);
  if (svg) zeigeFadenkreuz(svg, svg._fk ?? punkteVon(svg).length - 1, true);
});

document.addEventListener('focusout', e => {
  const svg = diagrammVon(e);
  if (svg) zeigeFadenkreuz(svg, null);
});

document.addEventListener('keydown', e => {
  const svg = diagrammVon(e);
  if (!svg) return;
  const n = punkteVon(svg).length,
    i = svg._fk ?? n - 1;
  const ziel = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: n - 1 }[e.key];
  if (ziel === undefined) return;
  e.preventDefault();
  zeigeFadenkreuz(svg, ziel, true);
});
