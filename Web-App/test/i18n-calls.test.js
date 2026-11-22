/**
 * Every key the UI calls also stands in the dictionary.
 *
 * Counter-check: `t('zz.missing.key')` appended to public/js/catalog.js → red “every called i18n key is in the dictionary”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadTranslations } = require('./helpers/sources');
const ROOT = path.join(__dirname, '..');

/** All source files of the UI — without comments, without the bundle. */
function oberflaeche() {
  const out = [];
  const lauf = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      // locales/ itself contains the keys as a definition, not as a call.
      if (e.isDirectory()) {
        if (!/node_modules|locales/.test(p)) lauf(p);
        continue;
      }
      if (!/\.(js|html)$/.test(e.name) || e.name === 'app.bundle.js') continue;
      // Comments out FIRST: i18n.js documents its own usage with
      // `t('key')` in a comment. Without this step the sample call
      // counts as a real location — exactly the trap that
      // test/helpers/sources.js warns about.
      out.push([
        path.relative(ROOT, p),
        fs
          .readFileSync(p, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, ''),
      ]);
    }
  };
  lauf(path.join(ROOT, 'public'));
  return out;
}

const CALL = /\bt(?:Raw)?\(\s*'([a-z0-9_.]+)'|\bt(?:Raw)?\(\s*"([a-z0-9_.]+)"|data-i18n(?:-tab)?="([a-z0-9_.]+)"/g;

test('every called i18n key is in the dictionary', () => {
  const { de, en } = loadTranslations();
  const existing = new Set([...Object.keys(de), ...Object.keys(en)]);
  assert.ok(existing.size >= 400, `Only ${existing.size} keys loaded — path or format outdated?`);

  const dateien = oberflaeche();
  assert.ok(dateien.length >= 15, `Only ${dateien.length} source files found`);

  const gerufen = new Map();
  for (const [rel, src] of dateien)
    for (const m of src.matchAll(CALL)) {
      const k = m[1] || m[2] || m[3];
      if (!gerufen.has(k)) gerufen.set(k, rel);
    }
  // Self-proof: if the pattern no longer matches, the set would be empty and the
  // test green without having checked anything. MEASURED there are 542.
  assert.ok(gerufen.size >= 300, `Only ${gerufen.size} call sites found — pattern outdated?`);

  // Composed keys (`t('monitor.job.' + k)`) end in a dot.
  const prefixes = [...gerufen.keys()].filter(k => k.endsWith('.'));
  assert.equal(
    prefixes.length,
    1,
    `${prefixes.length} composed keys (${prefixes.join(', ')}) — expected ` +
      'is exactly one (monitor.job.). A second one needs the same safeguard ' +
      'as it: check the result against the key and fall back to something ' +
      'else.',
  );

  const absent = [...gerufen]
    .filter(([k]) => !k.endsWith('.') && !existing.has(k))
    .map(([k, rel]) => `${k}   (${rel})`)
    .sort();
  assert.deepEqual(
    absent,
    [],
    'The UI calls these keys, but they do not exist:\n  ' +
      absent.join('\n  ') +
      '\nt() then outputs the key itself — visible in the text, in the aria-label ' +
      'the screen reader reads it aloud.',
  );
});

/**
 * And the form of the call?
 */
test('every data-i18n form is also evaluated by applyLang', () => {
  const i18n = fs
    .readFileSync(path.join(ROOT, 'public', 'i18n.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // dataset.i18nAttr → data-i18n-attr; dataset.i18n → data-i18n.
  const erlaubt = new Set(
    [...i18n.matchAll(/\bdataset\.(i18n[A-Za-z]*)/g)].map(
      m => 'data-' + m[1].replace(/[A-Z]/g, c => '-' + c.toLowerCase()),
    ),
  );
  assert.ok(
    erlaubt.size >= 3,
    `Only ${erlaubt.size} forms found in i18n.js (${[...erlaubt].join(', ')}) — pattern outdated?`,
  );

  const benutzt = new Map();
  for (const [rel, src] of oberflaeche())
    for (const m of src.matchAll(/\b(data-i18n[a-z-]*)\s*=/g)) if (!benutzt.has(m[1])) benutzt.set(m[1], rel);
  // MEASURED there are four forms, 386 occurrences.
  assert.ok(benutzt.size >= 2, `Only ${benutzt.size} data-i18n forms found in the markup`);

  const ineffective = [...benutzt]
    .filter(([f]) => !erlaubt.has(f))
    .map(([f, rel]) => `${f}   (${rel})`)
    .sort();
  assert.deepEqual(
    ineffective,
    [],
    'applyLang() does not evaluate these data-i18n forms:\n  ' +
      ineffective.join('\n  ') +
      `\nOnly these are evaluated: ${[...erlaubt].sort().join(', ')}. An attribute that ` +
      'is none of them looks like a translation and leaves the text as it ' +
      'is in the source — in every language.',
  );
});
