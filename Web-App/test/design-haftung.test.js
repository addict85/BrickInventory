/**
 * Kopf- und Reiterleiste haften GEMEINSAM — in jedem Design, gemessen in Chrome
 * nach dem Rollen. Haftet nur die Reiterleiste, steht sie auf der Höhe der
 * weggerollten Kopfleiste und schiebt sich über den Inhalt; sitzt sie nicht
 * genau unter der Kopfleiste, klafft eine Lücke oder beide überdecken sich.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, zurückgenommen):
 *   A  in themes/noppe.css `[data-theme="noppe"] header{position:relative}` →
 *      rot: „noppe: Kopfleiste rollt weg, Reiterleiste haftet“
 *   B  in styles.css `nav{… top:58px …}` auf `top:50px` → rot: alle Designs
 *      („Reiterleiste bei 50, Kopfleiste endet bei 58“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chrome } = require('./helpers/app-browser');

const PUBLIC = path.join(__dirname, '..', 'public');
const DESIGNS = ['classic', ...fs.readdirSync(path.join(PUBLIC, 'themes')).filter(n => n.endsWith('.css')).map(n => n.slice(0, -4))];

function messe(bin, ordner, design) {
  const css = ['tokens.css', 'styles.css', ...fs.readdirSync(path.join(PUBLIC, 'themes')).map(n => `themes/${n}`)]
    .map(s => `<link rel="stylesheet" href="file://${path.join(PUBLIC, s)}">`).join('');
  const datei = path.join(ordner, `${design}.html`);
  fs.writeFileSync(datei, `<!doctype html><html lang="de" data-theme="${design}"><head><meta charset="utf-8">${css}
<style>*{transition:none!important;animation:none!important}</style></head><body>
<header><span>BrickInventory</span></header><nav><button class="ntab">Sammlung</button></nav>
<main style="height:5000px"></main><pre id="ergebnis"></pre>
<script>window.scrollTo(0, 1500); {
  const r = (s) => document.querySelector(s).getBoundingClientRect();
  document.getElementById('ergebnis').textContent = 'ERGE' + 'BNIS' + JSON.stringify({ kopf: [r('header').top, r('header').bottom],
    reiter: [r('nav').top, r('nav').bottom], gerollt: window.scrollY }) + 'EN' + 'DE'; }</script></body></html>`);
  const dom = execFileSync(bin, ['--headless', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
    '--window-size=1200,800', '--virtual-time-budget=3000', '--dump-dom', `file://${datei}`],
  { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] });
  const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
  assert.ok(m, `${design}: kein Ergebnis`);
  return JSON.parse(m[1].replace(/&quot;/g, '"'));
}

test('Kopf- und Reiterleiste haften in jedem Design gemeinsam und schliessen aneinander an', (t) => {
  const bin = chrome();
  if (!bin) { t.skip('kein Chrome gefunden'); return; }
  assert.ok(DESIGNS.length >= 5, `nur ${DESIGNS.length} Designs gefunden`);
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'haftung-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const fehler = [];
  for (const d of DESIGNS) {
    const { kopf, reiter, gerollt } = messe(bin, ordner, d);
    assert.ok(gerollt > 1000, `${d}: die Seite rollt nicht (${gerollt})`);
    const kopfHaftet = Math.round(kopf[0]) === 0, reiterSichtbar = reiter[1] > 0;
    if (kopfHaftet !== reiterSichtbar) fehler.push(`${d}: Kopfleiste ${kopfHaftet ? 'haftet' : 'rollt weg'}, Reiterleiste ${reiterSichtbar ? 'haftet' : 'rollt weg'}`);
    else if (kopfHaftet && Math.round(reiter[0]) !== Math.round(kopf[1]))
      fehler.push(`${d}: Reiterleiste bei ${Math.round(reiter[0])}, Kopfleiste endet bei ${Math.round(kopf[1])}`);
  }
  assert.deepEqual(fehler, []);
  // Die Grundgestaltung heftet beide an; ohne das prüfte der Vergleich oben zweimal „rollt weg“.
  assert.equal(Math.round(messe(bin, ordner, 'classic').kopf[0]), 0, 'classic: die Kopfleiste haftet nicht');
});
