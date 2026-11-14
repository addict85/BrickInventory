/**
 * „Wer fragt“ steht an einer Stelle: im Aufrufrahmen, dessen Konto auch der Zeilenschutz
 * setzt. Ein Dienst, der ein anderes Konto als Anfragenden bekommt, wirft (FremdesKonto),
 * statt still nur zu sehen, was der Zeilenschutz des Anfragenden zeigt.
 *
 * Gegenproben (14.11.2026):
 *   A  pruefeAnfragender() (src/infra/kontoKontext.ts) geleert → rot: „ein fremdes Konto
 *      als Anfragender wirft“ (das Unterkonto bekam still nur sein eigenes Set).
 *   B  in haushaltVon() den Aufruf von pruefeAnfragender() gestrichen → rot: dieselbe.
 *   C  in pruefeAnfragender() den Systemrahmen nicht ausgenommen → rot: „im Systemrahmen
 *      gilt jedes Konto“.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, alsKonto, bereichsSeite } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { haeltSet } = require('./helpers/bestand');

test('ein Dienst fragt nur als das Konto des Zeilenschutzes', { concurrency: 1 }, async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const { imSystemkontext, FremdesKonto } = require(path.join(__dirname, '..', 'dist', 'src/infra/kontoKontext.js'));
  const { getSets } = bereichsSeite('sets');
  const [HAUPT, SUB] = [`fk_haupt_${process.pid}`, `fk_sub_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[HAUPT, SUB]]);
  const neu = async n =>
    (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [n])).id;
  const haupt = await neu(HAUPT);
  const sub = await neu(SUB);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [haupt, sub]);
  require('./helpers/sources').testDienste().haushalt.leereHaushaltCache();
  await haeltSet(db, haupt, '10179-1');
  await haeltSet(db, sub, '75192-1');
  const nummern = async nutzer => (await getSets({ nutzer }, {})).sets.map(s => s.set_number).sort();

  await t.test('das eigene Konto sieht seinen Haushalt', async () => {
    assert.deepEqual(await alsKonto(haupt, () => nummern(haupt)), ['10179-1', '75192-1']);
  });

  await t.test('ein fremdes Konto als Anfragender wirft', async () => {
    await assert.rejects(
      alsKonto(sub, () => nummern(haupt)),
      e => e instanceof FremdesKonto && /Konto \d+ unter dem Zeilenschutz von Konto \d+/.test(String(e)),
    );
  });

  await t.test('im Systemrahmen gilt jedes Konto', async () => {
    const gesehen = await alsKonto(sub, () => imSystemkontext('Test', () => nummern(haupt)));
    assert.deepEqual(gesehen, ['10179-1', '75192-1']);
  });
});
