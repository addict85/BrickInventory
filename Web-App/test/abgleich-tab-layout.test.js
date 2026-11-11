/**
 * Reihenfolge der Reiter-Bereiche: Erfassen → Suche/Filter → Liste, so wie
 * Chrome sie zeichnet (echtes index.html mit den Stilen, alle Reiter und alle
 * erst später eingeblendeten Bereiche offen, 1200 px breit). Gemessen werden die Oberkanten, nicht die Zeilen im Markup:
 * Eine Flex-Reihenfolge oder ein Raster kann die Folge umdrehen.
 * Die App bleibt Kotlin-Struktur (kein SDK hier).
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln):
 *   A  in styles.css #tab-gallery als Flex-Spalte mit `.erfassen-leiste{order:9}`
 *      → rot: „Erfassen steht über den Filtern …“ (Galerie) — im Markup
 *      stünde alles noch richtig
 *   B  `.filterzeile{… margin-bottom:1rem}` → rot: „die Filterleisten halten Abstand …“
 *   C  #btn-pl-bestand hinter #pl-setnr in die Werkzeugzeile verschoben → rot:
 *      „der eigene Bestand …“
 *   D  in PartsListScreen.kt R.string.partslist_reset umbenannt → rot: „die App …“
 */
// Abgleich Web↔App: läuft in web-ci auch bei Änderungen unter Android-App/ (paths-Filter).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chrome } = require('./helpers/app-browser');

const PUBLIC = path.join(__dirname, '..', 'public');
const STILE = ['vendor/fonts/fonts.css', 'tokens.css', 'styles.css'];

/** Erfassen, Filter, Liste je Reiter — als Selektoren auf das gezeichnete Dokument. */
const REITER = {
  Galerie:     ['[data-click="oeffneErfassen"][data-arg="set"]',  '#gs',           '#gallery'],
  Teile:       ['[data-click="oeffneErfassen"][data-arg="part"]', '#parts-search', '#manual-parts-list', '#parts-main'],
  Minifiguren: ['[data-click="oeffneErfassen"][data-arg="fig"]',  '#fig-search',   '#manual-figs-list',  '#figs-list'],
  Katalog:     ['[data-tab-title="catalog"]',                     '#cat-search',   '#catalog-grid'],
};
const EINMAL = ['gs', 'gtheme', 'gsort', 'scope-gallery', 'vg', 'vl', 'parts-search', 'parts-spare', 'parts-view',
  'scope-parts', 'fig-search', 'figs-view', 'scope-minifigs'];

/** Misst im gezeichneten index.html; liefert, was `messung` (Funktionsrumpf im Browser) zurückgibt. */
let _ergebnis;
function gemessen(t) {
  if (_ergebnis !== undefined) return _ergebnis;
  const bin = chrome();
  if (!bin) { t.skip('kein Chrome gefunden'); _ergebnis = null; return null; }
  const html = require('./helpers/sources').ohneHtmlKommentare(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'));
  const koerper = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/data-stil="display:none;?/g, 'style="').replace(/data-stil="/g, 'style="').replace(/ hidden(?=[ >])/g, '').replace(/<details /g, '<details open ');
  const css = STILE.map(s => `<link rel="stylesheet" href="file://${path.join(PUBLIC, s)}">`).join('\n');
  const seite = `<!doctype html><html lang="de"><head><meta charset="utf-8">${css}
<style>#app{display:block!important}.tab{display:block!important}#login-screen,#startgeruest{display:none!important}</style></head>
${koerper.replace(/^<body[^>]*>/, '<body>')}
<pre id="ergebnis"></pre>
<script>
window.addEventListener('load', () => document.fonts.ready.then(() => {
  const REITER = ${JSON.stringify(REITER)}, EINMAL = ${JSON.stringify(EINMAL)};
  const oben = s => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top) : null; };
  const aus = { reiter: {}, einmal: {}, leisten: [], bestand: {} };
  for (const [n, sel] of Object.entries(REITER)) aus.reiter[n] = sel.map(s => [s, oben(s)]);
  for (const id of EINMAL) aus.einmal[id] = document.querySelectorAll('#' + id).length;
  for (const l of document.querySelectorAll('.filterzeile'))
    aus.leisten.push(parseFloat(getComputedStyle(l).marginBottom) / parseFloat(getComputedStyle(document.documentElement).fontSize));
  const r = id => document.getElementById(id)?.getBoundingClientRect();
  const nr = r('pl-setnr'), b = r('btn-pl-bestand'), lose = r('pl-bestand-lose');
  aus.bestand = { setnr: nr && [nr.top, nr.bottom], knopf: b && [b.top, b.bottom], lose: lose && [lose.top, lose.bottom] };
  document.getElementById('ergebnis').textContent = 'ERGEBNIS' + JSON.stringify(aus) + 'ENDE';
}));
</script></body></html>`;
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'reiterfolge-'));
  try {
    const datei = path.join(ordner, 'seite.html');
    fs.writeFileSync(datei, seite);
    const dom = execFileSync(bin, ['--headless', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
      '--window-size=1200,900', '--virtual-time-budget=3000', '--dump-dom', `file://${datei}`],
      { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
    assert.ok(m, 'Die Testseite hat kein Ergebnis geschrieben');
    _ergebnis = JSON.parse((m[1] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    return _ergebnis;
  } finally { fs.rmSync(ordner, { recursive: true, force: true }); }
}

test('Erfassen steht über den Filtern, die Filter über den Listen (auch der manuellen)', (t) => {
  const e = gemessen(t);
  if (!e) return;
  const falsch = [];
  for (const [name, folge] of Object.entries(e.reiter)) {
    for (const [s, y] of folge) if (y == null) falsch.push(`${name}: ${s} fehlt`);
    for (let i = 1; i < folge.length; i++)
      if (folge[i - 1][1] != null && folge[i][1] != null && !(folge[i - 1][1] < folge[i][1]))
        falsch.push(`${name}: ${folge[i - 1][0]} (${folge[i - 1][1]}) steht nicht über ${folge[i][0]} (${folge[i][1]})`);
  }
  assert.deepEqual(falsch, []);
});

test('jede Bedienelement-ID gibt es genau einmal', (t) => {
  const e = gemessen(t);
  if (!e) return;
  assert.deepEqual(Object.entries(e.einmal).filter(([, n]) => n !== 1).map(([id, n]) => `${id}: ${n}×`), [],
    'Die IDs sind der Vertrag mit dem JS');
});

test('die Filterleisten halten Abstand zur Liste', (t) => {
  const e = gemessen(t);
  if (!e) return;
  assert.equal(e.leisten.length, 5, 'Galerie, Teile, Minifiguren, Katalog, Merkliste');
  assert.deepEqual(e.leisten.filter(rem => rem < 1.5), [], 'Abstand unter 1.5rem');
});

test('der eigene Bestand steht in der Teileliste auf einer eigenen Zeile', (t) => {
  const e = gemessen(t);
  if (!e) return;
  const { setnr, knopf, lose } = e.bestand;
  assert.ok(setnr && knopf && lose, 'Set-Nummer, Bestand-Knopf oder „nur lose“ fehlt');
  // Die Werkzeugzeile trägt flex-wrap:nowrap: ein Knopf mehr schöbe dort den Rest aus dem Bild.
  assert.ok(knopf[0] >= setnr[1], `der Bestand-Knopf (${knopf[0]}) steht in der Werkzeugzeile (bis ${setnr[1]})`);
  assert.ok(lose[0] >= setnr[1], '„nur lose Teile“ steht in der Werkzeugzeile');
});

test('die App hält den eigenen Bestand ebenfalls aus der Werkzeugzeile heraus', () => {
  // Dieselbe Regel für die andere Oberfläche. In der App ist die Reihenfolge
  // im Quelltext die Aussage: „Reset" ist der letzte Knopf der Werkzeug-Row,
  // also steht alles danach ausserhalb davon.
  const ohneKommentare = (/** @type {string} */ s) => require('./helpers/sources').ohneKommentare(s);
  const src = ohneKommentare(fs.readFileSync(path.join(__dirname, '..', '..', 'Android-App', 'feature-teile', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'teile', 'ui', 'screens', 'PartsListScreen.kt'), 'utf8'));

  const reset  = src.indexOf('R.string.partslist_reset');
  const bestand = src.indexOf('R.string.partslist_fill_owned');
  const lose    = src.indexOf('R.string.partslist_only_loose');
  assert.ok(reset >= 0 && bestand >= 0 && lose >= 0, 'Beschriftungen nicht gefunden — Bildschirm umgebaut?');
  assert.ok(bestand > reset,
    '„Mein Bestand" steht wieder VOR dem Reset-Knopf und damit in derselben ' +
    'Werkzeug-Row. In der Webapp hat Marco genau das beanstandet.');
  assert.ok(lose > bestand,
    '„nur lose Teile" gehört neben den Bestand-Knopf, nicht davor.');
});
