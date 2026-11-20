/**
 * Härtung der Anmeldung und des Betriebs: neue Sitzungs-ID beim Anmelden,
 * Anmeldezähler in der Datenbank (mit Rückfall im Speicher), kein Token aus
 * der Adresszeile, Preis-Cache leeren nur als Verwalter, Vorschaubilder in den
 * Listen, und offene Ereignis-Ströme halten das Herunterfahren nicht auf.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, zurückgenommen):
 *   A  in establishSession() `req.session.regenerate(…)` durch einen
 *      direkten Aufruf des Rückrufs ersetzt → rot: „die Sitzungs-ID …“
 *      (kein neues Cookie, die alte ID bleibt)
 *   B  in _bump() zuerst `throw 0` (nur der Prozessspeicher zählt) → rot:
 *      „ein zweiter Prozess sieht die Sperre“
 *   C  in _reserviere() den catch-Zweig durch `throw fehler` ersetzt → rot:
 *      „ohne Datenbank bremst der Speicher“
 *   D  in /admin/cache-clear requireApiAdmin durch `(_q, _s, n) => n()` →
 *      rot: „den Preis-Cache leert nur …“ (200 statt 403)
 *   E  in minifigs.js die Kachel mit imgUrl(…, false) (Bündel neu gebaut)
 *      → rot: „Minifiguren und Finanzen fordern Vorschaubilder an“
 *   F  in herunterfahren() `closeAllSse()` gestrichen → rot: „offene
 *      Ereignis-Ströme …“ (Ende erst nach der Frist von 8 s)
 * Gestrichen, weil ein Verhaltenstest dasselbe ausführt: „Preis-Vorhandensein
 * hängt an avg_price“ (price-rule-db.test.js), Vorschau der Teile und Sets
 * (listen-paging-oberflaeche, bilder-proxy-oberflaeche), thumb=1 am Proxy
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
// Die Zähler-Fälle sperren diesen Namen; das Testkonto bleibt für den Token-Fall frei.
const COUNTER = `${NAME}_zaehler`;
let uid = 0;

test('Härtung gegen die Datenbank', { concurrency: 1, timeout: 120_000 }, async t => {
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

  await t.test('die Sitzungs-ID wechselt beim Anmelden', async () => {
    // Wer dem Opfer vorher eine ID untergeschoben hat, darf danach nicht angemeldet sein.
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

  await t.test('Anmeldezähler: ein zweiter Prozess sieht die Sperre', async () => {
    const IP = '203.0.113.7';
    const a = _req('src/account/loginLimiter.js');
    assert.equal(await a.loginAllowed(IP, COUNTER), null, 'Vorbedingung: frei');
    for (let i = 0; i < a.MAX_ATTEMPTS; i++) await a.loginFailed(IP, COUNTER);
    // Ein frisch geladenes Modul hat leeren Speicher, wie ein zweiter Arbeitsprozess.
    const datei = path.join(ROOT, 'dist', 'src', 'account', 'loginLimiter.js');
    delete require.cache[datei];
    const b = require(datei);
    assert.notEqual(a, b, 'Vorbedingung: zwei Modulinstanzen');
    const konto = require('./helpers/sources').testArea('account');
    assert.equal((await b.loginAllowed(konto, IP, COUNTER))?.code, 'zu_viele_fehlversuche');
  });

  await t.test('Anmeldezähler: ohne Datenbank bremst der Speicher', async () => {
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

  await t.test('ein Token zählt nur im Kopf, nicht in der Adresszeile', async () => {
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

  await t.test('den Preis-Cache leert nur, wer Verwalter ist', async () => {
    // Sonst liesse sich das BrickLink-Kontingent der Installation von aussen verbrennen.
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

  await t.test('offene Ereignis-Ströme halten das Herunterfahren nicht auf', async () => {
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

test('Minifiguren und Finanzen fordern Vorschaubilder an', async () => {
  // Volle Auflösung bei 36–100 px Anzeigegrösse liess die Kacheln sichtbar nachtröpfeln.
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

// ── Struktur: Verbote über alle Aufrufer der Webapp ─────────────────────────

test('die Webapp hängt keinen Token an eine Adresse', () => {
  // Der Server sieht ihn dort nicht mehr an (Test oben); er stünde nur im Protokoll.
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
  // Eine zweite Fassung des Wächters umginge die eine Regel in src/account/http/login.ts.
  assert.doesNotMatch(setCoreSource(), /function requireLoginOrToken/);
  // Während eines Imports ist 503 nach 3 s besser als eine hängende Verbindung.
  assert.match(setCoreSource(), /loginOrTokenGuard\(d\.account, \{ timeoutMs: 3000 \}\)/);
});

test('jede Preisabfrage auf price_cache nennt die Währung', () => {
  // price_cache ist über Set, Zustand UND Währung verschlüsselt; ohne currency_code mischen sich Währungen,
  // und ein Währungswechsel bräuchte eine Cache-Leerung. Zählungen und Abfragen ohne WHERE wählen keinen Preis.
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
