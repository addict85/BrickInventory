/**
 * npm run loadtest: Das Lastskript startet mit minimaler Last gegen die
 * heutigen Router, sät seine Sammlung und bekommt nur HTTP 200. Es lud
 * Router-Dateien, die es nicht mehr gab, und niemand merkte es.
 *
 * Gegenproben (13.11.2026, je einzeln):
 *   A  in scripts/loadtest.js den Pfad der Galerie auf das frühere `/api/sets/?page=1…`
 *      zurückgesetzt → rot (Exit-Code 1, „Galerie (Seite 1) → HTTP 404“)
 *   B  im Seed das Einfügen in set_teile weggelassen → rot (die Zählung nennt „parts 0“;
 *      leer gemessen wäre die Teile-Liste nichts wert)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { zugangOderSkip } = require('./helpers/db');

const SKRIPT = path.join(__dirname, '..', 'scripts', 'loadtest.js');

test('das Lastskript läuft mit kleiner Last ohne Fehler durch', async t => {
  if (!(await zugangOderSkip(t, _req, { migrieren: false }))) return;
  const r = spawnSync(process.execPath, [SKRIPT, '--users', '2', '--dauer', '1', '--sets', '20'], {
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
