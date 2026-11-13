/**
 * Den Bereich einer Anfrage lösen die Dienste auf, nicht die Routen: Eine Sicht
 * (wer fragt, welche Konten er gewählt hat) geht hinein, die Regel des
 * Haushalts gilt darin. Ein weiterer Aufrufer (Job, neuer Endpunkt) muss sie
 * nicht nachbauen.
 *
 * Gegenproben (05.11.2026 gemessen):
 *   A  in blickfeldAus() `parseScopeMode(v.konten)` durch 'all' ersetzt → rot:
 *      „eine Sicht wählt die Konten im Dienst“
 *   B  in loescheSetFuer() die Kontenwahl übergangen (`gewaehlt = schreibbar`)
 *      → rot: „Löschen folgt der Kontenwahl, im Schreibbereich“
 *   C  in schreibziel() ohne fachfehler (null zurück) → rot: „ein Unterkonto
 *      schreibt nicht für sein Hauptkonto“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { haeltSet } = require('./helpers/bestand');

test('Dienste lösen die Sicht auf', { concurrency: 1 }, async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const H = { ..._req('src/haushalt/haushalt.js'), ...require('./helpers/sources').testBereich('haushalt') };
  const { getSets } = require('./helpers/sources').bereichsSeite('sets');
  const { loescheSetFuer } = require('./helpers/sources').bereichsSeite('sets');
  const [HAUPT, SUB] = [`haupt_${process.pid}`, `sub_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[HAUPT, SUB]]);
  const haupt = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [HAUPT])).id;
  const sub = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [SUB])).id;
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [haupt, sub]);
  H.leereHaushaltCache();
  await haeltSet(db, haupt, '10179-1');
  await haeltSet(db, sub, '75192-1');
  const nummern = async sicht => (await getSets(sicht, {})).sets.map(s => s.set_number).sort();

  await t.test('eine Sicht wählt die Konten im Dienst', async () => {
    assert.deepEqual(await nummern({ nutzer: haupt }), ['10179-1', '75192-1']);
    assert.deepEqual(await nummern({ nutzer: haupt, konten: 'own' }), ['10179-1']);
    assert.deepEqual(await nummern({ nutzer: haupt, konten: 'subs' }), ['75192-1']);
    assert.deepEqual(
      await nummern({ nutzer: sub, konten: String(haupt) }),
      ['75192-1'],
      'ein Unterkonto sieht über eine fremde ID nicht ins Hauptkonto',
    );
  });

  await t.test('Löschen folgt der Kontenwahl, im Schreibbereich', async () => {
    assert.equal(
      await loescheSetFuer({ nutzer: sub, konten: String(haupt) }, '10179-1'),
      null,
      'das Unterkonto löschte ein Set des Hauptkontos',
    );
    assert.equal(
      await loescheSetFuer({ nutzer: haupt, konten: 'subs' }, '10179-1'),
      null,
      'mit „Unterkonten“ gewählt traf das Löschen das eigene Set',
    );
    assert.deepEqual(await nummern({ nutzer: haupt, konten: 'own' }), ['10179-1']);
    assert.ok(await loescheSetFuer({ nutzer: haupt, konten: 'subs' }, '75192-1'));
    assert.deepEqual(await nummern({ nutzer: haupt }), ['10179-1']);
  });

  await t.test('ein Unterkonto schreibt nicht für sein Hauptkonto', async () => {
    assert.equal(await H.schreibziel(haupt, sub), sub);
    assert.equal(await H.schreibziel(sub, undefined), sub, 'ohne Wunsch das eigene Konto');
    await assert.rejects(H.schreibziel(sub, haupt), e => e.code === 'kein_schreibrecht' && e.art === 'verboten');
  });
});
