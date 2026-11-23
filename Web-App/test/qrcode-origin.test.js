/**
 * QRCode.js is under dependency management: qrcodejs with an exact
 * version in package.json and lockfile; public/vendor/qrcode/ is the copy
 * that scripts/copy-qrcode.js writes when building.
 *
 * Counter-checks (05.11.2026, each on its own):
 *   A  package.json "qrcodejs": "^1.0.0" → “exact version …” red
 *   B  a byte appended to public/vendor/qrcode/qrcode.min.js → “the script
 *      produces exactly the shipped files” red
 *   C  the LICENSE not copied in copyQrcode() → same place red
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { FILES } = require('../scripts/copy-qrcode');

const ROOT = path.join(__dirname, '..');
const pkg = require('../package.json');
const variant = pkg.devDependencies.qrcodejs;
const installed = path.join(ROOT, 'node_modules', 'qrcodejs');

test('exact version in package.json and lockfile', () => {
  assert.match(String(variant), /^\d+\.\d+\.\d+$/, `qrcodejs „${variant}“ is not an exact version`);
  const lock = require('../package-lock.json');
  assert.equal(lock.packages['node_modules/qrcodejs']?.version, variant);
});

test('the script produces exactly the shipped files', () => {
  assert.ok(fs.existsSync(installed), 'qrcodejs not installed (npm ci)');
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'qrcode-'));
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'copy-qrcode.js'), target], {
      encoding: 'utf8',
    });
    assert.match(r.stdout, new RegExp(`qrcodejs ${variant.replace(/\./g, '\\.')} → public/vendor/qrcode/`));
    const copy = path.join(target, 'public', 'vendor', 'qrcode');
    assert.deepEqual(fs.readdirSync(copy).sort(), [...FILES].sort());
    // The paths literally: eigenbruecken.test.js no longer lets paths with a variable segment pass.
    assert.deepEqual(FILES, ['qrcode.min.js', 'LICENSE']);
    const same = (a, b) => fs.readFileSync(a).equals(fs.readFileSync(b));
    assert.ok(
      same(path.join(ROOT, 'public/vendor/qrcode/qrcode.min.js'), path.join(copy, 'qrcode.min.js')),
      `qrcode.min.js weicht von qrcodejs ${variant} ab`,
    );
    assert.ok(
      same(path.join(ROOT, 'public/vendor/qrcode/LICENSE'), path.join(copy, 'LICENSE')),
      `LICENSE weicht von qrcodejs ${variant} ab`,
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
