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
const { buildTestbuendel } = require('./helpers/bundle');
process.env.TEST_BUNDLE = buildTestbuendel(
  'geldformat',
  "import { fmtN } from './format.js';\nwindow.__fmtN = fmtN;\n",
);
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
  assert.ok(dateien.length >= 10, `Nur ${dateien.length} Skriptdateien gefunden`);

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
  assert.ok(found >= 20, `Nur ${found} fmtN-Aufrufe gefunden — Muster veraltet?`);

  assert.deepEqual(
    ohne.sort(),
    [],
    'Diese fmtN-Aufrufe nennen keine Währung:\n  ' +
      ohne.join('\n  ') +
      '\nEntweder fehlt sie (dann steht dort die Währung eines anderen Nutzers), ' +
      'oder es ist gar kein Geldbetrag — dann gehört dorthin ' +
      '`(n||0).toLocaleString(locale())`, wie auf der Teilekachel.',
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
    assert.ok(await warte(() => /CHF/.test(w.__fmtN(12.5))), `ohne Währung: ${w.__fmtN(12.5)}`);
    assert.match(w.__fmtN(12.5, 'USD'), /\$|USD/, 'Die genannte Währung gewinnt');
  } finally {
    w.close();
  }
});
