/**
 * Hardening of login and operation: new session ID on login,
 * login counters in the database (with fallback in memory), no token from
 * the address bar, clearing the price cache only as administrator, preview images in the
 * lists, and open event streams do not hold up shutdown.
 *
 * Counter-checks (measured 10.11.2026, each alone, reverted):
 *   A  in establishSession() `req.session.regenerate(…)` replaced by a
 *      direct call of the callback → red: “the session ID …”
 *      (no new cookie, the old ID stays)
 *   B  in _bump() first `throw 0` (only process memory counts) → red:
 *      “a second process sees the lock”
 *   C  in _reserviere() the catch branch replaced by `throw fehler` → red:
 *      “without a database the memory throttles”
 *   D  in /admin/cache-clear requireApiAdmin replaced by `(_q, _s, n) => n()` →
 *      red: “only … clears the price cache” (200 instead of 403)
 *   E  in minifigs.js the tile with imgUrl(…, false) (bundle rebuilt)
 *      → red: “minifigures and finances request preview images”
 *   F  `closeAllSse()` deleted in herunterfahren() → red: “open
 *      event streams …” (end only after the deadline of 8 s)
 * Deleted because a behavior test executes the same: “price presence
 * depends on avg_price” (price-rule-db.test.js), preview of parts and sets
 * (listen-paging-oberflaeche, bilder-proxy-oberflaeche), thumb=1 at the proxy
 * (img-cache-serve.test.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer, portOf } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const { openUi, reiter, warte } = require('./helpers/ui');
const { bis } = require('./helpers/time');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const db = testData();

const NAME = `haerte_${process.pid}`,
  PASS = 'Haerte-Passwort-1';
// The counter cases lock this name; the test account stays free for the token case.
const COUNTER = `${NAME}_zaehler`;
let uid = 0;

test('hardening against the database', { concurrency: 1, timeout: 120_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const aufraeumen = async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, `${NAME}_v`]]);
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', ['%203.0.113.%']);
  };
  await aufraeumen();
  const anlegen = async (n, admin) =>
    (
      await db.get(
        `INSERT INTO users (username, password_hash, is_active, email_verified, is_admin) VALUES ($1,$2,true,true,$3) RETURNING id`,
        [n, bcrypt.hashSync(PASS, 4), admin],
      )
    ).id;
  uid = await anlegen(NAME, false);
  const verwalter = await anlegen(`${NAME}_v`, true);
  await adminWithFactor(_req, verwalter);
  t.after(async () => {
    await aufraeumen().catch(() => {});
  });

  await t.test('the session ID changes on login', async () => {
    // Whoever slipped the victim an ID beforehand must not be logged in afterwards.
    const app = express();
    app.use(express.json());
    app.use(session({ secret: 'haerte-test-geheimnis-lang-genug', resave: false, saveUninitialized: false }));
    app.get('/vorher', (req, res) => {
      req.session.visit = 1;
      res.json({});
    });
    app.use('/api/v1/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
    const srv = app.listen(0);
    t.after(() => new Promise(r => srv.close(r)));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const keks = r => (r.headers.get('set-cookie') || '').split(';')[0];
    const alt = keks(await fetch(`${base}/vorher`));
    assert.match(alt, /^connect\.sid=/, 'Vorbedingung: eine Sitzung vor der Anmeldung');
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alt },
      body: JSON.stringify({ username: NAME, password: PASS, ohne_token: true }),
    });
    assert.equal(login.status, 200, await login.text());
    const neu = keks(login);
    assert.match(neu, /^connect\.sid=/, 'die Anmeldung setzt kein Cookie');
    assert.notEqual(neu, alt, 'die Sitzungs-ID von vor der Anmeldung gilt weiter');
    const ich = async c => (await (await fetch(`${base}/api/v1/auth/me`, { headers: { cookie: c } })).json()).loggedIn;
    assert.equal(await ich(neu), true);
    assert.equal(await ich(alt), false, 'die alte ID ist angemeldet');
  });

  await t.test('login counter: a second process sees the lock', async () => {
    const IP = '203.0.113.7';
    const a = _req('src/account/loginLimiter.js');
    assert.equal(await a.loginAllowed(IP, COUNTER), null, 'Vorbedingung: frei');
    for (let i = 0; i < a.MAX_ATTEMPTS; i++) await a.loginFailed(IP, COUNTER);
    // A freshly loaded module has empty memory, like a second worker process.
    const datei = path.join(ROOT, 'dist', 'src', 'account', 'loginLimiter.js');
    delete require.cache[datei];
    const b = require(datei);
    assert.notEqual(a, b, 'Vorbedingung: zwei Modulinstanzen');
    const konto = require('./helpers/sources').testArea('account');
    assert.equal((await b.loginAllowed(konto, IP, COUNTER))?.code, 'zu_viele_fehlversuche');
  });

  await t.test('login counter: without a database the memory throttles', async () => {
    const IP = '203.0.113.8';
    const l = _req('src/account/loginLimiter.js');
    const warn = console.warn;
    console.warn = () => {};
    await db.run('ALTER TABLE rate_limit_attempts RENAME TO rate_limit_attempts_weg');
    try {
      assert.equal(await l.loginAllowed(IP, COUNTER), null, 'ein Datenbankfehler sperrt die Anmeldung');
      for (let i = 0; i < l.MAX_ATTEMPTS; i++) await l.loginFailed(IP, COUNTER);
      assert.equal((await l.loginAllowed(IP, COUNTER))?.code, 'zu_viele_fehlversuche', 'ohne Datenbank keine Bremse');
    } finally {
      await db.run('ALTER TABLE rate_limit_attempts_weg RENAME TO rate_limit_attempts');
      console.warn = warn;
    }
  });

  await t.test('a token only counts in the header, not in the address bar', async () => {
    const { base } = testServer(_req, { sitzung: {}, t });
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: NAME, password: PASS }),
    });
    const { token } = await login.json();
    assert.ok(token, 'Vorbedingung: ein Token');
    assert.equal((await fetch(`${base}/api/v1/stats`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
    assert.equal((await fetch(`${base}/api/v1/stats?token=${token}`)).status, 401);
    assert.equal((await fetch(`${base}/api/v1/stats?access_token=${token}`)).status, 401);
  });

  await t.test('only an admin clears the price cache', async () => {
    // Otherwise the installation's BrickLink quota could be burned from outside.
    const SN = `haerte-${process.pid}-1`;
    await db.run(`INSERT INTO price_cache (set_number, condition, currency_code, avg_price) VALUES ($1,'N','EUR',1)`, [
      SN,
    ]);
    const leeren = async (id, admin) => {
      const { base } = testServer(_req, { sitzung: { userId: id, isAdmin: !!admin }, t });
      return (
        await fetch(`${base}/api/v1/admin/cache-clear`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      ).status;
    };
    const da = async () => !!(await db.get('SELECT 1 FROM price_cache WHERE set_number = $1', [SN]));
    assert.equal(await leeren(uid, 0), 403);
    assert.equal(await da(), true, 'ein gewöhnliches Konto hat den Cache geleert');
    assert.equal(await leeren(verwalter, 1), 200);
    assert.equal(await da(), false);
  });

  await t.test('open event streams do not hold up shutdown', async () => {
    const port = await new Promise(r => {
      const s = net.createServer().listen(0, () => {
        const p = portOf(s);
        s.close(() => r(p));
      });
    });
    const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        DATABASE_URL: URL_DB,
        SESSION_SECRET: 'haerte-test-geheimnis-lang-genug-1234',
        PORT: String(port),
        ROLLE: 'web',
        NODE_ENV: 'production',
        DB_SUPERUSER_ERLAUBT: '1',
        APP_BASE_URL_FEHLT_OK: '1',
        COOKIE_SECURE: '0',
      },
    });
    let log = '';
    srv.stdout.on('data', d => {
      log += d;
    });
    srv.stderr.on('data', d => {
      log += d;
    });
    const ende = new Promise(r => srv.on('exit', code => r(code)));
    t.after(() => {
      if (srv.exitCode === null) srv.kill('SIGKILL');
    });
    const basis = `http://127.0.0.1:${port}`;
    assert.ok(await bis(async () => (await fetch(`${basis}/api/v1/health/live`).catch(() => null))?.ok, 60_000), log);
    const login = await fetch(`${basis}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: NAME, password: PASS, ohne_token: true }),
    });
    assert.equal(login.status, 200, `${await login.clone().text()}\n${log}`);
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const strom = await fetch(`${basis}/api/v1/sets/import/csv/stream`, { headers: { cookie } });
    assert.equal(strom.status, 200, log);
    assert.match(strom.headers.get('content-type') || '', /text\/event-stream/);
    const lauf = strom.body
      .getReader()
      .read()
      .catch(() => null);
    const start = Date.now();
    srv.kill('SIGTERM');
    const code = await ende;
    await lauf;
    assert.equal(code, 0, log);
    assert.ok(Date.now() - start < 5000, `Herunterfahren dauerte ${Date.now() - start} ms:\n${log.slice(-800)}`);
    assert.match(log, /offene Ereignis-Ströme beendet/);
  });
  await db.pool.end().catch(() => {});
});

test('minifigures and finances request preview images', async () => {
  // Full resolution at a display size of 36–100 px made the tiles visibly trickle in.
  const IMAGE = 'https://cdn.rebrickable.com/media/sets/fig-000123.jpg';
  const { w, d } = await openUi({
    '/v1/minifigs': {
      success: true,
      total: 1,
      figs: [{ fig_number: 'fig-000123', fig_name: 'Chewbacca', source: 'set', total_quantity: 1, image_url: IMAGE }],
    },
    '/v1/finance/valuation': {
      success: true,
      currency: 'EUR',
      condition: 'N',
      total_value: '1',
      kaufpreise_fremde_waehrung: 0,
      totals: { min: '0', avg: '1', max: '0', qty_avg: '1' },
      sets: [
        {
          set_number: '10294-1',
          name: 'Titanic',
          quantity: 1,
          avg_price: 1,
          wert_gesamt: 1,
          from_cache: true,
          is_fallback: false,
          no_price: false,
          mixed: false,
          image_url: 'https://cdn.rebrickable.com/media/sets/10294-1.jpg',
          acquisitions: [],
        },
      ],
    },
  });
  try {
    await reiter(w, 'minifigs');
    assert.ok(await warte(() => d.querySelector('#figs-list img')), 'keine Figurenkachel');
    assert.match(d.querySelector('#figs-list img').getAttribute('src'), /^\/api\/v1\/img-proxy\?.*&thumb=1/);
    await reiter(w, 'finance');
    assert.ok(await warte(() => d.querySelector('#fin-tbl .fin-bild img')), 'kein Bild in der Finanztabelle');
    assert.match(d.querySelector('#fin-tbl .fin-bild img').getAttribute('src'), /^\/api\/v1\/img-proxy\?.*&thumb=1/);
  } finally {
    w.close();
  }
});

// ── Structure: bans across all callers of the web app ───────────────────────

test('the web app appends no token to an address', () => {
  // The server no longer looks at it there (test above); it would only stand in the log.
  const { ohneKommentare, setCoreSource } = require('./helpers/sources');
  const append = [/'\?token='\s*\+/, /\?token=\$/];
  const dateien = [
    path.join(ROOT, 'public', 'js', 'api.js'),
    path.join(ROOT, 'public', 'js', 'images.js'),
    path.join(ROOT, 'public', 'js', 'progress.js'),
    path.join(ROOT, 'public', 'js', 'monitor.js'),
    path.join(ROOT, 'public', 'js', 'collection.js'),
    path.join(ROOT, 'public', 'js', 'settings.js'),
  ];
  const treffer = [];
  for (const voll of dateien) {
    assert.ok(fs.existsSync(voll), `${path.basename(voll)} steht nicht mehr dort — Pfad im Test veraltet`);
    const src = ohneKommentare(fs.readFileSync(voll, 'utf8'));
    if (append.some(re => re.test(src))) treffer.push(path.basename(voll));
  }
  assert.deepEqual(treffer, []);
  // A second version of the guard would bypass the one rule in src/account/http/login.ts.
  assert.doesNotMatch(setCoreSource(), /function requireLoginOrToken/);
  // During an import 503 after 3 s is better than a hanging connection.
  assert.match(setCoreSource(), /loginOrTokenGuard\(d\.account, \{ timeoutMs: 3000 \}\)/);
});

test('every price query on price_cache names the currency', () => {
  // price_cache is keyed over set, condition AND currency; without currency_code currencies mix,
  // and a currency change would need a cache clearing. Counts and queries without WHERE select no price.
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const reader = require('./helpers/sources')
    .allSources()
    .filter(d => read(d).includes('FROM price_cache'));
  assert.ok(reader.length >= 4, `nur ${reader.length} Leser von price_cache gefunden — Suche veraltet?`);
  const ohne = [];
  for (const datei of reader) {
    const src = read(datei);
    for (let i = src.indexOf('FROM price_cache'); i !== -1; i = src.indexOf('FROM price_cache', i + 1)) {
      const vorher = src.slice(Math.max(0, i - 400), i);
      const auf = vorher[Math.max(vorher.lastIndexOf('`'), vorher.lastIndexOf("'"), vorher.lastIndexOf('"'))] || '`';
      const block = src.slice(i, i + 400).split(auf)[0];
      if (!/COUNT\(\*\)[^`'"]*$/.test(vorher) && /\bWHERE\b/.test(block) && !/currency_code/.test(block))
        ohne.push(datei);
    }
  }
  assert.deepEqual(ohne, []);
});
