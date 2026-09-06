/**
 * Rechteentzug und Kontoloeschung muessen die offene Sitzung erreichen.
 *
 * ── Woher das kommt ─────────────────────────────────────────────────────────
 * istVerwalter() (utils/auth.ts) fragt ZUERST `req.session.isAdmin`. Der Wert
 * steht seit dem Anmelden fest und wurde nie nachgefuehrt:
 *
 *   PUT /users/:id/admin  schrieb nur `UPDATE users SET is_admin`.
 *   DELETE /users/:id     loeschte nur die Zeile.
 *
 * Damit wirkte dieselbe Regel an den beiden Ausweisen VERSCHIEDEN:
 *
 *   App / Bearer-Token   wirkte — validateToken() liest u.is_admin per JOIN
 *                        frisch; nur der Cache hielt bis zu 60s am alten Wert.
 *   Browser / Sitzung    wirkte NICHT — wer sein Fenster offen liess, blieb
 *                        Verwalter. Das Sitzungs-Cookie hat kein maxAge.
 *
 * Und beim Loeschen: Die Bearer-Tokens gehen per ON DELETE CASCADE mit,
 * user_sessions hat aber keinen Fremdschluessel auf users — das geloeschte
 * Konto blieb angemeldet.
 *
 * ── Warum das hier gegen eine echte Datenbank laeuft ────────────────────────
 * Der Kern der Sache ist eine ZEILE in user_sessions, die verschwinden muss.
 * Ein quelltextlesender Test koennte nur pruefen, dass irgendwo
 * `revokeAllSessions` steht — und genau diese Funktion hat schon einmal in die
 * falsche Tabelle geschrieben (siehe ihren Kommentar in utils/auth.ts: sie
 * suchte `session` statt `user_sessions`, das DELETE lief nie, und die Pruefung
 * darauf blieb gruen). Hier wird deshalb nachgesehen, ob die Zeile weg ist.
 *
 * Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
 * Ohne DB: skip. Ausfuehren: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, einhaengung } = require('./helpers/sources');
const _req = buildAndRequire();
const AUTH = einhaengung('auth');
const db   = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt  = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const CHEF = 'rechte_chef', ZIEL = 'rechte_ziel', PASS = 'richtigesPasswort1';

test('ein Rechtewechsel und eine Loeschung beenden die Sitzung des Ziels',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await db.run('DELETE FROM users WHERE username IN ($1,$2)', [CHEF, ZIEL]);
  const hash = await bcrypt.hash(PASS, 4);
  await db.run('INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,1,1,1)', [CHEF, hash]);
  await db.run('INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,1,1,1)', [ZIEL, hash]);
  const idZiel = (await db.get('SELECT id FROM users WHERE username=$1', [ZIEL])).id;

  const app = express();
  app.use(express.json());
  app.use(session({
    store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
  }));
  app.use(AUTH, _req('routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}`;

  const ruf = async (weg, opt = {}) => {
    const r = await fetch(basis + weg, {
      method: opt.method || 'GET',
      headers: { 'content-type': 'application/json', ...(opt.headers || {}) },
      ...(opt.body ? { body: JSON.stringify(opt.body) } : {}),
    });
    return { status: r.status, cookie: r.headers.get('set-cookie'), body: await r.json().catch(() => null) };
  };
  const anmelden = async (name) => {
    const a = await ruf(AUTH + '/login', { method: 'POST', body: { username: name, password: PASS } });
    assert.equal(a.status, 200, `Anmeldung von ${name} scheiterte: ${JSON.stringify(a.body)}`);
    assert.ok(a.cookie, 'Ohne Set-Cookie gibt es keine Sitzung');
    return a.cookie.split(';')[0];
  };
  // Gezaehlt wird ueber den Inhalt, nicht ueber die Gesamtzahl der Zeilen: Im
  // Store liegen auch Sitzungen anderer Tests.
  const sitzungen = async (uid) => Number((await db.get(
    "SELECT COUNT(*)::int AS n FROM user_sessions WHERE sess::jsonb->>'userId' = $1",
    [String(uid)])).n);

  try {
    const chefCookie = await anmelden(CHEF);

    // ── 1. Rechteentzug ─────────────────────────────────────────────────────
    let zielCookie = await anmelden(ZIEL);
    assert.equal(await sitzungen(idZiel), 1, 'Vorbedingung: Das Ziel hat genau eine offene Sitzung');

    const entzug = await ruf(AUTH + `/users/${idZiel}/admin`,
      { method: 'PUT', headers: { cookie: chefCookie }, body: { is_admin: false } });
    assert.equal(entzug.status, 200, `Entzug scheiterte: ${JSON.stringify(entzug.body)}`);
    assert.equal(await sitzungen(idZiel), 0,
      'Die Sitzung des Ziels lebt weiter — dann bleibt es in seinem offenen Fenster Verwalter, ' +
      'denn session.isAdmin wird nie nachgefuehrt');

    // ── 2. Kein Rauswurf ohne echte Aenderung ───────────────────────────────
    //
    // Sonst wuerde ein Verwalter, der einen bestehenden Zustand nur bestaetigt,
    // eine fremde Sitzung ohne Grund beenden — und sich selbst aussperren,
    // wenn er es an seinem eigenen Konto tut.
    zielCookie = await anmelden(ZIEL);
    assert.equal(await sitzungen(idZiel), 1, 'Vorbedingung fuer den Nicht-Wechsel');
    const nochmal = await ruf(AUTH + `/users/${idZiel}/admin`,
      { method: 'PUT', headers: { cookie: chefCookie }, body: { is_admin: false } });
    assert.equal(nochmal.status, 200,
      'Denselben Wert nochmal zu setzen muss gelingen — die Existenzpruefung haengt ' +
      'nicht mehr an r.changes, das bei einem wertgleichen UPDATE 0 sein kann');
    assert.equal(await sitzungen(idZiel), 1,
      'Ohne echte Aenderung darf keine Sitzung enden');

    // ── 2b. Ein unbekanntes Konto ───────────────────────────────────────────
    //
    // Die Existenzpruefung haengt seit dem Umbau am vorgezogenen SELECT statt
    // an r.changes. Ohne diese Zusicherung waere ihr Wegfall unbemerkt
    // geblieben — die Route antwortete dann mit 200 auf eine Kennung, die es
    // nicht gibt.
    const unbekannt = await ruf(AUTH + '/users/99999999/admin',
      { method: 'PUT', headers: { cookie: chefCookie }, body: { is_admin: true } });
    assert.equal(unbekannt.status, 404,
      'Ein nicht vorhandenes Konto muss 404 ergeben, nicht 200');

    // ── 3. Und die Gegenrichtung: Rechte ERTEILEN ───────────────────────────
    const vergabe = await ruf(AUTH + `/users/${idZiel}/admin`,
      { method: 'PUT', headers: { cookie: chefCookie }, body: { is_admin: true } });
    assert.equal(vergabe.status, 200);
    assert.equal(await sitzungen(idZiel), 0,
      'Auch bei der Vergabe muss die Sitzung enden — eine fremde Sitzung laesst sich ' +
      'nicht umschreiben, und sonst saehe das Ziel seine neuen Rechte nie');

    // ── 4. Kontoloeschung ───────────────────────────────────────────────────
    zielCookie = await anmelden(ZIEL);
    assert.equal(await sitzungen(idZiel), 1, 'Vorbedingung fuer die Loeschung');
    const weg = await ruf(AUTH + `/users/${idZiel}`,
      { method: 'DELETE', headers: { cookie: chefCookie } });
    assert.equal(weg.status, 200, `Loeschen scheiterte: ${JSON.stringify(weg.body)}`);
    assert.equal(await sitzungen(idZiel), 0,
      'Das geloeschte Konto ist noch angemeldet — user_sessions haengt an keinem ' +
      'Fremdschluessel, die Zeile muss ausdruecklich weg');
    assert.equal(await db.get('SELECT id FROM users WHERE id=$1', [idZiel]), undefined,
      'Vorbedingung: Das Konto ist wirklich geloescht');
  } finally {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE username IN ($1,$2)', [CHEF, ZIEL]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
