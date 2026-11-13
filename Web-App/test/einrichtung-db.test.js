/**
 * Einrichtungs-Assistent: wann er erscheint, wann nicht mehr, und dass der
 * Testknopf nur bekannte Quellen anfasst.
 *
 * Gegenproben (25.10., gemessen):
 *   A  `!erledigt &&` aus der Bedingung entfernt   → rot: „erscheint nach Fertig weiter"
 *   B  Object.hasOwn in /quelle-testen entfernt   → rot: „__proto__ gilt als Quelle"
 *   C  istVerwalter-Prüfung in /einrichtung weg   → rot: „Nicht-Verwalter sieht den Stand"
 *   D  (04.11.) in quellenAbsage die Zeile für fehlende Schlüssel entfernt
 *      → rot: „fehlender Schlüssel in Klartext" (quelle_test_fehlgeschlagen)
 *   E  (13.11.) in eingangsSperre() die Prüfung mussWechseln() entfernt → rot:
 *      „mit dem Startpasswort führt der Eingang nur zum Wechsel“ (200 statt 403)
 *
 * Über die echte Kette (testServer): Mit dem Startpasswort lässt der Eingang nur
 * den Wechsel zu; die Oberfläche öffnet den Assistenten erst danach (sitzung.js:
 * oeffneApp → Pflichtwechsel → Neuladen → showApp → pruefeEinrichtung).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { verwalterMitFaktor } = require('./helpers/verwalter');
const db = testDaten();

const SCHLUESSEL = [
  'rebrickable_api_key',
  'brickset_api_key',
  'bricklink_consumer_key',
  'bricklink_consumer_secret',
  'bricklink_token',
  'bricklink_token_secret',
  'einrichtung_erledigt',
];

test('Einrichtungs-Assistent', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req, { migrieren: false }))) return;
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);

  const name = `ew_${process.pid}`;
  const uid = (
    await db.get(
      "INSERT INTO users (username, password_hash, is_admin, must_change_password) VALUES ($1,'x',true,true) RETURNING id",
      [name],
    )
  ).id;
  await verwalterMitFaktor(_req, uid);
  const verwalter = { userId: uid, isAdmin: true };
  const V = testServer(_req, { sitzung: verwalter, t });
  const N = testServer(_req, { sitzung: { userId: uid, isAdmin: false }, t });
  const ruf = async (srv, weg, body) => {
    const r = await fetch(srv.base + '/api/v1/settings' + weg, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json() };
  };
  const setze = (k, v) =>
    db.run(
      `INSERT INTO global_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [k, v],
    );

  try {
    await t.test('mit dem Startpasswort führt der Eingang nur zum Wechsel', async () => {
      const r = await ruf(V, '/einrichtung');
      assert.equal(r.status, 403, JSON.stringify(r.body));
      assert.equal(r.body.code, 'passwort_wechsel_noetig');
    });

    await t.test('frische Installation nach dem Pflichtwechsel: offen, ohne Passwortschritt', async () => {
      // Wie POST /auth/change-password: Konto und Sitzung vergessen die Pflicht.
      await db.run('UPDATE users SET must_change_password = false WHERE id = $1', [uid]);
      delete verwalter.mussPasswortAendern;
      const r = await ruf(V, '/einrichtung');
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.offen, true);
      assert.equal(r.body.passwort_aendern, false);
      assert.deepEqual(r.body.quellen, { rebrickable: false, brickset: false, bricklink: false });
      const n = await ruf(N, '/einrichtung');
      assert.equal(n.status, 403, 'Nicht-Verwalter sieht den Stand');
      assert.equal(n.body.code, 'nur_admins');
    });

    await t.test('eingerichtet: Schlüssel da, Passwort gesetzt → nicht mehr offen', async () => {
      await setze('rebrickable_api_key', 'abc');
      await _req('src/einstellungen/settings.js').verschluesseleGlobaleAltwerte();
      const r = await ruf(V, '/einrichtung');
      assert.equal(r.body.offen, false);
      assert.equal(r.body.quellen.rebrickable, true);
      assert.ok(!JSON.stringify(r.body).includes('abc'), 'Der Stand gibt den Schlüssel heraus');
    });

    await t.test('„Fertig" schliesst ihn auch, wenn noch etwas fehlt', async () => {
      await db.run('DELETE FROM global_settings WHERE key = $1', ['rebrickable_api_key']);
      assert.equal((await ruf(V, '/einrichtung')).body.offen, true);
      assert.equal((await ruf(V, '/einrichtung/fertig', {})).status, 200);
      assert.equal((await ruf(V, '/einrichtung')).body.offen, false, 'erscheint nach Fertig weiter');
    });

    await t.test('Testknopf: nur bekannte Quellen, ohne Schlüssel eine verständliche Absage', async () => {
      for (const q of ['gibtsnicht', '__proto__', 'constructor']) {
        const r = await ruf(V, '/quelle-testen', { quelle: q });
        assert.equal(r.status, 400, q);
        assert.equal(r.body.code, 'quelle_unbekannt', `${q} gilt als Quelle`);
      }
      const bs = await ruf(V, '/quelle-testen', { quelle: 'brickset' });
      assert.equal(bs.status, 400);
      assert.equal(bs.body.code, 'quelle_ohne_schluessel', 'fehlender Schlüssel in Klartext');
      assert.match(bs.body.error, /Für Brickset ist noch kein Zugang gespeichert/);
      assert.match(bs.body.details, /nicht konfiguriert/, 'der rohe Grund steht unter „Details“');
      const bl = await ruf(V, '/quelle-testen', { quelle: 'bricklink' });
      assert.equal(bl.body.code, 'quelle_ohne_schluessel');
      assert.match(bl.body.details, /nicht vollständig/);
      assert.equal((await ruf(N, '/quelle-testen', { quelle: 'brickset' })).status, 403);
    });
  } finally {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]).catch(() => {});
    for (const z of vorher) await setze(z.key, z.value).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
