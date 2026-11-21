/**
 * Late require() calls between server modules no longer exist.
 *
 * Counter-check (31.10.2026): `const { konfig } = require('./konfig')` in
 * src/infra/appPaths.ts → red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT, buildAndRequire, ohneKommentare } = require('./helpers/sources');
const DIST = path.join(ROOT, 'dist');

/** All .ts sources of the server (without tests, scripts and frontend). */
function quellFiles() {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', 'public', 'test', 'scripts', 'types'].includes(e.name)) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith('.ts')) out.push(abs);
    }
  })(ROOT);
  return out;
}

test('no server module fetches another one via late require()', () => {
  const dateien = quellFiles();
  assert.ok(dateien.length > 100, `Nur ${dateien.length} Quelldateien gefunden — die Prüfung liefe ins Leere`);
  const treffer = [];
  for (const datei of dateien) {
    // `import x = require('./y')` is an import (TypeScript checks it), not a late call.
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8')).replace(
      /^\s*import\s+\w+\s*=\s*require\([^)]*\);?/gm,
      '',
    );
    for (const m of src.matchAll(/\brequire\(\s*['"](\.[^'"]*)['"]/g))
      treffer.push(`${path.relative(ROOT, datei)}: require('${m[1]}')`);
  }
  assert.deepEqual(treffer, [], 'Statt require() einen Import benutzen — Pfad und Name prüft dann tsc.');
});

// ═══════════════════════════════════════════════════════════════════════════
// The same question for the TESTS: do they load modules that still exist?
// ═══════════════════════════════════════════════════════════════════════════
/** A missing module at file level would let the whole file die when loading, without a case red. */
test('no test fetches a module from dist/ that does not exist', () => {
  buildAndRequire(); // makes sure that dist/ stands
  const dir = path.join(ROOT, 'test');
  const fehlend = [];
  let geprueft = 0;

  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.test.js'))) {
    const src = ohneKommentare(fs.readFileSync(path.join(dir, f), 'utf8'));
    // Deliberately not tied to ONE call form: the tests fetch sometimes via
    // `buildAndRequire()('x')`, sometimes via a cached `req('x')`.
    // Hence what both have in common is searched for — the module path itself.
    for (const m of src.matchAll(
      /['"]((?:utils|routes|db|jobs|clients|startup)\/[A-Za-z0-9_/-]+\.js|server\.js)['"]/g,
    )) {
      geprueft++;
      if (!fs.existsSync(path.join(DIST, m[1]))) fehlend.push(`${f}: ${m[1]}`);
    }
  }

  // Lower limit for the same reason as above: if the search pattern breaks, this
  // rule would silently check nothing any more.
  assert.ok(geprueft > 10, `Nur ${geprueft} Modulpfade gefunden — das Muster greift nicht mehr`);
  assert.deepEqual(fehlend, [], `Test holt ein Modul, das es in dist/ nicht gibt:\n  ${fehlend.join('\n  ')}`);
});
