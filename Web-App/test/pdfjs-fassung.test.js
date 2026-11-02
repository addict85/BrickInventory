/**
 * PDF.js steht unter Abhängigkeitsverwaltung: pdfjs-dist mit exakter Fassung
 * in package.json und Lockfile (sichtbar für npm audit und Renovate);
 * public/vendor/pdfjs/ ist eine Kopie, die scripts/pdfjs-kopieren.js beim
 * Bauen schreibt. Läuft die Kopie der Fassung hinterher, wird dieser Test rot.
 *
 * Gegenproben (am 01.11.2026 gemessen):
 *   A  package.json "pdfjs-dist": "^6.1.200" → rot: „exakte Fassung …“
 *   B  ?v=6.1.199 in public/js/pdfjs-boot.js → rot: „Cache-Brecher …“
 *   C  ein Byte in public/vendor/pdfjs/pdf.min.mjs angehängt → rot: „die
 *      ausgelieferten Dateien sind die des Pakets“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const paket = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const fassung = paket.devDependencies['pdfjs-dist'];
const installiert = path.join(ROOT, 'node_modules', 'pdfjs-dist');

test('exakte Fassung in package.json und Lockfile', () => {
  assert.match(String(fassung), /^\d+\.\d+\.\d+$/, `pdfjs-dist „${fassung}“ ist keine exakte Fassung`);
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['node_modules/pdfjs-dist']?.version, fassung);
});

test('Cache-Brecher in pdfjs-boot.js nennt dieselbe Fassung', () => {
  const boot = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pdfjs-boot.js'), 'utf8');
  const v = [...boot.matchAll(/\/vendor\/pdfjs\/[\w.]+\.mjs\?v=([\w.-]+)/g)].map(m => m[1]);
  assert.deepEqual(v, [fassung, fassung]);
});

test('die ausgelieferten Dateien sind die des Pakets', (t) => {
  if (!fs.existsSync(installiert)) return t.skip('pdfjs-dist nicht installiert (npm ci)');
  for (const d of ['pdf.min.mjs', 'pdf.worker.min.mjs'])
    assert.ok(fs.readFileSync(path.join(ROOT, 'public', 'vendor', 'pdfjs', d))
      .equals(fs.readFileSync(path.join(installiert, 'build', d))), `${d} weicht von pdfjs-dist ${fassung} ab`);
});

// Ab PDF.js 5 gibt es den eval-Pfad für Schriften nicht mehr; eine ältere
// Fassung brächte ihn zurück (die CSP verböte ihn, isEvalSupported auch).
// Gegenprobe (02.11.2026 gemessen): `new Function("x")` an eine Kopie gehängt → rot.
test('die ausgelieferten PDF.js-Dateien enthalten weder eval noch new Function', () => {
  for (const d of [path.join(ROOT, 'public', 'vendor', 'pdfjs', 'pdf.min.mjs'), path.join(ROOT, 'public', 'vendor', 'pdfjs', 'pdf.worker.min.mjs')]) {
    const text = fs.readFileSync(d, 'utf8');
    assert.ok(text.length > 100_000, `${d} ist leer`);
    assert.doesNotMatch(text, /\beval\s*\(|\bnew\s+Function\s*\(/, d);
  }
});

test('das Kopierskript legt die Dateien ab und zieht die Fassung nach', (t) => {
  if (!fs.existsSync(installiert)) return t.skip('pdfjs-dist nicht installiert (npm ci)');
  const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-pdfjs-'));
  t.after(() => fs.rmSync(ziel, { recursive: true, force: true }));
  fs.mkdirSync(path.join(ziel, 'public', 'js'), { recursive: true });
  fs.writeFileSync(path.join(ziel, 'public', 'js', 'pdfjs-boot.js'),
    "import '/vendor/pdfjs/pdf.min.mjs?v=1.0.0';\nw = '/vendor/pdfjs/pdf.worker.min.mjs?v=1.0.0';\n");
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'pdfjs-kopieren.js'), ziel], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(ziel, 'public', 'vendor', 'pdfjs', 'pdf.worker.min.mjs')));
  assert.equal((fs.readFileSync(path.join(ziel, 'public', 'js', 'pdfjs-boot.js'), 'utf8').match(new RegExp(`v=${fassung.replace(/\./g, '\\.')}`, 'g')) || []).length, 2);
});
