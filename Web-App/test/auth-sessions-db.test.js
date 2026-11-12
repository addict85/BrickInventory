/**
 * Passwortwechsel gegen echte Datenbank und echten Session-Store.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
// Die Adresse aus server.ts LESEN, nicht abschreiben: Ein eigener Pruefstand
// mit fester Adresse bleibt gruen, waehrend der Router laengst woanders haengt.
const AUTH = require('./helpers/sources').einhaengung('auth');
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

test('ein Passwortwechsel beendet Sitzungen UND Token — gegen echten Store', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;

  // ── Aufbau: ein Administrator, ein Opfer ────────────────────────────────
  for (const name of ['pw_chef', 'pw_opfer']) {
    await db.run('DELETE FROM users WHERE username = $1', [name]);
  }
  const hash = await bcrypt.hash('altesPasswort1', 4);
  await db.run('INSERT INTO users (username,password_hash,is_admin,email_verified) VALUES ($1,$2,true,true)', [
    'pw_chef',
    hash,
  ]);
  await db.run('INSERT INTO users (username,password_hash,is_admin,email_verified) VALUES ($1,$2,false,true)', [
    'pw_opfer',
    hash,
  ]);
  const opferId = (await db.get("SELECT id FROM users WHERE username='pw_opfer'")).id;

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
  app.use(AUTH, _req('routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}`;

  // Passwort als Parameter, NICHT fest verdrahtet: Der zweite Subtest ändert
  // das Passwort des Administrators — mit einem festen 'altesPasswort1' scheitert
  // die nächste Anmeldung, und der dritte Subtest wäre aus einem Grund rot, der
  // nichts mit der geprüften Regel zu tun hat.
  const anmelden = async (user, passwort) => {
    const r = await fetch(`${basis}${AUTH}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: user, password: passwort, ohne_token: true }),
    });
    const body = await r.json();
    assert.equal(body.success, true, `Anmeldung ${user} fehlgeschlagen: ${JSON.stringify(body)}`);
    return { cookie: (r.headers.get('set-cookie') || '').split(';')[0], body };
  };
  const angemeldet = async cookie =>
    (await fetch(`${basis}${AUTH}/me`, { headers: { cookie } }).then(r => r.json())).loggedIn === true;
  const sitzungen = async uid =>
    (await db.get("SELECT COUNT(*)::int n FROM user_sessions WHERE sess::jsonb->>'userId' = $1", [String(uid)])).n;

  try {
    await t.test('der Admin-Reset wirft das übernommene Fenster hinaus', async () => {
      const angreifer = await anmelden('pw_opfer', 'altesPasswort1');
      const chef = await anmelden('pw_chef', 'altesPasswort1');
      assert.equal(await angemeldet(angreifer.cookie), true, 'Vorbedingung: Sitzung steht');
      assert.ok((await sitzungen(opferId)) >= 1, 'Vorbedingung: Sitzung liegt in user_sessions');

      const r = await fetch(`${basis}${AUTH}/users/${opferId}/password`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: chef.cookie },
        body: JSON.stringify({ password: 'neuesPasswort1', admin_password: 'altesPasswort1' }),
      });
      assert.equal(r.status, 200, await r.text());

      // DER Punkt der Datei: Sitzung ist wirklich weg, nicht nur „das DELETE
      // steht im Code".
      assert.equal(await sitzungen(opferId), 0, 'Sitzungen des Kontos müssen enden');
      assert.equal(
        await angemeldet(angreifer.cookie),
        false,
        'Das alte Fenster darf nach dem Reset nicht weiter angemeldet sein',
      );
    });

    await t.test('der eigene Passwortwechsel wirft die anderen Fenster hinaus — nicht das eigene', async () => {
      // Zwei Fenster desselben Kontos: eines wechselt das Passwort, das andere
      // muss draussen sein. Das wechselnde Fenster bleibt drin (frische
      // Session-ID über establishSession) — sonst flöge man sich selbst raus.
      const fensterA = await anmelden('pw_chef', 'altesPasswort1');
      const fensterB = await anmelden('pw_chef', 'altesPasswort1');
      assert.equal(await angemeldet(fensterB.cookie), true, 'Vorbedingung: zweites Fenster offen');

      const r = await fetch(`${basis}${AUTH}/change-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: fensterA.cookie },
        body: JSON.stringify({ current: 'altesPasswort1', newPassword: 'nochNeuer1234' }),
      });
      assert.equal(r.status, 200, await r.text());

      assert.equal(
        await angemeldet(fensterB.cookie),
        false,
        'Das andere Fenster muss nach dem Passwortwechsel abgemeldet sein',
      );
      // Das eigene Fenster: Die Session-ID wurde erneuert, das alte Cookie ist
      // damit ebenfalls entwertet — erwünscht (Session Fixation) und der Grund,
      // warum die Antwort ein neues Cookie mitschickt.
      assert.ok(r.headers.get('set-cookie'), 'Nach der Rotation muss ein neues Sitzungs-Cookie zurückkommen');
    });

    await t.test('Bearer-Token des Kontos verfallen mit', async () => {
      const { hashToken, validateToken } = _req('src/konto/geraeteToken.js');
      const crypto = require('node:crypto');
      const tok = crypto.randomBytes(16).toString('hex');
      await db.run("INSERT INTO api_tokens (token,user_id,label,expires_at) VALUES ($1,$2,'app',NULL)", [
        hashToken(tok),
        opferId,
      ]);
      assert.ok(await validateToken(tok), 'Vorbedingung: Token gilt');

      // 'nochNeuer1234' — der Subtest davor hat es geändert.
      const chef = await anmelden('pw_chef', 'nochNeuer1234');
      // Das Passwort des OPFERS wurde im ersten Subtest geändert — hier zählt nur, dass
      // der Reset läuft; der Admin-Weg verlangt kein altes Passwort.
      const r = await fetch(`${basis}${AUTH}/users/${opferId}/password`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: chef.cookie },
        body: JSON.stringify({ password: 'wiederNeu123', admin_password: 'nochNeuer1234' }),
      });
      assert.equal(r.status, 200, await r.text());
      assert.equal(
        await validateToken(tok),
        null,
        'Ein Token auf einem fremden Gerät darf den Passwortwechsel nicht überleben',
      );
    });

    // Gegenprobe (11.11.2026 gemessen): in setzePasswortZurueck (src/konto/konten.ts)
    // `await zugaengeBeenden(uid)` gestrichen → rot hier (Sitzung und Token bleiben).
    await t.test('das Zurücksetzen per Link beendet Sitzungen und Token', async () => {
      const { hashToken, createToken, validateToken } = _req('src/konto/geraeteToken.js');
      const fenster = await anmelden('pw_opfer', 'wiederNeu123');
      const tok = await createToken(opferId, 'Fremdgerät', true);
      const roh = 'd'.repeat(64);
      await db.run(`UPDATE users SET reset_token = $2, reset_token_expires = NOW() + interval '1 hour' WHERE id = $1`, [
        opferId,
        hashToken(roh),
      ]);
      await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'reset-password|%'");
      const r = await fetch(`${basis}${AUTH}/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: roh, password: 'perLinkGesetzt12' }),
      });
      assert.equal(r.status, 200, await r.text());
      assert.equal(await sitzungen(opferId), 0, 'Sitzungen des Kontos müssen enden');
      assert.equal(await angemeldet(fenster.cookie), false);
      assert.equal(await validateToken(tok), null, 'Der Token darf das Zurücksetzen nicht überleben');
    });

    // Gegenprobe (11.11.2026 gemessen): in PUT /users/:id/password die Prüfung
    // `targetId === nutzerId(req)` gestrichen → rot „… nicht für das eigene Konto“ (200).
    await t.test('der Verwalterweg gilt nicht für das eigene Konto und nicht für Unbekannte', async () => {
      const chef = await anmelden('pw_chef', 'nochNeuer1234');
      const chefId = (await db.get("SELECT id FROM users WHERE username='pw_chef'")).id;
      const setze = async (cookie, id) => {
        const r = await fetch(`${basis}${AUTH}/users/${id}/password`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ password: 'Verwalter-Setzt-99', admin_password: 'nochNeuer1234' }),
        });
        return `${r.status} ${(await r.json()).code ?? ''}`;
      };
      assert.equal(await setze(chef.cookie, chefId), '400 eigenes_konto_passwort', 'nicht für das eigene Konto');
      assert.equal(
        await setze(chef.cookie, 2_000_000_000),
        '404 benutzer_nicht_gefunden',
        'ein Unbekannter ist kein stiller Erfolg',
      );
      const opfer = await anmelden('pw_opfer', 'perLinkGesetzt12');
      assert.match(await setze(opfer.cookie, chefId), /^403 /, 'nur für Verwalter');
      assert.ok(
        await bcrypt.compare(
          'nochNeuer1234',
          (await db.get('SELECT password_hash FROM users WHERE id = $1', [chefId])).password_hash,
        ),
      );
    });
  } finally {
    srv.close();
    for (const name of ['pw_chef', 'pw_opfer']) {
      await db.run('DELETE FROM users WHERE username = $1', [name]).catch(() => {});
    }
    await db.pool.end();
  }
});
