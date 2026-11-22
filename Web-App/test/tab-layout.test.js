/**
 * Order of the tab areas: add → search/filter → list, as
 * Chrome draws them (real index.html with the styles, all tabs and all
 * areas shown only later open, 1200 px wide). Measured are the top edges, not the lines in the markup:
 * a flex order or a grid can reverse the sequence.
 *
 * Counter-checks (measured 10.11.2026, each on its own):
 *   A  in styles.css #tab-gallery as a flex column with `.capture-bar{order:9}`
 *      → red: “adding is above the filters …” (gallery) — in the markup
 *      everything would still be right
 *   B  `.filter-row{… margin-bottom:1rem}` → red: “the filter bars keep distance …”
 *   C  #btn-pl-bestand moved behind #pl-setnr into the tool row → red:
 *      “the own stock …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chrome } = require('./helpers/app-browser');

const PUBLIC = path.join(__dirname, '..', 'public');
const STILE = ['vendor/fonts/fonts.css', 'tokens.css', 'styles.css'];

/** Add, filter, list per tab — as selectors on the drawn document. */
const REITER = {
  Galerie: ['[data-click="openCapture"][data-arg="set"]', '#gs', '#gallery'],
  Teile: ['[data-click="openCapture"][data-arg="part"]', '#parts-search', '#manual-parts-list', '#parts-main'],
  Minifiguren: ['[data-click="openCapture"][data-arg="fig"]', '#fig-search', '#manual-figs-list', '#figs-list'],
  Katalog: ['[data-tab-title="catalog"]', '#cat-search', '#catalog-grid'],
};
const EINMAL = [
  'gs',
  'gtheme',
  'gsort',
  'scope-gallery',
  'vg',
  'vl',
  'parts-search',
  'parts-spare',
  'parts-view',
  'scope-parts',
  'fig-search',
  'figs-view',
  'scope-minifigs',
];

/** Measures in the drawn index.html; delivers what `measurement` (function body in the browser) returns. */
let _result;
function gemessen(t) {
  if (_result !== undefined) return _result;
  const bin = chrome();
  if (!bin) {
    t.skip('no Chrome found');
    _result = null;
    return null;
  }
  const html = require('./helpers/sources').withoutHtmlComments(
    fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'),
  );
  const koerper = html
    .slice(html.indexOf('<body'), html.lastIndexOf('</body>'))
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/data-style="display:none;?/g, 'style="')
    .replace(/data-style="/g, 'style="')
    .replace(/ hidden(?=[ >])/g, '')
    .replace(/<details /g, '<details open ');
  const css = STILE.map(s => `<link rel="stylesheet" href="file://${path.join(PUBLIC, s)}">`).join('\n');
  const seite = `<!doctype html><html lang="de"><head><meta charset="utf-8">${css}
<style>#app{display:block!important}.tab{display:block!important}#login-screen,#start-skeleton{display:none!important}</style></head>
${koerper.replace(/^<body[^>]*>/, '<body>')}
<pre id="ergebnis"></pre>
<script>
window.addEventListener('load', () => document.fonts.ready.then(() => {
  const REITER = ${JSON.stringify(REITER)}, EINMAL = ${JSON.stringify(EINMAL)};
  const oben = s => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top) : null; };
  const aus = { reiter: {}, einmal: {}, leisten: [], bestand: {} };
  for (const [n, sel] of Object.entries(REITER)) aus.reiter[n] = sel.map(s => [s, oben(s)]);
  for (const id of EINMAL) aus.einmal[id] = document.querySelectorAll('#' + id).length;
  for (const l of document.querySelectorAll('.filter-row'))
    aus.leisten.push(parseFloat(getComputedStyle(l).marginBottom) / parseFloat(getComputedStyle(document.documentElement).fontSize));
  const r = id => document.getElementById(id)?.getBoundingClientRect();
  const nr = r('pl-setnr'), b = r('btn-pl-stock'), lose = r('pl-stock-lose');
  aus.bestand = { setnr: nr && [nr.top, nr.bottom], knopf: b && [b.top, b.bottom], lose: lose && [lose.top, lose.bottom] };
  document.getElementById('ergebnis').textContent = 'ERGEBNIS' + JSON.stringify(aus) + 'ENDE';
}));
</script></body></html>`;
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'reiterfolge-'));
  try {
    const datei = path.join(ordner, 'seite.html');
    fs.writeFileSync(datei, seite);
    const dom = execFileSync(
      bin,
      [
        '--headless',
        '--no-sandbox',
        '--disable-gpu',
        '--allow-file-access-from-files',
        '--window-size=1200,900',
        '--virtual-time-budget=3000',
        '--dump-dom',
        `file://${datei}`,
      ],
      { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
    assert.ok(m, 'Die Testseite hat kein Ergebnis geschrieben');
    _result = JSON.parse((m[1] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    return _result;
  } finally {
    fs.rmSync(ordner, { recursive: true, force: true });
  }
}

test('adding is above the filters, the filters above the lists (including the manual one)', t => {
  const e = gemessen(t);
  if (!e) return;
  const falsch = [];
  for (const [name, sequence] of Object.entries(e.reiter)) {
    for (const [s, y] of sequence) if (y == null) falsch.push(`${name}: ${s} fehlt`);
    for (let i = 1; i < sequence.length; i++)
      if (sequence[i - 1][1] != null && sequence[i][1] != null && !(sequence[i - 1][1] < sequence[i][1]))
        falsch.push(
          `${name}: ${sequence[i - 1][0]} (${sequence[i - 1][1]}) steht nicht über ${sequence[i][0]} (${sequence[i][1]})`,
        );
  }
  assert.deepEqual(falsch, []);
});

test('every control ID exists exactly once', t => {
  const e = gemessen(t);
  if (!e) return;
  assert.deepEqual(
    Object.entries(e.einmal)
      .filter(([, n]) => n !== 1)
      .map(([id, n]) => `${id}: ${n}×`),
    [],
    'Die IDs sind der Vertrag mit dem JS',
  );
});

test('the filter bars keep distance to the list', t => {
  const e = gemessen(t);
  if (!e) return;
  assert.equal(e.leisten.length, 5, 'Galerie, Teile, Minifiguren, Katalog, Merkliste');
  assert.deepEqual(
    e.leisten.filter(rem => rem < 1.5),
    [],
    'Abstand unter 1.5rem',
  );
});

test('the own stock is on its own line in the parts list', t => {
  const e = gemessen(t);
  if (!e) return;
  const { setnr, knopf, lose } = e.bestand;
  assert.ok(setnr && knopf && lose, 'Set-Nummer, Bestand-Knopf oder „nur lose“ fehlt');
  // The tool row carries flex-wrap:nowrap: one more button would push the rest out of view there.
  assert.ok(knopf[0] >= setnr[1], `der Bestand-Knopf (${knopf[0]}) steht in der Werkzeugzeile (bis ${setnr[1]})`);
  assert.ok(lose[0] >= setnr[1], '„nur lose Teile“ steht in der Werkzeugzeile');
});
