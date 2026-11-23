/**
 * On the phone every control is at least 44 × 44 px — measured
 * in the browser, not read from the source text.
 *
 * Counter-checks (measured on 27.10.):
 *   A  in mobile.css `.delbtn` again 36 px (29.10.; since then 44 px without ::after)
 *      → red: „Löschknopf auf der Kachel"
 *   B  in mobile.css `.vb` taken out of the 44 px line → red: „Ansicht Karten/Tabelle"
 *   C  `label:has(> input[type="checkbox"])` removed → red: „Häkchen mit Beschriftung"
 *   D  (28.10.) the checkbox again as a 22 px box without its own surface
 *      → red: „Häkchen allein (22×22)"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PUBLIC = path.join(__dirname, '..', 'public');
const STILE = ['tokens.css', 'styles.css', 'mobile.css'];

const { chrome } = require('./helpers/app-browser');

/** Per case: name and markup; the measured element carries data-ziel. */
const CASES = [
  ['Textfeld', '<input class="si" data-ziel placeholder="Suchen">'],
  ['Auswahl', '<select data-ziel><option>Alle</option></select>'],
  ['Knopf', '<button class="btn bp" data-ziel>Speichern</button>'],
  ['Kleiner Knopf', '<button class="btn bs btn-sm" data-ziel>✓</button>'],
  ['Ansicht Karten/Tabelle', '<div class="vt"><button class="vb active" data-ziel>▦</button></div>'],
  ['Zeitraum', '<button class="period-btn" data-ziel>Monat</button>'],
  ['Kontomenü', '<button class="ubadge ubadge-button" data-ziel>☰</button>'],
  [
    'Sammlungswahl',
    '<div class="collection-choice" role="tablist"><button type="button" role="tab" data-ziel>Teile</button></div>',
  ],
  [
    'Löschknopf auf der Kachel',
    '<div class="sc" style="width:170px"><div class="ca"><button class="delbtn" data-ziel aria-label="Löschen">×</button></div>' +
      '<div class="sci" style="height:150px;position:relative"></div><div class="sb">Titanic</div></div>',
  ],
  [
    'Häkchen mit Beschriftung',
    '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" style="width:auto" data-ziel> Admin</label>',
  ],
  // Without a label around it the box itself must hold 44 px.
  ['Häkchen allein', '<input type="checkbox" style="width:auto" data-ziel aria-label="Auswahl">'],
  ['Häkchen allein, angehakt', '<input type="checkbox" checked data-ziel aria-label="Auswahl">'],
];

function testPage() {
  const css = STILE.map(s => `<link rel="stylesheet" href="file://${path.join(PUBLIC, s)}">`).join('\n');
  const cases = CASES.map(([, html], i) => `<section data-fall="${i}" style="margin:24px 16px">${html}</section>`).join(
    '\n',
  );
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">${css}</head>
<body>${cases}<pre id="ergebnis"></pre>
<script>
window.addEventListener('load', () => {
  const MIN = 44, h = MIN / 2 - 0.5;
  const out = [...document.querySelectorAll('[data-fall]')].map(sec => {
    const el = sec.querySelector('[data-ziel]');
    // Ein Häkchen in einer Beschriftung: Die Beschriftung ist die Tippfläche.
    const target = (el.type === 'checkbox' && el.closest('label')) || el;
    const r = target.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    target.scrollIntoView({ block: 'center' });
    const r2 = target.getBoundingClientRect(), x = r2.left + r2.width / 2, y = r2.top + r2.height / 2;
    const matches = ([a, b]) => { const t = document.elementFromPoint(a, b); return !!t && (t === target || target.contains(t)); };
    const ok = [[x - h, y], [x + h, y], [x, y - h], [x, y + h]].every(matches);
    return { fall: +sec.dataset.fall, ok, w: Math.round(r.width), h: Math.round(r.height) };
  });
  document.getElementById('ergebnis').textContent = 'ERGEBNIS' + JSON.stringify(out) + 'ENDE';
});
</script></body></html>`;
}

test('on the phone every control is at least 44 px large', t => {
  const bin = chrome();
  if (!bin) {
    t.skip('no Chrome found');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tippziele-'));
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
      '--window-size=390,844',
      '--virtual-time-budget=3000',
      '--dump-dom',
      `file://${file}`,
    ],
    { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
  assert.ok(m, 'The test page wrote no result');
  const outcome = JSON.parse((m[1] ?? '').replace(/&quot;/g, '"'));
  assert.equal(outcome.length, CASES.length);
  const toSmall = outcome.filter(e => !e.ok).map(e => `${CASES[e.fall]?.[0]} (${e.w}×${e.h})`);
  assert.deepEqual(toSmall, []);
});
