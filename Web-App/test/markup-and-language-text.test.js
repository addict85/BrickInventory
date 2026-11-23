/**
 * What stands in the markup is also what the language text says.
 *
 * ── Counter-checks (carried out, results copied) ────────────────────
 *
 *   A  a markup text set differently again
 *      → “every fallback text shows what the language text says” red, names it
 *   B  the `(Admin)` field back under a `data-i18n` element
 *      → “no element with data-i18n has child elements” red
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

/** Escaped in the text node what belongs escaped there. */
const escHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function languageTexts() {
  const de = fs.readFileSync(path.join(ROOT, 'public', 'locales', 'de.js'), 'utf8');
  return new Map(
    [...de.matchAll(/^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)'/gm)].map(m => [m[1], m[2].replace(/\\'/g, "'")]),
  );
}

test('every fallback text shows what the language text says', () => {
  const texts = languageTexts();
  const placeList = [...HTML.matchAll(/(<[a-z]+\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)([^<]+)</g)];
  // Self-proof: MEASURED there are over 200. If the derivation finds nothing,
  // the loop would be silently green.
  assert.ok(placeList.length > 150, `Only ${placeList.length} places derived — does the search still work?`);

  const deviating = [];
  let checked = 0;
  for (const [, tag, key, text] of placeList) {
    if (tag.includes('data-i18n-attr')) continue; // exception 1
    const want = texts.get(key);
    if (want === undefined) continue; // i18n.test.js covers missing keys
    if (want.includes('{')) continue; // exception 2
    checked++;
    if (escHtml(want) !== text.trim()) deviating.push(`${key}: Markup "${text.trim()}" ≠ "${want}"`);
  }
  assert.ok(checked > 100, `Only ${checked} places actually checked — are the exceptions too broad?`);
  assert.deepEqual(
    deviating,
    [],
    `${deviating.length} fallback texts differ from the language text:\n  ` +
      deviating.join('\n  ') +
      '\n\nWhat is visible is the LANGUAGE TEXT. The text in the markup is only the fallback ' +
      'for the moment before translating — if they drift apart, you see ' +
      'one thing while developing and another in production.',
  );
});

test('no element with data-i18n has child elements', () => {
  const bad = [];
  for (const m of HTML.matchAll(/<([a-z]+)\b([^>]*\bdata-i18n="([^"]+)"[^>]*)>/g)) {
    if (m[2].includes('data-i18n-attr')) continue;
    const tag = m[1];
    const rest = HTML.slice(m.index + m[0].length);
    // Up to the matching closing tag, nested ones of the same name counted.
    let depth = 1,
      i = 0,
      end = -1;
    while (i < rest.length && depth > 0) {
      const opened = rest.indexOf('<' + tag, i);
      const closed = rest.indexOf('</' + tag, i);
      if (closed === -1) break;
      if (opened !== -1 && opened < closed) {
        depth++;
        i = opened + 1;
      } else {
        depth--;
        i = closed + 1;
        end = closed;
      }
    }
    const content = end === -1 ? '' : rest.slice(0, end);
    if (/<[a-z]/i.test(content)) bad.push(`${m[3]}: <${tag}> enthält ${content.match(/<[a-z][^\s>]*/i)[0]}…`);
  }
  assert.deepEqual(
    bad,
    [],
    'These elements carry `data-i18n` AND child elements:\n  ' +
      bad.join('\n  ') +
      '\n\n`textContent` replaces the WHOLE content — the children are gone after the first ' +
      'translation. Attach the key to an inner field.',
  );
});
