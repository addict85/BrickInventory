/**
 * QRCode.js steht unter Abhängigkeitsverwaltung: qrcodejs mit exakter
 * Fassung in package.json und Lockfile; public/vendor/qrcode/ ist die Kopie,
 * die scripts/qrcode-kopieren.js beim Bauen schreibt.
 *
 * Gegenproben (05.11.2026, je einzeln):
 *   A  package.json "qrcodejs": "^1.0.0" → „exakte Fassung …“ rot
 *   B  ein Byte an public/vendor/qrcode/qrcode.min.js gehängt → „das Skript
 *      erzeugt genau die ausgelieferten Dateien“ rot
 *   C  in kopiereQrcode() die LICENSE nicht kopiert → ebenda rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DATEIEN } = require('../scripts/qrcode-kopieren');

const ROOT = path.join(__dirname, '..');
const paket = require('../package.json');
const fassung = paket.devDependencies.qrcodejs;
const installiert = path.join(ROOT, 'node_modules', 'qrcodejs');

test('exakte Fassung in package.json und Lockfile', () => {
  assert.match(String(fassung), /^\d+\.\d+\.\d+$/, `qrcodejs „${fassung}“ ist keine exakte Fassung`);
  const lock = require('../package-lock.json');
  assert.equal(lock.packages['node_modules/qrcodejs']?.version, fassung);
});

test('das Skript erzeugt genau die ausgelieferten Dateien', () => {
  assert.ok(fs.existsSync(installiert), 'qrcodejs nicht installiert (npm ci)');
  const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'qrcode-'));
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'qrcode-kopieren.js'), ziel], {
      encoding: 'utf8',
    });
    assert.match(r.stdout, new RegExp(`qrcodejs ${fassung.replace(/\./g, '\\.')} → public/vendor/qrcode/`));
    const kopie = path.join(ziel, 'public', 'vendor', 'qrcode');
    assert.deepEqual(fs.readdirSync(kopie).sort(), [...DATEIEN].sort());
    // Die Pfade wörtlich: eigenbruecken.test.js lässt Pfade mit variablem Segment nicht mehr werden.
    assert.deepEqual(DATEIEN, ['qrcode.min.js', 'LICENSE']);
    const gleich = (a, b) => fs.readFileSync(a).equals(fs.readFileSync(b));
    assert.ok(
      gleich(path.join(ROOT, 'public/vendor/qrcode/qrcode.min.js'), path.join(kopie, 'qrcode.min.js')),
      `qrcode.min.js weicht von qrcodejs ${fassung} ab`,
    );
    assert.ok(
      gleich(path.join(ROOT, 'public/vendor/qrcode/LICENSE'), path.join(kopie, 'LICENSE')),
      `LICENSE weicht von qrcodejs ${fassung} ab`,
    );
  } finally {
    fs.rmSync(ziel, { recursive: true, force: true });
  }
});
