/**
 * Die Version kommt zur Bauzeit aus Git oder einem Build-Argument und landet
 * in dist/version.json; `npm ci` und `npm run build` verändern den
 * Arbeitsbaum nicht mehr.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in package.json wieder "postinstall": "node scripts/version.js" →
 *      rot: „das Projekt hat kein Install-Skript“
 *   B  in scripts/version.js APP_VERSION nicht mehr gelesen → rot: „ein
 *      Build-Argument geht vor, sonst Git“
 *   C  in src/infra/appVersion.ts den Rückgriff auf dist/version.json entfernt →
 *      rot: „der Server meldet die gebaute Version“ („unbekannt“)
 *   D  (13.11.2026) in scripts/version.js die beiden --exclude entfernt → rot: „Android-Etiketten
 *      nennen nicht die Web-Version“ („android-v2026.11.12.4-1-g…“)
 */
const test = require('node:test');
const { umgebung } = require('./helpers/sources');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('das Projekt hat kein Install-Skript', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const s of ['preinstall', 'install', 'postinstall', 'prepare'])
    assert.equal(pkg.scripts[s], undefined, `package.json hat ${s}`);
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages[''].hasInstallScript, undefined, 'die Lockfile kennt noch ein Install-Skript');
});

test('ein Build-Argument geht vor, sonst Git', () => {
  const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'version-'));
  try {
    const skript = path.join(ROOT, 'scripts', 'version.js');
    execFileSync(process.execPath, [skript, '--outdir', ziel], {
      env: { PATH: process.env.PATH, APP_VERSION: '2026.10.30' },
      stdio: 'ignore',
    });
    assert.equal(JSON.parse(fs.readFileSync(path.join(ziel, 'version.json'), 'utf8')).version, '2026.10.30');
    const ohne = execFileSync(process.execPath, [skript], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.match(ohne, /^\[version\] [\w.-]+\n$/);
    assert.doesNotMatch(ohne, /2026\.10\.30/);
  } finally {
    fs.rmSync(ziel, { recursive: true, force: true });
  }
});

test('der Server meldet die gebaute Version', () => {
  const _req = require('./helpers/sources').buildAndRequire();
  const gebaut = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'version.json'), 'utf8')).version;
  const alt = process.env.APP_VERSION;
  umgebung({ APP_VERSION: undefined });
  try {
    const { appVersion } = _req('src/infra/appVersion.js');
    assert.equal(appVersion(), gebaut);
    umgebung({ APP_VERSION: 'laufzeit-1' });
    assert.equal(appVersion(), 'laufzeit-1', 'APP_VERSION zur Laufzeit geht vor');
  } finally {
    if (alt === undefined) umgebung({ APP_VERSION: undefined });
    else umgebung({ APP_VERSION: alt });
  }
});

test('Android-Etiketten nennen nicht die Web-Version', () => {
  const { bauVersion } = require('../scripts/version');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'version-git-'));
  const git = (...a) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.org', ...a], { cwd: repo, stdio: 'ignore' });
  try {
    git('init', '-q');
    git('commit', '-q', '--allow-empty', '-m', 'eins');
    git('tag', 'v2026.11.01');
    git('commit', '-q', '--allow-empty', '-m', 'zwei');
    git('tag', 'android-v2026.11.12.4');
    git('tag', 'apk-neuste');
    git('commit', '-q', '--allow-empty', '-m', 'drei');
    assert.match(bauVersion({}, repo), /^v2026\.11\.01-2-g[0-9a-f]+$/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
