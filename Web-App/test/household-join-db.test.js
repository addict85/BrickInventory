/**
 * Joining a household needs the invitation code and the login, no password or
 * second factor (docs/SICHERHEIT.md), and the owner gets a mail. Afterwards the
 * main account reads and writes the stock.
 *
 * Counter-checks (measured on 28.10.2026):
 *   B  the hint mail not sent → red: “linked without password, and
 *      the owner learns of it”
 * Counter-check (26.11.2026): a password check back into the route → red: “linked
 *   without password …” and “with a second factor no code either” (400 instead of 200)
 * Counter-check (measured 01.11.2026): maskAddress() bypassed in the mailer's console path
 *   → red: “linked without password, and the owner learns of it”
 * Counter-check (measured 04.11.2026): accountThrottled() removed from redeem/pruefen
 *   → red: “checking a code is throttled per account” (200 instead of 429)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const PASS = 'eigenes-Passwort-1';
const MAIN = `beitritt_haupt_${process.pid}`,
  KIND = `beitritt_kind_${process.pid}`,
  MAIN2 = `beitritt_haupt2_${process.pid}`;

test('join household', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[MAIN, KIND, MAIN2]]);
  const hash = await bcrypt.hash(PASS, 4);
  const create = async n =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
        [n, `${n}@example.org`, hash],
      )
    ).id;
  const main = await create(MAIN),
    kind = await create(KIND),
    main2 = await create(MAIN2);
  await db.run("DELETE FROM global_settings WHERE key LIKE 'smtp_%'");
  const checkCounter = () =>
    db.run('DELETE FROM rate_limit_attempts WHERE key = $1', [`haushalt-pruefen|konto:${kind}`]);
  await checkCounter();
  t.after(async () => {
    await checkCounter();
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%-bestaetigen|${kind}|%`]);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[main, kind, main2]]);
    await db.pool.end().catch(() => {});
  });
  const { createInvitation } = {
    ..._req('src/household/rules.js'),
    ..._req('src/household/household.js'),
    ...require('./helpers/sources').testArea('household'),
  };
  const { base } = testServer(_req, { session: { userId: kind }, t });
  const redeemIt = body =>
    fetch(`${base}/api/v2/settings/household/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async r => ({ status: r.status, body: await r.json() }));
  const linkedOne = async () =>
    !!(await db.get('SELECT 1 FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2', [main, kind]));

  await t.test('checking a code is throttled per account', async () => {
    const { code } = await createInvitation(main);
    const check = () =>
      fetch(`${base}/api/v2/settings/household/redeem/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      }).then(async r => ({ status: r.status, body: await r.json() }));
    const first = await check();
    assert.deepEqual([first.status, first.body.inviter?.username], [200, MAIN], JSON.stringify(first.body));
    for (let i = 1; i < 30; i++) assert.equal((await check()).status, 200, `Check ${i + 1}`);
    const r = await check();
    assert.deepEqual([r.status, r.body.code], [429, 'too_many_requests'], JSON.stringify(r.body));
    assert.equal(r.body.inviter, undefined, 'when throttled the response names nobody');
    await checkCounter();
  });

  await t.test('no link without a valid code', async () => {
    const r = await redeemIt({ code: 'XXXX-XXXX-XXXX-XXXX' });
    assert.ok(r.status >= 400 && r.status < 500, JSON.stringify(r.body));
    assert.equal(await linkedOne(), false);
  });

  await t.test('linked without password, and the owner learns about it', async () => {
    const { code } = await createInvitation(main);
    const lines = [];
    const original = console.log;
    console.log = (...a) => {
      lines.push(a.join(' '));
    };
    let r;
    try {
      r = await redeemIt({ code });
      for (let i = 0; i < 50 && !lines.some(z => z.includes('An:')); i++) await new Promise(f => setTimeout(f, 50));
    } finally {
      console.log = original;
    }
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await linkedOne(), true);
    // The console lands in app_logs: the address only stands there masked.
    assert.ok(
      lines.some(z => z.includes(`An:      ${KIND[0]}…@example.org`)),
      lines.join('\n'),
    );
    assert.ok(!lines.some(z => z.includes(`${KIND}@`)), 'the full address is in the log');
    assert.ok(
      lines.some(z => /Haushalt/.test(z)),
      'Subject is missing',
    );
  });

  await t.test('with a second factor no code either', async () => {
    const zf = _req('src/factors/secondFactor.js');
    const secret = await zf.beginSetup(kind);
    assert.ok(Array.isArray(await zf.confirmSetup(kind, zf.hotp(zf.fromBase32(secret), zf.timeStep()))));
    const { code } = await createInvitation(main2);
    // Wait for the hint mail: written to stdout late, it disturbs the test run.
    const lines = [],
      original = console.log;
    console.log = (...a) => {
      lines.push(a.join(' '));
    };
    let withIt;
    try {
      withIt = await redeemIt({ code });
      for (let i = 0; i < 50 && !lines.some(z => z.includes('An:')); i++) await new Promise(f => setTimeout(f, 50));
    } finally {
      console.log = original;
    }
    assert.equal(withIt.status, 200, JSON.stringify(withIt.body));
  });
});
