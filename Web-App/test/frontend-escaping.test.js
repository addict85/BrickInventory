/**
 * Static XSS regression test for public/js/.
 */
const { isAppModule } = require('../scripts/build-frontend');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS_DIR = path.join(__dirname, '..', 'public', 'js');
const FILES = fs
  .readdirSync(JS_DIR)
  .filter(f => isAppModule(f))
  .sort();

// The helpers themselves, not rebuilt: escaping.js is DOM-free and loads in Node.
const helper = import(require('node:url').pathToFileURL(path.join(JS_DIR, 'escaping.js')).href);
const loadHelpers = () => helper;

test('esc() neutralizes all HTML metacharacters incl. apostrophe', async () => {
  const { esc } = await loadHelpers();
  assert.equal(esc('<script>'), '&lt;script&gt;');
  assert.equal(esc('a"b'), 'a&quot;b');
  assert.equal(esc("a'b"), 'a&#39;b');
  assert.equal(esc('a&b'), 'a&amp;b');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

// Counter-check (08.11.2026): “\\” and control characters removed from the regex of safeUrl() → red: “/\\host” got through.
test('safeUrl() only lets same origin, http(s) and image data through', async () => {
  const { safeUrl } = await loadHelpers();
  for (const good of [
    '/img/a.png',
    '/',
    'https://cdn.example/a.png',
    'http://x/y',
    'data:image/png;base64,AAAA',
    ' /pfad ',
  ])
    assert.equal(safeUrl(good), good.trim(), `„${good}“ wrongly rejected`);
  for (const badOne of [
    '//evil.example/x',
    '/\\evil.example/x',
    '/\\\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    'javascript:alert(1)',
    'https:\\\\evil.example',
    'ftp://x',
    'evil.example',
    '',
    null,
    undefined,
  ])
    assert.equal(safeUrl(badOne), '', `„${badOne}“ got through`);
});

test('escJs() does not break out of onclick="fn(\'…\')"', async () => {
  const { escJs } = await loadHelpers();
  // The classic breakout: an apostrophe closes the JS string, code afterwards.
  const payload = "');alert(1);//";
  const out = escJs(payload);
  assert.ok(!/(^|[^\\])'/.test(out), `apostrophe not escaped: ${out}`);
  assert.ok(!out.includes('<'), 'Angle bracket not escaped');
  // A backslash must be doubled, otherwise it neutralizes the following \'
  assert.equal(escJs('a\\'), 'a\\\\');
});

test('escUrl() only lets relative paths and http(s) through', async () => {
  const { escUrl } = await loadHelpers();
  assert.equal(escUrl('https://cdn.rebrickable.com/x.jpg'), 'https://cdn.rebrickable.com/x.jpg');
  assert.equal(escUrl('/data/part_images/x.jpg'), '/data/part_images/x.jpg');
  assert.equal(escUrl('javascript:alert(1)'), '');
  assert.equal(escUrl('  JaVaScRiPt:alert(1)'), '');
  assert.equal(escUrl('//evil.tld/x.jpg'), '', 'a protocol-relative URL must go');
  assert.equal(escUrl(''), '');
  // Attribute breakout via a quote in the URL
  assert.ok(!escUrl('https://a/" onerror="alert(1)').includes('"'));
});

test('escHex() exclusively accepts 6 hex digits', async () => {
  const { escHex } = await loadHelpers();
  assert.equal(escHex('FF0000'), '#FF0000');
  assert.equal(escHex('#00ff00'), '#00ff00');
  assert.equal(escHex('red;background:url(x)'), 'var(--s300)');
  assert.equal(escHex(null, 'var(--s50)'), 'var(--s50)');
});

// ── Static sink check ───────────────────────────────────────────────────────
const SAFE = /^\s*(esc|escJs|escUrl|safeUrl|escHex|escHtml|encodeURIComponent|t)\s*\(/;
const DATA_FIELD =
  /(set_number|part_number|bl_part_number|fig_number|bl_fig_number|part_name|fig_name|color_name|category_name|image_url|image_local|note|username|theme|last_error)\b/;

function interpolations(attrValue) {
  return [...attrValue.matchAll(/\$\{([^{}]*)\}/g)].map(m => m[1]);
}

test('no src/href/data-orig with an unchecked URL', () => {
  const bad = [];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    for (const m of src.matchAll(/\b(src|href|data-orig)="([^"#]*\$\{[^"]*)"/g)) {
      for (const expr of interpolations(m[2])) {
        if (!SAFE.test(expr)) bad.push(`${f}: ${m[1]}="…\${${expr}}…"`);
      }
    }
  }
  assert.deepEqual(bad, [], 'URL attributes must go through escUrl()');
});

test('no onXxx handler with an unchecked data field', () => {
  const bad = [];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    for (const m of src.matchAll(/\bon[a-z]+="([^"]*\$\{[^"]*)"/g)) {
      for (const expr of interpolations(m[1])) {
        if (DATA_FIELD.test(expr) && !SAFE.test(expr)) bad.push(`${f}: on…="…\${${expr}}…"`);
      }
    }
  }
  assert.deepEqual(bad, [], 'Values in inline handlers must go through escJs()');
});

test('esc/escJs/escUrl/escHex are defined exactly once', () => {
  // All escapers live in escaping.js (DOM-free, the BrickLink export also
  // loads it). Two versions of the same escaper drifted apart once already.
  const home = { esc: 'escaping.js', escJs: 'escaping.js', escUrl: 'escaping.js', escHex: 'escaping.js' };
  for (const [name, file] of Object.entries(home)) {
    const defs = FILES.filter(f =>
      new RegExp(`function\\s+${name}\\s*\\(`).test(fs.readFileSync(path.join(JS_DIR, f), 'utf8')),
    );
    assert.deepEqual(
      defs,
      [file],
      `${name}() must be declared exactly once (in ${file}) — otherwise ` +
        'escaping depends on the load order, and two versions drift ' +
        'apart. Exactly that was reported by test/wish-list-xml.test.js ' +
        'once before: the app escaped, the web app did not.',
    );
  }
});

test('translations for plain text go via tRaw(), not via t()', () => {
  // Where this test comes from
  const jsDir = path.join(__dirname, '..', 'public', 'js');
  const offenders = [];
  for (const f of fs.readdirSync(jsDir)) {
    if (!f.endsWith('.js') || f === 'app.bundle.js') continue;
    fs.readFileSync(path.join(jsDir, f), 'utf8')
      .split('\n')
      .forEach((l, i) => {
        if (/^\s*(\/\/|\*)/.test(l)) return;
        // Assignment to a text target or call of a function that sets textContent
        if (
          /(\.(?:textContent|value|placeholder|title|alt|label)\s*=\s*|alert\(|confirm\(|toast\(|confirmDelete\()\s*t\(/.test(
            l,
          )
        ) {
          offenders.push(`${f}:${i + 1}`);
        }
      });
  }
  assert.deepEqual(
    offenders,
    [],
    `t() instead of tRaw() at a text target — the escaping would become visible: ${offenders.join(', ')}`,
  );
});

test('server-side error messages go through esc() in the HTML context', () => {
  // Where this test comes from
  const bad = [];
  const FIELD = /\w+\.(?:error|message)\b/g;
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    let ab = 0;
    src.split('\n').forEach((line, i) => {
      const rowFrom = ab;
      ab += line.length + 1;
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (!/<\w/.test(line)) return; // no HTML context
      for (const m of line.matchAll(/\$\{([^}]*)\}/g)) {
        // In html`` the template itself escapes — unless the value goes through rawHtml().
        const ago = src.lastIndexOf('`', rowFrom + (m.index ?? 0));
        if (src.slice(ago - 4, ago) === 'html' && !/rawHtml\(/.test(m[1])) continue;
        // Remove string literals so that translation keys
        // ('…error') do not count as a data field.
        const expression = m[1].replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");
        for (const hits of expression.matchAll(FIELD)) {
          const afterwards = expression.slice(hits.index + hits[0].length).trimStart();
          if (afterwards.startsWith('?')) continue; // Bedingungsstellung
          const before = expression.slice(0, hits.index);
          if (/\besc\s*\($/.test(before)) continue; // already escaped
          bad.push(`${f}:${i + 1}: \${${m[1]}}`);
        }
      }
    });
  }
  assert.deepEqual(
    bad,
    [],
    `Error messages in an HTML context must go through esc() — they can contain text from foreign services: ${bad.join(', ')}`,
  );
});
