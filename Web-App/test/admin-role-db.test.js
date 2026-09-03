/**
 * Adminrechte entziehen — an BEIDEN Wegen, mit Wahrheitswerten als Text.
 *
 * ── Warum es diese Datei gibt ───────────────────────────────────────────────
 * Beide Rollen-Endpunkte lasen den Wunsch mit `is_admin ? 1 : 0`. In
 * JavaScript ist die ZEICHENKETTE "false" wahr. Am laufenden Endpunkt
 * nachgestellt, bevor es gemeldet wurde:
 *
 *   {"is_admin": false}     → HTTP 200, Rechte entzogen      ✓
 *   {"is_admin": "false"}   → HTTP 200, Rechte NICHT entzogen ⚠
 *   {"is_admin": "0"}       → HTTP 200, Rechte NICHT entzogen ⚠
 *
 * Der Admin bekam „erfolgreich" gemeldet und glaubte, jemandem die Rechte
 * genommen zu haben — sie bestanden weiter. Ein Client, der Wahrheitswerte als
 * Text schickt (Formulare, manche HTTP-Bibliotheken), trifft das sofort. Der
 * Selbstschutz („eigene Admin-Rolle kann nicht entfernt werden") hing an
 * derselben Prüfung und lief mit "false" ebenfalls ins Leere.
 *
 * Es war das bekannte Muster „dieselbe Lücke an ZWEI Wegen": Webapp
 * (PUT /api/auth/users/:id/admin) und Android-API
 * (PUT /api/v1/admin/users/:id/role) hatten beide denselben Fehler.
 *
 * Den zweiten Weg gibt es nicht mehr. Er hatte nie einen Aufrufer —
 * nachgemessen über den Browser-Code und die Retrofit-Anmerkungen
 * (test/api-aufrufer.test.js) —, schaltete dieselbe Rolle aber unter einem
 * anderen Feldnamen (`role` statt `is_admin`) mit eigener Prüfung. Bei Rechten
 * ist das die Sorte Doppelung, bei der irgendwann eine Seite großzügiger ist
 * als die andere. Geprüft wird deshalb jetzt der eine Weg, den es gibt.
 *
 * Gegenprobe (durchgeführt): strictBool() in einem der beiden Endpunkte wieder
 * durch `is_admin ? 1 : 0` ersetzt → der zugehörige Teilschritt wird rot.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('Adminrechte lassen sich auch mit "false" als Text entziehen',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const ADMIN = 'rollen-admin-test', ZIEL = 'rollen-ziel-test';
  await db.run(`DELETE FROM users WHERE username IN ($1, $2)`, [ADMIN, ZIEL]);
  await db.run(`INSERT INTO users (username, password_hash, is_admin, is_active)
                VALUES ($1,'x',1,1), ($2,'x',1,1)`, [ADMIN, ZIEL]);
  const adminId = (await db.get(`SELECT id FROM users WHERE username=$1`, [ADMIN])).id;
  const zielId  = (await db.get(`SELECT id FROM users WHERE username=$1`, [ZIEL])).id;

  const { base, srv } = testServer(_req, {
    sitzung: { userId: adminId, username: ADMIN, isAdmin: true },
    apiNutzer: { user_id: adminId, is_admin: 1 },
    routen: { '/api/auth': 'routes/auth.js', '/api/v1': 'routes/api_v1/index.js' },
    t,
  });

  const setzeZielAdmin = () => db.run(`UPDATE users SET is_admin=1 WHERE id=$1`, [zielId]);
  const istAdmin = async () => (await db.get(`SELECT is_admin FROM users WHERE id=$1`, [zielId])).is_admin;

  const entziehe = async (url, methode, wert) => {
    await setzeZielAdmin();
    const r = await fetch(url, {
      method: methode, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_admin: wert }),
    });
    return { status: r.status, adminDanach: await istAdmin() };
  };

  const WEB = `${base}/api/auth/users/${zielId}/admin`;

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
    const r = await fetch(`${base}/api/auth/users/${adminId}/admin`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_admin: 'false' }),
    });
    assert.equal(r.status, 400, 'die eigene Admin-Rolle darf auch mit "false" nicht entfernt werden');
    assert.equal((await db.get(`SELECT is_admin FROM users WHERE id=$1`, [adminId])).is_admin, 1);
  } finally {
    await db.run(`DELETE FROM users WHERE username IN ($1, $2)`, [ADMIN, ZIEL]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
