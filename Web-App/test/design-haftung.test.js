/**
 * Header and tab bar stick SHARED — in every design, measured in Chrome
 * after scrolling. If only the tab bar sticks, it stands at the height of the
 * scrolled-away header and slides over the content; if it does not sit
 * exactly below the header, a gap opens or both overlap.
 *
 * Counter-checks (measured 10.11.2026, each alone, reverted):
 *   A  in themes/noppe.css `[data-theme="noppe"] header{position:relative}` →
 *      red: “noppe: header scrolls away, tab bar sticks”
 *   B  in styles.css `nav{… top:58px …}` to `top:50px` → red: all designs
 *      (“tab bar at 50, header ends at 58”)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chrome } = require('./helpers/app-browser');

const PUBLIC = path.join(__dirname, '..', 'public');
const DESIGNS = [
  'classic',
  ...fs
    .readdirSync(path.join(PUBLIC, 'themes'))
    .filter(n => n.endsWith('.css'))
    .map(n => n.slice(0, -4)),
];

function measure(bin, ordner, design) {
  const css = ['tokens.css', 'styles.css', ...fs.readdirSync(path.join(PUBLIC, 'themes')).map(n => `themes/${n}`)]
    .map(s => `<link rel="stylesheet" href="file://${path.join(PUBLIC, s)}">`)
    .join('');
  const datei = path.join(ordner, `${design}.html`);
  fs.writeFileSync(
    datei,
    `<!doctype html><html lang="de" data-theme="${design}"><head><meta charset="utf-8">${css}
<style>*{transition:none!important;animation:none!important}</style></head><body>
<header><span>BrickInventory</span></header><nav><button class="ntab">Sammlung</button></nav>
<main style="height:5000px"></main><pre id="ergebnis"></pre>
<script>window.scrollTo(0, 1500); {
  const r = (s) => document.querySelector(s).getBoundingClientRect();
  document.getElementById('ergebnis').textContent = 'ERGE' + 'BNIS' + JSON.stringify({ kopf: [r('header').top, r('header').bottom],
    reiter: [r('nav').top, r('nav').bottom], gerollt: window.scrollY }) + 'EN' + 'DE'; }</script></body></html>`,
  );
  const dom = execFileSync(
    bin,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--allow-file-access-from-files',
      '--window-size=1200,800',
      '--virtual-time-budget=3000',
      '--dump-dom',
      `file://${datei}`,
    ],
    { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
  assert.ok(m, `${design}: kein Ergebnis`);
  return JSON.parse(m[1].replace(/&quot;/g, '"'));
}

test('header and tab bar stick together in every theme and connect to each other', t => {
  const bin = chrome();
  if (!bin) {
    t.skip('no Chrome found');
    return;
  }
  assert.ok(DESIGNS.length >= 5, `nur ${DESIGNS.length} Designs gefunden`);
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'haftung-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const error = [];
  for (const d of DESIGNS) {
    const { kopf, reiter, gerollt } = measure(bin, ordner, d);
    assert.ok(gerollt > 1000, `${d}: die Seite rollt nicht (${gerollt})`);
    const headerSticks = Math.round(kopf[0]) === 0,
      tabVisible = reiter[1] > 0;
    if (headerSticks !== tabVisible)
      error.push(
        `${d}: Kopfleiste ${headerSticks ? 'haftet' : 'rollt weg'}, Reiterleiste ${tabVisible ? 'haftet' : 'rollt weg'}`,
      );
    else if (headerSticks && Math.round(reiter[0]) !== Math.round(kopf[1]))
      error.push(`${d}: Reiterleiste bei ${Math.round(reiter[0])}, Kopfleiste endet bei ${Math.round(kopf[1])}`);
  }
  assert.deepEqual(error, []);
  // The base styling pins both; without that the comparison above would check “scrolls away” twice.
  assert.equal(Math.round(measure(bin, ordner, 'classic').kopf[0]), 0, 'classic: die Kopfleiste haftet nicht');
});
