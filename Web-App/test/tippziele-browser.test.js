/**
 * Am Telefon ist jedes Bedienelement mindestens 44 × 44 px gross — gemessen
 * im Browser, nicht im Quelltext gelesen.
 *
 * Eine Testseite lädt dieselben Stylesheets wie index.html und je ein
 * Beispiel der Bedienelemente, die vorher zu klein waren. Chrome rendert sie
 * bei 390 px Breite; ein Skript in der Seite tippt um jedes Element herum
 * (elementFromPoint 22 px links, rechts, oben und unten der Mitte) und
 * schreibt das Ergebnis ins DOM, das `--dump-dom` ausgibt. So zählt auch eine
 * Tippfläche, die per ::after über den sichtbaren Knopf hinausreicht.
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  in mobile.css `.delbtn::after` entfernt → rot: „Löschknopf auf der Kachel"
 *   B  in mobile.css `.vb` aus der 44-px-Zeile genommen → rot: „Ansicht Karten/Tabelle"
 *   C  `label:has(> input[type="checkbox"])` entfernt → rot: „Häkchen mit Beschriftung"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PUBLIC = path.join(__dirname, '..', 'public');
const STILE = ['tokens.css', 'styles.css', 'mobile.css'];

function chrome() {
  const kandidaten = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];
  return kandidaten.find(k => k && fs.existsSync(k)) ?? null;
}

/** Je Fall: Name und Markup; das gemessene Element trägt data-ziel. */
const FAELLE = [
  ['Textfeld', '<input class="si" data-ziel placeholder="Suchen">'],
  ['Auswahl', '<select data-ziel><option>Alle</option></select>'],
  ['Knopf', '<button class="btn bp" data-ziel>Speichern</button>'],
  ['Kleiner Knopf', '<button class="btn bs btn-sm" data-ziel>✓</button>'],
  ['Ansicht Karten/Tabelle', '<div class="vt"><button class="vb active" data-ziel>▦</button></div>'],
  ['Zeitraum', '<button class="period-btn" data-ziel>Monat</button>'],
  ['Kontomenü', '<button class="ubadge ubadge-knopf" data-ziel>☰</button>'],
  ['Sammlungswahl', '<div class="sammlung-wahl" role="tablist"><button type="button" role="tab" data-ziel>Teile</button></div>'],
  ['Löschknopf auf der Kachel',
    '<div class="sc" style="width:170px"><div class="ca"><button class="delbtn" data-ziel aria-label="Löschen">×</button></div>' +
    '<div class="sci" style="height:150px;position:relative"></div><div class="sb">Titanic</div></div>'],
  ['Häkchen mit Beschriftung',
    '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" style="width:auto" data-ziel> Admin</label>'],
];

function testseite() {
  const css = STILE.map(s => `<link rel="stylesheet" href="file://${path.join(PUBLIC, s)}">`).join('\n');
  const faelle = FAELLE.map(([name, html], i) =>
    `<section data-fall="${i}" style="margin:24px 16px">${html}</section>`).join('\n');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">${css}</head>
<body>${faelle}<pre id="ergebnis"></pre>
<script>
window.addEventListener('load', () => {
  const MIN = 44, h = MIN / 2 - 0.5;
  const aus = [...document.querySelectorAll('[data-fall]')].map(sec => {
    const el = sec.querySelector('[data-ziel]');
    // Ein Häkchen in einer Beschriftung: Die Beschriftung ist die Tippfläche.
    const ziel = (el.type === 'checkbox' && el.closest('label')) || el;
    const r = ziel.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    ziel.scrollIntoView({ block: 'center' });
    const r2 = ziel.getBoundingClientRect(), x = r2.left + r2.width / 2, y = r2.top + r2.height / 2;
    const trifft = ([a, b]) => { const t = document.elementFromPoint(a, b); return !!t && (t === ziel || ziel.contains(t)); };
    const ok = [[x - h, y], [x + h, y], [x, y - h], [x, y + h]].every(trifft);
    return { fall: +sec.dataset.fall, ok, w: Math.round(r.width), h: Math.round(r.height) };
  });
  document.getElementById('ergebnis').textContent = 'ERGEBNIS' + JSON.stringify(aus) + 'ENDE';
});
</script></body></html>`;
}

test('am Telefon ist jedes Bedienelement mindestens 44 px gross', (t) => {
  const bin = chrome();
  if (!bin) { t.skip('kein Chrome gefunden'); return; }
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'tippziele-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const datei = path.join(ordner, 'seite.html');
  fs.writeFileSync(datei, testseite());
  const dom = execFileSync(bin, ['--headless', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
    '--window-size=390,844', '--virtual-time-budget=3000', '--dump-dom', `file://${datei}`],
    { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] });
  const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
  assert.ok(m, 'Die Testseite hat kein Ergebnis geschrieben');
  const ergebnis = JSON.parse((m[1] ?? '').replace(/&quot;/g, '"'));
  assert.equal(ergebnis.length, FAELLE.length);
  const zuKlein = ergebnis.filter(e => !e.ok).map(e => `${FAELLE[e.fall]?.[0]} (${e.w}×${e.h})`);
  assert.deepEqual(zuKlein, []);
});
