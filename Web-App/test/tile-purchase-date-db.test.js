/**
 * The set tile shows the date of the last purchase, not the addition to the
 * account (after an import that was the same day for all sets).
 *
 *   - setsLesen() delivers `letzter_kauf` = latest acquisition of the set.
 *   - The tile (jsdom, real bundle) shows this date, not added_at.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  MAX(…created_at) in src/sets/repository/sets.ts to MIN → red: “setsLesen
 *      delivers the last purchase”
 *   B  gridCard() again with s.added_at → red: “the tile shows the purchase date”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const db = testData();
const { holdsSet, record } = require('./helpers/inventory');
const { dataOrSkip } = require('./helpers/db');
const { openUi, warte } = require('./helpers/ui');

test('setsLesen delivers the last purchase', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `kaufdatum_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  await holdsSet(db, uid, '10300-1', 1, { preis: 199, am: '2024-03-02T10:00:00Z' });
  await record(db, uid, '10300-1', 1, { preis: 210, am: '2025-07-14T10:00:00Z' });
  const { setsLesen } = require('./helpers/sources').areaPage('sets');
  const { sets } = await setsLesen(uid, {});
  const s = sets.find(x => x.set_number === '10300-1');
  assert.ok(s, 'Set fehlt');
  assert.equal(new Date(s.letzter_kauf).toISOString().slice(0, 10), '2025-07-14');
});

test('the tile shows the purchase date', async () => {
  const { w, d } = await openUi(
    {
      '/v1/sets': {
        success: true,
        total: 1,
        themes: [],
        sets: [
          {
            set_number: '10300-1',
            name: 'Zeitmaschine',
            quantity: 2,
            conditions: ['N'],
            added_at: '2026-10-28T08:00:00Z',
            letzter_kauf: '2025-07-14T10:00:00Z',
          },
        ],
      },
    },
    { browserLanguage: 'de-DE' },
  );
  try {
    await warte(() => d.querySelector('.sc .tile-date'));
    const datum = d.querySelector('.sc .tile-date');
    assert.ok(datum, 'Kein Datum auf der Kachel');
    // One notation for all dates (fmtDatum): two digits, since 29.10.
    assert.match(datum.textContent, /14\.07\.2025/);
    assert.match(datum.textContent, /Gekauft/); // visibly labeled (L3), „Gekauft am“ in the title
  } finally {
    w.close();
  }
});
