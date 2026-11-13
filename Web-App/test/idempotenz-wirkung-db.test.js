/**
 * Der Idempotenzschlüssel vermerkt die Wirkung der Route in derselben
 * Transaktion. Bricht die Anfrage nach dem COMMIT ab (Absturz, Serverfehler),
 * wirkt die Wiederholung kein zweites Mal: nach der Frist 409
 * „nicht wiederholbar“ statt eines zweiten Laufs.
 *
 * Gegenproben (10.11.2026 gemessen):
 * - db/database.ts: der Aufruf von commitBegleiter vor dem COMMIT entfernt →
 *   rot: „abgebrochen nach dem COMMIT“ (zwei Zeilen statt einer) und „ein
 *   Serverfehler nach dem COMMIT“ (Wiederholung lief, 200 statt 409).
 * - repository.ts: in belege() `AND NOT idempotenz.wirkung` gestrichen → rot:
 *   „abgebrochen nach dem COMMIT“ (die Wiederholung belegt neu und wirkt).
 * - Gegenrichtung: „ohne COMMIT darf sie neu“ bleibt grün, auch mit beiden
 *   Gegenproben; eine zurückgerollte Transaktion vermerkt nichts.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const db = testDaten();
const { idempotenz } = _req('src/idempotenz/http/middleware.js');
const dienst = _req('src/idempotenz/dienst.js');

const NAME = `idem_wirkung_${process.pid}`;

test('Idempotenz: Wirkung und Schlüssel in einer Transaktion', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  const tabelle = `idem_wirkung_${process.pid}`;
  await db.run(`CREATE TABLE ${tabelle} (schluessel text)`);
  t.after(async () => {
    await db.run(`DROP TABLE IF EXISTS ${tabelle}`).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  // Was die Route nach ihrer Transaktion tut: antworten, abbrechen oder scheitern.
  let danach = 'antworten',
    rollback = false;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    /** @type {any} */ (req).apiUser = { user_id: uid };
    next();
  });
  app.use('/api/v1', idempotenz);
  app.post('/api/v1/parts', async (req, res) => {
    await db.transaction(async tx => {
      await tx.run(`INSERT INTO ${tabelle} VALUES ($1)`, [req.get('Idempotency-Key')]);
      if (rollback) throw new Error('zurückgerollt');
    });
    if (danach === 'abbrechen') return void res.socket.destroy();
    if (danach === 'scheitern') throw new Error('nach dem COMMIT');
    res.json({ success: true });
  });
  app.use((_e, _req, res, _next) => {
    res.status(500).type('text/plain').send('Fehler');
  });
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const url = `http://localhost:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}/api/v1/parts`;
  const sende = k =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': k },
      body: '{"part_number":"3001"}',
    }).catch(() => null);
  const wirkungen = async k => (await db.get(`SELECT COUNT(*)::int AS n FROM ${tabelle} WHERE schluessel = $1`, [k])).n;
  const verwaise = k =>
    db.run(
      `UPDATE idempotenz SET angelegt = NOW() - make_interval(secs => $3)
                                  WHERE user_id = $1 AND schluessel = $2`,
      [uid, k, dienst.VERWAIST_NACH_S + 1],
    );
  const fertig = async k => {
    for (let i = 0; i < 50; i++) {
      if (
        !(await db.get('SELECT 1 FROM idempotenz WHERE user_id = $1 AND schluessel = $2 AND status IS NULL', [uid, k]))
      )
        return;
      await new Promise(r => setTimeout(r, 20));
    }
  };

  await t.test('abgebrochen nach dem COMMIT', async () => {
    danach = 'abbrechen';
    assert.equal(await sende('k-abbruch'), null, 'Vorbedingung: Die Verbindung reisst ab');
    await verwaise('k-abbruch');
    danach = 'antworten';
    const r = await sende('k-abbruch');
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, 'idempotenz_nicht_wiederholbar');
    assert.equal(await wirkungen('k-abbruch'), 1);
  });

  await t.test('ein Serverfehler nach dem COMMIT', async () => {
    danach = 'scheitern';
    assert.equal((await sende('k-fehler')).status, 500);
    await fertig('k-fehler');
    danach = 'antworten';
    const r = await sende('k-fehler');
    assert.equal(r.status, 409);
    assert.equal(await wirkungen('k-fehler'), 1);
  });

  await t.test('ohne COMMIT darf sie neu', async () => {
    rollback = true;
    assert.equal((await sende('k-rollback')).status, 500);
    await fertig('k-rollback');
    rollback = false;
    const r = await sende('k-rollback');
    assert.equal(r.status, 200);
    assert.equal(await wirkungen('k-rollback'), 1);
  });
});
