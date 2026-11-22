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
    'Die Dateien unter src/finances/calculation/ stimmen nicht mehr mit der Schichtung ' +
      'ueberein. Kommt eine dazu, gehoert sie an ihren Platz in SCHICHTEN — ' +
      'sonst prueft hier niemand ihre Richtung.',
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
  assert.ok(kanten >= 4, `Nur ${kanten} Abhaengigkeiten zwischen den Schichten gefunden — greift die Suche noch?`);
  assert.deepEqual(
    error,
    [],
    'Ein Griff nach oben schliesst den Kreis. Node laedt im Kreis ein halb ' +
      'fertiges Modul aus — das faellt nicht beim Uebersetzen auf, sondern zur ' +
      'Laufzeit und nur manchmal.',
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
  assert.ok(zeilen <= 29, `Die Fassade hat ${zeilen} Zeilen Code. Sie soll nur weiterreichen.`);
  assert.ok(
    !/\bfunction\b|\bdb\./.test(withoutComment),
    'In der Fassade steht wieder Logik. Sie gehoert in die Schicht, zu der sie ' +
      'passt — dafuer gibt es src/finances/calculation/.',
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
    'Der Typ Scope wird an mehr als einer Stelle erklaert. Er gehoert dort ' +
      'hin, wo asIds() steht — sonst driften die Fassungen auseinander, und eine ' +
      'Signatur sagt nicht mehr, ob sie vor oder nach der Normalisierung steht.',
  );
});
