/**
 * Counter-check: `import './valuation'` at the top of src/finances/calculation/condition.ts → red “no layer reaches upwards”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FOLDER = path.join(__dirname, '..', 'src/finances/calculation');

/**
 * The finance layers stack on each other — in ONE direction.
 */

/** The order — whoever stands further down may fetch nothing from further up. */
const SCHICHTEN = ['condition', 'queries', 'prices', 'valuation', 'profitLoss'];

function importsOf(name) {
  const s = fs.readFileSync(path.join(FOLDER, `${name}.ts`), 'utf8');
  // Only siblings in the same layer family: './x'
  return [...s.matchAll(/(?:import|from)\s+['"]\.\/(\w+)['"]/g)].map(m => m[1]);
}

test('the layers are complete', () => {
  // Self-proof: if a file is missing, the loop below would check thin air.
  const da = fs
    .readdirSync(FOLDER)
    .filter(n => n.endsWith('.ts'))
    .map(n => path.basename(n, '.ts'))
    .sort();
  assert.deepEqual(
    da,
    [...SCHICHTEN].sort(),
    'The files under src/finances/calculation/ no longer match the layering. ' +
      'If one is added, it belongs in its place in „SCHICHTEN“ — ' +
      'otherwise nobody checks its direction here.',
  );
});

test('no layer reaches upwards', () => {
  const error = [];
  let kanten = 0;
  SCHICHTEN.forEach((name, hoehe) => {
    for (const ziel of importsOf(name)) {
      const targetHeight = SCHICHTEN.indexOf(ziel);
      if (targetHeight < 0) continue; // not a sibling of the layer
      kanten++;
      if (targetHeight >= hoehe) {
        error.push(`${name}.ts holt ${ziel}.ts — das steht gleich hoch oder hoeher`);
      }
    }
  });
  // Self-proof: MEASURED there are several edges. If the search found none,
  // the assertion below would be silently green.
  assert.ok(kanten >= 4, `Only ${kanten} dependencies between the layers found — does the search still match?`);
  assert.deepEqual(
    error,
    [],
    'A reach upwards closes the cycle. In a cycle Node loads a half ' +
      'finished module — that does not show up when compiling but at ' +
      'runtime and only sometimes.',
  );
});

test('the facade only passes through', () => {
  // src/finances/financeCalc.ts is the door for 16 call sites. If logic stands
  // there again, it grows back to 1529 lines.
  const facade = fs.readFileSync(path.join(__dirname, '..', 'src/finances/financeCalc.ts'), 'utf8');
  const withoutComment = facade
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(z => !/^\s*\/\//.test(z))
    .join('\n')
    .trim();
  const zeilen = withoutComment.split('\n').filter(z => z.trim()).length;
  assert.ok(zeilen <= 29, `The facade has ${zeilen} lines of code. It should only pass things on.`);
  assert.ok(
    !/\bfunction\b|\bdb\./.test(withoutComment),
    'There is logic in the facade again. It belongs in the layer it ' +
      'fits — that is what src/finances/calculation/ is for.',
  );
});

test('scope is explained in one place', () => {
  // One name, two meanings
  const wurzel = path.join(__dirname, '..');
  const treffer = [];
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) {
        if (['node_modules', 'dist', '.git', 'test'].includes(n)) continue;
        lauf(p);
      } else if (n.endsWith('.ts')) {
        const s = fs.readFileSync(p, 'utf8');
        if (/^\s*(export )?type Scope\w* =/m.test(s)) {
          treffer.push(path.relative(wurzel, p).split(path.sep).join('/'));
        }
      }
    }
  })(wurzel);
  assert.deepEqual(
    treffer,
    ['src/household/rules.ts'],
    'The type Scope is declared in more than one place. It belongs ' +
      'where asIds() is — otherwise the versions drift apart, and a ' +
      'signature no longer says whether it is before or after the normalization.',
  );
});
