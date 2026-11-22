/**
 * Joining a household only works with the own password, and the owner
 * gets a mail. Afterwards the main account reads and writes the stock; with
 * a captured token alone this should not be settable.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  bestaetigePasswort() removed from the route → red: “without password no
 *      link”
 *   B  the hint mail not sent → red: “linked with password, and
 *      the owner learns of it”
 * Counter-check (measured 01.11.2026): code requirement removed in the route → red:
 *   “with a second factor it also needs the code”
 * Counter-check (measured 01.11.2026): maskAddress() bypassed in the mailer's console path
 *   → red: “linked with password, and the owner learns of it”
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
  HAUPT2 = `beitritt_haupt2_${process.pid}`;

test('join household', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[MAIN, KIND, HAUPT2]]);
  const hash = await bcrypt.hash(PASS, 4);
  const anlegen = async n =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
        [n, `${n}@example.org`, hash],
      )
    ).id;
  const haupt = await anlegen(MAIN),
    kind = await anlegen(KIND),
    haupt2 = await anlegen(HAUPT2);
  await db.run("DELETE FROM global_settings WHERE key LIKE 'smtp_%'");
  const pruefCounter = () =>
    db.run('DELETE FROM rate_limit_attempts WHERE key = $1', [`haushalt-pruefen|konto:${kind}`]);
  await pruefCounter();
  t.after(async () => {
    await pruefCounter();
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%-bestaetigen|${kind}|%`]);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[haupt, kind, haupt2]]);
    await db.pool.end().catch(() => {});
  });
  const { createInvitation } = {
    ..._req('src/household/rules.js'),
    ..._req('src/household/household.js'),
    ...require('./helpers/sources').testArea('household'),
  };
  const { base } = testServer(_req, { sitzung: { userId: kind }, t });
  const einloesen = body =>
    fetch(`${base}/api/v2/settings/household/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async r => ({ status: r.status, body: await r.json() }));
  const verknuepft = async () =>
    !!(await db.get('SELECT 1 FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2', [haupt, kind]));

  await t.test('checking a code is throttled per account', async () => {
    const { code } = await createInvitation(haupt);
    const pruefe = () =>
      fetch(`${base}/api/v2/settings/household/redeem/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      }).then(async r => ({ status: r.status, body: await r.json() }));
    const erste = await pruefe();
    assert.deepEqual([erste.status, erste.body.inviter?.username], [200, MAIN], JSON.stringify(erste.body));
    for (let i = 1; i < 30; i++) assert.equal((await pruefe()).status, 200, `Prüfung ${i + 1}`);
    const r = await pruefe();
    assert.deepEqual([r.status, r.body.code], [429, 'too_many_requests'], JSON.stringify(r.body));
    assert.equal(r.body.inviter, undefined, 'gebremst nennt die Antwort niemanden');
    await pruefCounter();
  });

  await t.test('no link without password', async () => {
    const { code } = await createInvitation(haupt);
    for (const body of [{ code }, { code, password: 'falsch' }]) {
      const r = await einloesen(body);
      assert.equal(r.status, 400, JSON.stringify(r.body));
      assert.equal(r.body.code, 'current_password_wrong');
    }
    assert.equal(await verknuepft(), false);
  });

  await t.test('linked with password, and the owner learns about it', async () => {
    const { code } = await createInvitation(haupt);
    const zeilen = [];
    const echt = console.log;
    console.log = (...a) => {
      zeilen.push(a.join(' '));
    };
    let r;
    try {
      r = await einloesen({ code, password: PASS });
      for (let i = 0; i < 50 && !zeilen.some(z => z.includes('An:')); i++) await new Promise(f => setTimeout(f, 50));
    } finally {
      console.log = echt;
    }
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await verknuepft(), true);
    // The console lands in app_logs: the address only stands there masked.
    assert.ok(
      zeilen.some(z => z.includes(`An:      ${KIND[0]}…@example.org`)),
      zeilen.join('\n'),
    );
    assert.ok(!zeilen.some(z => z.includes(`${KIND}@`)), 'die volle Adresse steht im Protokoll');
    assert.ok(
      zeilen.some(z => /Haushalt/.test(z)),
      'Betreff fehlt',
    );
  });

  await t.test('with a second factor the code is needed too', async () => {
    const zf = _req('src/factors/secondFactor.js');
    const geheim = await zf.beginSetup(kind);
    const codes = await zf.confirmSetup(kind, zf.hotp(zf.fromBase32(geheim), zf.timeStep()));
    const { code } = await createInvitation(haupt2);
    const ohne = await einloesen({ code, password: PASS });
    assert.equal(ohne.status, 400, JSON.stringify(ohne.body));
    assert.equal(ohne.body.code, 'second_factor_required');
    // Wait for the hint mail: written to stdout late, it disturbs the test run.
    const zeilen = [],
      echt = console.log;
    console.log = (...a) => {
      zeilen.push(a.join(' '));
    };
    let mit;
    try {
      mit = await einloesen({ code, password: PASS, factor_code: codes[0] });
      for (let i = 0; i < 50 && !zeilen.some(z => z.includes('An:')); i++) await new Promise(f => setTimeout(f, 50));
    } finally {
      console.log = echt;
    }
    assert.equal(mit.status, 200, JSON.stringify(mit.body));
  });
});
