/**
 * What is open without login at the entrance (PUBLIC_ROUTES in routes/api_v1/middleware.ts)
 * is exactly what the app calls before it has a token, what Caddy buffers as a
 * sign-in path, plus a named list of exceptions. The app's "No" on the QR
 * screen (POST /auth/qr-login/verwerfen) came without session and token and ended at the
 * entrance with 401; the existing QR test ran its whole server with a session.
 *
 * Counter-checks (measured 22.11.2026, each on its own):
 *   A  'POST /auth/qr-login/verwerfen' removed from PUBLIC_ROUTES → red: “the app's No
 *      without session is stored” (401 instead of 200) and “the app's sign-in screen calls
 *      only open routes” (verwerfen missing)
 *   B  '/api/v1/auth/uebernahme-abbrechen' removed from the Caddyfile matcher → red:
 *      “Caddy buffers every open POST” (missing in Caddy)
 *   C  'POST /auth/settings-probe' added to PUBLIC_ROUTES → red: “every open route
 *      is named” and “Caddy buffers every open POST” (an open route nobody calls without login)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'http://localhost';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

const WEB = path.join(__dirname, '..');
const ANDROID = path.join(WEB, '..', 'Android-App');
const KT = 'src/main/java/ch/brickinventoryapp';
const { PUBLIC_ROUTES, isPublicRoute } = _req('routes/api_v1/middleware.js');

/** Retrofit methods of AccountApi: name → "METHOD /path" below /api/v1. */
function accountApi() {
  const src = fs.readFileSync(path.join(ANDROID, 'core-data', KT, 'data/api/AccountApi.kt'), 'utf8');
  const map = new Map();
  for (const m of src.matchAll(/@(GET|POST|PUT|DELETE)\("api\/v1([^"]+)"\)[\s\S]*?fun (\w+)\(/g))
    map.set(m[3], `${m[1]} ${m[2]}`);
  return map;
}

/** Repository method → the AccountApi methods its body calls. */
function repositoryCalls() {
  const src = fs.readFileSync(path.join(ANDROID, 'core-data', KT, 'data/repository/KontoRepositoryImpl.kt'), 'utf8');
  const teile = src.split(/\n\s*override (?:suspend )?fun /).slice(1);
  return new Map(teile.map(t => [t.match(/^(\w+)/)?.[1] ?? '', [...t.matchAll(/\bapi\.(\w+)\(/g)].map(m => m[1])]));
}

/** What the sign-in screen (before there is a token) calls on the server. */
function signInScreenRoutes() {
  const vm = fs.readFileSync(
    path.join(ANDROID, 'feature-login', KT, 'login/ui/viewmodel/AnmeldungViewModel.kt'),
    'utf8',
  );
  const api = accountApi();
  const repo = repositoryCalls();
  const routen = new Set();
  for (const [, name] of vm.matchAll(/\bkonto\.(\w+)\(/g))
    for (const a of repo.get(name) ?? []) {
      const r = api.get(a);
      assert.ok(r, `${name} → api.${a} ohne Adresse in AccountApi.kt`);
      routen.add(r);
    }
  return routen;
}

/** Open, but not from the sign-in screen; each with the reason. */
const EXCEPTIONS = {
  // The app before login (design of the sign-in screen) and the web app.
  'GET /settings/theme': 'app',
  // Answers "not signed in" instead of 401; the app asks with a token.
  'GET /auth/me': 'app',
  // An expired token must still be able to sign out and to swap (it checks itself).
  'POST /auth/logout': 'app',
  'POST /auth/token-rotieren': 'app',
  // Pages of the web app and links from mails (routes/pages.ts).
  'GET /einrichtung/stand': 'web',
  'POST /auth/reset-password': 'web',
  'POST /auth/bestaetigung-erneut': 'web',
  'POST /auth/email-bestaetigen': 'web',
  'POST /auth/email-bestaetigen/vorschau': 'web',
  'POST /auth/uebernahme-abbrechen': 'web',
  'POST /auth/anmeldung-freigeben': 'web',
};

test("the app's sign-in screen calls only open routes, and every open route is named", () => {
  const screen = signInScreenRoutes();
  assert.ok(screen.size >= 8, `nur ${screen.size} Adressen der Anmeldung — greift die Suche noch?`);
  assert.ok(screen.has('POST /auth/qr-login/verwerfen'), 'das Nein der App fehlt in der Ermittlung');
  const geschlossen = [...screen].filter(r => !isPublicRoute(...r.split(' ')));
  assert.deepEqual(geschlossen, [], 'die Anmeldung der App ruft diese ohne Token');
  assert.deepEqual(
    [...PUBLIC_ROUTES].sort(),
    [...new Set([...screen, ...Object.keys(EXCEPTIONS)])].sort(),
    'offen = Anmeldung der App + benannte Ausnahmen',
  );
  // The app interface (shared/app-schnittstelle.json) knows the exceptions marked `app`.
  const app = new Set(
    JSON.parse(fs.readFileSync(path.join(WEB, '..', 'shared', 'app-schnittstelle.json'), 'utf8')).routen.map(
      (/** @type {{ methode: string, pfad: string }} */ r) => `${r.methode} ${r.pfad.replace(/^\/api\/v1/, '')}`,
    ),
  );
  for (const [r, wer] of Object.entries(EXCEPTIONS))
    if (wer === 'app') assert.ok(app.has(r), `${r} ruft die App nicht`);
});

test('Caddy buffers every open POST as a sign-in path', () => {
  const caddy = fs.readFileSync(path.join(WEB, 'Caddyfile'), 'utf8');
  const block = caddy.match(/@anmeldung \{([\s\S]*?)\n\t\}/)?.[1] ?? '';
  const pfade = (block.match(/^\s*path (.+)$/m)?.[1] ?? '').trim().split(/\s+/);
  assert.ok(/method POST/.test(block) && pfade.length > 5, 'Block @anmeldung nicht gefunden');
  const offen = PUBLIC_ROUTES.filter(r => r.startsWith('POST ')).map(r => `/api/v1${r.slice(5)}`);
  assert.deepEqual([...pfade].sort(), [...offen].sort());
});

test("the app's No without session is stored", { concurrency: 1, timeout: 60_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `qrnein_${process.pid}`;
  const PASS = 'Nein-Passwort-1';
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  await db.run(`DELETE FROM rate_limit_attempts WHERE key ~ '^(qr-login|qr-abholen)\\|'`);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, $2, true, true) RETURNING id`,
      [NAME, await bcrypt.hash(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  /** The browser has the session, the app has none: the same server, the session switched per call. */
  const sitzung = {};
  const { base } = testServer(_req, { sitzung, t });
  const adresse = base.replace('localhost', '127.0.0.1');
  const ruf = async (/** @type {boolean} */ browser, /** @type {string} */ pfad, /** @type {object} */ body) => {
    for (const k of Object.keys(sitzung)) delete sitzung[k];
    if (browser) Object.assign(sitzung, { userId: uid, username: NAME });
    const r = await fetch(`${adresse}/api/v1/auth${pfad}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const qr = await ruf(true, '/qr-token', { password: PASS });
  assert.equal(qr.status, 200, JSON.stringify(qr.body));
  const m = await ruf(false, '/qr-login', { token: qr.body.token, label: 'Pixel Nein' });
  assert.equal(m.status, 200, JSON.stringify(m.body));

  const nein = await ruf(false, '/qr-login/verwerfen', { abholung: m.body.abholung });
  assert.equal(nein.status, 200, JSON.stringify(nein.body));
  const zeile = await db.get('SELECT rejected_at FROM qr_login_tokens WHERE user_id = $1', [uid]);
  assert.ok(zeile?.rejected_at, 'die Ablehnung steht in der Datenbank');
  // The web session confirms afterwards: the app still gets no token.
  assert.equal((await ruf(true, `/qr-kopplung/${qr.body.kopplung}/bestaetigen`, { code: m.body.code })).status, 409);
  const ab = await ruf(false, '/qr-login/abholen', { abholung: m.body.abholung });
  assert.equal(ab.body?.token, undefined, JSON.stringify(ab.body));
});
