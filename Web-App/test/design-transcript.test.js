/**
 * The colors BOTH UIs must carry identically appear ONCE.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCss, QUELLE, TARGET_CSS } = require('../scripts/generate-design-tokens.js');

// TREE, not ROOT: in every other test file of this folder `ROOT` means
// the root of the WEB APP. eigenbruecken.test.js relies on that to check every
// `path.join(TREE, ...)` against the web tree — and promptly reported this file
// as broken because the root of the REPOSITORY is meant here. The same name
// for two different things; the name changes, not the rule.
const TREE = path.join(__dirname, '..', '..');
const CSS_BASIS = path.join(TREE, 'Web-App', 'public', 'styles.css');
const CSS_BRICK = path.join(TREE, 'Web-App', 'public', 'themes', 'brick.css');
const CSS_MOBILE = path.join(TREE, 'Web-App', 'public', 'mobile.css');
const INDEX = path.join(TREE, 'Web-App', 'public', 'index.html');
const DATEN = JSON.parse(fs.readFileSync(QUELLE, 'utf8'));

// The Kotlin products (DesignTokens.kt, DunkelTokens.kt) are checked by the Android run with
// `node scripts/generate-design-tokens.js --pruefen`.
test('the generated stylesheet matches shared/design-tokens.json', () => {
  // Counter-check (30.10., measured): "txt" set to #e6e9ee by hand there → red.
  assert.equal(
    fs.readFileSync(TARGET_CSS, 'utf8'),
    buildCss(DATEN),
    'public/tokens.css weicht von shared/design-tokens.json ab. Entweder wurde die Datei von Hand ' +
      'geaendert — dann gehoert der Wert in die JSON —, oder es fehlt ein Lauf von "npm run design:tokens".',
  );
});

test('no handwritten stylesheet redefines a generated token', () => {
  // An own --b600 in styles.css would win (loaded later); the app would keep following the source.
  const erzeugt = new Set(Object.values(DATEN.designs).flatMap(t => Object.keys(t)));
  assert.ok(erzeugt.size >= 10, `Nur ${erzeugt.size} erzeugte Tokens — greift die Suche noch?`);

  const doppelt = [];
  for (const datei of [CSS_BASIS, CSS_BRICK, CSS_MOBILE]) {
    // The dark variants (since 29.10.) are a second assignment of the same
    // names; the light one is read here.
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

test('index.html loads the generated tokens', () => {
  // Without this line every var(--b600) in the web delivers nothing — and silently:
  // the page builds up, only colorless.
  const html = fs.readFileSync(INDEX, 'utf8');
  const place = html.indexOf('/tokens.css');
  assert.ok(
    place > 0,
    'index.html laedt /tokens.css nicht — im Web fehlt dann ' +
      'jede gemeinsame Farbe, ohne dass irgendwo ein Fehler erscheint.',
  );
  // And BEFORE styles.css: the tokens are the foundation, everything else builds
  // on them. (For resolving var() the order would not matter —
  // for the human reading the file it does.)
  assert.ok(
    place < html.indexOf('/styles.css'),
    'tokens.css wird nach styles.css geladen — die Grundlage gehoert nach oben.',
  );
});

// The build (`npm run build`) calls the generator; in a checkout without
// the Android app (Docker build, partial clone) it must not fail on that.
// Counter-check (measured 02.11.2026): the folder check removed in the generator →
// red (ENOENT when writing DesignTokens.kt, exit 1).
test('without the Android app the generator only writes the web CSS', () => {
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
