/**
 * Währungswechsel stösst den Preis-Job an — gegen echte Routen und Tabelle.
 * Ausführlich: docs/begruendungen/test/currency-change-db.test.js.md#kopf
 *
 * Gegenprobe (durchgeführt): den Anstoss in setUserSetting() entfernt →
 * die beiden „stösst an"-Schritte hier werden rot. Am 30.10.2026 mit dem
 * geplanten Auftrag wiederholt: preisJobAnstossen in startup/verdrahtung.ts leer
 * → rot: „EUR → CHF muss den Preis-Job anstossen“.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('eine echte Währungsänderung stösst den Preis-Job an, ein No-op-Speichern nicht',
  { concurrency: 1 }, async (t) => {

  if (!await dbOderSkip(t, _req, { migrieren: false })) return;

  // Beobachtet wird der Termin des geplanten Auftrags 'preise'.
  const Z = _req('src/auftraege/zeitplan.js');
  await db.run(`DELETE FROM auftraege WHERE art = 'preise'`);
  await Z.planeNaechsten('preise');
  const spaeter = () => db.run(`UPDATE auftraege SET faellig_ab = NOW() + INTERVAL '1 hour' WHERE art = 'preise' AND status = 'offen'`);
  const faellig = async () => (await db.get(
    `SELECT faellig_ab <= NOW() AS jetzt FROM auftraege WHERE art = 'preise' AND status = 'offen'`))?.jetzt === true;
  const warteAufLauf = async () => {
    for (let i = 0; i < 40; i++) { if (await faellig()) return true; await new Promise(r => setTimeout(r, 50)); }
    return false;
  };

  const USERNAME = 'currencytest';
  await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
  await db.run(`INSERT INTO users (username, password_hash, is_admin, is_active) VALUES ($1,'x',false,true)`, [USERNAME]);
  const uid = (await db.get(`SELECT id FROM users WHERE username = $1`, [USERNAME])).id;
  await db.run(
    `INSERT INTO user_settings (user_id, key, value) VALUES ($1,'currency','EUR')
     ON CONFLICT (user_id, key) DO UPDATE SET value='EUR'`, [uid]);

  const { base, srv } = testServer(_req, {
    sitzung: { userId: uid, username: USERNAME, isAdmin: false },
    apiNutzer: { user_id: uid },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });

  const postWeb = (body) => fetch(`${base}/api/v1/settings`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  try {
    // 1) Echte Änderung über die Webapp-Route → der Termin ist jetzt.
    assert.equal(await faellig(), false, 'Vorbedingung: der Lauf liegt in der Zukunft');
    let r = await postWeb({ currency: 'CHF' });
    assert.equal(r.status, 200);
    assert.ok(await warteAufLauf(), 'EUR → CHF muss den Preis-Job anstossen');
    assert.equal((await db.get(
      `SELECT value FROM user_settings WHERE user_id=$1 AND key='currency'`, [uid])).value, 'CHF');

    // 2) Dieselbe Währung nochmal (Formular schickt immer alle Felder) → kein Lauf.
    await spaeter();
    r = await postWeb({ currency: 'CHF', language: 'de' });
    assert.equal(r.status, 200);
    await new Promise(res => setTimeout(res, 700));
    assert.equal(await faellig(), false, 'ein Speichern OHNE Währungsänderung darf keinen Lauf kosten');

    // 3) Parität: dieselbe Regel auf der v1-Route.
    r = await fetch(`${base}/api/v1/settings`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currency: 'EUR' }),
    });
    assert.equal(r.status, 200, `v1-Settings-Route antwortete ${r.status}`);
    assert.ok(await warteAufLauf(), 'CHF → EUR über /api/v1 muss den Preis-Job ebenfalls anstossen');
  } finally {
    await db.run(`DELETE FROM auftraege WHERE art = 'preise'`);
    await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
