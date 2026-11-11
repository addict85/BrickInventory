/**
 * Migration 0109: Zustand ist in Merkliste, Preisalarm und Preisspeichern
 * 'N' oder 'U', Auftragsarten stehen in auftrags_arten. Die Migration läuft auf
 * einem Altbestand in einem eigenen Schema (search_path); danach prüft der Test
 * die Regeln an der echten Datenbank.
 *
 * Gegenproben (am 11.11.2026 gemessen):
 *   A  das UPDATE wanted … der Migration entfernt → rot: „Merkliste: andere
 *      Schreibweise wird berichtigt …“ ('2-1' fehlt)
 *   B  im UPDATE wanted die Bedingung `w.id = (SELECT min(y.id) …)` entfernt →
 *      rot: die Migration scheitert an wanted_user_id_set_number_condition_key
 *   C  in AUFTRAGS_ARTEN eine Art 'neu' ohne Migration ergänzt → rot:
 *      „auftrags_arten kennt genau AUFTRAGS_ARTEN“
 *   D  das ALTER TABLE auftraege ADD CONSTRAINT auftraege_art_fkey entfernt →
 *      rot: „danach weist das Schema Unbekanntes ab“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'db/migrations/0109-zustand-und-auftragsart-pruefen.sql'),
  'utf8',
);
const SCHEMA = `probe0109_${process.pid}`;
const TABELLEN = [
  'wanted',
  'price_alerts',
  'price_cache',
  'price_history',
  'part_price_cache',
  'part_price_history',
  'minifig_price_cache',
  'minifig_price_history',
  'auftraege',
  'auftrag_pausen',
];

test('Migration 0109: Zustand und Auftragsart', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const c = await db.pool.connect();
  t.after(async () => {
    await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    c.release();
    await db.pool.end().catch(() => {});
  });

  await t.test('auf einem Altbestand', async tt => {
    await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await c.query(`CREATE SCHEMA ${SCHEMA}`);
    await c.query(`SET search_path TO ${SCHEMA}, public`);
    // Ohne die Prüfungen von heute: Standardwerte und Indizes, keine CHECKs.
    for (const tab of TABELLEN)
      await c.query(`CREATE TABLE ${tab} (LIKE public.${tab} INCLUDING DEFAULTS INCLUDING INDEXES)`);
    await c.query(`INSERT INTO wanted (user_id, set_number, condition) VALUES
      (1, '1-1', 'n'), (1, '1-1', 'N'), (1, '2-1', 'u '), (1, '3-1', 'x'), (1, '4-1', 'n'), (1, '4-1', ' n')`);
    await c.query(`INSERT INTO price_alerts (user_id, set_number, condition, richtung, schwelle, currency_code)
                   VALUES (1, '1-1', 'u', 'unter', 5, 'EUR'), (1, '2-1', '?', 'unter', 5, 'EUR')`);
    await c.query(`INSERT INTO price_cache (set_number, condition, currency_code) VALUES
      ('1-1', 'N', 'EUR'), ('1-1', 'n', 'EUR')`);
    await c.query(`INSERT INTO auftraege (art) VALUES ('preise'), ('verschwunden')`);
    await c.query(`INSERT INTO auftrag_pausen (art, bis) VALUES ('preise', NOW()), ('weg', NOW())`);

    await c.query(MIGRATION);

    await tt.test('Merkliste: andere Schreibweise wird berichtigt, Unbrauchbares fällt', async () => {
      const z = (await c.query('SELECT set_number, condition FROM wanted ORDER BY 1, 2')).rows;
      assert.deepEqual(z, [
        { set_number: '1-1', condition: 'N' },
        { set_number: '2-1', condition: 'U' },
        { set_number: '4-1', condition: 'N' },
      ]);
    });

    await tt.test('Preisalarm und Preisspeicher', async () => {
      assert.deepEqual((await c.query('SELECT set_number, condition FROM price_alerts')).rows, [
        { set_number: '1-1', condition: 'U' },
      ]);
      assert.deepEqual((await c.query('SELECT condition FROM price_cache')).rows, [{ condition: 'N' }]);
    });

    await tt.test('Aufträge und Pausen unbekannter Art fallen', async () => {
      assert.deepEqual((await c.query('SELECT art FROM auftraege')).rows, [{ art: 'preise' }]);
      assert.deepEqual((await c.query('SELECT art FROM auftrag_pausen')).rows, [{ art: 'preise' }]);
    });

    await tt.test('danach weist das Schema Unbekanntes ab', async () => {
      await assert.rejects(c.query(`INSERT INTO auftraege (art) VALUES ('gibt_es_nicht')`), /auftraege_art_fkey/);
      await assert.rejects(
        c.query(`INSERT INTO price_history (set_number, condition, currency_code) VALUES ('9-1', 'u', 'EUR')`),
        /price_history_zustand/,
      );
    });
    await c.query('SET search_path TO public');
  });

  await t.test('auftrags_arten kennt genau AUFTRAGS_ARTEN', async () => {
    const { AUFTRAGS_ARTEN } = _req('src/auftraege/auftraege.js');
    const inDb = (await db.all('SELECT art FROM auftrags_arten ORDER BY art')).map(z => z.art);
    assert.deepEqual(inDb, [...AUFTRAGS_ARTEN].sort());
  });

  await t.test('ein Zustand ausser N und U wird abgewiesen', async () => {
    for (const tab of ['wanted', 'price_cache']) {
      const sql =
        tab === 'wanted'
          ? `INSERT INTO wanted (user_id, set_number, condition) VALUES ((SELECT min(id) FROM users), '9-1', 'n')`
          : `INSERT INTO price_cache (set_number, condition, currency_code) VALUES ('9-1', 'n', 'EUR')`;
      await assert.rejects(db.run(sql), new RegExp(`${tab}_zustand`));
    }
  });

  await t.test('eine unbekannte Auftragsart wird abgewiesen', async () => {
    await assert.rejects(db.run(`INSERT INTO auftraege (art) VALUES ('gibt_es_nicht')`), /auftraege_art_fkey/);
  });
});
