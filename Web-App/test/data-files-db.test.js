/**
 * Uploaded instructions: the household reads along, strangers do not — not even
 * via a slash hidden as %2F in the segment.
 *
 * Express decodes %2F only after splitting at the slash. From
 * `/data/uploads/x%2F..%2F7/a.pdf` the segment becomes `x/../7`; the old
 * owner check read no number from it and let the request through.
 *
 * Counter-checks (measured on 27.10.):
 *   A  the old check (parseInt on segments[0], NaN = no check, segments
 *      only checked for '..') → red: “%2F in the segment" (200 instead of 404) and
 *      “no user folder" (200 instead of 404)
 *   B  scopeIds query removed (own ID only) → red: “main account reads sub-account"
 *   C  (28.10.) the administrator exception rebuilt → red: “not even an
 *      administrator reads foreign uploads"
 *   D  (03.11.) for foreign accounts again 403 “Kein Zugriff” → red: “foreign and
 *      missing answer the same” and the three subtests before
 *   E  (05.11.) asAttachment() removed in both routes → red: “as attachment in
 *      a sandbox” (both paths, header missing)
 *   F  (08.11.) seesAccount reads via scopeIds (memory) again → red:
 *      “an unlinked sub-account is no longer readable immediately” (200 instead of 404)
 *   G  (22.11.) no-store set inside the handler again (after the guards) → red:
 *      “without login, and no answer goes into a cache” (the 401 without the header)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// An own data directory before appPaths is loaded.
const WURZEL = fs.mkdtempSync(path.join(os.tmpdir(), 'daten-dateien-'));
fs.writeFileSync(path.join(WURZEL, 'package.json'), '{}');
process.env.APP_ROOT = WURZEL;
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();

const NAMEN = ['dd_haupt', 'dd_unter', 'dd_fremd'].map(n => `${n}_${process.pid}`);

test('uploads: household yes, strangers no, %2F never', { concurrency: 1 }, async t => {
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
  const [H, U, F] = ids;
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [H, U]);
  for (const id of [H, U]) {
    fs.mkdirSync(path.join(WURZEL, 'data', 'uploads', String(id)), { recursive: true });
    fs.writeFileSync(path.join(WURZEL, 'data', 'uploads', String(id), 'a.pdf'), `pdf von ${id}`);
  }
  fs.writeFileSync(path.join(WURZEL, 'data', 'uploads', 'lose.pdf'), 'ohne Benutzerordner');
  const SN = `7${process.pid % 100000}-1`;
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [H, SN]);
  fs.mkdirSync(path.join(WURZEL, 'data', 'instructions'), { recursive: true });
  fs.writeFileSync(path.join(WURZEL, 'data', 'instructions', `${SN}_1.pdf`), '%PDF-1.4\n<html><script>x</script>');

  const sitzung = {};
  const { base } = testServer(_req, { sitzung, t });
  const hole = async (als, weg, verwalter = false) => {
    sitzung.userId = als;
    sitzung.isAdmin = verwalter;
    const r = await fetch(base + weg);
    return { status: r.status, text: await r.text(), kopf: r.headers };
  };

  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.pool.end().catch(() => {});
    fs.rmSync(WURZEL, { recursive: true, force: true });
  });

  await t.test('the own file', async () => {
    const r = await hole(H, `/data/uploads/${H}/a.pdf`);
    assert.equal(r.status, 200);
    assert.equal(r.text, `pdf von ${H}`);
  });

  await t.test('main account reads sub-account', async () => {
    const r = await hole(H, `/data/uploads/${U}/a.pdf`);
    assert.equal(r.status, 200, 'The main account sees the instruction of the sub-account and must be able to open it');
  });

  await t.test('sub-account does not read main account', async () => {
    assert.equal((await hole(U, `/data/uploads/${H}/a.pdf`)).status, 404);
  });

  await t.test('strangers do not read', async () => {
    assert.equal((await hole(F, `/data/uploads/${H}/a.pdf`)).status, 404);
  });

  await t.test('foreign and missing answer the same', async () => {
    const withoutHeader = ({ kopf, ...r }) => {
      void kopf;
      return r;
    };
    const fremd = await hole(F, `/data/uploads/${H}/a.pdf`);
    const fehlt = await hole(F, `/data/uploads/${F}/gibt-es-nicht.pdf`);
    assert.deepEqual(withoutHeader(fremd), withoutHeader(fehlt));
  });

  await t.test('as an attachment in a sandbox', async () => {
    for (const weg of [`/data/uploads/${U}/a.pdf`, `/data/instructions/${SN}_1.pdf`]) {
      const r = await hole(H, weg);
      assert.equal(r.status, 200, `${weg}: ${r.text}`);
      assert.match(r.kopf.get('content-security-policy') ?? '', /^sandbox\b.*default-src 'none'/, weg);
      assert.match(r.kopf.get('content-disposition') ?? '', /^attachment; filename="[^"]+\.pdf"$/, weg);
    }
  });

  await t.test('even an admin does not read foreign uploads', async () => {
    await db.run('UPDATE users SET is_admin = true WHERE id = $1', [F]);
    await db.run(`INSERT INTO second_factor (user_id, secret, active) VALUES ($1, 'x', TRUE)`, [F]);
    assert.equal(
      (await hole(F, `/data/uploads/${H}/a.pdf`, true)).status,
      404,
      'Invoices and vouchers of others are none of the account management’s business',
    );
  });

  await t.test('%2F in the segment', async () => {
    for (const weg of [
      `/data/uploads/x%2F..%2F${H}/a.pdf`,
      `/data/uploads/${F}%2F..%2F${H}/a.pdf`,
      `/data/uploads/..%2F${H}%2Fa.pdf`,
      `/data/uploads/${H}%5Ca.pdf`,
    ]) {
      const r = await hole(F, weg);
      assert.equal(r.status, 404, `${weg} → ${r.status}: ${r.text}`);
    }
  });

  await t.test('no user folder', async () => {
    assert.equal((await hole(F, '/data/uploads/lose.pdf')).status, 404);
  });

  await t.test('an unlinked sub-account is immediately no longer readable', async () => {
    assert.equal((await hole(H, `/data/uploads/${U}/a.pdf`)).status, 200);
    // Directly in the table, without notification: the memory knows nothing of it.
    await db.run('DELETE FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2', [H, U]);
    assert.equal((await hole(H, `/data/uploads/${U}/a.pdf`)).status, 404);
  });

  await t.test('without login, and no answer goes into a cache', async () => {
    const ohne = await hole(undefined, `/data/uploads/${H}/a.pdf`);
    assert.equal(ohne.status, 401);
    for (const r of [ohne, await hole(F, `/data/uploads/${H}/a.pdf`), await hole(H, `/data/uploads/${H}/a.pdf`)])
      assert.equal(r.kopf.get('cache-control'), 'private, no-store', `${r.status}`);
  });
});
