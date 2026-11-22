/**
 * One password rule for every path that sets a password: registration,
 * changing, resetting, creating an account and setting a password by the
 * admin, the start password from ADMIN_PASSWORD. Rejected are passwords that are too short,
 * oversized (more than 1024 characters) and common or known from
 * data leaks (shipped list, no network query).
 *
 * Counter-checks (measured 01.11.2026):
 *   A  list check deleted in passwordLack() → red: all cases,
 *      first “common passwords …” (all five routes accept the common one)
 *   B  byte limit deleted → red: “the rule itself” and “more than 72
 *      bytes …” (afterwards “a good password …”: the account already exists)
 *      (14.11.2026, argon2id: limit 1024 characters; length check deleted → red:
 *      “the rule itself” and “oversized passwords …”)
 *   E  (14.11.2026) hashe() in src/account/accounts.ts again bcrypt with 12 rounds → red:
 *      “every path hashes with the same costs” (four paths „anders“ instead of argon2id)
 *   C  /reset-password again only checks the length → red: “common
 *      passwords …” and “more than 72 bytes …” (only this route accepts it)
 *   D  src/account/startAdmin.ts takes ADMIN_PASSWORD unchecked → red: “a weak
 *      ADMIN_PASSWORD …”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL (the last case recreates the
 * schema).
 */
const test = require('node:test');
const { environment, testData } = require('./helpers/sources');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
environment({ APP_BASE_URL: 'http://localhost' });
environment({ ADMIN_PASSWORD: undefined });

const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { routerServer } = require('./helpers/server');
const { mailAttrappe, enterMailServer } = require('./helpers/mail-fake');
mailAttrappe();
const db = testData();
const { passwordLack } = _req('src/infra/passwordRule.js');
const { passwordFits, ARGON2_PREFIX } = _req('src/account/passwordHash.js');

test('the rule itself', () => {
  assert.equal(passwordLack('Brick-Sammlung-2026'), null);
  assert.equal(passwordLack('1234567'), 'password_too_short');
  // Since 04.11.2026 at least 12 characters: the common ones below already fail on the length.
  assert.equal(passwordLack('password1'), 'password_too_short');
  for (const p of ['ichliebedich', 'Sonnenschein', 'SONNENSCHEIN'])
    assert.equal(passwordLack(p), 'password_too_common', p);
  assert.equal(
    passwordLack('Mein-Name-Ist-Lego', 'mein-name-ist-lego'),
    'password_too_common',
    'der Benutzername als Passwort',
  );
  // argon2id reads the whole password: long sentences and umlauts work, only oversize does not.
  assert.equal(passwordLack('ä'.repeat(1024)), null, '1024 Zeichen gehen noch');
  assert.equal(passwordLack('a'.repeat(1025)), 'password_too_long');
});

test('password rule on all paths', { concurrency: 1, timeout: 120_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const CHEF = `regel_chef_${process.pid}`,
    ZIEL = `regel_ziel_${process.pid}`,
    PASS = 'Regel-Pruefung-7';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[CHEF, ZIEL]]);
  const hash = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs')).hashSync(PASS, 4);
  const chef = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, true, true, true) RETURNING id`,
      [CHEF, hash],
    )
  ).id;
  const ziel = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, $2, true, true) RETURNING id`,
      [ZIEL, hash],
    )
  ).id;
  const regBefore = await db.get("SELECT value FROM global_settings WHERE key = 'registration_enabled'");
  await db.run(
    "INSERT INTO global_settings (key, value) VALUES ('registration_enabled', '1') ON CONFLICT (key) DO UPDATE SET value = '1'",
  );
  const mailBack = await enterMailServer(db);
  t.after(async () => {
    await db.run("DELETE FROM global_settings WHERE key = 'registration_enabled'");
    if (regBefore)
      await db.run("INSERT INTO global_settings (key, value) VALUES ('registration_enabled', $1)", [regBefore.value]);
    await mailBack();
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[chef, ziel]]);
  });
  const { base } = routerServer(_req, {
    sitzung: { userId: chef, username: CHEF, isAdmin: true },
    routen: { '/api/v2/auth': 'routes/auth.js' },
    t,
  });
  /** @param {string} pw @returns {[string, string, object][]} */
  const wege = pw => [
    [
      'POST',
      '/register',
      { username: `regel_neu_${process.pid}`, email: `regel_${process.pid}@example.org`, password: pw },
    ],
    ['POST', '/change-password', { current: PASS, newPassword: pw }],
    ['POST', '/reset-password', { token: 'a'.repeat(64), password: pw }],
    ['POST', '/users', { username: `regel_vw_${process.pid}`, password: pw, admin_password: PASS }],
    ['PUT', `/users/${ziel}/password`, { password: pw, admin_password: PASS }],
  ];
  const ruf = async ([methode, path, rumpf]) => {
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'register|%' OR key LIKE 'reset-password|%'");
    const r = await fetch(`${base}/api/v2/auth${path}`, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rumpf),
    });
    const b = await r.json();
    return `${path} ${r.status} ${b.code ?? ''}`;
  };

  await t.test('common passwords are rejected on all five paths', async () => {
    const ist = [];
    for (const w of wege('sonnenschein')) ist.push(await ruf(w));
    assert.deepEqual(
      ist,
      wege('').map(([, p]) => `${p} 400 password_too_common`),
    );
    const text = (
      await (
        await fetch(`${base}/api/v2/auth/reset-password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: 'x', password: 'ICHLIEBEDICH' }),
        })
      ).json()
    ).error;
    assert.match(text, /zu häufig oder aus Datenlecks bekannt/);
  });

  // Above 1024 characters the contract already rejects (input_invalid), otherwise the rule.
  await t.test('oversized passwords are rejected', async () => {
    const ist = [];
    for (const w of wege('Ä'.repeat(1025))) ist.push((await ruf(w)).replace(/ \S*$/, ''));
    assert.deepEqual(
      ist,
      wege('').map(([, p]) => `${p} 400`),
    );
  });

  await t.test('a good password goes through', async () => {
    assert.equal(await ruf(wege('Brick-Sammlung-2026')[3]), '/users 200 ');
    await db.run('DELETE FROM users WHERE username = $1', [`regel_vw_${process.pid}`]);
  });

  // The login searches in name AND address: a foreign address as a name would pull its login to itself.
  // Counter-check (measured 11.11.2026): /register also allows an address next to USERNAME_RE → red.
  await t.test('registration takes no address as username', async () => {
    assert.equal(
      await ruf([
        'POST',
        '/register',
        {
          username: `regel_${process.pid}@example.org`,
          email: `regel_${process.pid}@example.org`,
          password: 'Brick-Sammlung-2026',
        },
      ]),
      '/register 400 username_invalid',
    );
  });

  // Counter-checks (measured 02.11.2026): in /change-password again
  // req.session?.username → red (200 for the own name); in
  // /users/:id/password again without names → red (200 for the name of the target).
  await t.test('the username is no password, even without a name in the session', async () => {
    const app = routerServer(_req, {
      sitzung: { userId: chef, isAdmin: true },
      routen: { '/api/v2/auth': 'routes/auth.js' },
      t,
    });
    const setze = (methode, path, rumpf) =>
      fetch(`${app.base}/api/v2/auth${path}`, {
        method: methode,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(rumpf),
      }).then(async r => `${r.status} ${(await r.json()).code ?? ''}`);
    assert.equal(
      await setze('POST', '/change-password', { current: PASS, newPassword: CHEF.toUpperCase() }),
      '400 password_too_common',
    );
    assert.equal(
      await setze('PUT', `/users/${ziel}/password`, { password: ZIEL, admin_password: PASS }),
      '400 password_too_common',
    );
    assert.ok(
      await passwordFits(PASS, (await db.get('SELECT password_hash FROM users WHERE id = $1', [ziel])).password_hash),
    );
  });

  // Counter-check (measured 05.11.2026): in /reset-password the second check
  // with user.username deleted → red (200, the password is the name).
  await t.test('reset: the username is no password', async () => {
    const roh = 'b'.repeat(64);
    await db.run(`UPDATE users SET reset_token = $2, reset_token_expires = NOW() + interval '1 hour' WHERE id = $1`, [
      ziel,
      require('node:crypto').createHash('sha256').update(roh).digest('hex'),
    ]);
    assert.equal(
      await ruf(['POST', '/reset-password', { token: roh, password: ZIEL.toUpperCase() + '-x' }]).then(
        r => r.split(' ')[1],
      ),
      '200',
      'ein anderes Passwort geht (Prüfung des Tokens)',
    );
    await db.run(`UPDATE users SET reset_token = $2, reset_token_expires = NOW() + interval '1 hour' WHERE id = $1`, [
      ziel,
      require('node:crypto').createHash('sha256').update(roh).digest('hex'),
    ]);
    assert.equal(
      await ruf(['POST', '/reset-password', { token: roh, password: ZIEL.toUpperCase() }]),
      '/reset-password 400 password_too_common',
    );
    assert.ok(
      !(await passwordFits(
        ZIEL.toUpperCase(),
        (
          await db.get('SELECT password_hash FROM users WHERE id = $1', [ziel])
        ).password_hash,
      )),
    );
  });

  // Counter-check (measured 11.11.2026): changeOwnPassword() (src/account/loginFlow.ts)
  // lets password_too_short through → red (/change-password 200 instead of 400).
  await t.test('passwords that are too short are rejected on all five paths', async () => {
    const ist = [];
    for (const w of wege('Kurz-12345')) ist.push(await ruf(w));
    assert.deepEqual(
      ist,
      wege('').map(([, p]) => `${p} 400 password_too_short`),
    );
  });

  // Counter-check (measured 11.11.2026, bcrypt back then): in setForeignPassword (src/account/accounts.ts)
  // hashed with 4 instead of BCRYPT_ROUNDS → red (PUT /users/:id/password: 4); since argon2id see E in the header.
  await t.test('every path hashes with the same costs', async () => {
    const NEU = `regel_neu_${process.pid}`,
      VW = `regel_vw_${process.pid}`;
    t.after(() => db.run('DELETE FROM users WHERE username = ANY($1)', [[NEU, VW]]));
    const roh = 'c'.repeat(64);
    await db.run(`UPDATE users SET reset_token = $2, reset_token_expires = NOW() + interval '1 hour' WHERE id = $1`, [
      ziel,
      require('node:crypto').createHash('sha256').update(roh).digest('hex'),
    ]);
    const runden = async name =>
      (await db.get('SELECT password_hash FROM users WHERE username = $1', [name])).password_hash.startsWith(
        ARGON2_PREFIX,
      )
        ? 'argon2id'
        : 'anders';
    // Above 72 bytes: bcrypt would have cut off the rest, the old rule rejected it.
    const gut = `Brick-Sammlung-2026-${'ä'.repeat(40)}`;
    // The own password last: the paths before it confirm with PASS.
    /** @type {[string, string, object, string][]} */
    const steps = [
      ['POST', '/register', { username: NEU, email: `regel_${process.pid}@example.org`, password: gut }, NEU],
      ['POST', '/reset-password', { token: roh, password: gut }, ZIEL],
      ['POST', '/users', { username: VW, password: gut, admin_password: PASS }, VW],
      ['PUT', `/users/${ziel}/password`, { password: gut, admin_password: PASS }, ZIEL],
      ['POST', '/change-password', { current: PASS, newPassword: gut }, CHEF],
    ];
    const ist = [];
    for (const [methode, path, rumpf, name] of steps) {
      const response = await ruf([methode, path, rumpf]);
      ist.push(`${response.split(' ')[0]} ${response.split(' ')[1]} ${await runden(name)}`);
    }
    assert.deepEqual(
      ist,
      ['/register', '/reset-password', '/users', `/users/${ziel}/password`, '/change-password'].map(
        p => `${p} 200 argon2id`,
      ),
    );
  });

  await t.test('a weak ADMIN_PASSWORD is not adopted', async () => {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    environment({ ADMIN_PASSWORD: 'passwort123' });
    const echt = { log: console.log, warn: console.warn },
      warnings = [];
    console.log = () => {};
    console.warn = (...a) => warnings.push(a.join(' '));
    try {
      await db.initSchema();
    } finally {
      Object.assign(console, echt);
      environment({ ADMIN_PASSWORD: undefined });
    }
    const admin = await db.get("SELECT password_hash, must_change_password FROM users WHERE username = 'admin'");
    assert.equal(await passwordFits('passwort123', admin.password_hash), false, 'das schwache Passwort gilt');
    assert.equal(admin.must_change_password, true);
    assert.ok(
      warnings.some(w => /ADMIN_PASSWORD wird nicht verwendet/.test(w)),
      warnings.join('\n'),
    );
  });
  t.after(() => db.pool.end().catch(() => {}));
});
