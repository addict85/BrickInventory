/**
 * The version comes from Git or a build argument at build time and lands
 * in dist/version.json; `npm ci` and `npm run build` no longer change the
 * working tree.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  in package.json again "postinstall": "node scripts/version.js" →
 *      red: “the project has no install script”
 *   B  APP_VERSION no longer read in scripts/version.js → red: “a
 *      build argument takes precedence, otherwise Git”
 *   C  the fallback to dist/version.json removed in src/infra/appVersion.ts →
 *      red: “the server reports the built version” („unbekannt“)
 *   D  (13.11.2026) the two --exclude removed in scripts/version.js → red: “Android tags
 *      do not name the web version” („android-v2026.11.12.4-1-g…“)
 */
const test = require('node:test');
const { environment } = require('./helpers/sources');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('the project has no install script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const s of ['preinstall', 'install', 'postinstall', 'prepare'])
    assert.equal(pkg.scripts[s], undefined, `package.json has ${s}`);
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages[''].hasInstallScript, undefined, 'the lockfile still knows an install script');
});

test('a build argument takes precedence, otherwise Git', () => {
  const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'version-'));
  try {
    const script = path.join(ROOT, 'scripts', 'version.js');
    execFileSync(process.execPath, [script, '--outdir', ziel], {
      env: { PATH: process.env.PATH, APP_VERSION: '2026.10.30' },
      stdio: 'ignore',
    });
    assert.equal(JSON.parse(fs.readFileSync(path.join(ziel, 'version.json'), 'utf8')).version, '2026.10.30');
    const ohne = execFileSync(process.execPath, [script], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.match(ohne, /^\[version\] [\w.-]+\n$/);
    assert.doesNotMatch(ohne, /2026\.10\.30/);
  } finally {
    fs.rmSync(ziel, { recursive: true, force: true });
  }
});

test('the server reports the built version', () => {
  const _req = require('./helpers/sources').buildAndRequire();
  const gebaut = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'version.json'), 'utf8')).version;
  const alt = process.env.APP_VERSION;
  environment({ APP_VERSION: undefined });
  try {
    const { appVersion } = _req('src/infra/appVersion.js');
    assert.equal(appVersion(), gebaut);
    environment({ APP_VERSION: 'laufzeit-1' });
    assert.equal(appVersion(), 'laufzeit-1', 'APP_VERSION at runtime takes precedence');
  } finally {
    if (alt === undefined) environment({ APP_VERSION: undefined });
    else environment({ APP_VERSION: alt });
  }
});

test('Android tags do not name the web version', () => {
  const { buildVersion } = require('../scripts/version');
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
    assert.match(buildVersion({}, repo), /^v2026\.11\.01-2-g[0-9a-f]+$/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
