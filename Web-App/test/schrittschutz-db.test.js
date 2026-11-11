/**
 * Der Schrittschutz der App am echten Server (dist/server.js): Ein App-Token
 * kommt an Gutschein-PIN und Verwaltung nur mit einer Signatur des
 * Geräteschlüssels über eine einmalige Challenge. Die Browser-Sitzung bleibt
 * beim Passwort.
 *
 * Gegenproben (09.11.2026 gemessen):
 *   A  in server.ts `app.use('/api/v1', schrittschutzAmEingang)` gestrichen →
 *      rot: „ohne Geräteschlüssel …“ (Klartext 200 statt 403)
 *   B  in requireApiAdmin wieder `next()` statt verlangeFreigabe() → rot:
 *      „Verwalter-Routen …“ (/admin/cache-ttl 200 ohne Freigabe)
 *   C  in loeseEin() die Signatur nicht geprüft (`passt = true`) → rot:
 *      „eine fremde Signatur …“
 *   D  in nachricht() die Aktion weggelassen → rot: „eine Challenge taugt
 *      nur für ihre Aktion“
 *   E  in legeSchluesselAn() die Frist vertausendfacht → rot: „ein alter Zugang …“
 *      (mit einer Nonce von damals; ohne sie hält schon legeNonceAn())
 *   F  in hinterlegeSchluessel() `nimmNonce` übergangen → rot: „eine Kette mit fremder
 *      oder verbrauchter Challenge …“
 *   G  in schluesselDer() `(attestiert OR NOW() < $3)` gestrichen → rot: „ein Schlüssel
 *      ohne Attestation gilt bis zum Stichtag …“
 *   H  in qrNonceDer() `aus_qr` gestrichen und neueNonce() immer neu → rot: „ein Zugang
 *      aus der QR-Kopplung …“
 *   I  in routes/api_v1/settings.ts POST /settings ohne freigegeben() → rot:
 *      „jeder Verwalterweg …“ (POST /settings ohne Freigabe 200); dasselbe je
 *      Weg für smtp-test, einrichtung und quelle-testen mit `requireToken`
 *      statt `requireAdmin`, für Import und Anleitungen ohne freigegeben()
 *   J  in /settings/raw `istVerwalter(req)` statt alsVerwalter() → rot:
 *      „ohne Freigabe zeigt /settings/raw nur Kontowerte“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const auth = _req('src/konto/geraeteToken.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const { bis } = require('./helpers/zeit');
const { verwalterMitFaktor } = require('./helpers/verwalter');
const { geraeteSchluessel, signiere, geraetFreigeben, hinterlege } = require('./helpers/geraet');
const attestation = require('./helpers/attestation');
const repo = _req('src/konto/prozess.js').kontoBereich().geraeteSchluessel;
const { qrKoppeln } = require('./helpers/qr');
const freierPort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
      s.close(() => r(p));
    });
  });

test('Schrittschutz am Server', { concurrency: 1, timeout: 180_000 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const NAME = `schritt_${process.pid}`,
    CHEF = `schrittchef_${process.pid}`,
    PASS = 'Schritt-Schutz-7x';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, CHEF]]);
  const anlegen = async (name, admin) =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified, is_admin)
    VALUES ($1, $2, $3, true, true, $4) RETURNING id`,
        [name, `${name}@example.org`, bcrypt.hashSync(PASS, 4), admin],
      )
    ).id;
  const uid = await anlegen(NAME, false),
    chefId = await anlegen(CHEF, true);
  const codes = await verwalterMitFaktor(_req, chefId);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, chefId]]);
    await db.pool.end().catch(() => {});
  });

  const port = await freierPort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'schrittschutz-test-geheimnis-lang-genug-1234',
      PORT: String(port),
      TRUST_PROXY: 'false',
      ROLLE: 'web',
      APP_BASE_URL: `http://127.0.0.1:${port}`,
      ...attestation.UMGEBUNG,
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
    await bis(() => srv.exitCode !== null || srv.signalCode !== null, 4000);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  const basis = `http://127.0.0.1:${port}`;
  await bis(async () => (await fetch(`${basis}/api/v1/health/live`).catch(() => null)) !== null, 60_000);

  const ruf = async (weg, o = {}) => {
    const r = await fetch(basis + '/api/v1' + weg, {
      method: o.method || 'GET',
      headers: {
        'content-type': 'application/json',
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...(o.cookie ? { cookie: o.cookie, origin: basis } : {}),
      },
      ...(o.body ? { body: JSON.stringify(o.body) } : {}),
    });
    return { status: r.status, kopf: r.headers, body: await r.json().catch(() => null) };
  };
  const anmelden = async (name, extra = {}) => {
    const a = await ruf('/auth/login', {
      method: 'POST',
      body: { username: name, password: PASS, never_expires: true, ...extra },
    });
    assert.equal(a.status, 200, `${JSON.stringify(a.body)}\n${log}`);
    return a;
  };
  const token = (await anmelden(NAME)).body.token;
  const neu = await ruf('/vouchers', {
    method: 'POST',
    token,
    body: { number: '6006491234567890', pin: '4321', amount: 25, currency: 'CHF' },
  });
  assert.equal(neu.status, 200, JSON.stringify(neu.body));
  const gid = neu.body.voucher?.id ?? (await db.get('SELECT id FROM vouchers WHERE user_id = $1', [uid])).id;
  const klartext = o => ruf(`/vouchers/${gid}/klartext`, { method: 'POST', body: { password: PASS }, ...o });
  let geraet;

  await t.test('ohne Geräteschlüssel kommt ein App-Token nicht an die PIN', async () => {
    const r = await klartext({ token });
    assert.deepEqual([r.status, r.body.code], [403, 'geraeteschluessel_fehlt']);
    const c = await ruf('/geraet/schritt/challenge', { method: 'POST', token, body: { aktion: 'gutschein' } });
    assert.deepEqual([c.status, c.body.code], [403, 'geraeteschluessel_fehlt']);
  });

  await t.test('der Schlüssel gilt einmal je Zugang; ein anderer wird nicht nachgeschoben', async () => {
    const h = await hinterlege(ruf, token);
    assert.equal(h.antwort.status, 200, JSON.stringify(h.antwort.body));
    geraet = h.schluessel;
    const anderer = await hinterlege(ruf, token);
    assert.deepEqual([anderer.antwort.status, anderer.antwort.body.code], [409, 'geraeteschluessel_vorhanden']);
    const ohneKette = await ruf('/geraet/schluessel', {
      method: 'POST',
      token,
      body: { oeffentlich: geraet.oeffentlich },
    });
    assert.deepEqual(
      [ohneKette.status, ohneKette.body.code],
      [400, 'geraeteschluessel_attestation'],
      'Ein Schlüssel ohne Attestation (ältere App) wird nicht mehr angenommen',
    );
  });

  await t.test(
    'eine Kette mit fremder oder verbrauchter Challenge, aus Software oder fremder Wurzel wird abgewiesen',
    async () => {
      const neu = (await anmelden(NAME)).body.token;
      const senden = kette => ruf('/geraet/schluessel', { method: 'POST', token: neu, body: { kette } });
      const fremdeChallenge = attestation.kette({ challenge: Buffer.alloc(32, 1) });
      assert.deepEqual([(await senden(fremdeChallenge.kette)).body.code], ['geraeteschluessel_attestation']);
      for (const o of [{ sicherheit: 0 }, { wurzel: attestation.neueWurzel('Fremd') }, { paket: 'com.boese.app' }]) {
        const n = (await ruf('/geraet/schluessel/nonce', { method: 'POST', token: neu, body: {} })).body.nonce;
        const r = await senden(attestation.kette({ challenge: Buffer.from(n, 'base64url'), ...o }).kette);
        assert.deepEqual([r.status, r.body.code], [400, 'geraeteschluessel_attestation'], JSON.stringify(o));
      }
      const ok = await hinterlege(ruf, neu);
      assert.equal(ok.antwort.status, 200, JSON.stringify(ok.antwort.body));
      const zweimal = await ruf('/geraet/schluessel', {
        method: 'POST',
        token: (await anmelden(NAME)).body.token,
        body: { kette: attestation.kette({ challenge: Buffer.from(ok.nonce, 'base64url') }).kette },
      });
      assert.equal(zweimal.body.code, 'geraeteschluessel_attestation', 'Die Nonce gilt einmal und nur ihrer Familie');
    },
  );

  await t.test('ein Schlüssel ohne Attestation gilt bis zum Stichtag und weicht einem attestierten', async () => {
    const alt = (await anmelden(NAME)).body.token;
    const z = await db.get(
      `SELECT user_id AS uid, date_trunc('milliseconds', created_at) AS seit FROM api_tokens
      WHERE token = $1`,
      [auth.hashToken(alt)],
    );
    const f = { uid: z.uid, seit: z.seit.toISOString() };
    await db.run('INSERT INTO geraete_schluessel (user_id, familie, oeffentlich) VALUES ($1, $2, $3)', [
      f.uid,
      f.seit,
      geraeteSchluessel().oeffentlich,
    ]);
    assert.equal((await klartext({ token: alt })).body.code, 'schritt_freigabe_noetig', 'vor dem Stichtag gilt er');
    assert.equal(await repo.schluesselDer(f, new Date(Date.now() - 1000)), null, 'nach dem Stichtag nicht mehr');
    const h = await hinterlege(ruf, alt);
    assert.equal(h.antwort.status, 200, JSON.stringify(h.antwort.body));
    assert.deepEqual(await repo.eintragDer(f), { oeffentlich: h.schluessel.oeffentlich, attestiert: true });
    assert.equal(await repo.schluesselDer(f, new Date(0)), h.schluessel.oeffentlich);
  });

  await t.test('ein Zugang aus der QR-Kopplung hinterlegt nur mit der Nonce seiner Abholung', async () => {
    const sitzung = (await anmelden(NAME, { ohne_token: true })).kopf.get('set-cookie').split(';')[0];
    const qr = await ruf('/auth/qr-token', { method: 'POST', cookie: sitzung, body: { password: PASS } });
    assert.equal(qr.status, 200, JSON.stringify(qr.body));
    const post = (p, body, kopf) => ruf('/auth' + p, { method: 'POST', body, cookie: kopf.cookie });
    const a = await qrKoppeln(post, qr.body, { cookie: sitzung });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.match(a.body.schluessel_nonce, /^[\w-]{43}$/);
    for (let i = 0; i < 2; i++) {
      const n = await ruf('/geraet/schluessel/nonce', { method: 'POST', token: a.body.token, body: {} });
      assert.equal(n.body.nonce, a.body.schluessel_nonce, 'keine zweite Nonce neben der aus der Abholung');
    }
    const h = await hinterlege(ruf, a.body.token);
    assert.equal(h.antwort.status, 200, JSON.stringify(h.antwort.body));
  });

  await t.test('mit Schlüssel, aber ohne Freigabe: weiter zu', async () => {
    const r = await klartext({ token });
    assert.deepEqual([r.status, r.body.code], [403, 'schritt_freigabe_noetig']);
  });

  await t.test('eine fremde Signatur öffnet nichts, und die Challenge ist danach verbraucht', async () => {
    const c = await ruf('/geraet/schritt/challenge', { method: 'POST', token, body: { aktion: 'gutschein' } });
    assert.equal(c.status, 200);
    const fremd = await ruf('/geraet/schritt/freigabe', {
      method: 'POST',
      token,
      body: { challenge: c.body.challenge, signatur: signiere(geraeteSchluessel().privateKey, c.body.nachricht) },
    });
    assert.deepEqual([fremd.status, fremd.body.code], [400, 'schritt_signatur_ungueltig']);
    const spaeter = await ruf('/geraet/schritt/freigabe', {
      method: 'POST',
      token,
      body: { challenge: c.body.challenge, signatur: signiere(geraet.privateKey, c.body.nachricht) },
    });
    assert.equal(spaeter.status, 400, 'Eine Challenge gilt genau einmal');
    assert.equal((await klartext({ token })).status, 403);
  });

  await t.test('eine Challenge taugt nur für ihre Aktion', async () => {
    const c = await ruf('/geraet/schritt/challenge', { method: 'POST', token, body: { aktion: 'verwaltung' } });
    const umgedeutet = c.body.nachricht.replace('\nverwaltung\n', '\ngutschein\n');
    assert.notEqual(umgedeutet, c.body.nachricht);
    const r = await ruf('/geraet/schritt/freigabe', {
      method: 'POST',
      token,
      body: { challenge: c.body.challenge, signatur: signiere(geraet.privateKey, umgedeutet) },
    });
    assert.equal(r.status, 400);
    // Richtig signiert öffnet sie die Verwaltung, nicht die Gutscheine.
    await geraetFreigeben(ruf, token, 'verwaltung', geraet);
    assert.equal((await klartext({ token })).status, 403);
  });

  await t.test('nach der Freigabe die PIN; abgelaufen wieder zu; ein anderer Zugang hat seine eigene', async () => {
    await geraetFreigeben(ruf, token, 'gutschein', geraet);
    const r = await klartext({ token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.pin, '4321');
    const zweiter = (await anmelden(NAME)).body.token;
    assert.equal(
      (await klartext({ token: zweiter })).body.code,
      'geraeteschluessel_fehlt',
      'Die Freigabe gilt der Token-Familie, nicht dem Konto',
    );
    await db.run(`UPDATE schritt_freigaben SET bis = NOW() - INTERVAL '1 second' WHERE user_id = $1`, [uid]);
    assert.equal((await klartext({ token })).body.code, 'schritt_freigabe_noetig');
  });

  await t.test('ein alter Zugang kann keinen Schlüssel mehr hinterlegen', async () => {
    const alt = (await anmelden(NAME)).body.token;
    await db.run(`UPDATE api_tokens SET created_at = NOW() - INTERVAL '1 hour' WHERE token = $1`, [
      auth.hashToken(alt),
    ]);
    const n = await ruf('/geraet/schluessel/nonce', { method: 'POST', token: alt, body: {} });
    assert.deepEqual([n.status, n.body.code], [403, 'geraeteschluessel_frist']);
    // Auch eine Nonce von damals hilft nicht: Sie läuft mit der Frist der Familie ab.
    const altNonce = Buffer.alloc(32, 9);
    await db.run(
      `INSERT INTO geraete_nonces (nonce, user_id, familie, ablauf) SELECT $2, user_id,
       date_trunc('milliseconds', created_at), NOW() + INTERVAL '1 hour' FROM api_tokens WHERE token = $1`,
      [auth.hashToken(alt), altNonce.toString('base64url')],
    );
    const r = await ruf('/geraet/schluessel', {
      method: 'POST',
      token: alt,
      body: { kette: attestation.kette({ challenge: altNonce }).kette },
    });
    assert.deepEqual([r.status, r.body.code], [403, 'geraeteschluessel_frist']);
  });

  await t.test('die Browser-Sitzung bleibt beim Passwort', async () => {
    const a = await anmelden(NAME, { ohne_token: true });
    const keks = a.kopf.get('set-cookie').split(';')[0];
    const r = await klartext({ cookie: keks });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const c = await ruf('/geraet/schritt/challenge', { method: 'POST', cookie: keks, body: { aktion: 'gutschein' } });
    assert.deepEqual([c.status, c.body.code], [403, 'nur_mit_app_token']);
  });

  await t.test('Verwalter-Routen eines App-Tokens erst nach der Freigabe „verwaltung“', async () => {
    const voll = (await anmelden(CHEF, { scope: 'voll', code: codes.shift() })).body.token;
    const vorher = await ruf('/admin/cache-ttl', { token: voll });
    assert.deepEqual([vorher.status, vorher.body.code], [403, 'geraeteschluessel_fehlt']);
    const h = await hinterlege(ruf, voll);
    assert.equal(h.antwort.status, 200, JSON.stringify(h.antwort.body));
    const s = h.schluessel;
    assert.equal((await ruf('/auth/users', { token: voll })).body.code, 'schritt_freigabe_noetig');
    await geraetFreigeben(ruf, voll, 'gutschein', s);
    assert.equal(
      (await ruf('/admin/cache-ttl', { token: voll })).status,
      403,
      'Die Freigabe der Gutscheine öffnet keine Verwaltung',
    );
    await geraetFreigeben(ruf, voll, 'verwaltung', s);
    assert.equal((await ruf('/admin/cache-ttl', { token: voll })).status, 200);
    assert.equal((await ruf('/auth/users', { token: voll })).status, 200);
  });

  await t.test('jeder Verwalterweg in Einstellungen und Anleitungen verlangt die Freigabe „verwaltung“', async () => {
    const voll = (await anmelden(CHEF, { scope: 'voll', code: codes.shift() })).body.token;
    await db.run(`INSERT INTO global_settings (key, value) VALUES ('smtp_host', 'mail.schritt.example')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    await db.run(`DELETE FROM global_settings WHERE key IN ('einrichtung_erledigt', 'default_price_condition')`);
    const einspielen = async () => {
      const form = new FormData();
      const datei = JSON.stringify({ version: '3.0', global: { default_price_condition: 'U' }, user_settings: {} });
      form.append('file', new Blob([datei], { type: 'application/json' }), 'k.json');
      const r = await fetch(`${basis}/api/v1/settings/import`, {
        method: 'POST',
        headers: { authorization: `Bearer ${voll}` },
        body: form,
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const wege = {
      'POST /settings': () => ruf('/settings', { method: 'POST', token: voll, body: { default_price_condition: 'N' } }),
      'POST /settings/import': einspielen,
      'POST /settings/smtp-test': () => ruf('/settings/smtp-test', { method: 'POST', token: voll, body: {} }),
      'GET /settings/einrichtung': () => ruf('/settings/einrichtung', { token: voll }),
      'POST /settings/einrichtung/fertig': () =>
        ruf('/settings/einrichtung/fertig', { method: 'POST', token: voll, body: {} }),
      'POST /settings/quelle-testen': () =>
        ruf('/settings/quelle-testen', { method: 'POST', token: voll, body: { quelle: 'keine' } }),
      'POST /sets/:setNumber/instructions': () =>
        ruf('/sets/10001-1/instructions', { method: 'POST', token: voll, body: {} }),
    };
    // Seit der Attestation hinterlegt die App den Schlüssel mit Kette (helpers/geraet.js).
    const h = await hinterlege(ruf, voll);
    assert.equal(h.antwort.status, 200, JSON.stringify(h.antwort.body));
    const s = h.schluessel;
    for (const [weg, rufe] of Object.entries(wege)) {
      const r = await rufe();
      assert.deepEqual([r.status, r.body?.code], [403, 'schritt_freigabe_noetig'], `${weg} ohne Freigabe`);
    }
    assert.equal(
      (await db.get(`SELECT value FROM global_settings WHERE key = 'default_price_condition'`))?.value,
      undefined,
      'ohne Freigabe ist nichts geschrieben',
    );
    const ohne = await ruf('/settings/raw', { token: voll });
    assert.equal(ohne.status, 200);
    assert.equal(ohne.body.settings.smtp_host, undefined, 'ohne Freigabe zeigt /settings/raw nur Kontowerte');
    const eigene = await ruf('/settings', { method: 'POST', token: voll, body: { language: 'de' } });
    assert.equal(eigene.status, 200, 'die eigenen Werte braucht keine Freigabe');

    await geraetFreigeben(ruf, voll, 'verwaltung', s);
    const erwartet = {
      'POST /settings': [200, undefined],
      'POST /settings/import': [200, undefined],
      'POST /settings/smtp-test': [400, 'smtp_nicht_konfiguriert'],
      'GET /settings/einrichtung': [200, undefined],
      'POST /settings/einrichtung/fertig': [200, undefined],
      'POST /settings/quelle-testen': [400, 'quelle_unbekannt'],
      'POST /sets/:setNumber/instructions': [202, undefined],
    };
    for (const [weg, rufe] of Object.entries(wege)) {
      const r = await rufe();
      assert.deepEqual([r.status, r.body?.code], erwartet[weg], `${weg} mit Freigabe: ${JSON.stringify(r.body)}`);
    }
    assert.equal((await db.get(`SELECT value FROM global_settings WHERE key = 'einrichtung_erledigt'`))?.value, '1');
    assert.equal((await ruf('/settings/raw', { token: voll })).body.settings.smtp_host, 'mail.schritt.example');
  });
});
