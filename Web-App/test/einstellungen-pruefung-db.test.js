/**
 * Einstellungen eines Kontos nehmen nur bekannte Werte an, und die
 * Konfigurations-Sicherung eines Nicht-Verwalters trägt keine Installation mit.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  NUTZER_REGELN.currency auf `() => true` → rot: „eine fremde Währung
 *      wird abgewiesen" (200 statt 400, "<img>" gespeichert)
 *   B  NUTZER_REGELN.language auf `() => true` → rot: „eine fremde Währung
 *      wird abgewiesen" (Sprache "xx") und „ein Objekt als Wert wird
 *      abgewiesen" ("[object Object]" gespeichert)
 *   C  `if (istVerwalter(req))` vor dem Export entfernt → rot: „ein
 *      Nicht-Verwalter exportiert keine SMTP-Daten"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));

test('Einstellungen: Prüfung der Werte und Export je Rolle', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const NAME = `einst-pruef-${process.pid}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  // Schon CHF, damit das Speichern keinen Preis-Job anstösst (sein Zeitgeber
  // hielte den Testprozess offen).
  await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')`, [uid]);
  const smtpVorher = (await db.get(`SELECT value FROM global_settings WHERE key='smtp_host'`))?.value ?? null;
  await db.run(`INSERT INTO global_settings (key,value) VALUES ('smtp_host','mail.intern.example')
                ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`);

  const appFuer = (isAdmin) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.session = { userId: uid, isAdmin }; next(); });
    app.use('/api/v1', _req('routes/api_v1/settings.js'));
    return app.listen(0);
  };
  const nutzer = appFuer(false), verwalter = appFuer(true);
  const url = (srv, p) => `http://localhost:${srv.address().port}/api/v1/settings${p}`;
  const schicke = (body) => fetch(url(nutzer, '/'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const wert = async (key) =>
    (await db.get('SELECT value FROM user_settings WHERE user_id=$1 AND key=$2', [uid, key]))?.value ?? null;

  try {
    await t.test('bekannte Werte werden gespeichert', async () => {
      const r = await schicke({ currency: 'CHF', language: 'de', user_default_condition: 'U' });
      assert.equal(r.status, 200);
      assert.equal(await wert('language'), 'de');
      assert.equal(await wert('user_default_condition'), 'U');
    });

    await t.test('eine fremde Währung wird abgewiesen', async () => {
      const r = await schicke({ currency: '<img src=x>' });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).code, 'wert_ungueltig');
      assert.equal(await wert('currency'), 'CHF', 'der alte Wert bleibt');
      assert.equal((await schicke({ language: 'xx' })).status, 400);
      assert.equal((await schicke({ user_default_condition: 'Z' })).status, 400);
    });

    await t.test('ein Objekt als Wert wird abgewiesen', async () => {
      const r = await schicke({ language: { a: 1 } });
      assert.equal(r.status, 400);
      assert.equal(await wert('language'), 'de');
    });

    await t.test('ein Nicht-Verwalter exportiert keine SMTP-Daten', async () => {
      const j = await (await fetch(url(nutzer, '/export'))).json();
      assert.deepEqual(j.global, {});
      assert.equal(j.user_settings.currency, 'CHF', 'die eigenen Einstellungen sind dabei');
      const v = await (await fetch(url(verwalter, '/export'))).json();
      assert.equal(v.global.smtp_host, 'mail.intern.example', 'der Verwalter bekommt sie');
    });
  } finally {
    if (smtpVorher === null) await db.run(`DELETE FROM global_settings WHERE key='smtp_host'`);
    else await db.run(`UPDATE global_settings SET value=$1 WHERE key='smtp_host'`, [smtpVorher]);
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await new Promise(r => nutzer.close(r));
    await new Promise(r => verwalter.close(r));
    await db.pool.end().catch(() => {});
  }
});
