/**
 * The bundle (public/js/app.bundle.js) is a product: not in git, but
 * freshly built wherever it is needed (placeBundleSafe()).
 *
 * Counter-checks (measured on 08.11.2026):
 *   - `git add -f public/js/app.bundle.js` → red: “is checked in”.
 *   - the line `public/js/app.bundle.js` deleted from Web-App/.gitignore →
 *     red: “is ignored by git”.
 *   - in placeBundleSafe() the staleness check replaced by `true` (never
 *     build) → red in the second test: “missing bundle is built”.
 *   - replaced by `false` (always build) → red in the second test (the
 *     fresh bundle is touched).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { OUT_REL, placeBundleSafe } = require('../scripts/build-frontend');

const ROOT = path.join(__dirname, '..');
const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const inGit = git('rev-parse', '--is-inside-work-tree').stdout.trim() === 'true';

test('the bundle is not checked in and is ignored by git', { skip: !inGit && 'no git working tree' }, () => {
  const rel = path.posix.join('public', OUT_REL);
  assert.equal(git('ls-files', '--', rel).stdout.trim(), '', `${rel} is checked in`);
  for (const name of [rel, `${rel}.map`, `${rel}.123.tmp`]) {
    assert.equal(git('check-ignore', '-q', '--', name).status, 0, `${name} is ignored by git`);
  }
});

test('a missing or outdated bundle is built, a fresh one is not touched', { timeout: 60_000 }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buendel-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'app.bundle.js');

  assert.equal(placeBundleSafe(target), true, 'a missing bundle is built');
  const size = fs.statSync(target).size;
  assert.ok(size > 100_000, `only ${size} bytes built — does the build still work?`);
  assert.equal(spawnSync(process.execPath, ['--check', target]).status, 0, 'the built bundle is valid JavaScript');
  assert.deepEqual(fs.readdirSync(dir), ['app.bundle.js'], 'no intermediate file is left behind');

  const mtime = fs.statSync(target).mtimeMs;
  assert.equal(placeBundleSafe(target), false, 'a fresh bundle stays untouched');
  assert.equal(fs.statSync(target).mtimeMs, mtime);

  // A second file never checked before: writing after checking the same file is a file system race.
  const alt = path.join(dir, 'alt.bundle.js');
  fs.writeFileSync(alt, 'veraltet');
  fs.utimesSync(alt, 1, 1);
  assert.equal(placeBundleSafe(alt), true, 'an outdated bundle is rebuilt');
  assert.equal(fs.statSync(alt).size, size, 'and matches the fresh build');
});
