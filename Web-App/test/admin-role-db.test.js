/**
 * Adminrechte entziehen — an BEIDEN Wegen, mit Wahrheitswerten als Text.
 * Ausführlich: docs/begruendungen/test/admin-role-db.test.js.md#kopf
 *
 * Gegenprobe (durchgeführt): strictBool() in einem der beiden Endpunkte wieder
 * durch `is_admin ? 1 : 0` ersetzt → der zugehörige Teilschritt wird rot.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
// Adresse aus server.ts lesen — siehe einhaengung() in helpers/sources.js.
const AUTH = require('./helpers/sources').einhaengung('auth');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');

test('Adminrechte lassen sich auch mit "false" als Text entziehen',
  { concurrency: 1 }, async (t) => {

  if (!await dbOderSkip(t, _req, { migrieren: false })) return;
  { const c = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); } }

  const ADMIN = 'rollen-admin-test', ZIEL = 'rollen-ziel-test';
  await db.run(`DELETE FROM users WHERE username IN ($1, $2)`, [ADMIN, ZIEL]);
  const bcrypt = require(require('node:path').join(__dirname, '..', 'node_modules', 'bcryptjs'));
  const ADMIN_PW = 'verwalterPasswort1';
  await db.run(`INSERT INTO users (username, password_hash, is_admin, is_active)
                VALUES ($1,$3,true,true), ($2,'x',true,true)`, [ADMIN, ZIEL, await bcrypt.hash(ADMIN_PW, 4)]);
  const adminId = (await db.get(`SELECT id FROM users WHERE username=$1`, [ADMIN])).id;
  const zielId  = (await db.get(`SELECT id FROM users WHERE username=$1`, [ZIEL])).id;

  const { base, srv } = testServer(_req, {
    sitzung: { userId: adminId, username: ADMIN, isAdmin: true },
    apiNutzer: { user_id: adminId, is_admin: 1 },
    routen: { [AUTH]: 'routes/auth.js', '/api/v1': 'routes/api_v1/index.js' },
    t,
  });

  const setzeZielAdmin = () => db.run(`UPDATE users SET is_admin=true WHERE id=$1`, [zielId]);
  const istAdmin = async () => Number((await db.get(`SELECT is_admin FROM users WHERE id=$1`, [zielId])).is_admin);

  const entziehe = async (url, methode, wert) => {
    await setzeZielAdmin();
    const r = await fetch(url, {
      method: methode, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_admin: wert, admin_password: ADMIN_PW }),
    });
    return { status: r.status, adminDanach: await istAdmin() };
  };

  const WEB = `${base}${AUTH}/users/${zielId}/admin`;

  try {
    {
      const name = 'Webapp', url = WEB;
      // Der eigentliche Fund: "false" als Zeichenkette MUSS entziehen.
      let e = await entziehe(url, 'PUT', 'false');
      assert.equal(e.status, 200, `${name}: "false" sollte angenommen werden`);
      assert.equal(e.adminDanach, 0, `${name}: "false" als Text muss die Rechte ENTZIEHEN`);

      e = await entziehe(url, 'PUT', '0');
      assert.equal(e.adminDanach, 0, `${name}: "0" als Text muss die Rechte entziehen`);

      // Echte Wahrheitswerte wie bisher.
      e = await entziehe(url, 'PUT', false);
      assert.equal(e.adminDanach, 0, `${name}: false entzieht`);

      e = await entziehe(url, 'PUT', true);
      assert.equal(e.adminDanach, 1, `${name}: true vergibt`);

      // Unlesbares wird abgewiesen, statt still das Gegenteil zu tun.
      e = await entziehe(url, 'PUT', 'vielleicht');
      assert.equal(e.status, 400, `${name}: unlesbarer Wert muss 400 geben`);
      assert.equal(e.adminDanach, 1, `${name}: bei 400 darf sich nichts geändert haben`);
    }

    // Der Selbstschutz muss auch mit "false" als Text greifen. Stand vorher
    // auf der v1-Route; die Regel selbst ist unverändert und steht in
    // routes/auth.ts.
    const r = await fetch(`${base}${AUTH}/users/${adminId}/admin`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_admin: 'false', admin_password: ADMIN_PW }),
    });
    assert.equal(r.status, 400, 'die eigene Admin-Rolle darf auch mit "false" nicht entfernt werden');
    assert.equal((await db.get(`SELECT is_admin FROM users WHERE id=$1`, [adminId])).is_admin, true);
  } finally {
    await db.run(`DELETE FROM users WHERE username IN ($1, $2)`, [ADMIN, ZIEL]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
