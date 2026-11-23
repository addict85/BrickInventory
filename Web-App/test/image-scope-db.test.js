/**
 * Instructions only exist for sets in the own view (household
 * included); a foreign one answers like a missing one (404). Set and
 * part images are catalog and go to every logged-in account (decision
 * on migration 0105). The real server is asked with real files under data/.
 *
 * Counter-checks (measured 01.11.2026, A and E anew on 10.11.2026):
 *   A  imageReleased() checks sets/ against the view again
 *      (`inScope(uid, stamm, 'nummern')`) → red: “set images go to every
 *      logged-in account” (404 instead of 200)
 *   B  instructionReleased() removed in routes/dataFiles.ts → red:
 *      “instructions only for own sets” (200 instead of 404)
 *   C  imageReleased() only lets sets/ through (parts checked like sets) → red:
 *      “part images are catalog” (404)
 *   D  scopeIds() replaced by [uid] → red: “instructions only for own sets”
 *   E  in setInfoForAccount() (src/sets/content.ts) image_local for sets outside
 *      the view back to null → red: “the API names the local image of every set”
 *   F  atHouseholdChange() not called in bildBlickfeld.ts (60 s
 *      hit deadline stays) → red: “after unlinking …” (200 instead of 404)
 *   G  (08.11.2026) deliverImage without the 401 line or with `public` instead of
 *      `private` → red: “without login no image …”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
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
const { catalogSet } = require('./helpers/inventory');
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { sleep } = require('./helpers/time');
const { portOf } = require('./helpers/server');
const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = portOf(s);
      s.close(() => r(p));
    });
  });

const P = process.pid;
const SN = { sub: `BBU${P}-1`, fremd: `BBF${P}-1`, remembered: `BBW${P}-1`, none: `BBX${P}-1` };
const PART = `BBT${P}_0.png`;
const DATA = path.join(ROOT, 'data');
const FILES = [
  ['images/sets', `${SN.sub}.jpg`],
  ['images/sets', `${SN.sub}_thumb.jpg`],
  ['images/sets', `${SN.fremd}.jpg`],
  ['images/sets', `${SN.remembered}.jpg`],
  ['images/parts', PART],
  ['instructions', `${SN.sub}_1.pdf`],
  ['instructions', `${SN.fremd}_1.pdf`],
  ['instructions', `${SN.remembered}_bdp.pdf`],
].map(([o, n]) => path.join(DATA, o, n));

test('images and instructions in scope', { concurrency: 1, timeout: 180_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const names = ['bb_haupt', 'bb_unter', 'bb_fremd'].map(n => `${n}_${P}`);
  await db.run('DELETE FROM users WHERE username = ANY($1)', [names]);
  const ids = [];
  for (const n of names)
    ids.push(
      (
        await db.get(
          `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, 'x', true, true) RETURNING id`,
          [n],
        )
      ).id,
    );
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [ids[0], ids[1]]);
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2), ($3, $4)', [ids[1], SN.sub, ids[2], SN.fremd]);
  await db.run('INSERT INTO wanted (user_id, set_number) VALUES ($1, $2)', [ids[0], SN.remembered]);
  for (const sn of [SN.sub, SN.fremd]) await catalogSet(db, sn, { name: sn, image_local: `/images/sets/${sn}.jpg` });
  for (const f of FILES) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `Inhalt ${path.basename(f)}`);
  }
  const auth = _req('src/account/deviceToken.js');
  const token = {};
  for (const [k, id] of [
    ['haupt', ids[0]],
    ['sub', ids[1]],
    ['fremd', ids[2]],
  ])
    token[k] = await auth.createToken(id, 'Prüfung', true);
  t.after(async () => {
    for (const f of FILES) fs.rmSync(f, { force: true });
    await db.run('DELETE FROM rb_sets WHERE set_num = ANY($1)', [[SN.sub, SN.fremd]]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'blickfeld-test-geheimnis-lang-genug-1234',
      PORT: String(port),
      TRUST_PROXY: 'false',
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
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await sleep(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  for (let i = 0; i < 240 && !/localhost:\d+|Startup complete/.test(log); i++) await sleep(250);
  for (let i = 0; i < 40 && (await fetch(`http://127.0.0.1:${port}/api/v2/health`).catch(() => null)) === null; i++)
    await sleep(250);

  const hole = async (who, route) => {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, {
      redirect: 'manual',
      headers: { Authorization: `Bearer ${token[who]}` },
    });
    return { status: r.status, text: await r.text() };
  };
  const image = (sn, extra = '') => `/images/sets/${sn}${extra}.jpg`;

  await t.test('without login no image and no instruction, and images only cached privately', async () => {
    for (const route of [image(SN.sub), `/images/parts/${PART}`, `/data/instructions/${SN.sub}_1.pdf`]) {
      const r = await fetch(`http://127.0.0.1:${port}${route}`, { redirect: 'manual' });
      const text = await r.text();
      assert.ok([401, 403].includes(r.status), `${route} without sign-in: ${r.status}`);
      assert.doesNotMatch(text, /^Inhalt /, `${route} delivered the file without sign-in`);
    }
    const r = await fetch(`http://127.0.0.1:${port}${image(SN.sub)}`, {
      headers: { Authorization: `Bearer ${token.sub}` },
    });
    await r.text();
    assert.match(
      String(r.headers.get('cache-control')),
      /^private\b/,
      'Images behind a sign-in must not be cached as public',
    );
  });

  await t.test('the own set image including preview', async () => {
    assert.equal((await hole('sub', image(SN.sub))).status, 200);
    assert.equal((await hole('sub', image(SN.sub, '_thumb'))).text, `Inhalt ${SN.sub}_thumb.jpg`);
    assert.equal((await hole('fremd', image(SN.fremd))).status, 200);
  });

  await t.test('set images go to every logged-in account', async () => {
    for (const [who, sn] of [
      ['haupt', SN.sub],
      ['haupt', SN.remembered],
      ['sub', SN.remembered],
      ['haupt', SN.fremd],
    ]) {
      const r = await hole(who, image(sn));
      assert.deepEqual(r, { status: 200, text: `Inhalt ${sn}.jpg` }, `${who} → ${sn}`);
    }
    assert.equal((await hole('fremd', image(SN.sub, '_thumb'))).status, 200);
    assert.equal((await hole('haupt', image(SN.none))).status, 404, 'a missing file stays 404');
  });

  await t.test('part images are catalog', async () => {
    assert.equal((await hole('fremd', `/images/parts/${PART}`)).status, 200);
  });

  await t.test('instructions only for own sets', async () => {
    assert.equal((await hole('haupt', `/data/instructions/${SN.sub}_1.pdf`)).status, 200);
    assert.equal((await hole('fremd', `/data/instructions/${SN.fremd}_1.pdf`)).status, 200);
    const fremd = await hole('haupt', `/data/instructions/${SN.fremd}_1.pdf`);
    assert.equal(fremd.status, 404);
    assert.deepEqual(fremd, await hole('haupt', `/data/instructions/${SN.none}_1.pdf`));
    assert.equal(
      (await hole('haupt', `/data/instructions/${SN.remembered}_bdp.pdf`)).status,
      404,
      'remembered is not owned',
    );
  });

  await t.test('the API names the local image of every set', async () => {
    const info = async sn => JSON.parse((await hole('haupt', `/api/v2/sets/info/${sn}`)).text);
    assert.equal((await info(SN.sub)).image_local, `/images/sets/${SN.sub}.jpg`);
    assert.equal((await info(SN.fremd)).image_local, `/images/sets/${SN.fremd}.jpg`);
  });

  await t.test('after unlinking, the main account immediately no longer sees the instruction', async () => {
    assert.equal(
      (await hole('haupt', `/data/instructions/${SN.sub}_1.pdf`)).status,
      200,
      'before: in the cache as a hit',
    );
    const r = await fetch(`http://127.0.0.1:${port}/api/v2/settings/household/unlink`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.sub}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ main_user_id: ids[0] }),
    });
    assert.equal(r.status, 200, await r.text());
    assert.equal((await hole('haupt', `/data/instructions/${SN.sub}_1.pdf`)).status, 404);
    assert.equal((await hole('haupt', image(SN.sub))).status, 200, 'the set image stays catalog');
  });
});
