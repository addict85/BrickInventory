/**
 * Anmelden füllt die Tabellen nicht beliebig (Sicherheitsprüfung Runde 13, H2):
 * je Konto höchstens 50 Sitzungen und 50 Tokens, es fällt der am längsten
 * unbenutzte. Wer sich von einer Adresse sehr oft anmeldet, verliert nur den
 * Vorrang in der bcrypt-Schranke (weiche Grenze), gesperrt wird er nicht.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  establishSession() ohne begrenzeSitzungen() → rot: „höchstens 50 Sitzungen …“
 *   B  in kappeSitzungen() `ORDER BY expire ASC` → rot: dieselbe Prüfung (die
 *      zuletzt benutzten fielen)
 *   C  createToken() ohne kappeTokens() → rot: „höchstens 50 Tokens …“
 *   D  kappeTokens() ohne `ersetzt_durch IS NULL` → rot: dieselbe Prüfung (der
 *      getauschte Token in seiner Überlappung fiel)
 *   E  bekannteAnmeldung() ohne den Zähler `login-erfolg` → rot: „nach 30
 *      Anmeldungen …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);

test('Obergrenzen für Sitzungen, Tokens und Vorrang', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    keineDb(t, e); return;
  }
  { const c = await db.pool.connect(); try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); } }
  const NAME = `grenze_${process.pid}`, ANDERER = `grenze_b_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, ANDERER]]);
  const lege = async (n) => (await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, 'x', true, true) RETURNING id`, [n])).id;
  const uid = await lege(NAME), anderer = await lege(ANDERER);
  const sitzungen = (id) => db.all(`SELECT sid FROM user_sessions WHERE sess::jsonb->>'userId' = $1 ORDER BY sid`, [String(id)]);
  t.after(async () => {
    await db.run(`DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = ANY($1)`, [[String(uid), String(anderer)]]);
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2', [`%konto:${uid}%`, '%203.0.113.77%']);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, anderer]]);
    await db.pool.end().catch(() => {});
  });

  await t.test('höchstens 50 Sitzungen je Konto, die zuletzt benutzten bleiben', async () => {
    // 60 alte Sitzungen: alt_00 lief zuerst ab (am längsten unbenutzt), alt_59 zuletzt.
    for (const [id, n] of [[uid, 60], [anderer, 3]]) {
      for (let i = 0; i < n; i++) {
        await db.run(`INSERT INTO user_sessions (sid, sess, expire) VALUES ($1, $2, NOW() + make_interval(mins => $3))`,
          [`${id}_alt_${String(i).padStart(2, '0')}`, JSON.stringify({ cookie: {}, userId: id }), 60 + i]);
      }
    }
    const { establishSession } = _req('src/konto/http/anmeldung.js');
    const app = express();
    app.use(session({ store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
      secret: 'grenze-test-geheimnis-lang-genug', resave: false, saveUninitialized: false }));
    app.post('/an', async (req, res) => {
      await establishSession(req, { userId: uid, username: NAME, isAdmin: false });
      res.json({ sid: req.sessionID });
    });
    const srv = app.listen(0);
    t.after(() => new Promise(r => srv.close(r)));
    const { sid } = await (await fetch(`http://127.0.0.1:${srv.address().port}/an`, { method: 'POST' })).json();
    const rest = (await sitzungen(uid)).map(z => z.sid);
    assert.equal(rest.length, 50, 'höchstens 50 Sitzungen …');
    assert.ok(rest.includes(sid), 'die neue Sitzung bleibt');
    assert.deepEqual(rest.filter(s => s !== sid), Array.from({ length: 49 }, (_, i) => `${uid}_alt_${i + 11}`),
      'höchstens 50 Sitzungen … (es fallen die am längsten unbenutzten)');
    assert.equal((await sitzungen(anderer)).length, 3, 'fremde Sitzungen bleiben');
  });

  await t.test('höchstens 50 Tokens je Konto, ein getauschter zählt nicht', async () => {
    for (let i = 0; i < 55; i++) {
      await db.run(`INSERT INTO api_tokens (token, user_id, label, last_used, expires_at)
        VALUES ($1, $2, 'alt', NOW() - make_interval(hours => $3), NOW() + INTERVAL '7 days')`, [`grenze_${uid}_${String(i).padStart(2, '0')}`, uid, 55 - i]);
    }
    // Der älteste ist schon getauscht und gilt noch in seiner Überlappung.
    await db.run(`UPDATE api_tokens SET ersetzt_durch = $2, last_used = NOW() - INTERVAL '100 hours' WHERE token = $1`,
      [`grenze_${uid}_00`, `grenze_${uid}_54`]);
    const auth = _req('src/konto/geraeteToken.js');
    const neu = auth.hashToken(await auth.createToken(uid, 'neu'));
    const rest = (await db.all('SELECT token FROM api_tokens WHERE user_id = $1 ORDER BY token', [uid])).map(z => z.token);
    assert.ok(rest.includes(neu), 'der neue Token bleibt');
    assert.ok(rest.includes(`grenze_${uid}_00`), 'höchstens 50 Tokens … (der getauschte bleibt bis zum Ende der Überlappung)');
    assert.deepEqual(rest.filter(x => x !== neu && x !== `grenze_${uid}_00`),
      Array.from({ length: 49 }, (_, i) => `grenze_${uid}_${String(i + 6).padStart(2, '0')}`), 'höchstens 50 Tokens …');
  });

  await t.test('nach 30 Anmeldungen je Adresse und Konto nur noch ohne Vorrang', async () => {
    const L = _req('src/konto/loginLimiter.js');
    const ip = '203.0.113.77';
    assert.equal(await L.bekannteAnmeldung(ip, NAME), false, 'ein unbekanntes Gerät hat keinen Vorrang');
    for (let i = 0; i < L.ERFOLGE_MIT_VORRANG - 1; i++) await L.recordLoginSuccess(ip, NAME);
    assert.equal(await L.bekannteAnmeldung(ip, NAME), true);
    await L.recordLoginSuccess(ip, NAME);
    assert.equal(await L.bekannteAnmeldung(ip, NAME), false, 'nach 30 Anmeldungen …');
    assert.equal(await L.checkLoginAllowed(ip, NAME), null, 'die weiche Grenze sperrt nicht');
    await L.gibAnmeldeplatzFrei(ip, NAME);
  });
});
