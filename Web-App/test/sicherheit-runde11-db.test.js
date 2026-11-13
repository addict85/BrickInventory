/**
 * Befunde der zehnten Sicherheitsprüfung am echten Server (dist/server.js):
 * langsame Anfragen, Fehlertexte bei 4xx, Orakel für Erfassungs-IDs, fremder
 * Host-Kopf, E-Mail-Bestätigung erst per POST.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln, danach gebaut):
 *   M1a `headersTimeout` aus den Fristen in server.ts gestrichen → rot: „ein
 *       stockender Kopf …“ (Node-Vorgabe 60 s, Prüfung nach 18 s)
 *   M1b `nurWenn(unangemeldet, rumpfFrist)` aus rumpfLesen gestrichen → rot:
 *       „ein stockender Rumpf ohne Anmeldung …“
 *   M1c die Bedingung `unangemeldet` weggelassen (Frist für alle) → rot: „ein
 *       stockender Rumpf mit Anmeldung …“
 *   H1  in handleRouteError den Zweig für 4xx ohne Code gestrichen → rot:
 *       „GET /% …“ (Antwort „Failed to decode param '%'“); `fail()` in
 *       validate.ts wieder mit `new Error` → rot: „ein eigener Satz …“
 *   H2  in umzugsQuelle wieder 403 kein_schreibrecht für fremde
 *       Zeilen → rot: „eine fremde Erfassung antwortet wie eine fehlende“
 *   H4  `app.use(nurEigenerHost)` in server.ts gestrichen → rot: „ein fremder
 *       Host-Kopf …“; die Ausnahme für IP-Adressen gestrichen → rot: „IP-Host“; Bearer wieder
 *       als Ausnahme → rot: „öffnet einen fremden Namen nicht“
 *   H5  GET /verify bestätigt wieder selbst (verifiziereEmailToken im Handler)
 *       → rot: „der Link allein bestätigt nichts“
 *
 * Token im Fragment statt in der Abfrage (13.11.2026 gemessen):
 *   N2  in routes/seiten.ts die Umleitung für ?token= gestrichen → rot: „ein
 *       alter Link mit ?token= wird umgeleitet“ (200 statt 303)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const { warte } = require('./helpers/zeit');
const freierPort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });

/** Eine Anfrage mit frei gewähltem Host-Kopf; fetch setzt ihn selbst. */
function mitHost(port, host, pfad, kopf = {}) {
  return new Promise((fertig, fehler) => {
    const r = http.request({ host: '127.0.0.1', port, path: pfad, setHost: false, headers: { host, ...kopf } }, res => {
      let text = '';
      res.on('data', d => {
        text += d;
      });
      res.on('end', () => fertig({ status: res.statusCode, text }));
    });
    r.on('error', fehler);
    r.end();
  });
}

/** Rohe Verbindung: schickt `roh`, sammelt die Antwort und misst bis zum Schliessen. */
function roh(port, text) {
  const beginn = Date.now();
  const s = net.connect(port, '127.0.0.1', () => s.write(text));
  const ergebnis = { antwort: '', zu: null, socket: s };
  s.on('data', d => {
    ergebnis.antwort += d;
  });
  s.on('error', () => {});
  s.on('close', () => {
    ergebnis.zu = Date.now() - beginn;
  });
  return ergebnis;
}

test('zehnte Sicherheitsprüfung am echten Server', { concurrency: 1, timeout: 240_000 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const PASS = 'Runde-Elf-Passwort-7x',
    NAME = `r11_${process.pid}`;
  const namen = [`${NAME}_a`, `${NAME}_b`, `${NAME}_v`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const lege = async (name, bestaetigt, token = null) =>
    (
      await db.get(
        `INSERT INTO users
    (username, email, password_hash, is_active, email_verified, verification_token, token_expires)
    VALUES ($1, $2, $3, true, $4, $5, CASE WHEN $5::text IS NULL THEN NULL ELSE NOW() + INTERVAL '1 day' END) RETURNING id`,
        [name, `${name}@example.org`, bcrypt.hashSync(PASS, 4), bestaetigt, token],
      )
    ).id;
  const alice = await lege(namen[0], true),
    bob = await lege(namen[1], true);
  const MAILTOKEN = crypto.randomBytes(32).toString('hex');
  const unbestaetigt = await lege(namen[2], false, crypto.createHash('sha256').update(MAILTOKEN).digest('hex'));
  // Wie POST /register seit Runde 13: Adresse und Link nur ausstehend.
  await db.run(
    `UPDATE users SET email_neu = email, email_neu_token = verification_token, email_neu_bis = token_expires,
    email = NULL, verification_token = NULL, token_expires = NULL, registrierung_offen = true WHERE id = $1`,
    [unbestaetigt],
  );
  t.after(async () => {
    await db.run('DELETE FROM set_acquisitions WHERE user_id = $1', [alice]);
    await db.run('DELETE FROM sets WHERE user_id = $1', [alice]);
    await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
    await db.pool.end().catch(() => {});
  });

  const port = await freierPort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'runde-elf-test-geheimnis-lang-genug-12345',
      PORT: String(port),
      TRUST_PROXY: 'false',
      ROLLE: 'web',
      APP_BASE_URL: `http://nas.example.lan:${port}`,
    },
  });
  let log = '';
  srv.stdout.on('data', d => {
    log += d;
  });
  srv.stderr.on('data', d => {
    log += d;
  });
  t.after(async () => {
    srv.kill('SIGTERM');
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  const basis = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240 && (await fetch(`${basis}/api/v1/health/live`).catch(() => null)) === null; i++)
    await warte(250);

  const anmelden = async name => {
    const r = await fetch(`${basis}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: name, password: PASS, ohne_token: true }),
    });
    assert.equal(r.status, 200, `${await r.clone().text()}\n${log}`);
    return r.headers.get('set-cookie').split(';')[0];
  };
  const keksA = await anmelden(namen[0]),
    keksB = await anmelden(namen[1]);
  const als =
    keks =>
    (pfad, o = {}) =>
      fetch(basis + pfad, {
        redirect: 'manual',
        ...o,
        headers: { cookie: keks, origin: basis, 'content-type': 'application/json', ...(o.headers || {}) },
      });

  await t.test('langsame Köpfe und Rümpfe halten den Server nicht fest', async () => {
    const kopf = roh(port, 'POST /api/v1/auth/login HTTP/1.1\r\nHost: 127.0.0.1\r\n');
    const ohne = roh(
      port,
      'POST /api/v1/auth/login HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n' +
        'Content-Length: 200\r\n\r\n{',
    );
    const mit = roh(
      port,
      `POST /api/v1/vouchers HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nCookie: ${keksA}\r\nOrigin: ${basis}\r\n` +
        'Content-Type: application/json\r\nContent-Length: 200\r\n\r\n{',
    );
    try {
      for (const ende = Date.now() + 14_000; ohne.zu === null && Date.now() < ende; ) await warte(200);
      assert.ok(
        ohne.zu !== null && ohne.zu < 13_000,
        `ein stockender Rumpf ohne Anmeldung wird beendet (nach ${ohne.zu} ms)`,
      );
      assert.match(ohne.antwort, /^HTTP\/1\.1 408 [\s\S]*anfrage_zu_langsam/, ohne.antwort);
      await warte(1500);
      assert.equal(mit.zu, null, 'ein stockender Rumpf mit Anmeldung (Upload) läuft weiter: ' + mit.antwort);
      assert.equal(mit.antwort, '');
      for (const ende = Date.now() + 8_000; kopf.zu === null && Date.now() < ende; ) await warte(200);
      assert.ok(kopf.zu !== null && kopf.zu < 18_000, `ein stockender Kopf wird beendet (nach ${kopf.zu} ms)`);
      const r = await fetch(`${basis}/api/v1/health/live`);
      assert.equal(r.status, 200);
    } finally {
      for (const v of [kopf, ohne, mit]) v.socket.destroy();
    }
  });

  await t.test('4xx nennen keinen Text einer Bibliothek, eigene Sätze bleiben', async () => {
    const prozent = await fetch(`${basis}/%`);
    const p = await prozent.json();
    assert.equal(prozent.status, 400);
    assert.equal(p.code, 'anfrage_ungueltig', `GET /% → ${JSON.stringify(p)}`);
    const gzip = await fetch(`${basis}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body: 'kein gzip',
    });
    const g = await gzip.json();
    assert.equal(gzip.status, 400);
    assert.equal(g.code, 'anfrage_ungueltig', `gzip → ${JSON.stringify(g)}`);
    assert.doesNotMatch(JSON.stringify([p, g]), /decode|header check|zlib/i);
    const eigen = await als(keksA)('/api/v1/parts', {
      method: 'POST',
      body: JSON.stringify({ part_number: '!!', quantity: 1 }),
    });
    assert.equal(eigen.status, 400);
    assert.match((await eigen.json()).error, /part_number darf nur Buchstaben/, 'ein eigener Satz erreicht den Nutzer');
  });

  await t.test('eine fremde Erfassung antwortet wie eine fehlende', async () => {
    await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10294-1') ON CONFLICT DO NOTHING`, [alice]);
    const acq = (
      await db.get(
        `INSERT INTO set_acquisitions (user_id, set_number, quantity, condition, currency)
      VALUES ($1, '10294-1', 1, 'N', 'CHF') RETURNING id`,
        [alice],
      )
    ).id;
    const umhaengen = async id => {
      const r = await als(keksB)(`/api/v1/sets/10294-1/acquisitions/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ owner_user_id: bob }),
      });
      return [r.status, await r.json()];
    };
    const fremd = await umhaengen(acq),
      fehlt = await umhaengen(2_000_000_000);
    assert.deepEqual(fremd, fehlt);
    assert.equal(fremd[0], 404);
    assert.equal(fremd[1].code, 'kaufpreis_nicht_gefunden');
    assert.equal(Number((await db.get('SELECT user_id FROM set_acquisitions WHERE id = $1', [acq])).user_id), alice);
  });

  await t.test('ein fremder Host-Kopf wird abgewiesen, der eigene nicht', async () => {
    const fremd = await mitHost(port, 'boese.example', '/api/v1/auth/me');
    assert.equal(fremd.status, 421, 'ein fremder Host-Kopf wird abgewiesen');
    assert.equal(JSON.parse(fremd.text).code, 'fremder_host');
    assert.equal((await mitHost(port, `NAS.example.lan:${port}`, '/api/v1/auth/me')).status, 200);
    assert.equal((await mitHost(port, 'nas.example.lan', '/api/v1/auth/me')).status, 200);
    assert.equal((await mitHost(port, 'boese.example', '/api/v1/health/live')).status, 200);
    assert.notEqual((await mitHost(port, 'boese.example', '/ca.crt')).status, 421);
    assert.equal(
      (await mitHost(port, 'boese.example', '/api/v1/auth/me', { authorization: 'Bearer falsch' })).status,
      421,
      'ein Bearer-Kopf öffnet einen fremden Namen nicht',
    );
    for (const ip of [`192.168.1.20:${port}`, '10.0.0.5', '[fe80::1]:8080']) {
      assert.equal(
        (await mitHost(port, ip, '/api/v1/auth/me', { authorization: 'Bearer falsch' })).status,
        401,
        `ein IP-Host (${ip}) geht an die Anmeldung`,
      );
    }
    assert.equal(
      (await mitHost(port, '1.2.3.4.boese.example', '/api/v1/auth/me')).status,
      421,
      'ein Name mit Ziffern ist keine Adresse',
    );
  });

  await t.test('der Link allein bestätigt nichts, erst der POST', async () => {
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'email-bestaetigen|%'");
    // Ein Link aus einer älteren Mail (?token=) wird vor dem Laden der Seite zum Fragment.
    const alt = await fetch(`${basis}/verify?token=${MAILTOKEN}`, { redirect: 'manual' });
    assert.equal(alt.status, 303, 'ein alter Link mit ?token= wird umgeleitet');
    assert.equal(alt.headers.get('location'), `/verify#token=${MAILTOKEN}`);
    assert.equal(alt.headers.get('cache-control'), 'no-store');
    const seite = await fetch(`${basis}/verify`, { redirect: 'manual' });
    assert.equal(seite.status, 200);
    assert.match(seite.headers.get('content-type'), /text\/html/);
    assert.equal(seite.headers.get('cache-control'), 'no-store');
    assert.match(await seite.text(), /id="panel-verify"/);
    const stand = async () =>
      (await db.get('SELECT email_verified FROM users WHERE id = $1', [unbestaetigt])).email_verified;
    assert.equal(await stand(), false, 'der Link allein bestätigt nichts');
    const bestaetige = token =>
      fetch(`${basis}/api/v1/auth/email-bestaetigen`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      }).then(async r => [r.status, await r.json()]);
    assert.deepEqual((await bestaetige('falsch'))[1].code, 'bestaetigungslink_ungueltig');
    assert.deepEqual(await bestaetige(MAILTOKEN), [200, { success: true }]);
    assert.equal(await stand(), true);
    assert.equal((await bestaetige(MAILTOKEN))[0], 400, 'ein zweiter Klick meldet keinen zweiten Erfolg');
  });
});
