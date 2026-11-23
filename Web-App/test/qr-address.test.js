/**
 * The QR code carries the address under which the server is reachable from
 * OUTSIDE — or no code comes.
 *
 * ── Counter-checks (carried out, result in the commit) ─────────────────────────
 *   a) refusal removed, `url: basis` stays         → step 1 red (200 instead of 503)
 *   b) refusal moved AFTER the INSERT              → step 1 red, with exactly the
 *                                                     message „Nonce entstanden"
 *   c) `d.url || location.origin` restored         → step 2 red
 *   d) fallback to the Host header in the server   → steps 1 AND 3 red
 *
 * With d) it was two, not one: step 3 sees the guessed host in the
 * source text, step 1 sees the consequence — the route then answers with 200 and
 * an address from the test server (`localhost:<port>`) instead of refusing. Both
 * messages are right; the second one is the one that matters.
 */
const test = require('node:test');
const { environment, testData } = require('./helpers/sources');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
environment({ SESSION_SECRET: 'test-secret-lang-genug-fuer-die-pruefung' });

const { buildAndRequire, mounting, ohneKommentare } = require('./helpers/sources');
const { testServer } = require('./helpers/server');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
// READ the mount from server.ts, do not copy it: a test bench with a
// fixed address stays green while the router has long been mounted elsewhere.
const AUTH = mounting('auth');
const db = testData();

const lies = rel => ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

test('1. without APP_BASE_URL no code comes — and no nonce', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run("DELETE FROM users WHERE username = 'qr_pruefling'");
  const nutzer = await db.get(
    'INSERT INTO users (username,password_hash,is_admin,email_verified) VALUES ($1,$2,false,true) RETURNING id',
    ['qr_pruefling', require('bcryptjs').hashSync('qr-passwort-1', 4)],
  );
  // Clean up AND close the pool, both here: without the `end()` the open
  // connection keeps the process alive, and `node --test` hangs after
  // the last step instead of reporting red or green. Exactly that happened when
  // writing this file.
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [nutzer.id]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { sitzung: { userId: nutzer.id, username: 'qr_pruefling', isAdmin: 0 }, t });
  const hole = () =>
    fetch(`${base}${AUTH}/qr-token`, {
      // Since the password step the route requires the own password.
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'qr-passwort-1' }),
    });
  const nonces = async () =>
    (await db.get('SELECT COUNT(*)::int AS n FROM qr_login_tokens WHERE user_id = $1', [nutzer.id])).n;

  // ── Case 1: the variable is missing ────────────────────────────────────────────
  const vorher = process.env.APP_BASE_URL;
  t.after(() => {
    if (vorher === undefined) environment({ APP_BASE_URL: undefined });
    else environment({ APP_BASE_URL: vorher });
  });
  environment({ APP_BASE_URL: undefined });

  const abgelehnt = await hole();
  assert.equal(
    abgelehnt.status,
    503,
    'Without APP_BASE_URL the route must refuse — otherwise the code carries the browser address.',
  );
  const reason = await abgelehnt.json();
  assert.equal(reason.success, false);
  assert.equal(
    reason.code,
    'qr_without_base_url',
    'The refusal does not name its reason — the interface cannot say what to do.',
  );
  assert.match(reason.error, /APP_BASE_URL/, 'The sentence for the user does not name the variable to set.');

  // THAT is the core: the refusal stands BEFORE the database access. If it stood
  // behind it, an access code would lie here that opens an account for five minutes
  // and that nobody ever redeems.
  assert.equal(await nonces(), 0, 'Despite the refusal a nonce was created — the check comes too late.');

  // ── Case 2: the variable is set ──────────────────────────────────────
  // With a surplus slash, because exactly that would otherwise come through as
  // `https://host//?set=…`.
  environment({ APP_BASE_URL: 'https://lego.example.org//' });
  const gut = await hole();
  assert.equal(gut.status, 200, 'With APP_BASE_URL a code must be created.');
  const d = await gut.json();
  assert.equal(d.url, 'https://lego.example.org', 'The server does not name the address or leaves the slash in place.');
  assert.match(d.token, /^bim:/, 'The token has lost its shape.');
  assert.equal(await nonces(), 1, 'In the good case exactly one nonce MUST be created.');
});

test('2. the web app no longer has its own opinion about the address', () => {
  const js = require('./helpers/sources').ansichtQuelle('settings');
  assert.match(js, /const serverUrl = d\.url;/, "The web app does not simply take the server's address.");
  // The fallback is gone — that was Marco's second sentence. `ohneKommentare`
  // makes sure that the explanation ABOVE (which quotes the old expression)
  // does not seemingly fulfill this assertion.
  assert.ok(!/location\.origin/.test(js), 'location.origin is still in the QR generation code.');

  // The hidden field is dropped: it only carried location.origin along and
  // was never editable. A line that nobody needs any more is a
  // place where somebody later suspects something wrong.
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(!/id="qr-server-url"/.test(html), 'The orphaned field qr-server-url is still in the markup.');
  assert.ok(!/qr-server-url/.test(js), 'The web app still reads the dropped field.');
});

test('3. one source for QR code, mail button and reset links', () => {
  // The core of Marco's first sentence: ONE address, not three. Only
  // src/infra/baseUrl.ts may read it; whoever touches process.env.APP_BASE_URL himself has
  // started a fourth notation.
  // src/infra/config.ts reads the variable (appBaseUrl, without a slash at the
  // end); baseUrl() is the one way there.
  const helper = lies('src/infra/baseUrl.ts');
  assert.match(helper, /config\(\)\.appBaseUrl/, 'src/infra/baseUrl.ts does not read the configuration.');
  assert.match(
    lies('src/infra/config.ts'),
    /APP_BASE_URL\?\.trim\(\)\.replace\(\/\\\/\+\$\/, ''\)/,
    'A trailing slash is not removed.',
  );

  for (const datei of ['src/account/loginFlow.ts', 'routes/auth/registration.ts', 'src/mail/mailer.ts']) {
    const source = lies(datei);
    assert.ok(
      !/process\.env\.APP_BASE_URL/.test(source),
      `${datei} reads APP_BASE_URL itself — that is the copy that drifts apart.`,
    );
    assert.match(source, /baseUrl\(\)/, `${datei} does not use the shared helper.`);
  }

  // The QR branch must not guess a host: for this code the same applies as
  // for a link in a mail — a guessed address is worse than
  // none. (getBaseUrl further down MAY do it, see the reasoning there.)
  const auth = lies('routes/auth/qr.ts');
  const i = auth.search(/router\.endpoint\(\s*'POST \/api\/v2\/auth\/qr-token'/);
  assert.ok(i > 0, 'The route /qr-token has disappeared — renamed?');
  const rumpf = auth.slice(i, auth.indexOf('\n  router.', i + 10));
  assert.ok(
    !/headers\['x-forwarded-host'\]|headers\.host/.test(rumpf),
    'The route falls back to the Host header — exactly what it must not do.',
  );

  // And it is documented — otherwise nobody knows that it needs to be set.
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /APP_BASE_URL/, 'README.md does not mention APP_BASE_URL.');
});
