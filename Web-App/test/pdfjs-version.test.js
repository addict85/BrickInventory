/**
 * PDF.js is under dependency management: pdfjs-dist with an exact version
 * in package.json and lockfile (visible for npm audit and Dependabot);
 * public/vendor/pdfjs/ is a copy that scripts/copy-pdfjs.js writes when
 * building. If the copy lags behind the version, this test turns red.
 *
 * Counter-checks (measured on 01.11.2026):
 *   A  package.json "pdfjs-dist": "^6.1.200" → red: “exact version …”
 *   B  ?v=6.1.199 in public/js/pdfjs-boot.js → red: “cache buster …”
 *   C  a byte appended to public/vendor/pdfjs/pdf.min.mjs → red: “the
 *      delivered files are those of the package”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const paket = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const variant = paket.devDependencies['pdfjs-dist'];
const installiert = path.join(ROOT, 'node_modules', 'pdfjs-dist');

test('exact version in package.json and lockfile', () => {
  assert.match(String(variant), /^\d+\.\d+\.\d+$/, `pdfjs-dist „${variant}“ is not an exact version`);
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['node_modules/pdfjs-dist']?.version, variant);
});

test('cache buster in pdfjs-boot.js names the same version', () => {
  const boot = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pdfjs-boot.js'), 'utf8');
  const v = [...boot.matchAll(/\/vendor\/pdfjs\/[\w.]+\.mjs\?v=([\w.-]+)/g)].map(m => m[1]);
  assert.deepEqual(v, [variant, variant]);
});

test('the delivered files are those of the package', t => {
  if (!fs.existsSync(installiert)) return t.skip('pdfjs-dist not installed (npm ci)');
  for (const d of ['pdf.min.mjs', 'pdf.worker.min.mjs'])
    assert.ok(
      fs
        .readFileSync(path.join(ROOT, 'public', 'vendor', 'pdfjs', d))
        .equals(fs.readFileSync(path.join(installiert, 'build', d))),
      `${d} weicht von pdfjs-dist ${variant} ab`,
    );
});

// From PDF.js 5 on the eval path for fonts no longer exists; an older
// version would bring it back (the CSP would forbid it, isEvalSupported too).
// Counter-check (measured 02.11.2026): `new Function("x")` appended to a copy → red.
test('the delivered PDF.js files contain neither eval nor new Function', () => {
  for (const d of [
    path.join(ROOT, 'public', 'vendor', 'pdfjs', 'pdf.min.mjs'),
    path.join(ROOT, 'public', 'vendor', 'pdfjs', 'pdf.worker.min.mjs'),
  ]) {
    const text = fs.readFileSync(d, 'utf8');
    assert.ok(text.length > 100_000, `${d} is empty`);
    assert.doesNotMatch(text, /\beval\s*\(|\bnew\s+Function\s*\(/, d);
  }
});

test('the copy script stores the files and updates the version', t => {
  if (!fs.existsSync(installiert)) return t.skip('pdfjs-dist not installed (npm ci)');
  const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-pdfjs-'));
  t.after(() => fs.rmSync(ziel, { recursive: true, force: true }));
  fs.mkdirSync(path.join(ziel, 'public', 'js'), { recursive: true });
  fs.writeFileSync(
    path.join(ziel, 'public', 'js', 'pdfjs-boot.js'),
    "import '/vendor/pdfjs/pdf.min.mjs?v=1.0.0';\nw = '/vendor/pdfjs/pdf.worker.min.mjs?v=1.0.0';\n",
  );
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'copy-pdfjs.js'), ziel], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(ziel, 'public', 'vendor', 'pdfjs', 'pdf.worker.min.mjs')));
  assert.equal(
    (
      fs
        .readFileSync(path.join(ziel, 'public', 'js', 'pdfjs-boot.js'), 'utf8')
        .match(new RegExp(`v=${variant.replace(/\./g, '\\.')}`, 'g')) || []
    ).length,
    2,
  );
});
