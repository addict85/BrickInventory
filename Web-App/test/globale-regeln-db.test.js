'use strict';
/**
 * Globale Einstellungen haben je Schlüssel eine Regel (GLOBALE_REGELN); die
 * Routen warten auf das Schreiben, und ein ungültiger Wert ändert nichts.
 *
 * Gegenproben (05.11.2026 gemessen):
 *   A  api_limit_bricklink in GLOBALE_REGELN als text(200) → rot: „"abc" als
 *      BrickLink-Limit wurde angenommen“ und „ein Import mit ungültigem Limit …“
 *   B  in setGlobalSetting die Prüfung entfernt (nur schreiben) → rot in
 *      settings-helfer-db: „ein Schlüssel ohne Regel wird nicht geschrieben“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { verwalterMitFaktor } = require('./helpers/verwalter');

test('globale Einstellungen: eine Regel je Schlüssel', { concurrency: 1 }, async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, 'x', true, true, true) RETURNING id`,
      [`regeln_${process.pid}`],
    )
  ).id;
  await verwalterMitFaktor(_req, uid);
  const { base } = testServer(_req, { t, sitzung: { userId: uid, username: 'v', isAdmin: true } });
  const wert = async k => (await db.get('SELECT value FROM global_settings WHERE key = $1', [k]))?.value ?? null;
  const schicke = (m, p, body) =>
    fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  await t.test('ungültige Grenzwerte ergeben 400 und ändern nichts', async () => {
    const r0 = await schicke('PUT', '/api/v1/admin/api-limits', { bricklink: 4000 });
    assert.equal(r0.status, 200);
    assert.equal(await wert('api_limit_bricklink'), '4000', 'das Limit steht nach der Antwort in der Tabelle');
    for (const falsch of ['abc', -7, '-7', 0, 100001, '12abc', 1.5]) {
      const r = await schicke('PUT', '/api/v1/admin/api-limits', { bricklink: falsch });
      assert.equal(r.status, 400, `${JSON.stringify(falsch)} als BrickLink-Limit wurde angenommen`);
      assert.equal((await r.json()).code, 'tageslimit_bereich');
    }
    assert.equal(await wert('api_limit_bricklink'), '4000', 'die Tabelle bleibt unverändert');
    const ttl = await schicke('POST', '/api/v1/admin/cache-ttl', { ttl: '7' });
    assert.equal(ttl.status, 400, 'eine TTL ausserhalb der Auswahl');
  });

  await t.test('ein Import mit ungültigem Limit ändert nichts', async () => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([JSON.stringify({ version: '3.0', global: { api_limit_bricklink: 'NaN' } })]),
      'k.json',
    );
    const r = await fetch(`${base}/api/v1/settings/import`, { method: 'POST', body: form });
    assert.equal(r.status, 400, 'ein Import mit ungültigem Limit …');
    assert.equal(await wert('api_limit_bricklink'), '4000');
    const kaputt = new FormData();
    kaputt.append('file', new Blob([JSON.stringify({ global: 'kein Objekt' })]), 'k.json');
    assert.equal(
      (await fetch(`${base}/api/v1/settings/import`, { method: 'POST', body: kaputt })).status,
      400,
      'eine Importdatei ausserhalb des Schemas',
    );
  });

  await t.test('jeder geschriebene Schlüssel hat eine Regel', () => {
    const { GLOBALE_REGELN } = _req('src/vertrag/globaleRegeln.js');
    const { GLOBALE_EINSTELLUNGEN } = _req('src/vertrag/einstellungen.js');
    const { DAILY_JOBS } = _req('src/auftraege/zeitplan.js');
    const geschrieben = [
      ...GLOBALE_EINSTELLUNGEN,
      ...DAILY_JOBS.map(j => `job_time_${j.name}`),
      'app_theme',
      'einrichtung_erledigt',
    ];
    assert.deepEqual(
      geschrieben.filter(k => !Object.hasOwn(GLOBALE_REGELN, k)),
      [],
    );
    assert.ok(require('node:fs').existsSync(path.join(ROOT, 'src/vertrag/globaleRegeln.ts')));
  });
});
