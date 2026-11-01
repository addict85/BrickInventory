/**
 * Ein Währungswechsel gilt für den ganzen Haushalt. Die Haushaltssicht
 * summiert Beträge; zwei Währungen darin ergäben eine falsche Summe. Stellen
 * darf sie nur das Hauptkonto, und jeder Wechsel (ein voller Preislauf) ist
 * gedrosselt.
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  in setzeHaushaltswaehrung nur das eigene Konto schreiben → rot: „der
 *      Wechsel des Hauptkontos gilt im ganzen Haushalt“
 *   C  die Prüfung hatHauptkonto() entfernt → rot: „ein Unterkonto ändert die
 *      Haushaltswährung nicht“
 *   D  die Drossel entfernt → rot: „höchstens fünf Wechsel je Stunde“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('Haushaltswährung', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const namen = ['eltern', 'kind', 'enkel', 'fremd'].map(n => `hw-${n}-${process.pid}`);
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen)
    ids.push((await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [n])).id);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2), ($2, $3)', [ids[0], ids[1], ids[2]]);
  for (const id of ids)
    await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'EUR')`, [id]);
  // Ein echter Wechsel zieht den geplanten Preis-Auftrag vor; ausgeführt wird er hier nicht.
  t.after(async () => {
    await db.run(`DELETE FROM auftraege WHERE art = 'preise'`);
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'waehrung|%'");
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]);
    await db.pool.end().catch(() => {});
  });
  const { setUserSetting } = _req('src/konto/settings.js');
  const waehrungen = async () => (await db.all(
    `SELECT u.id, s.value FROM unnest($1::int[]) WITH ORDINALITY AS u(id, n)
       JOIN user_settings s ON s.user_id = u.id AND s.key = 'currency' ORDER BY u.n`, [ids])).map(r => r.value);

  await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'waehrung|%'");

  await t.test('der Wechsel des Hauptkontos gilt im ganzen Haushalt', async () => {
    await setUserSetting(ids[0], 'currency', 'CHF');
    assert.deepEqual(await waehrungen(), ['CHF', 'CHF', 'CHF', 'EUR'],
      'Eltern, Kind und Enkel müssen dieselbe Währung tragen; das fremde Konto bleibt');
  });

  await t.test('ein Unterkonto ändert die Haushaltswährung nicht', async () => {
    for (const unter of [ids[1], ids[2]]) {
      await assert.rejects(setUserSetting(unter, 'currency', 'USD'),
        e => e.code === 'waehrung_nur_hauptkonto' && e.status === 403);
    }
    await setUserSetting(ids[1], 'currency', 'CHF');
    assert.deepEqual(await waehrungen(), ['CHF', 'CHF', 'CHF', 'EUR'], 'derselbe Wert bleibt erlaubt und ändert nichts');
  });

  await t.test('der Wechsel eines Kontos ohne Haushalt betrifft nur es selbst', async () => {
    await setUserSetting(ids[3], 'currency', 'USD');
    assert.deepEqual(await waehrungen(), ['CHF', 'CHF', 'CHF', 'USD']);
  });

  await t.test('höchstens fünf Wechsel je Stunde', async () => {
    // Der Wechsel oben war der erste dieses Kontos.
    for (const w of ['GBP', 'EUR', 'CHF', 'SEK']) await setUserSetting(ids[3], 'currency', w);
    await assert.rejects(setUserSetting(ids[3], 'currency', 'NOK'), e => e.code === 'zu_viele_anfragen' && e.status === 429);
    await setUserSetting(ids[3], 'currency', 'SEK');
    assert.equal((await waehrungen())[3], 'SEK', 'ein unveränderter Wert zählt nicht und geht durch');
  });
});
