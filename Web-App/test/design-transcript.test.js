/**
 * The colors BOTH UIs must carry identically appear ONCE.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCss, cssToken, SOURCE, TARGET_CSS } = require('../scripts/generate-design-tokens.js');

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
const DATA = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));

// The Kotlin products (DesignTokens.kt, DunkelTokens.kt) are checked by the Android run with
// `node scripts/generate-design-tokens.js --pruefen`.
test('the generated stylesheet matches shared/design-tokens.json', () => {
  // Counter-check (30.10., measured): "txt" set to #e6e9ee by hand there → red.
  assert.equal(
    fs.readFileSync(TARGET_CSS, 'utf8'),
    buildCss(DATA),
    'public/tokens.css differs from shared/design-tokens.json. Either the file was changed by hand ' +
      '— then the value belongs in the JSON — or a run of "npm run design:tokens" is missing.',
  );
});

test('no handwritten stylesheet redefines a generated token', () => {
  // An own --b600 in styles.css would win (loaded later); the app would keep following the source.
  const generated = new Set(Object.values(DATA.designs).flatMap(t => Object.keys(t).map(cssToken)));
  assert.ok(generated.size >= 10, `Only ${generated.size} generated tokens — does the search still match?`);

  const twice = [];
  for (const file of [CSS_BASIS, CSS_BRICK, CSS_MOBILE]) {
    // The dark variants (since 29.10.) are a second assignment of the same
    // names; the light one is read here.
    const src = fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\[data-dark\][^{]*\{[^}]*\}/g, '');
    for (const m of src.matchAll(/--([a-z0-9-]+)\s*:/g)) {
      if (generated.has(m[1])) twice.push(`${path.basename(file)}: --${m[1]}`);
    }
  }
  assert.deepEqual(
    twice,
    [],
    `These tokens are generated AND set by hand:\n  ${twice.join('\n  ')}\nThen the handwritten value applies on the web and the generated one in the app. The value belongs in shared/design-tokens.json.`,
  );
});

test('index.html loads the generated tokens', () => {
  // Without this line every var(--b600) in the web delivers nothing — and silently:
  // the page builds up, only colorless.
  const html = fs.readFileSync(INDEX, 'utf8');
  const place = html.indexOf('/tokens.css');
  assert.ok(
    place > 0,
    'index.html does not load /tokens.css — then the web lacks ' +
      'every shared color, without an error appearing anywhere.',
  );
  // And BEFORE styles.css: the tokens are the foundation, everything else builds
  // on them. (For resolving var() the order would not matter —
  // for the human reading the file it does.)
  assert.ok(
    place < html.indexOf('/styles.css'),
    'tokens.css is loaded after styles.css — the foundation belongs at the top.',
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
    fs.copyFileSync(SOURCE, path.join(tmp, 'shared', 'design-tokens.json'));
    const script = path.join(tmp, 'Web-App', 'scripts', 'generate-design-tokens.js');
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'generate-design-tokens.js'), script);
    const r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(path.join(tmp, 'Web-App', 'public', 'tokens.css'), 'utf8'), buildCss(DATA));
    assert.deepEqual(fs.readdirSync(tmp).sort(), ['Web-App', 'shared'], 'the generator creates the Android folder');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
