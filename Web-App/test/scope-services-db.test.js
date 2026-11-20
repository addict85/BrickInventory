/**
 * Den Bereich einer Anfrage lösen die Dienste auf, nicht die Routen: Eine Sicht
 * (wer fragt, welche Konten er gewählt hat) geht hinein, die Regel des
 * Haushalts gilt darin. Ein weiterer Aufrufer (Job, neuer Endpunkt) muss sie
 * nicht nachbauen.
 *
 * Gegenproben (05.11.2026 gemessen):
 *   A  in scopeFrom() `scopeKind(v.konten)` durch 'all' ersetzt → rot:
 *      „eine Sicht wählt die Konten im Dienst“
 *   B  in deleteSetFor() die Kontenwahl übergangen (`gewaehlt = writable`)
 *      → rot: „Löschen folgt der Kontenwahl, im Schreibbereich“
 *   C  in schreibziel() ohne fachfehler (null zurück) → rot: „ein Unterkonto
 *      schreibt nicht für sein Hauptkonto“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsSet } = require('./helpers/inventory');

test('services resolve the view', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const H = {
    ..._req('src/household/rules.js'),
    ..._req('src/household/household.js'),
    ...require('./helpers/sources').testArea('household'),
  };
  const { setsLesen } = require('./helpers/sources').areaPage('sets');
  const { deleteSetFor } = require('./helpers/sources').areaPage('sets');
  const [MAIN, SUB] = [`haupt_${process.pid}`, `sub_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[MAIN, SUB]]);
  const haupt = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [MAIN])).id;
  const sub = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [SUB])).id;
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [haupt, sub]);
  H.reportHouseholdChange();
  await holdsSet(db, haupt, '10179-1');
  await holdsSet(db, sub, '75192-1');
  const nummern = async sicht => (await setsLesen(sicht, {})).sets.map(s => s.set_number).sort();

  await t.test('a view selects the accounts in the service', async () => {
    assert.deepEqual(await nummern({ nutzer: haupt }), ['10179-1', '75192-1']);
    assert.deepEqual(await nummern({ nutzer: haupt, konten: 'own' }), ['10179-1']);
    assert.deepEqual(await nummern({ nutzer: haupt, konten: 'subs' }), ['75192-1']);
    assert.deepEqual(
      await nummern({ nutzer: sub, konten: String(haupt) }),
      ['75192-1'],
      'ein Unterkonto sieht über eine fremde ID nicht ins Hauptkonto',
    );
  });

  await t.test('deleting follows the account selection, in the write scope', async () => {
    assert.equal(
      await deleteSetFor({ nutzer: sub, konten: String(haupt) }, '10179-1'),
      null,
      'das Unterkonto löschte ein Set des Hauptkontos',
    );
    assert.equal(
      await deleteSetFor({ nutzer: haupt, konten: 'subs' }, '10179-1'),
      null,
      'mit „Unterkonten“ gewählt traf das Löschen das eigene Set',
    );
    assert.deepEqual(await nummern({ nutzer: haupt, konten: 'own' }), ['10179-1']);
    assert.ok(await deleteSetFor({ nutzer: haupt, konten: 'subs' }, '75192-1'));
    assert.deepEqual(await nummern({ nutzer: haupt }), ['10179-1']);
  });

  await t.test('a sub-account does not write for its main account', async () => {
    assert.equal(await H.schreibziel(haupt, sub), sub);
    assert.equal(await H.schreibziel(sub, undefined), sub, 'ohne Wunsch das eigene Konto');
    await assert.rejects(
      H.schreibziel(sub, haupt),
      (/** @type {any} */ e) => e.code === 'kein_schreibrecht' && e.art === 'verboten',
    );
  });
});
