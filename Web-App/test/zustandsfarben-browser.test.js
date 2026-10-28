/**
 * „Neu“ ist in jedem Design blau, „Gebraucht“ bernstein — Plakette und
 * Diagrammlinie gleich. Vorher war „Neu“ je nach Design grün oder blau, und
 * die Linie im Diagramm blau neben einer grünen Plakette. Blau/Bernstein,
 * weil das Paar auch bei Rot-Grün-Sehschwäche unterscheidbar bleibt.
 *
 * Gemessen im Browser mit allen Designs; ohne Chrome übersprungen.
 *
 * Gegenprobe (am 28.10.2026 gemessen): farbfaecher .cond-new wieder grün
 * (#dcfce7/#15803d) → rot: „farbfaecher: Neu ist nicht blau (Farbton 142)“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PUBLIC = path.join(__dirname, '..', 'public');
const DESIGNS = ['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz'];

function chrome() {
  const kandidaten = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return kandidaten.find(k => k && fs.existsSync(k)) ?? null;
}

function testseite() {
  const css = ['tokens.css', 'styles.css', ...DESIGNS.filter(d => d !== 'classic').map(d => `themes/${d}.css`)]
    .map(s => `<link rel="stylesheet" href="file://${path.join(PUBLIC, s)}">`).join('\n');
  const abschnitte = DESIGNS.map(d => `<section data-theme="${d}" data-design="${d}">
    <span class="cond-badge cond-new">Neu</span><span class="cond-badge cond-used">Gebraucht</span>
    <i class="linie-neu" style="background:var(--chart-new)"></i><i class="linie-gebr" style="background:var(--chart-used)"></i></section>`).join('\n');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">${css}</head><body>${abschnitte}
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
    return { design: s.dataset.design, neu: plakette('.cond-new'), gebr: plakette('.cond-used'),
             linieNeu: f('.linie-neu', 'backgroundColor'), linieGebr: f('.linie-gebr', 'backgroundColor') };
  });
  document.getElementById('ergebnis').textContent = 'ERGEBNIS' + JSON.stringify(e) + 'ENDE';
});
</script></body></html>`;
}

test('Zustandsfarben in allen Designs', (t) => {
  const bin = chrome();
  if (!bin) { t.skip('kein Chrome gefunden'); return; }
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'zustand-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const datei = path.join(ordner, 'seite.html');
  fs.writeFileSync(datei, testseite());
  const dom = execFileSync(bin, ['--headless', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
    '--window-size=800,800', '--virtual-time-budget=3000', '--dump-dom', `file://${datei}`],
    { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] });
  const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
  assert.ok(m, 'Die Testseite hat kein Ergebnis geschrieben');
  const e = JSON.parse((m[1] ?? '').replace(/&quot;/g, '"'));
  assert.equal(e.length, DESIGNS.length);
  const blau = h => h >= 190 && h <= 250, bernstein = h => h >= 20 && h <= 55;
  for (const d of e) {
    assert.ok(blau(d.neu), `${d.design}: Neu ist nicht blau (Farbton ${d.neu})`);
    assert.ok(blau(d.linieNeu), `${d.design}: Diagrammlinie Neu ist nicht blau (Farbton ${d.linieNeu})`);
    assert.ok(bernstein(d.gebr), `${d.design}: Gebraucht ist nicht bernstein (Farbton ${d.gebr})`);
    assert.ok(bernstein(d.linieGebr), `${d.design}: Diagrammlinie Gebraucht ist nicht bernstein (Farbton ${d.linieGebr})`);
  }
});
