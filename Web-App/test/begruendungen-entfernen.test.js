/**
 * scripts/begruendungen-entfernen.js streicht die Verweise ins frühere Archiv, ohne leere Kommentare,
 * kaputte JSDoc oder doppelte Leerzeilen zu hinterlassen, und ein zweiter Lauf ändert nichts.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, zurückgenommen):
 *   A  im Skript die Normalisierung des JSDoc-Schlusses entfernt → rot: „JSDoc-Schluss“ (Stern blieb davor)
 *   B  die Leerzeilen-Regel (leerDavor) entfernt → rot: „allein zwischen Leerzeilen“
 *   C  UMBRUCH nicht angewandt → rot: „umbrochener Verweis“ (die Pfadzeile blieb)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { entferneVerweise } = require('../scripts/begruendungen-entfernen');

// Zusammengesetzt, damit das Skript diese Datei nicht selbst bereinigt.
const V = `Ausführlich: ${['docs', 'begruendungen'].join('/')}/src/x.ts.md#anker`;

test('Zeilenkommentar: Verweiszeile und Verweis am Zeilenende verschwinden', () => {
  assert.equal(entferneVerweise(`// Warum.\n// ${V}\nconst a = 1;`), '// Warum.\nconst a = 1;');
  assert.equal(entferneVerweise(`  // Warum. ${V}\n  f();`), '  // Warum.\n  f();');
});

test('umbrochener Verweis: „Ausführlich:“ am Zeilenende, Pfad auf der nächsten Zeile', () => {
  const pfad = V.replace('Ausführlich: ', '');
  assert.equal(entferneVerweise(`  // Warum. Ausführlich:\n  // ${pfad}\n  f();`), '  // Warum.\n  f();');
});

test('JSDoc-Schluss wandert an die letzte Inhaltszeile, Tags bleiben', () => {
  assert.equal(entferneVerweise(`/** Warum,\n * weil. ${V} */\nf();`), '/** Warum,\n * weil. */\nf();');
  assert.equal(entferneVerweise(`/** Warum.\n * ${V} */\nf();`), '/** Warum. */\nf();');
  assert.equal(entferneVerweise(`/**\n * Warum.\n * ${V}\n */`), '/**\n * Warum.\n */');
  assert.equal(entferneVerweise(`/** Warum.\n * ${V}\n * @param x Zahl */`), '/** Warum.\n * @param x Zahl */');
  assert.equal(entferneVerweise(`/** Warum.\n * @returns Zahl\n * ${V} */`), '/** Warum.\n * @returns Zahl\n */');
});

test('Kommentare, die nur den Verweis trugen, verschwinden ganz', () => {
  assert.equal(entferneVerweise(`/** ${V} */\nf();`), 'f();');
  assert.equal(entferneVerweise(`/**\n * ${V}\n */\nf();`), 'f();');
  assert.equal(entferneVerweise(`a();\n\n//\n// ${V}\n\nb();`), 'a();\n\nb();', 'allein zwischen Leerzeilen');
});

test('HTML-Kommentar endet auf der Inhaltszeile', () => {
  assert.equal(entferneVerweise(`  <!-- Warum …\n       ${V} -->\n  <p>`), '  <!-- Warum … -->\n  <p>');
});

test('ohne Verweis bleibt der Text unverändert; ein zweiter Lauf ändert nichts', () => {
  const ohne = '/** Warum.\n *\n */\n\n\n// x\n';
  assert.equal(entferneVerweise(ohne), ohne);
  const einmal = entferneVerweise(`/** Warum.\n * ${V} */\n// a ${V}\n`);
  assert.equal(entferneVerweise(einmal), einmal);
});

test('das Skript bereinigt einen Baum und lässt node_modules und Fremdes liegen', () => {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'begr-'));
  const skript = (/** @type {string[]} */ ...args) =>
    spawnSync(
      process.execPath,
      [path.join(__dirname, '..', 'scripts', 'begruendungen-entfernen.js'), ...args, wurzel],
      {
        encoding: 'utf8',
      },
    );
  const lies = (/** @type {string} */ rel) => fs.readFileSync(path.join(wurzel, rel), 'utf8');
  try {
    fs.mkdirSync(path.join(wurzel, 'baum'));
    fs.mkdirSync(path.join(wurzel, 'node_modules'));
    fs.writeFileSync(path.join(wurzel, 'baum', 'a.ts'), `// Warum.\n// ${V}\n`);
    fs.writeFileSync(path.join(wurzel, 'node_modules', 'b.js'), `// ${V}\n`);
    fs.writeFileSync(path.join(wurzel, 'baum', 'c.md'), `${V}\n`);
    const pruefen = skript('--pruefen');
    assert.equal(pruefen.status, 1);
    assert.match(pruefen.stdout, /1 Dateien mit Verweisen\nbaum[\\/]a\.ts/);
    assert.equal(lies('baum/a.ts'), `// Warum.\n// ${V}\n`, '--pruefen schreibt nicht');
    assert.equal(skript().status, 0);
    assert.equal(lies('baum/a.ts'), '// Warum.\n');
    assert.equal(lies('node_modules/b.js'), `// ${V}\n`);
    assert.equal(lies('baum/c.md'), `${V}\n`);
    const nochmal = skript('--pruefen');
    assert.equal(nochmal.status, 0, 'ein zweiter Lauf findet nichts');
    assert.match(nochmal.stdout, /0 Dateien mit Verweisen/);
  } finally {
    fs.rmSync(wurzel, { recursive: true, force: true });
  }
});
