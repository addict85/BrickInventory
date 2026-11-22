/**
 * The write/delete paths in src/settings/settings.ts and the trigger in
 * src/jobQueue/repository/runState.ts (there since migration 0063) against a real database.
 *
 * Counter-checks (carried out):
 *   a) `if (keys.length === 0) return;` removed in deleteGlobalValues and the
 *      parameter left at `[keys]` → substep 4 stayed green (ANY('{}')
 *      hits nothing). Only with `WHERE key = ANY($1) OR $1 IS NULL` did it turn
 *      red — so the probe really measures the table contents.
 *   b) dropped with setzeAusloeser (30.10.2026): kicks are jobs.
 *   c) in deleteGlobalValues only the FIRST key deleted
 *      (`WHERE key = $1`, `[keys[0]]`) → substep 3 red.
 *
 *   d) (05.11.2026) setGlobalSetting without the check against GLOBAL_RULES → red:
 *      „ein Schlüssel ohne Regel wird nicht geschrieben“
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { getGlobalSetting, setGlobalSetting, deleteGlobalValues } = _req('src/settings/settings.js');
const { setState, readState, deleteState } = require('./helpers/sources').testArea('jobQueue').runState;

test('global settings: write, trigger, delete', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }

  // Real keys: a key without a rule in GLOBAL_RULES is not written.
  const A = 'smtp_host',
    B = 'smtp_user',
    T = 'smtp_from';
  const alle = [A, B, T];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [alle]);
  const holding = async () => (await db.get(`SELECT COUNT(*)::int AS c FROM global_settings`)).c;

  try {
    // 1. There and back — including the conversion into a string.
    await setGlobalSetting(A, 42);
    assert.equal(await getGlobalSetting(A), '42', 'die Spalte ist TEXT; eine Zahl muss als Zeichenkette zurückkommen');
    await setGlobalSetting(A, 'zwei');
    assert.equal(await getGlobalSetting(A), 'zwei', 'der zweite Aufruf muss überschreiben');
    assert.equal(await getGlobalSetting(`gibt_es_nicht_${process.pid}`, 'ersatz'), 'ersatz');
    await assert.rejects(
      setGlobalSetting(`gibt_es_nicht_${process.pid}`, 'x'),
      { code: 'value_invalid' },
      'ein Schlüssel ohne Regel wird nicht geschrieben',
    );

    // 2. Run state: deleted means the row is gone.
    await setState(T, 'x');
    assert.equal(await readState(T), 'x');
    await deleteState(T);
    assert.equal(await readState(T), null, 'abgearbeitet heisst: die Zeile ist weg');
    await setGlobalSetting(T, 'bleibt');

    // 3. Several keys in ONE call — the reason for `key = ANY($1)`.
    await setGlobalSetting(B, 'x');
    await deleteGlobalValues(A, B);
    assert.equal(await getGlobalSetting(A), null, 'A muss weg sein');
    assert.equal(await getGlobalSetting(B), null, 'B muss weg sein');
    assert.ok(await getGlobalSetting(T), 'T war nicht genannt und muss stehen bleiben');

    // 4. The dangerous case: no key named. The table carries the
    //    registration lock, the API limits and the BrickLink credentials —
    //    an accidental emptying could not be undone.
    const zahl = await holding();
    assert.ok(zahl > 0, 'für diese Probe muss die Tabelle etwas enthalten');
    await deleteGlobalValues();
    assert.equal(await holding(), zahl, 'ein Aufruf ohne Schlüssel darf NICHTS löschen');
    await deleteGlobalValues(...[]);
    assert.equal(await holding(), zahl, 'auch ein leeres Array darf NICHTS löschen');
  } finally {
    await db.run(`DELETE FROM global_settings WHERE key = ANY($1)`, [alle]).catch(() => {});
    for (const z of vorher)
      await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]).catch(() => {});
    await deleteState(T).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
