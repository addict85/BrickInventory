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

function measure(bin, dir, design) {
  const css = ['tokens.css', 'styles.css', ...fs.readdirSync(path.join(PUBLIC, 'themes')).map(n => `themes/${n}`)]
    .map(s => `<link rel="stylesheet" href="file://${path.join(PUBLIC, s)}">`)
    .join('');
  const file = path.join(dir, `${design}.html`);
  fs.writeFileSync(
    file,
    `<!doctype html><html lang="de" data-theme="${design}"><head><meta charset="utf-8">${css}
<style>*{transition:none!important;animation:none!important}</style></head><body>
<header><span>BrickInventory</span></header><nav><button class="ntab">Sammlung</button></nav>
<main style="height:5000px"></main><pre id="ergebnis"></pre>
<script>window.scrollTo(0, 1500); {
  const r = (s) => document.querySelector(s).getBoundingClientRect();
  document.getElementById('ergebnis').textContent = 'ERGE' + 'BNIS' + JSON.stringify({ head: [r('header').top, r('header').bottom],
    tabBar: [r('nav').top, r('nav').bottom], scrolled: window.scrollY }) + 'EN' + 'DE'; }</script></body></html>`,
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
      `file://${file}`,
    ],
    { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
  assert.ok(m, `${design}: no result`);
  return JSON.parse(m[1].replace(/&quot;/g, '"'));
}

test('header and tab bar stick together in every theme and connect to each other', t => {
  const bin = chrome();
  if (!bin) {
    t.skip('no Chrome found');
    return;
  }
  assert.ok(DESIGNS.length >= 5, `only ${DESIGNS.length} designs found`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haftung-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const error = [];
  for (const d of DESIGNS) {
    const { head, tabBar, scrolled } = measure(bin, dir, d);
    assert.ok(scrolled > 1000, `${d}: the page does not scroll (${scrolled})`);
    const headerSticks = Math.round(head[0]) === 0,
      tabVisible = tabBar[1] > 0;
    if (headerSticks !== tabVisible)
      error.push(
        `${d}: Kopfleiste ${headerSticks ? 'haftet' : 'rollt weg'}, Reiterleiste ${tabVisible ? 'haftet' : 'rollt weg'}`,
      );
    else if (headerSticks && Math.round(tabBar[0]) !== Math.round(head[1]))
      error.push(`${d}: Reiterleiste bei ${Math.round(tabBar[0])}, Kopfleiste endet bei ${Math.round(head[1])}`);
  }
  assert.deepEqual(error, []);
  // The base styling pins both; without that the comparison above would check “scrolls away” twice.
  assert.equal(Math.round(measure(bin, dir, 'classic').head[0]), 0, 'classic: the header bar does not stick');
});
