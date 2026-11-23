/**
 * scripts/remove-rationales.js deletes the references into the former archive without leaving empty comments,
 * broken JSDoc or double blank lines, and a second run changes nothing.
 *
 * Counter-checks (measured 10.11.2026, each on its own, reverted):
 *   A  the normalization of the JSDoc end removed in the script → red: “JSDoc end” (star stayed in front)
 *   B  the blank line rule (emptyBefore) removed → red: „allein zwischen Leerzeilen“
 *   C  WRAP not applied → red: “wrapped reference” (the path line stayed)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { removeReferences } = require('../scripts/remove-rationales');

// Assembled so that the script does not clean this file itself.
const V = `Ausführlich: ${['docs', 'begruendungen'].join('/')}/src/x.ts.md#anker`;

test('line comment: reference line and reference at end of line disappear', () => {
  assert.equal(removeReferences(`// Warum.\n// ${V}\nconst a = 1;`), '// Warum.\nconst a = 1;');
  assert.equal(removeReferences(`  // Warum. ${V}\n  f();`), '  // Warum.\n  f();');
});

test('wrapped reference: “Ausführlich:” at end of line, path on the next line', () => {
  const path = V.replace('Ausführlich: ', '');
  assert.equal(removeReferences(`  // Warum. Ausführlich:\n  // ${path}\n  f();`), '  // Warum.\n  f();');
});

test('JSDoc end moves to the last content line, tags stay', () => {
  assert.equal(removeReferences(`/** Warum,\n * weil. ${V} */\nf();`), '/** Warum,\n * weil. */\nf();');
  assert.equal(removeReferences(`/** Warum.\n * ${V} */\nf();`), '/** Warum. */\nf();');
  assert.equal(removeReferences(`/**\n * Warum.\n * ${V}\n */`), '/**\n * Warum.\n */');
  assert.equal(removeReferences(`/** Warum.\n * ${V}\n * @param x Zahl */`), '/** Warum.\n * @param x Zahl */');
  assert.equal(removeReferences(`/** Warum.\n * @returns Zahl\n * ${V} */`), '/** Warum.\n * @returns Zahl\n */');
});

test('comments that only carried the reference disappear entirely', () => {
  assert.equal(removeReferences(`/** ${V} */\nf();`), 'f();');
  assert.equal(removeReferences(`/**\n * ${V}\n */\nf();`), 'f();');
  assert.equal(removeReferences(`a();\n\n//\n// ${V}\n\nb();`), 'a();\n\nb();', 'alone between blank lines');
});

test('HTML comment ends on the content line', () => {
  assert.equal(removeReferences(`  <!-- Warum …\n       ${V} -->\n  <p>`), '  <!-- Warum … -->\n  <p>');
});

test('without a reference the text stays unchanged; a second run changes nothing', () => {
  const without = '/** Warum.\n *\n */\n\n\n// x\n';
  assert.equal(removeReferences(without), without);
  const once = removeReferences(`/** Warum.\n * ${V} */\n// a ${V}\n`);
  assert.equal(removeReferences(once), once);
});

test('the script cleans a tree and leaves node_modules and foreign files alone', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'begr-'));
  const script = (/** @type {string[]} */ ...args) =>
    spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'remove-rationales.js'), ...args, root], {
      encoding: 'utf8',
    });
  const read = (/** @type {string} */ rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  try {
    fs.mkdirSync(path.join(root, 'baum'));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'baum', 'a.ts'), `// Warum.\n// ${V}\n`);
    fs.writeFileSync(path.join(root, 'node_modules', 'b.js'), `// ${V}\n`);
    fs.writeFileSync(path.join(root, 'baum', 'c.md'), `${V}\n`);
    const check = script('--pruefen');
    assert.equal(check.status, 1);
    assert.match(check.stdout, /1 Dateien mit Verweisen\nbaum[\\/]a\.ts/);
    assert.equal(read('baum/a.ts'), `// Warum.\n// ${V}\n`, '--pruefen does not write');
    assert.equal(script().status, 0);
    assert.equal(read('baum/a.ts'), '// Warum.\n');
    assert.equal(read('node_modules/b.js'), `// ${V}\n`);
    assert.equal(read('baum/c.md'), `${V}\n`);
    const again = script('--pruefen');
    assert.equal(again.status, 0, 'a second run finds nothing');
    assert.match(again.stdout, /0 Dateien mit Verweisen/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
