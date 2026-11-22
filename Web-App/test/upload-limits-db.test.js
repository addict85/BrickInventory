/**
 * A file that is too large gets 413, a wrong file type 415 — each with a
 * code, so that web and app say „zu gross“ instead of „Interner Serverfehler“.
 * Measured on the real server, because the mapping applies in the global error path of
 * server.ts: multer reports its limits without a status.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  asUploadError() not called in handleRouteError() → red:
 *      “too large: 413 with code” (500 instead of 413, voucher and wanted list)
 *   B  in the fileFilter of the vouchers again `new Error('pdf_only')` → red:
 *      “wrong type: 415 with code” (500 instead of 415)
 *   C  in the fileFilter of the instructions again `new Error('Nur PDF, JPG oder
 *      PNG')` → red: “wrong type: 415 with code” (500 instead of 415)
 * Counter-checks (measured 01.11.2026):
 *   D  the path-specific parser removed in server.ts (state before: limit only in the
 *      PDF router, behind the general one) → red: “the parts list of the
 *      PDF job may be larger” (413 instead of 200)
 *   E  its limit on all paths (app.use instead of app.post on the path) → red:
 *      “… other routes not” (200 instead of 413)
 * Counter-checks (measured 04.11.2026):
 *   F  readBody again before session and entrance (server.ts) → red: “without
 *      login no body is read” and “the parts list …” (before the
 *      session every request counts as not logged in)
 *   G  the 16 KB limit for those not logged in deleted in readBody → red:
 *      “… and on the login routes at most 16 KB” (401 instead of 413)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { warte } = require('./helpers/time');
const { portOf } = require('./helpers/server');
const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = portOf(s);
      s.close(() => r(p));
    });
  });

test('upload limits', { concurrency: 1, timeout: 180_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NAME = `upload_${process.pid}`,
    SN = `UG${process.pid}-1`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(`INSERT INTO users (username, password_hash, is_active) VALUES ($1,'x',true) RETURNING id`, [NAME])
  ).id;
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [uid, SN]);
  const token = await _req('src/account/deviceToken.js').createToken(uid, 'Prüfung', true);
  t.after(async () => {
    await db.run("DELETE FROM jobs WHERE type = 'pdf' AND user_id = $1", [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'upload-test-geheimnis-lang-genug-1234',
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
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  for (let i = 0; i < 240 && !/localhost:\d+|Startup complete/.test(log); i++) await warte(250);
  for (let i = 0; i < 40 && (await fetch(`http://127.0.0.1:${port}/api/v2/health`).catch(() => null)) === null; i++)
    await warte(250);

  const sende = async (path, inhalt, typ, name) => {
    const form = new FormData();
    form.append('file', new Blob([inhalt], { type: typ }), name);
    const r = await fetch(`http://127.0.0.1:${port}/api/v2${path}`, {
      method: 'POST',
      body: form,
      headers: { Authorization: `Bearer ${token}` },
    });
    const rumpf = await r.json().catch(() => null);
    return { status: r.status, code: rumpf?.code, json: rumpf !== null };
  };
  const pdf = bytes => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(bytes, 0x20)]);

  await t.test('too large: 413 with code', async () => {
    assert.deepEqual(
      {
        gutschein: await sende('/vouchers/pdf', pdf(3 * 1024 * 1024), 'application/pdf', 'g.pdf'),
        wanted: await sende('/wanted-list/import/xml', Buffer.alloc(5 * 1024 * 1024, 0x20), 'text/xml', 'w.xml'),
      },
      {
        gutschein: { status: 413, code: 'file_too_large', json: true },
        wanted: { status: 413, code: 'file_too_large', json: true },
      },
    );
  });

  await t.test('wrong type: 415 with code', async () => {
    assert.deepEqual(
      {
        gutschein: await sende('/vouchers/pdf', 'kein pdf', 'text/plain', 'g.txt'),
        anleitung: await sende(`/sets/${SN}/instructions/upload`, 'kein pdf', 'text/plain', 'a.txt'),
      },
      {
        gutschein: { status: 415, code: 'pdf_only', json: true },
        anleitung: { status: 415, code: 'file_type_wrong', json: true },
      },
    );
  });

  const json = async (path, rumpf) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/v2${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(rumpf),
    });
    const j = await r.json().catch(() => null);
    return { status: r.status, code: j?.code ?? null };
  };
  // About 1 MB: 3000 items in the form that web and app send.
  const parts = Array.from({ length: 3000 }, (_, i) => ({
    part_number: `3001-${i}`,
    bl_part_number: `3001-${i}`,
    part_name: 'Brick 2 x 4 '.repeat(14),
    color_name: 'Bright Red',
    color_hex: 'C91A09',
    color_id: 4,
    quantity: 2,
    image_url: `https://cdn.rebrickable.com/media/parts/elements/${300121 + i}.jpg`,
    image_local: null,
    is_fig: false,
  }));

  await t.test('the parts list of the PDF job may be larger than 256 KB', async () => {
    assert.ok(JSON.stringify({ parts: parts }).length > 900 * 1024);
    assert.deepEqual(await json('/sets/partslist-pdf', { sets: [{ set_number: SN }], parts: parts }), {
      status: 200,
      code: null,
    });
    const huge = Array.from({ length: 4 }, () => parts).flat();
    assert.equal(
      (await json('/sets/partslist-pdf', { sets: [], parts: huge })).status,
      413,
      'above 4 MB stays too large',
    );
  });

  await t.test('… other routes not', async () => {
    assert.deepEqual(await json('/settings', { currency: 'EUR', ballast: parts }), {
      status: 413,
      code: 'request_too_large',
    });
  });

  const anonym = async (path, rumpf) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/v2${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rumpf,
    });
    const j = await r.json().catch(() => null);
    return { status: r.status, code: j?.code ?? null };
  };

  await t.test('without login no body is read', async () => {
    // Broken JSON: read, it would give 400; unread it stays at the entrance's 401.
    assert.equal((await anonym('/sets/partslist-pdf', '{' + ' '.repeat(1024 * 1024))).status, 401);
  });

  await t.test('… and on the login routes at most 16 KB', async () => {
    // The ballast in the field `label`: an unknown field would already be 400 before login.
    const mit = n => JSON.stringify({ username: 'niemand', password: 'x'.repeat(20), label: 'y'.repeat(n) });
    assert.equal((await anonym('/auth/login', mit(10 * 1024))).status, 401, 'an ordinary login fits');
    assert.deepEqual(await anonym('/auth/login', mit(20 * 1024)), { status: 413, code: 'request_too_large' });
  });
});
