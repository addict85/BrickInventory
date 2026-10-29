/**
 * Auf der Set-Kachel steht das Datum des letzten Kaufs, nicht die Aufnahme ins
 * Konto (die war nach einem Import für alle Sets derselbe Tag).
 *
 *   - getSets() liefert `letzter_kauf` = späteste Erfassung des Sets.
 *   - Die Kachel (jsdom, echtes Bündel) zeigt dieses Datum, nicht added_at.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  MAX(…created_at) in utils/handlers/sets.ts zu MIN → rot: „getSets
 *      liefert den letzten Kauf“
 *   B  gridCard() wieder mit s.added_at → rot: „die Kachel zeigt das Kaufdatum“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { haeltSet, erfasse } = require('./helpers/bestand');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');

test('getSets liefert den letzten Kauf', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  const NAME = `kaufdatum_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [NAME])).id;
  t.after(async () => { await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {}); await db.pool.end().catch(() => {}); });
  await haeltSet(db, uid, '10300-1', 1, { preis: 199, am: '2024-03-02T10:00:00Z' });
  await erfasse(db, uid, '10300-1', 1, { preis: 210, am: '2025-07-14T10:00:00Z' });
  const { getSets } = _req('utils/handlers/sets.js');
  const { sets } = await getSets(uid, {});
  const s = sets.find(x => x.set_number === '10300-1');
  assert.ok(s, 'Set fehlt');
  assert.equal(new Date(s.letzter_kauf).toISOString().slice(0, 10), '2025-07-14');
});

test('die Kachel zeigt das Kaufdatum', async () => {
  const { w, d } = await oeffneOberflaeche({ '/v1/sets': { success: true, total: 1, themes: [], sets: [
    { set_number: '10300-1', name: 'Zeitmaschine', quantity: 2, conditions: ['N'],
      added_at: '2026-10-28T08:00:00Z', letzter_kauf: '2025-07-14T10:00:00Z' }] } }, { browserSprache: 'de-DE' });
  try {
    await warte(() => d.querySelector('.sc .kachel-datum'));
    const datum = d.querySelector('.sc .kachel-datum');
    assert.ok(datum, 'Kein Datum auf der Kachel');
    // Eine Schreibweise für alle Daten (fmtDatum): zweistellig, seit dem 29.10.
    assert.match(datum.textContent, /14\.07\.2025/);
    assert.match(datum.textContent, /Gekauft am/);
  } finally { w.close(); }
});
