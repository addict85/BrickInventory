/**
 * Whoever formats money also says WHICH.
 *
 * Counter-check (measured 08.11.2026): in fmtN `cur||accountCurrency||'EUR'` →
 * `cur||'EUR'` → red: “the fallback of fmtN is the configured currency”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'public', 'js');
const { buildTestBundle } = require('./helpers/bundle');
process.env.TEST_BUNDLE = buildTestBundle('geldformat', "import { fmtN } from './format.js';\nwindow.__fmtN = fmtN;\n");
const { openUi, ANMELDUNG, warte } = require('./helpers/ui');

/**
 * Does this call have a SECOND argument?
 *
 * A pattern like /fmtN\([^)]*,/ is not enough: the arguments themselves contain
 * parentheses (`fmtN(v.total_value, v.currency || accountCurrency)`) and calls. Therefore
 * the parenthesis depth is counted along and only a comma on level 1 counts.
 */
function hatSecondArgument(src, ab) {
  let depth = 0;
  for (let i = ab; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return false;
    } else if (c === ',' && depth === 1) return true;
  }
  return false;
}

test('every fmtN call names the currency', () => {
  const dateien = fs
    .readdirSync(JS)
    .filter(f => f.endsWith('.js') && f !== 'app.bundle.js')
    .map(f => [
      f,
      fs
        .readFileSync(path.join(JS, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, ''),
    ]);
  assert.ok(dateien.length >= 10, `Only ${dateien.length} script files found`);

  let found = 0;
  const ohne = [];
  for (const [rel, src] of dateien)
    for (const m of src.matchAll(/\bfmtN\(/g)) {
      // The definition itself is not a call.
      if (/function\s+fmtN\($/.test(src.slice(0, m.index + 5))) continue;
      found++;
      if (!hatSecondArgument(src, m.index + 4)) {
        const row = src.slice(0, m.index).split('\n').length;
        ohne.push(`${rel}:${row}  ${src.slice(m.index, m.index + 46).split('\n')[0]}`);
      }
    }
  // Self-proof: if the pattern finds nothing, the list would be empty and the test
  // green without having checked anything. MEASURED there are 30 calls.
  assert.ok(found >= 20, `Only ${found} fmtN calls found — pattern outdated?`);

  assert.deepEqual(
    ohne.sort(),
    [],
    'These fmtN calls name no currency:\n  ' +
      ohne.join('\n  ') +
      '\nEither it is missing (then the currency of another user shows there), ' +
      'or it is not an amount of money at all — then it should be ' +
      '`(n||0).toLocaleString(locale())`, as on the part tile.',
  );
});

/**
 * Second line of defense: should a call without a currency arise after all,
 * it shows the CONFIGURED one — not euros for somebody who calculates in
 * francs. On the bundle in jsdom, with francs in the settings.
 */
test('the fallback of fmtN is the configured currency', async () => {
  const { w } = await openUi({
    '/v2/settings/raw': { success: true, settings: { ...ANMELDUNG['/v2/settings/raw'].settings, currency: 'CHF' } },
  });
  try {
    assert.ok(await warte(() => /CHF/.test(w.__fmtN(12.5))), `without currency: ${w.__fmtN(12.5)}`);
    assert.match(w.__fmtN(12.5, 'USD'), /\$|USD/, 'The named currency wins');
  } finally {
    w.close();
  }
});
