/**
 * The server answers in the language that the requester SHOWS.
 *
 * Counter-checks (measured 10.11.2026, each on its own, reverted):
 *   A  in the German text of too_many_invites `{n}` replaced by `n` → red:
 *      “every entry of the table has both languages and the same placeholders”
 *   B  in api() (api.js) the header Accept-Language deleted (bundle rebuilt)
 *      → red: “the web app tells the server which language it shows”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Where a fixed string MAY remain — and why. Currently nowhere. */
/** @type {Record<string, string>} */
const ALLOWED = {};

/** All .ts under the given folders, also in subfolders. */
function tsFiles(dir, prefix = '') {
  const found = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) found.push(...tsFiles(path.join(dir, e.name), prefix + e.name + '/'));
    else if (e.name.endsWith('.ts')) found.push([prefix + e.name, path.join(dir, e.name)]);
  }
  return found;
}

test('no route sends a fixed error sentence', () => {
  const files = [
    ...tsFiles(path.join(ROOT, 'routes')).map(([r, p]) => [r, p]),
    ...tsFiles(path.join(ROOT, 'src')).map(([r, p]) => [r, p]),
    ...tsFiles(path.join(ROOT, 'jobs')).map(([r, p]) => [r, p]),
  ];
  assert.ok(files.length >= 30, `Only ${files.length} files found — then the rest checks nothing.`);

  const violations = [];
  const used = new Set();
  for (const [, full] of files) {
    // The key in ALLOWED is the path from Web-App/ — assemble it here.
    const belowFolder = path.relative(ROOT, full).split(path.sep).join('/');
    const src = fs
      .readFileSync(full, 'utf8')
      .split('\n')
      .filter(z => !z.trimStart().startsWith('//') && !z.trimStart().startsWith('*'))
      .join('\n');
    // NO backtick and NO line break in the text: the first draft took
    // both and thereby ran across line ends — it reported six places
    // at which `error:` stands in the middle of a LOG TEXT
    // (`console.error(\`[pdf] error: \`, e.message)`). Six false alarms for …
    for (const m of src.matchAll(/error:\s*(['"])((?:[^\\\n]|\\.)*?)\1/g)) {
      const text = m[2];
      // Variables and empty values are not sentences.
      if (!text || text.length < 4) continue;
      if (/^[a-z_.]+$/.test(text)) continue;
      const row = src.slice(0, m.index).split('\n').length;
      // An allowed file is SEARCHED nevertheless — only its hit does not end up
      // in the violations, but proves that the exception is still
      // needed. If one skips it right away instead, its entry can
      // remain for years without describing anything any more.
      if (belowFolder in ALLOWED) used.add(belowFolder);
      else violations.push(`${belowFolder}:${row}  ${text.slice(0, 60)}`);
    }
  }

  // Here stood `src/infra/errorTexts.ts` with the reasoning „Die Tabelle
  // selbst." — and the file did not even hit the pattern: it carries its texts
  // as `{ de: '…', en: '…' }`, never as `error: '…'`. So the entry hid
  // nothing, but of all files exempted the one in which ALL error texts
  // stand from this check. So that this does not come back:
  const stale = Object.keys(ALLOWED)
    .filter(k => !used.has(k))
    .sort();
  assert.deepEqual(
    stale,
    [],
    'These entries in ALLOWED no longer describe anything:\n  ' +
      stale.join('\n  ') +
      '\nThe file no longer contains a fixed error sentence. The entry still exempts it ' +
      'from the check — remove it.',
  );

  assert.deepEqual(
    violations,
    [],
    'These places send a fixed sentence instead of sendError(req, res, …, code):\n  ' +
      violations.join('\n  ') +
      '\nThat way the message exists in only one language — in an interface ' +
      'that exists in two.',
  );
});

test('every entry of the table has both languages and the same placeholders', () => {
  // A missing placeholder means that in one language „{name}" stands on the screen.
  const { ERRORS, errorText } = require('./helpers/sources').buildAndRequire()('src/infra/errorTexts.js');
  const codes = Object.keys(ERRORS);
  assert.ok(codes.length >= 60, `Only ${codes.length} entries — does the table still work?`);
  const skewed = [];
  for (const code of codes) {
    const vars = {};
    for (const language of ['de', 'en']) {
      if (!String(ERRORS[code][language] || '').trim()) skewed.push(`${code}: ${language} fehlt`);
      for (const [, n] of String(ERRORS[code][language] || '').matchAll(/\{(\w+)\}/g)) vars[n] = `«${n}»`;
    }
    // Filled with all placeholders of both languages, no brace remains in either.
    for (const language of ['de', 'en']) {
      const text = errorText(code, language, vars);
      if (/\{\w+\}/.test(text)) skewed.push(`${code}/${language}: ${text}`);
      for (const n of Object.keys(vars)) if (!text.includes(`«${n}»`)) skewed.push(`${code}/${language}: {${n}} fehlt`);
    }
  }
  assert.deepEqual(skewed, []);
});

test('the web app tells the server which language it shows', async () => {
  // Without this header the server would fall back to German, and the table above would be ineffective.
  const { openUi } = require('./helpers/ui');
  for (const language of ['en', 'de']) {
    const { w, calls } = await openUi({}, { language });
    try {
      const api = calls.filter(a => a.url.includes('/api/v2/'));
      assert.ok(api.length >= 5, `only ${api.length} requests`);
      assert.deepEqual(
        api.filter(a => a.headers['Accept-Language'] !== language).map(a => a.url),
        [],
        `without language ${language}`,
      );
    } finally {
      w.close();
    }
  }
});
