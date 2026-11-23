/**
 * On the phone the metrics of the collection („4 Sets · 394 Teile“) stand there as text, not as pills:
 * without surface, border and shadow, in all three themes with their own metrics look. Measured in the browser
 * (computed styles), otherwise one would take them for a second toggle sets/parts/minifigures.
 *
 * Counter-check (measured on 07.11.): in mobile.css the pill again (`padding: 5px 12px; border-radius: 999px;`
 * without `background: none`) → red in all three themes („klassisch“, „brick“, „farbfaecher“: background or border);
 * without `border: 0 !important` alone red in the theme „farbfaecher“ (top border 4 px).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chrome } = require('./helpers/app-browser');

const PUBLIC = path.join(__dirname, '..', 'public');
const DESIGNS = ['klassisch', 'brick', 'farbfaecher'];

test('metrics on the phone are text without surface and border', t => {
  const bin = chrome();
  if (!bin) {
    t.skip('no Chrome found');
    return;
  }
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'kennzahlen-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const css = ['tokens.css', 'styles.css', 'themes/brick.css', 'themes/farbfaecher.css', 'mobile.css']
    .map(s => `<link rel="stylesheet" href="file://${path.join(PUBLIC, s)}">`)
    .join('');
  const stat = (k, z, l) =>
    `<div class="bstat ${k}"><div class="bstat-l">${l}</div><div class="bstat-v">${z}</div><div class="bstat-s"></div></div>`;
  const faelle = DESIGNS.map(
    d =>
      `<div data-theme="${d}" data-fall="${d}"><div class="brick-stats">${stat(
        'bstat-slate',
        4,
        'Sets',
      )}${stat('bstat-petrol', 394, 'Teile')}${stat('bstat-light', 3, 'Minifiguren')}</div></div>`,
  ).join('');
  const seite = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head>
<body style="margin:0">${faelle}<pre id="e"></pre><script>addEventListener('load',()=>{
const aus=[...document.querySelectorAll('[data-fall]')].map(f=>{const s=getComputedStyle(f.querySelector('.bstat'));
return {d:f.dataset.fall,bg:s.backgroundColor,rand:['Top','Right','Bottom','Left'].map(k=>s['border'+k+'Width']).join(' '),schatten:s.boxShadow};});
document.getElementById('e').textContent='ERGEBNIS'+JSON.stringify(aus)+'ENDE';});</script></body></html>`;
  const datei = path.join(ordner, 'seite.html');
  fs.writeFileSync(datei, seite);
  const dom = execFileSync(
    bin,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--allow-file-access-from-files',
      '--window-size=390,844',
      '--virtual-time-budget=3000',
      '--dump-dom',
      `file://${datei}`,
    ],
    { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
  assert.ok(m, 'The test page wrote no result');
  const ergebnis = JSON.parse(m[1].replace(/&quot;/g, '"'));
  assert.equal(ergebnis.length, DESIGNS.length);
  for (const e of ergebnis) {
    assert.equal(e.bg, 'rgba(0, 0, 0, 0)', `${e.d}: metric has background ${e.bg}`);
    assert.equal(e.rand, '0px 0px 0px 0px', `${e.d}: metric has border ${e.rand}`);
    assert.equal(e.schatten, 'none', `${e.d}: metric has a shadow`);
  }
});
