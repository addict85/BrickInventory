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
  Gallery: ['[data-click="openCapture"][data-arg="set"]', '#gs', '#gallery'],
  Parts: ['[data-click="openCapture"][data-arg="part"]', '#parts-search', '#manual-parts-list', '#parts-main'],
  Minifigs: ['[data-click="openCapture"][data-arg="fig"]', '#fig-search', '#manual-figs-list', '#figs-list'],
  Catalog: ['[data-tab-title="catalog"]', '#cat-search', '#catalog-grid'],
};
const ONCE = [
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
function measured(t) {
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
  const payload = html
    .slice(html.indexOf('<body'), html.lastIndexOf('</body>'))
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/data-style="display:none;?/g, 'style="')
    .replace(/data-style="/g, 'style="')
    .replace(/ hidden(?=[ >])/g, '')
    .replace(/<details /g, '<details open ');
  const css = STILE.map(s => `<link rel="stylesheet" href="file://${path.join(PUBLIC, s)}">`).join('\n');
  const page = `<!doctype html><html lang="de"><head><meta charset="utf-8">${css}
<style>#app{display:block!important}.tab{display:block!important}#login-screen,#start-skeleton{display:none!important}</style></head>
${payload.replace(/^<body[^>]*>/, '<body>')}
<pre id="ergebnis"></pre>
<script>
window.addEventListener('load', () => document.fonts.ready.then(() => {
  const REITER = ${JSON.stringify(REITER)}, ONCE = ${JSON.stringify(ONCE)};
  const upper = s => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top) : null; };
  const out = { switchTab: {}, once: {}, bars: [], holding: {} };
  for (const [n, sel] of Object.entries(REITER)) out.switchTab[n] = sel.map(s => [s, upper(s)]);
  for (const id of ONCE) out.once[id] = document.querySelectorAll('#' + id).length;
  for (const l of document.querySelectorAll('.filter-row'))
    out.bars.push(parseFloat(getComputedStyle(l).marginBottom) / parseFloat(getComputedStyle(document.documentElement).fontSize));
  const r = id => document.getElementById(id)?.getBoundingClientRect();
  const nr = r('pl-setnr'), b = r('btn-pl-stock'), lose = r('pl-stock-lose');
  out.holding = { setNo: nr && [nr.top, nr.bottom], button: b && [b.top, b.bottom], lose: lose && [lose.top, lose.bottom] };
  document.getElementById('ergebnis').textContent = 'ERGEBNIS' + JSON.stringify(out) + 'ENDE';
}));
</script></body></html>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reiterfolge-'));
  try {
    const file = path.join(dir, 'seite.html');
    fs.writeFileSync(file, page);
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
        `file://${file}`,
      ],
      { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
    assert.ok(m, 'The test page wrote no result');
    _result = JSON.parse((m[1] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    return _result;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('adding is above the filters, the filters above the lists (including the manual one)', t => {
  const e = measured(t);
  if (!e) return;
  const wrong = [];
  for (const [name, sequence] of Object.entries(e.switchTab)) {
    for (const [s, y] of sequence) if (y == null) wrong.push(`${name}: ${s} fehlt`);
    for (let i = 1; i < sequence.length; i++)
      if (sequence[i - 1][1] != null && sequence[i][1] != null && !(sequence[i - 1][1] < sequence[i][1]))
        wrong.push(
          `${name}: ${sequence[i - 1][0]} (${sequence[i - 1][1]}) steht nicht über ${sequence[i][0]} (${sequence[i][1]})`,
        );
  }
  assert.deepEqual(wrong, []);
});

test('every control ID exists exactly once', t => {
  const e = measured(t);
  if (!e) return;
  assert.deepEqual(
    Object.entries(e.once)
      .filter(([, n]) => n !== 1)
      .map(([id, n]) => `${id}: ${n}×`),
    [],
    'The IDs are the contract with the JS',
  );
});

test('the filter bars keep distance to the list', t => {
  const e = measured(t);
  if (!e) return;
  assert.equal(e.bars.length, 5, 'gallery, parts, minifigures, catalogue, wanted list');
  assert.deepEqual(
    e.bars.filter(rem => rem < 1.5),
    [],
    'gap below 1.5rem',
  );
});

test('the own stock is on its own line in the parts list', t => {
  const e = measured(t);
  if (!e) return;
  const { setNo, button, lose } = e.holding;
  assert.ok(setNo && button && lose, 'set number, stock button or „nur lose“ is missing');
  // The tool row carries flex-wrap:nowrap: one more button would push the rest out of view there.
  assert.ok(button[0] >= setNo[1], `the stock button (${button[0]}) is in the toolbar row (up to ${setNo[1]})`);
  assert.ok(lose[0] >= setNo[1], '„nur lose Teile“ is in the toolbar row');
});
