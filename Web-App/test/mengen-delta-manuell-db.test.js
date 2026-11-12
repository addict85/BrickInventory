/**
 * quantity_delta auch für manuelle Teile und Figuren: Zwei Geräte, die
 * gleichzeitig „+1" schicken, ergeben +2 — mit absoluter Menge gewann die
 * zuletzt gesendete. Geprüft über die Route (Antwort trägt die Menge) und
 * über den Dienst (Gleichzeitigkeit).
 *
 * Gegenproben (31.10.2026 gemessen):
 *   A  in passeManuelleMengeAn die Zielmenge aus `vorab` statt aus den in der
 *      Sperre gelesenen Erfassungen → rot: „zwei gleichzeitige +1" (3 statt 4)
 *   B  mengenwunsch() ohne den quantity_delta-Zweig → rot: alle Fälle
 *   C  Untergrenze MINDESTENS auf 0 → rot: „ein Schritt unter 1 bleibt bei 1"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const { testServer } = require('./helpers/server');

const NAME = `mdelta_${process.pid}`,
  TEIL = '3001md',
  FIGUR = 'fig-md01';

test('quantity_delta für manuelle Teile und Figuren', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, $2, 5, 'manual')`, [uid, TEIL]);
  await db.run(`INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity) VALUES ($1, $2, 5, 2)`, [
    uid,
    TEIL,
  ]);
  await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1, $2, 'manual')`, [uid, FIGUR]);
  await db.run(`INSERT INTO minifig_acquisitions (user_id, fig_number, quantity) VALUES ($1, $2, 1)`, [uid, FIGUR]);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const { updateManualPart } = _req('src/teile/manuelleTeile.js');
  const { updateManualFig } = _req('src/figuren/manuelleFiguren.js');
  const teil = async () =>
    Number(
      (
        await db.get(
          'SELECT COALESCE(SUM(quantity),0)::int q FROM part_acquisitions WHERE user_id=$1 AND part_number=$2',
          [uid, TEIL],
        )
      ).q,
    );
  const figur = async () =>
    Number(
      (
        await db.get(
          'SELECT COALESCE(SUM(quantity),0)::int q FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2',
          [uid, FIGUR],
        )
      ).q,
    );

  await t.test('zwei gleichzeitige +1 ergeben +2', async () => {
    await Promise.all([
      updateManualPart(uid, TEIL, 5, { quantity_delta: 1 }),
      updateManualPart(uid, TEIL, 5, { quantity_delta: 1 }),
    ]);
    assert.equal(await teil(), 4);
    await Promise.all([
      updateManualFig(uid, FIGUR, { quantity_delta: 1 }),
      updateManualFig(uid, FIGUR, { quantity_delta: 1 }),
    ]);
    assert.equal(await figur(), 3);
  });

  await t.test('über die Route: Schritt nach unten, Antwort mit der Menge danach', async () => {
    const { base } = testServer(_req, {
      apiNutzer: { user_id: uid, is_admin: 0 },
      routen: { '/api/v1': 'routes/api_v1/index.js' },
      t,
    });
    const put = (pfad, body) =>
      fetch(`${base}/api/v1/${pfad}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async r => ({ status: r.status, body: await r.json() }));
    assert.deepEqual(await put(`parts/${TEIL}/5`, { quantity_delta: -1 }), {
      status: 200,
      body: { success: true, quantity: 3 },
    });
    assert.deepEqual(await put(`minifigs/${FIGUR}`, { quantity_delta: -2 }), {
      status: 200,
      body: { success: true, quantity: 1 },
    });
    assert.equal((await put(`parts/${TEIL}/5`, { quantity_delta: 1.5 })).status, 400);
    assert.equal(await teil(), 3);
  });

  await t.test('ein Schritt unter 1 bleibt bei 1 — gelöscht wird nur über Löschen', async () => {
    assert.deepEqual(await updateManualPart(uid, TEIL, 5, { quantity_delta: -10 }), { quantity: 1 });
    assert.equal(await teil(), 1);
  });
});
