/**
 * Ein Konto löscht sich selbst (DELETE /api/v1/auth/konto) mit Passwort und,
 * falls eingerichtet, zweitem Faktor; der letzte Verwalter kann es nicht.
 * Unbestätigte Registrierungen räumt der tägliche Lauf nach sieben Tagen ab,
 * Konten mit nur noch nicht bestätigter neuer Adresse nicht.
 *
 * Gegenproben (am 04.11.2026 gemessen, je eine Änderung, danach zurück):
 *   A  bestaetigeMitFaktor() in der Route gestrichen → rot: „ohne Passwort
 *      bleibt das Konto …“ und „mit zweitem Faktor …“
 *   B  loescheEigenesKonto() ohne die Verwalterbedingung → rot: „der letzte
 *      Verwalter bleibt“
 *   C  loescheOffeneRegistrierungen() ohne `registrierung_offen` → rot:
 *      „unbestätigte Registrierungen …“ (das Konto mit neuer Adresse ist weg)
 *   D  der Schritt fehlt in aufraeumenTaeglich() → rot: dieselbe Prüfung
 *      (die alte Registrierung bleibt)
 * Gemessen grün blieb (04.11.2026): uebernimmEmailNeu() ohne `registrierung_offen = false` —
 * das Löschen verlangt zusätzlich NOT email_verified.
 *
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const crypto = require('node:crypto');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PASS = 'Loeschen-Passwort-1';

test('Konto selbst löschen und offene Registrierungen', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    keineDb(t, e); return;
  }
  { const c = await db.pool.connect(); try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); } }
  const P = process.pid, NAMEN = ['weg', 'zf', 'chef', 'offen_alt', 'offen_neu', 'adresse', 'bestaetigt'].map(n => `ksl_${n}_${P}`);
  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  // Nur dieser Verwalter: Die übrigen Konten der Test-DB sollen die Bedingung nicht erfüllen.
  await db.run('UPDATE users SET is_active = false WHERE is_admin AND NOT (username = ANY($1))', [NAMEN]);
  const konto = async (name, admin = false) => (await db.get(`INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, $4, true, true) RETURNING id`, [name, `${name}@example.org`, await bcrypt.hash(PASS, 4), admin])).id;
  const da = async (id) => !!(await db.get('SELECT 1 FROM users WHERE id = $1', [id]));
  t.after(async () => { await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]).catch(() => {}); await db.pool.end().catch(() => {}); });
  const als = (uid) => {
    const { base } = testServer(_req, { sitzung: { userId: uid, destroy: (cb) => cb() }, routen: { '/api/v1/auth': 'routes/auth.js' }, t });
    return async (body) => {
      const r = await fetch(`${base}/api/v1/auth/konto`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
  };

  await t.test('ohne Passwort bleibt das Konto, mit Passwort ist es weg', async () => {
    const id = await konto(NAMEN[0]);
    await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10294-1')`, [id]);
    const loesche = als(id);
    assert.ok((await loesche({})).status >= 400);
    assert.ok((await loesche({ password: 'falsch-falsch-1' })).status >= 400);
    assert.ok(await da(id));
    const r = await loesche({ password: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await da(id), false);
    assert.equal((await db.get('SELECT count(*)::int AS n FROM sets WHERE user_id = $1', [id])).n, 0);
  });

  await t.test('mit zweitem Faktor reicht das Passwort nicht', async () => {
    const id = await konto(NAMEN[1]);
    await db.run(`INSERT INTO zweiter_faktor (user_id, geheimnis, aktiv) VALUES ($1, 'x', true)`, [id]);
    const r = await als(id)({ password: PASS });
    assert.equal(r.body.code, 'zweiter_faktor_noetig', JSON.stringify(r.body));
    assert.ok(await da(id));
  });

  await t.test('der letzte Verwalter bleibt', async () => {
    const id = await konto(NAMEN[2], true);
    const r = await als(id)({ password: PASS });
    assert.deepEqual([r.status, r.body.code], [409, 'letzter_verwalter']);
    assert.ok(await da(id));
  });

  const K = { ..._req('src/konto/konten.js'), ..._req('src/konto/prozess.js').kontoBereich().konten };
  const { verifiziereEmailToken } = _req('src/konto/anmeldepruefung.js');
const { hashToken } = _req('src/konto/geraeteToken.js');
  const registriert = async (name, tageAlt) => {
    const roh = crypto.randomBytes(16).toString('hex');
    const id = await K.registriere({ username: name, email: `${name}@example.org`, passwort: PASS,
      tokenHash: hashToken(roh), bis: new Date(Date.now() + 86_400_000) });
    await db.run(`UPDATE users SET created_at = NOW() - make_interval(days => $2) WHERE id = $1`, [id, tageAlt]);
    return { id, roh };
  };

  await t.test('unbestätigte Registrierungen nach sieben Tagen', async () => {
    const alt = await registriert(NAMEN[3], 8), neu = await registriert(NAMEN[4], 6);
    const bestaetigt = await registriert(NAMEN[6], 8);
    assert.equal((await verifiziereEmailToken(bestaetigt.roh)).ok, true);
    // Ein altes Konto, dessen neue Adresse noch nicht bestätigt ist.
    const adresse = await konto(NAMEN[5]);
    await db.run(`UPDATE users SET email_verified = false, verification_token = 'x', created_at = NOW() - INTERVAL '30 days' WHERE id = $1`, [adresse]);

    await _req('src/verwaltung/aufraeumen.js').aufraeumenTaeglich();
    const stand = { alt: await da(alt.id), neu: await da(neu.id), bestaetigt: await da(bestaetigt.id), adresse: await da(adresse) };
    assert.deepEqual(stand, { alt: false, neu: true, bestaetigt: true, adresse: true });
  });
});
