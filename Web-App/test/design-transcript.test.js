/**
 * Die Farben, die BEIDE Oberflaechen gleich fuehren muessen, stehen EINMAL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCss, QUELLE, TARGET_CSS } = require('../scripts/generate-design-tokens.js');

// TREE, nicht ROOT: In jeder anderen Testdatei dieses Ordners heisst `ROOT`
// die Wurzel der WEB-APP. eigenbruecken.test.js prueft darauf gestuetzt jeden
// `path.join(TREE, ...)` gegen den Web-Baum — und meldete diese Datei prompt
// als kaputt, weil hier die Wurzel des REPOSITORYS gemeint ist. Derselbe Name
// fuer zwei verschiedene Dinge; der Name wechselt, nicht die Regel.
const TREE = path.join(__dirname, '..', '..');
const CSS_BASIS = path.join(TREE, 'Web-App', 'public', 'styles.css');
const CSS_BRICK = path.join(TREE, 'Web-App', 'public', 'themes', 'brick.css');
const CSS_MOBILE = path.join(TREE, 'Web-App', 'public', 'mobile.css');
const INDEX = path.join(TREE, 'Web-App', 'public', 'index.html');
const DATEN = JSON.parse(fs.readFileSync(QUELLE, 'utf8'));

// Die Kotlin-Erzeugnisse (DesignTokens.kt, DunkelTokens.kt) prüft der Android-Lauf mit
// `node scripts/generate-design-tokens.js --pruefen`.
test('das erzeugte Stylesheet stimmt mit shared/design-tokens.json ueberein', () => {
  // Gegenprobe (30.10., gemessen): dort "txt" von Hand auf #e6e9ee → rot.
  assert.equal(
    fs.readFileSync(TARGET_CSS, 'utf8'),
    buildCss(DATEN),
    'public/tokens.css weicht von shared/design-tokens.json ab. Entweder wurde die Datei von Hand ' +
      'geaendert — dann gehoert der Wert in die JSON —, oder es fehlt ein Lauf von "npm run design:tokens".',
  );
});

test('kein handgeschriebenes Stylesheet definiert einen erzeugten Token neu', () => {
  // Ein eigenes --b600 in styles.css gewänne (später geladen); die App folgte weiter der Quelle.
  const erzeugt = new Set(Object.values(DATEN.designs).flatMap(t => Object.keys(t)));
  assert.ok(erzeugt.size >= 10, `Nur ${erzeugt.size} erzeugte Tokens — greift die Suche noch?`);

  const doppelt = [];
  for (const datei of [CSS_BASIS, CSS_BRICK, CSS_MOBILE]) {
    // Die dunklen Varianten (seit 29.10.) sind eine zweite Belegung derselben
    // Namen; gelesen wird hier die helle.
    const src = fs
      .readFileSync(datei, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\[data-dunkel\][^{]*\{[^}]*\}/g, '');
    for (const m of src.matchAll(/--([a-z0-9-]+)\s*:/g)) {
      if (erzeugt.has(m[1])) doppelt.push(`${path.basename(datei)}: --${m[1]}`);
    }
  }
  assert.deepEqual(
    doppelt,
    [],
    'Diese Tokens werden erzeugt UND von Hand gesetzt:\n  ' +
      doppelt.join('\n  ') +
      '\nDamit gilt im Web der handgeschriebene Wert und in der App der erzeugte. ' +
      'Der Wert gehoert nach shared/design-tokens.json.',
  );
});

test('index.html laedt die erzeugten Tokens', () => {
  // Ohne diese Zeile liefert jedes var(--b600) im Web nichts — und zwar still:
  // Die Seite baut sich auf, nur farblos.
  const html = fs.readFileSync(INDEX, 'utf8');
  const place = html.indexOf('/tokens.css');
  assert.ok(
    place > 0,
    'index.html laedt /tokens.css nicht — im Web fehlt dann ' +
      'jede gemeinsame Farbe, ohne dass irgendwo ein Fehler erscheint.',
  );
  // Und zwar VOR styles.css: Die Tokens sind die Grundlage, alles andere baut
  // darauf auf. (Fuer die Aufloesung von var() waere die Reihenfolge egal —
  // fuer den Menschen, der die Datei liest, nicht.)
  assert.ok(
    place < html.indexOf('/styles.css'),
    'tokens.css wird nach styles.css geladen — die Grundlage gehoert nach oben.',
  );
});

// Der Bau (`npm run build`) ruft den Erzeuger auf; in einem Checkout ohne
// Android-App (Docker-Bau, Teil-Klon) darf er daran nicht scheitern.
// Gegenprobe (02.11.2026 gemessen): die Ordnerprüfung im Erzeuger entfernt →
// rot (ENOENT beim Schreiben von DesignTokens.kt, Exit 1).
test('ohne Android-App schreibt der Erzeuger nur das Web-CSS', () => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tokens-'));
  try {
    fs.mkdirSync(path.join(tmp, 'shared'));
    fs.mkdirSync(path.join(tmp, 'Web-App', 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'Web-App', 'public'));
    fs.copyFileSync(QUELLE, path.join(tmp, 'shared', 'design-tokens.json'));
    const script = path.join(tmp, 'Web-App', 'scripts', 'generate-design-tokens.js');
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'generate-design-tokens.js'), script);
    const r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(path.join(tmp, 'Web-App', 'public', 'tokens.css'), 'utf8'), buildCss(DATEN));
    assert.deepEqual(fs.readdirSync(tmp).sort(), ['Web-App', 'shared'], 'der Erzeuger legt den Android-Ordner an');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
