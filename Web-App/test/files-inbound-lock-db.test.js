/**
 * Files, images and image proxy stand before the /api/v1 entrance; the locks
 * “password change needed” and “2nd factor mandatory for administrators” apply anyway.
 *
 * Counter-checks (measured on 08.11.2026):
 *   A  inboundLock deleted from the two file routes in routes/dataFiles.ts
 *      → red: uploads and instructions in “password change” and
 *      “administrator without second factor” (200 instead of 403)
 *   B  inboundLock deleted from registerImgProxy → red: the same
 *      subtests for the image proxy (no longer 403)
 *   C  check secondFactorRequired deleted in inboundLock → red:
 *      “administrator without second factor”, “password change” stays green
 *   D  (09.11.2026) in routes/pages.ts the image route again without
 *      requireLoginOrToken, inboundLock → red: both lock subtests for
 *      /images/parts/probe.png (200 instead of 403)
 *
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WURZEL = fs.mkdtempSync(path.join(os.tmpdir(), 'datei-sperre-'));
fs.writeFileSync(path.join(WURZEL, 'package.json'), '{}');
process.env.APP_ROOT = WURZEL;
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();

const NAMEN = ['ds_normal', 'ds_wechsel', 'ds_chef', 'ds_chef2fa'].map(n => `${n}_${process.pid}`);

test('files and image proxy: entrance locks', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  const ids = [];
  for (const n of NAMEN)
    ids.push(
      (
        await db.get(
          `INSERT INTO users (username, password_hash, is_active, email_verified)
                            VALUES ($1, 'x', true, true) RETURNING id`,
          [n],
        )
      ).id,
    );
  const [normal, wechsel, chef, boss2fa] = ids;
  await db.run('UPDATE users SET must_change_password = TRUE WHERE id = $1', [wechsel]);
  await db.run('UPDATE users SET is_admin = TRUE WHERE id = ANY($1)', [[chef, boss2fa]]);
  await db.run(`INSERT INTO second_factor (user_id, secret, active) VALUES ($1, 'x', TRUE)`, [boss2fa]);
  for (const id of ids) {
    fs.mkdirSync(path.join(WURZEL, 'data', 'uploads', String(id)), { recursive: true });
    fs.writeFileSync(path.join(WURZEL, 'data', 'uploads', String(id), 'a.pdf'), `pdf von ${id}`);
  }
  const SN = `8${process.pid % 100000}-1`;
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [normal, SN]);
  fs.mkdirSync(path.join(WURZEL, 'data', 'instructions'), { recursive: true });
  fs.writeFileSync(path.join(WURZEL, 'data', 'instructions', `${SN}_1.pdf`), '%PDF-1.4');
  fs.mkdirSync(path.join(WURZEL, 'data', 'images', 'parts'), { recursive: true });
  fs.writeFileSync(path.join(WURZEL, 'data', 'images', 'parts', 'probe.png'), 'kein echtes png');

  const sitzung = {};
  const { app, base } = testServer(_req, { sitzung, t });
  _req('routes/imgProxy.js').registerImgProxy(app, require('./helpers/sources').testServices());
  app.use('/', _req('routes/pages.js').buildPagesRouter(require('./helpers/sources').testServices()));
  const hole = async (uid, weg) => {
    const k = await db.get('SELECT is_admin FROM users WHERE id = $1', [uid]);
    Object.assign(sitzung, { userId: uid, isAdmin: k.is_admin === true });
    delete sitzung.mussPasswortAendern;
    const r = await fetch(base + weg);
    return { status: r.status, body: await r.text() };
  };
  const image = 'url=https%3A%2F%2Fcdn.rebrickable.com%2Fx.jpg';
  const pathList = uid => [
    `/data/uploads/${uid}/a.pdf`,
    `/data/instructions/${SN}_1.pdf`,
    `/api/v1/img-proxy?${image}`,
    `/api/img-proxy?${image}`,
    '/images/parts/probe.png',
  ];

  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.pool.end().catch(() => {});
    fs.rmSync(WURZEL, { recursive: true, force: true });
  });

  await t.test('password change required locks files and image proxy', async () => {
    for (const weg of pathList(wechsel)) {
      const r = await hole(wechsel, weg);
      assert.equal(r.status, 403, `${weg}: ${r.body}`);
      assert.match(r.body, /password_change_required/, weg);
    }
  });

  await t.test('an admin without a second factor is locked', async () => {
    for (const weg of pathList(chef)) {
      const r = await hole(chef, weg);
      assert.equal(r.status, 403, `${weg}: ${r.body}`);
      assert.match(r.body, /second_factor_mandatory/, weg);
    }
  });

  await t.test('an ordinary account and an admin with a second factor get through', async () => {
    assert.equal((await hole(normal, `/data/uploads/${normal}/a.pdf`)).status, 200);
    assert.equal((await hole(normal, `/data/instructions/${SN}_1.pdf`)).status, 200);
    assert.equal((await hole(normal, '/images/parts/probe.png')).status, 200);
    assert.equal((await hole(boss2fa, `/data/uploads/${boss2fa}/a.pdf`)).status, 200);
    // 400 only comes from the proxy itself: the lock let the administrator through.
    assert.equal((await hole(boss2fa, '/api/v1/img-proxy?url=http%3A%2F%2Fnein')).status, 400);
  });
});
