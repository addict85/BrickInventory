/**
 * npm run loadtest: the load script starts with minimal load against the
 * current routers, seeds its collection and gets only HTTP 200. It loaded
 * router files that no longer existed, and nobody noticed.
 *
 * Counter-checks (13.11.2026, each on its own):
 *   A  in scripts/loadtest.js the path of the gallery reset to the former `/api/sets/?page=1…`
 *      → red (exit code 1, „Galerie (Seite 1) → HTTP 404“)
 *   B  the insert into set_parts left out in the seed → red (the count says „parts 0“;
 *      measured empty, the parts list would be worth nothing)
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { accessOrSkip } = require('./helpers/db');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'loadtest.js');

test('the load script runs through without errors at a small load', async t => {
  if (!(await accessOrSkip(t, _req, { migrieren: false }))) return;
  const r = spawnSync(process.execPath, [SCRIPT, '--users', '2', '--dauer', '1', '--sets', '20'], {
    encoding: 'utf8',
    env: { ...process.env },
    timeout: 120_000,
  });
  const aus = `${r.stdout}\n${r.stderr}`;
  assert.equal(r.status, 0, aus);
  assert.match(r.stdout, /sets 20, parts 1500, minifigs 80, price_history 900/, aus);
  for (const name of ['Galerie (Seite 1)', 'Teile-Liste', 'Minifiguren', 'Bewertung Sets', 'Portfolio-Verlauf'])
    assert.match(r.stdout, new RegExp(`^  ${name.replace(/[()]/g, '\\$&')}\\s+\\d+ ms$`, 'm'), name);
  assert.match(r.stdout, /Keine Fehler — alle Antworten HTTP 200/);
});
