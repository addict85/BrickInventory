/**
 * Open without login at the entrance (PUBLIC_ROUTES, routes/api/middleware.ts) is exactly
 * what the app calls before it has a token (`ohne_token` in shared/app-schnittstelle.json),
 * plus named exceptions; Caddy buffers each open POST as a sign-in path. The app's "No" on
 * the QR screen (POST /auth/qr-login/verwerfen) comes without session and token.
 *
 * Counter-checks (measured 22.11.2026, each on its own):
 *   A  'POST /auth/qr-login/discard' removed from PUBLIC_ROUTES → red: “the app's No
 *      without session is stored” (401 instead of 200) and “the app's sign-in screen calls
 *      only open routes” (verwerfen missing)
 *   B  '/api/v2/auth/cancel-takeover' removed from the Caddyfile matcher → red:
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
const { PUBLIC_ROUTES, isPublicRoute } = _req('routes/api/middleware.js');
/** What the app needs from the server, generated from its source (Android-App/tools/contract). */
const APP = JSON.parse(fs.readFileSync(path.join(WEB, '..', 'shared', 'app-schnittstelle.json'), 'utf8'));
const withoutPrefix = (/** @type {string} */ r) => r.replace(' /api/v2/', ' /');

/** What the sign-in screen calls before there is a token (the generator follows
 * AnmeldungViewModel → KontoRepositoryImpl → AccountApi). */
const { v2PathOf } = _req('src/http/apiV1Alias.js');
/** The app calls /api/v1: its routes under their v2 address. */
const v2Of = (/** @type {string} */ r) => {
  const [m, p] = r.split(' ');
  return `${m} ${v2PathOf(m, p).path}`;
};
const signInScreenRoutes = () =>
  new Set((APP[require('./helpers/contract').APP_KEYS.withoutToken] ?? []).map(r => withoutPrefix(v2Of(r))));

/** Open, but not from the sign-in screen; each with the reason. */
const EXCEPTIONS = {
  // The app before login (design of the sign-in screen) and the web app.
  'GET /settings/theme': 'app',
  // Answers "not signed in" instead of 401; the app asks with a token.
  'GET /auth/me': 'app',
  // An expired token must still be able to sign out and to swap (it checks itself).
  'POST /auth/logout': 'app',
  'POST /auth/rotate-token': 'app',
  // Pages of the web app and links from mails (routes/pages.ts).
  'GET /setup/state': 'web',
  'POST /auth/reset-password': 'web',
  'POST /auth/resend-confirmation': 'web',
  'POST /auth/confirm-email': 'web',
  'POST /auth/confirm-email/preview': 'web',
  'POST /auth/cancel-takeover': 'web',
  'POST /auth/approve-login': 'web',
};

test("the app's sign-in screen calls only open routes, and every open route is named", () => {
  const screen = signInScreenRoutes();
  assert.ok(screen.size >= 8, `only ${screen.size} addresses of the login — does the search still work?`);
  assert.ok(screen.has('POST /auth/qr-login/discard'), "the app's refusal is missing in the detection");
  const geschlossen = [...screen].filter(r => !isPublicRoute(...r.split(' ')));
  assert.deepEqual(geschlossen, [], "the app's login calls these without a token");
  assert.deepEqual(
    [...PUBLIC_ROUTES].sort(),
    [...new Set([...screen, ...Object.keys(EXCEPTIONS)])].sort(),
    "open = the app's login + named exceptions",
  );
  // The exceptions marked `app` are routes the app really calls.
  const app = new Set(
    APP.routen.map((/** @type {{ methode: string, pfad: string }} */ r) =>
      withoutPrefix(v2Of(`${r.methode} ${r.pfad}`)),
    ),
  );
  for (const [r, wer] of Object.entries(EXCEPTIONS))
    if (wer === 'app') assert.ok(app.has(r), `the app does not call ${r}`);
});

test('Caddy buffers every open POST as a sign-in path', () => {
  const caddy = fs.readFileSync(path.join(WEB, 'Caddyfile'), 'utf8');
  const block = caddy.match(/@anmeldung \{([\s\S]*?)\n\t\}/)?.[1] ?? '';
  const pfade = (block.match(/^\s*path (.+)$/m)?.[1] ?? '').trim().split(/\s+/);
  assert.ok(/method POST/.test(block) && pfade.length > 5, 'block @anmeldung not found');
  // The app still posts to the v1 alias, so Caddy buffers both addresses.
  const { v1Key } = _req('src/contract/v1Routes.js');
  const open = PUBLIC_ROUTES.filter(r => r.startsWith('POST ')).flatMap(r => [
    `/api/v2${r.slice(5)}`,
    v1Key(`POST /api/v2${r.slice(5)}`).slice(5),
  ]);
  assert.deepEqual([...pfade].sort(), [...open].sort());
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
  const address = base.replace('localhost', '127.0.0.1');
  const callFn = async (/** @type {boolean} */ browser, /** @type {string} */ path, /** @type {object} */ body) => {
    for (const k of Object.keys(sitzung)) delete sitzung[k];
    if (browser) Object.assign(sitzung, { userId: uid, username: NAME });
    const r = await fetch(`${address}/api/v2/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const qr = await callFn(true, '/qr-token', { password: PASS });
  assert.equal(qr.status, 200, JSON.stringify(qr.body));
  const m = await callFn(false, '/qr-login', { token: qr.body.token, label: 'Pixel Nein' });
  assert.equal(m.status, 200, JSON.stringify(m.body));

  const nein = await callFn(false, '/qr-login/discard', { pickup: m.body.pickup });
  assert.equal(nein.status, 200, JSON.stringify(nein.body));
  const row = await db.get('SELECT rejected_at FROM qr_login_tokens WHERE user_id = $1', [uid]);
  assert.ok(row?.rejected_at, 'the rejection is in the database');
  // The web session confirms afterwards: the app still gets no token.
  assert.equal((await callFn(true, `/qr-pairing/${qr.body.pairing}/confirm`, { code: m.body.code })).status, 409);
  const ab = await callFn(false, '/qr-login/collect', { pickup: m.body.pickup });
  assert.equal(ab.body?.token, undefined, JSON.stringify(ab.body));
});
