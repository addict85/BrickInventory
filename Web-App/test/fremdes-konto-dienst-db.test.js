/**
 * „Wer fragt“ steht an einer Stelle: im Aufrufrahmen, dessen Konto auch der Zeilenschutz
 * setzt. Ein Dienst, der ein anderes Konto als Anfragenden bekommt, wirft (ForeignAccount),
 * statt still nur zu sehen, was der Zeilenschutz des Anfragenden zeigt.
 *
 * Gegenproben (14.11.2026):
 *   A  checkRequester() (src/infra/accountContext.ts) geleert → rot: „ein fremdes Konto
 *      als Anfragender wirft“ (das Unterkonto bekam still nur sein eigenes Set).
 *   B  in householdOf() den Aufruf von checkRequester() gestrichen → rot: dieselbe.
 *   C  in checkRequester() den Systemrahmen nicht ausgenommen → rot: „im Systemrahmen
 *      gilt jedes Konto“.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, asAccount, areaPage } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsSet } = require('./helpers/bestand');

test('ein Dienst fragt nur als das Konto des Zeilenschutzes', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const { inSystemContext, ForeignAccount } = require(
    path.join(__dirname, '..', 'dist', 'src/infra/accountContext.js'),
  );
  const { setsLesen } = areaPage('sets');
  const [MAIN, SUB] = [`fk_haupt_${process.pid}`, `fk_sub_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[MAIN, SUB]]);
  const neu = async n =>
    (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [n])).id;
  const haupt = await neu(MAIN);
  const sub = await neu(SUB);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [haupt, sub]);
  require('./helpers/sources').testServices().household.reportHouseholdChange();
  await holdsSet(db, haupt, '10179-1');
  await holdsSet(db, sub, '75192-1');
  const nummern = async nutzer => (await setsLesen({ nutzer }, {})).sets.map(s => s.set_number).sort();

  await t.test('das eigene Konto sieht seinen Haushalt', async () => {
    assert.deepEqual(await asAccount(haupt, () => nummern(haupt)), ['10179-1', '75192-1']);
  });

  await t.test('ein fremdes Konto als Anfragender wirft', async () => {
    await assert.rejects(
      asAccount(sub, () => nummern(haupt)),
      e => e instanceof ForeignAccount && /Konto \d+ unter dem Zeilenschutz von Konto \d+/.test(String(e)),
    );
  });

  await t.test('im Systemrahmen gilt jedes Konto', async () => {
    const gesehen = await asAccount(sub, () => inSystemContext('Test', () => nummern(haupt)));
    assert.deepEqual(gesehen, ['10179-1', '75192-1']);
  });
});
