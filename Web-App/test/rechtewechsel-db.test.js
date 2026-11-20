/**
 * Rechteentzug und Kontoloeschung muessen die offene Sitzung erreichen.
 *
 * Gegenproben (am 28.10. gemessen):
 *   A  bestaetigePasswort() aus PUT /users/:id/admin entfernt → rot:
 *      „Rechte entziehen ohne Verwalterpasswort"
 *   B  protokolliere() vor dem Löschen entfernt → rot: Protokoll ohne
 *      „konto_geloescht"
 *
 * Das Ziel ist Verwalter: Entzug und Löschung werden seit Runde 29 angekündigt und
 * wirken im Aufräumlauf (src/account/adminActions.ts); der Test führt ihn aus.
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

const { buildAndRequire, einhaengung, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const AUTH = einhaengung('auth');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const CHEF = 'rechte_chef',
  ZIEL = 'rechte_ziel',
  PASS = 'richtigesPasswort1';

test('ein Rechtewechsel und eine Loeschung beenden die Sitzung des Ziels', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username IN ($1,$2)', [CHEF, ZIEL]);
  const hash = await bcrypt.hash(PASS, 4);
  await db.run(
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,true,true,true)',
    [CHEF, hash],
  );
  await db.run(
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,true,true,true)',
    [ZIEL, hash],
  );
  const idTarget = (await db.get('SELECT id FROM users WHERE username=$1', [ZIEL])).id;

  const app = express();
  app.use(express.json());
  app.use(
    session({
      store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use(AUTH, require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
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
  const anmelden = async name => {
    const a = await ruf(AUTH + '/login', {
      method: 'POST',
      body: { username: name, password: PASS, ohne_token: true },
    });
    assert.equal(a.status, 200, `Anmeldung von ${name} scheiterte: ${JSON.stringify(a.body)}`);
    assert.ok(a.cookie, 'Ohne Set-Cookie gibt es keine Sitzung');
    return a.cookie.split(';')[0];
  };
  // Gezaehlt wird ueber den Inhalt, nicht ueber die Gesamtzahl der Zeilen: Im
  // Store liegen auch Sitzungen anderer Tests.
  const sitzungen = async uid =>
    Number(
      (await db.get("SELECT COUNT(*)::int AS n FROM user_sessions WHERE sess::jsonb->>'userId' = $1", [String(uid)])).n,
    );

  /** Die Ankündigung fällig machen und den Aufräumlauf ausführen. */
  const faellig = async () => {
    await db.run(`UPDATE admin_takeovers SET effective_at = NOW() - INTERVAL '1 minute' WHERE target_id = $1`, [
      idTarget,
    ]);
    return _req('src/account/adminActions.js').runDueTakeoversFrom();
  };

  try {
    const chefCookie = await anmelden(CHEF);

    // ── 1. Rechteentzug ─────────────────────────────────────────────────────
    await anmelden(ZIEL);
    assert.equal(await sitzungen(idTarget), 1, 'Vorbedingung: Das Ziel hat genau eine offene Sitzung');

    const ohne = await ruf(AUTH + `/users/${idTarget}/admin`, {
      method: 'PUT',
      headers: { cookie: chefCookie },
      body: { is_admin: false },
    });
    assert.equal(ohne.status, 400, 'Rechte entziehen ohne Verwalterpasswort');
    const revocation = await ruf(AUTH + `/users/${idTarget}/admin`, {
      method: 'PUT',
      headers: { cookie: chefCookie },
      body: { is_admin: false, admin_password: PASS },
    });
    assert.equal(revocation.status, 200, `Entzug scheiterte: ${JSON.stringify(revocation.body)}`);
    assert.ok(revocation.body.effective_at, 'Bei einem Verwalter wird der Entzug angekündigt');
    assert.equal(await sitzungen(idTarget), 1, 'Vor der Frist bleibt die Sitzung');
    assert.equal(await faellig(), 1);
    assert.equal(
      await sitzungen(idTarget),
      0,
      'Die Sitzung des Ziels lebt weiter — dann bleibt es in seinem offenen Fenster Verwalter, ' +
        'denn session.isAdmin wird nie nachgefuehrt',
    );

    // ── 2. Kein Rauswurf ohne echte Aenderung ───────────────────────────────
    //
    // Sonst wuerde ein Verwalter, der einen bestehenden Zustand nur bestaetigt,
    // eine fremde Sitzung ohne Grund beenden — und sich selbst aussperren,
    // wenn er es an seinem eigenen Konto tut.
    await anmelden(ZIEL);
    assert.equal(await sitzungen(idTarget), 1, 'Vorbedingung fuer den Nicht-Wechsel');
    const nochmal = await ruf(AUTH + `/users/${idTarget}/admin`, {
      method: 'PUT',
      headers: { cookie: chefCookie },
      body: { is_admin: false, admin_password: PASS },
    });
    assert.equal(
      nochmal.status,
      200,
      'Denselben Wert nochmal zu setzen muss gelingen — die Existenzpruefung haengt ' +
        'nicht mehr an r.changes, das bei einem wertgleichen UPDATE 0 sein kann',
    );
    assert.equal(await sitzungen(idTarget), 1, 'Ohne echte Aenderung darf keine Sitzung enden');

    // ── 2b. Ein unbekanntes Konto ───────────────────────────────────────────
    //
    // Die Existenzpruefung haengt seit dem Umbau am vorgezogenen SELECT statt
    // an r.changes. Ohne diese Zusicherung waere ihr Wegfall unbemerkt
    // geblieben — die Route antwortete dann mit 200 auf eine Kennung, die es
    // nicht gibt.
    const unbekannt = await ruf(AUTH + '/users/99999999/admin', {
      method: 'PUT',
      headers: { cookie: chefCookie },
      body: { is_admin: true, admin_password: PASS },
    });
    assert.equal(unbekannt.status, 404, 'Ein nicht vorhandenes Konto muss 404 ergeben, nicht 200');

    // ── 3. Und die Gegenrichtung: Rechte ERTEILEN ───────────────────────────
    const vergabe = await ruf(AUTH + `/users/${idTarget}/admin`, {
      method: 'PUT',
      headers: { cookie: chefCookie },
      body: { is_admin: true, admin_password: PASS },
    });
    assert.equal(vergabe.status, 200);
    assert.equal(
      await sitzungen(idTarget),
      0,
      'Auch bei der Vergabe muss die Sitzung enden — eine fremde Sitzung laesst sich ' +
        'nicht umschreiben, und sonst saehe das Ziel seine neuen Rechte nie',
    );

    // ── 4. Kontoloeschung ───────────────────────────────────────────────────
    await anmelden(ZIEL);
    assert.equal(await sitzungen(idTarget), 1, 'Vorbedingung fuer die Loeschung');
    const withoutPw = await ruf(AUTH + `/users/${idTarget}`, { method: 'DELETE', headers: { cookie: chefCookie } });
    assert.equal(withoutPw.status, 400, 'Ein Konto zu löschen verlangt das Verwalterpasswort');
    assert.ok(await db.get('SELECT id FROM users WHERE id=$1', [idTarget]), 'ohne Passwort wurde trotzdem gelöscht');
    const weg = await ruf(AUTH + `/users/${idTarget}`, {
      method: 'DELETE',
      headers: { cookie: chefCookie },
      body: { admin_password: PASS },
    });
    assert.equal(weg.status, 200, `Loeschen scheiterte: ${JSON.stringify(weg.body)}`);
    assert.ok(weg.body.effective_at, 'Bei einem Verwalter wird die Löschung angekündigt');
    assert.equal(await faellig(), 1);
    assert.equal(
      await sitzungen(idTarget),
      0,
      'Das geloeschte Konto ist noch angemeldet — user_sessions haengt an keinem ' +
        'Fremdschluessel, die Zeile muss ausdruecklich weg',
    );
    assert.equal(
      await db.get('SELECT id FROM users WHERE id=$1', [idTarget]),
      undefined,
      'Vorbedingung: Das Konto ist wirklich geloescht',
    );

    // ── 5. Jede Verwalteraktion steht im Protokoll — auch die Löschung ──────
    const prot = await db.all(`SELECT action, target_name FROM admin_log WHERE target_id = $1 ORDER BY id`, [idTarget]);
    assert.deepEqual(
      prot.map(p => p.action),
      [
        'uebernahme_angekuendigt',
        'verwalter_entzogen',
        'verwalter_ernannt',
        'uebernahme_angekuendigt',
        'konto_geloescht',
      ],
    );
    assert.ok(
      prot.every(p => p.target_name === ZIEL),
      'Der Name muss auch nach dem Löschen lesbar bleiben',
    );
  } finally {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE username IN ($1,$2)', [CHEF, ZIEL]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
