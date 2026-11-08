/**
 * Das Bündel (public/js/app.bundle.js) ist ein Erzeugnis: nicht in git, aber
 * überall da, wo es gebraucht wird, frisch gebaut (stelleBuendelSicher()).
 *
 * Gegenproben (gemessen am 08.11.2026):
 *   - `git add -f public/js/app.bundle.js` → rot: „ist eingecheckt“.
 *   - die Zeile `public/js/app.bundle.js` aus Web-App/.gitignore gestrichen →
 *     rot: „wird von git ignoriert“.
 *   - in stelleBuendelSicher() die Veraltet-Prüfung durch `true` ersetzt (nie
 *     bauen) → rot im zweiten Test: „fehlendes Bündel wird gebaut“.
 *   - sie durch `false` ersetzt (immer bauen) → rot im zweiten Test (das
 *     frische Bündel wird angefasst).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { OUT_REL, stelleBuendelSicher } = require('../scripts/build-frontend');

const ROOT = path.join(__dirname, '..');
const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const imGit = git('rev-parse', '--is-inside-work-tree').stdout.trim() === 'true';

test('das Bündel ist nicht eingecheckt und wird von git ignoriert', { skip: !imGit && 'kein git-Arbeitsbaum' }, () => {
  const rel = path.posix.join('public', OUT_REL);
  assert.equal(git('ls-files', '--', rel).stdout.trim(), '', `${rel} ist eingecheckt`);
  for (const name of [rel, `${rel}.map`, `${rel}.123.tmp`]) {
    assert.equal(git('check-ignore', '-q', '--', name).status, 0, `${name} wird von git ignoriert`);
  }
});

test('fehlendes oder veraltetes Bündel wird gebaut, ein frisches nicht angefasst', { timeout: 60_000 }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buendel-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ziel = path.join(dir, 'app.bundle.js');

  assert.equal(stelleBuendelSicher(ziel), true, 'fehlendes Bündel wird gebaut');
  const groesse = fs.statSync(ziel).size;
  assert.ok(groesse > 100_000, `nur ${groesse} Byte gebaut — greift der Bau noch?`);
  assert.equal(spawnSync(process.execPath, ['--check', ziel]).status, 0, 'das gebaute Bündel ist gültiges JavaScript');
  assert.deepEqual(fs.readdirSync(dir), ['app.bundle.js'], 'keine Zwischendatei bleibt liegen');

  const mtime = fs.statSync(ziel).mtimeMs;
  assert.equal(stelleBuendelSicher(ziel), false, 'frisches Bündel bleibt unberührt');
  assert.equal(fs.statSync(ziel).mtimeMs, mtime);

  fs.writeFileSync(ziel, 'veraltet');
  fs.utimesSync(ziel, 1, 1);
  assert.equal(stelleBuendelSicher(ziel), true, 'veraltetes Bündel wird neu gebaut');
  assert.equal(fs.statSync(ziel).size, groesse, 'und entspricht dem frischen Bau');
});
