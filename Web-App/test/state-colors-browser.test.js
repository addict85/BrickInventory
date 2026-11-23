/**
 * „Neu“ is blue in every theme, „Gebraucht“ amber — badge and
 * chart line the same. Before, „Neu“ was green or blue depending on the theme, and
 * the line in the chart blue next to a green badge. Blue/amber
 * because the pair stays distinguishable even with red-green color blindness.
 *
 * Measured in the browser with all themes; skipped without Chrome.
 *
 * Counter-check (measured on 28.10.2026): farbfaecher .cond-new green again
 * (#dcfce7/#15803d) → red: „farbfaecher: Neu ist nicht blau (Farbton 142)“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PUBLIC = path.join(__dirname, '..', 'public');
const DESIGNS = ['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz'];

const { chrome } = require('./helpers/app-browser');

function testPage() {
  const css = ['tokens.css', 'styles.css', ...DESIGNS.filter(d => d !== 'classic').map(d => `themes/${d}.css`)]
    .map(s => `<link rel="stylesheet" href="file://${path.join(PUBLIC, s)}">`)
    .join('\n');
  const sections = DESIGNS.map(
    d => `<section data-theme="${d}" data-design="${d}">
    <span class="cond-badge cond-new">Neu</span><span class="cond-badge cond-used">Gebraucht</span>
    <i class="linie-neu" style="background:var(--chart-new)"></i><i class="linie-gebr" style="background:var(--chart-used)"></i></section>`,
  ).join('\n');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">${css}</head><body>${sections}
<pre id="ergebnis"></pre>
<script>
function farbton(c){ const [r,g,b]=(c.match(/[\\d.]+/g)||[]).slice(0,3).map(v=>v/255);
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn; if(!d) return -1;
  let h = mx===r ? ((g-b)/d)%6 : mx===g ? (b-r)/d+2 : (r-g)/d+4; h*=60; return Math.round(h<0?h+360:h); }
window.addEventListener('load', () => {
  const e = [...document.querySelectorAll('section')].map(s => {
    const f = (sel, eig) => farbton(getComputedStyle(s.querySelector(sel))[eig]);
    // Die Plakette ist in manchen Designs hell mit farbiger Schrift, in anderen
    // farbig mit weisser Schrift — gemessen wird jeweils die farbigere Seite.
    const plakette = sel => { const cs = getComputedStyle(s.querySelector(sel));
      const g = farbton(cs.backgroundColor), t = farbton(cs.color);
      const satt = c => { const v=(c.match(/[\\d.]+/g)||[]).slice(0,3).map(Number); return Math.max(...v)-Math.min(...v); };
      return satt(cs.backgroundColor) >= satt(cs.color) ? g : t; };
    return { design: s.dataset.design, fresh: plakette('.cond-new'), gebr: plakette('.cond-used'),
             lineNew: f('.linie-neu', 'backgroundColor'), lineUsed: f('.linie-gebr', 'backgroundColor') };
  });
  document.getElementById('ergebnis').textContent = 'ERGEBNIS' + JSON.stringify(e) + 'ENDE';
});
</script></body></html>`;
}

test('condition colors in all designs', t => {
  const bin = chrome();
  if (!bin) {
    t.skip('no Chrome found');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zustand-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'seite.html');
  fs.writeFileSync(file, testPage());
  const dom = execFileSync(
    bin,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--allow-file-access-from-files',
      '--window-size=800,800',
      '--virtual-time-budget=3000',
      '--dump-dom',
      `file://${file}`,
    ],
    { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
  assert.ok(m, 'The test page wrote no result');
  const e = JSON.parse((m[1] ?? '').replace(/&quot;/g, '"'));
  assert.equal(e.length, DESIGNS.length);
  const blue = h => h >= 190 && h <= 250,
    bernstein = h => h >= 20 && h <= 55;
  for (const d of e) {
    assert.ok(blue(d.fresh), `${d.design}: new is not blue (hue ${d.fresh})`);
    assert.ok(blue(d.lineNew), `${d.design}: chart line for new is not blue (hue ${d.lineNew})`);
    assert.ok(bernstein(d.gebr), `${d.design}: used is not amber (hue ${d.gebr})`);
    assert.ok(bernstein(d.lineUsed), `${d.design}: chart line for used is not amber (hue ${d.lineUsed})`);
  }
});
