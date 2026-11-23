/**
 * Deleting a voucher only marks it (migration 0138): it vanishes from list, export and every
 * route at once, the owner can restore it within RESTORE_DAYS, nobody else can, and the hourly
 * cleanup removes row and PDF once the window is over. Through the real app (testServer).
 *
 * Counter-checks (measured 23.11.2026, each on its own):
 *   A  in vouchersOfAccount() `AND deleted_at IS NULL` removed → red: “gone from list …”
 *   B  in restoreVoucher() (repository) `AND user_id = $2` removed → red: “a household member
 *      cannot restore it” (200 instead of 404), and the cases after it
 *   C  in restoreVoucher() the window `deleted_at >= …` removed → red: “past the window …”
 *      and “the cleanup removes only …” (the expired card came back)
 *   D  in purgeDeletedVouchers() (repository) `deleted_at < …` replaced by `deleted_at IS NOT NULL`
 *      → red: “the cleanup removes only …”
 *   E  in the migration the unique index without `WHERE deleted_at IS NULL` → red: “the same
 *      number again …” (409 on create)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testServices } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));
const { DATA_DIR } = _req('src/infra/appPaths.js');
const { inSystemContext } = _req('src/infra/accountContext.js');

const PASSWORD = 'Rueckgaengig-Passwort-1';
const NR_A = '5045076374450021111',
  NR_B = '5045076374450022222',
  NR_C = '5045076374450023333';
const DAY = 86_400_000;

test('a deleted voucher can be restored for a few days, then the cleanup takes it', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const names = [`ru_owner_${process.pid}`, `ru_member_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [names]);
  const hash = await bcrypt.hash(PASSWORD, 4);
  const fresh = async n =>
    (
      await db.get('INSERT INTO users (username, password_hash, is_active) VALUES ($1, $2, true) RETURNING id', [
        n,
        hash,
      ])
    ).id;
  const owner = await fresh(names[0]);
  const member = await fresh(names[1]);
  // The member is the owner's main account: for sets it would see everything of the owner.
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [member, owner]);
  testServices().household.reportHouseholdChange();
  const pdfDir = path.join(DATA_DIR, 'vouchers', String(owner));
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [names]).catch(() => {});
    fs.rmSync(pdfDir, { recursive: true, force: true });
    await db.pool.end().catch(() => {});
  });

  const own = testServer(_req, { session: { userId: owner }, t });
  const other = testServer(_req, { session: { userId: member }, t });
  const call = (srv, method, p, body) =>
    fetch(srv.base + p, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  const create = async number => {
    const r = await call(own, 'POST', '/api/v2/vouchers', { number, pin: '4711', amount: 40, currency: 'CHF' });
    const b = await r.json();
    assert.equal(r.status, 200, JSON.stringify(b));
    return b.voucher.id;
  };
  const listed = async srv => (await (await call(srv, 'GET', '/api/v2/vouchers')).json()).vouchers.map(v => v.id);
  const remove = id => call(own, 'DELETE', `/api/v2/vouchers/${id}`, { password: PASSWORD });
  const restore = (srv, id) => call(srv, 'POST', `/api/v2/vouchers/${id}/restore`);
  const deletedAt = async id => (await db.get('SELECT deleted_at FROM vouchers WHERE id = $1', [id]))?.deleted_at;

  const a = await create(NR_A);
  const b = await create(NR_B);

  await t.test('gone from list, export and the card routes; the row stays for the undo', async () => {
    assert.equal((await remove(a)).status, 200);
    assert.ok(await deletedAt(a), 'the row is marked, not deleted');
    assert.deepEqual(await listed(own), [b], 'the owner no longer sees it');
    // The web total adds up this list (js/vouchers.js); only B's amount remains.
    const vouchers = (await (await call(own, 'GET', '/api/v2/vouchers')).json()).vouchers;
    assert.equal(
      vouchers.reduce((s, v) => s + v.amount, 0),
      40,
    );

    const grant = await (await call(own, 'POST', '/api/v2/vouchers/export/pdf-grant', { password: PASSWORD })).json();
    const exp = await call(own, 'GET', `/api/v2/vouchers/export/pdf?ticket=${encodeURIComponent(grant.ticket)}`);
    assert.equal(exp.status, 200);
    const results = JSON.parse(Buffer.from(exp.headers.get('X-Gutschein-Befunde'), 'base64').toString('utf8'));
    assert.deepEqual(
      results.map(r => r.id),
      [b],
      'the export leaves the deleted card out',
    );

    for (const [method, p, body] of [
      ['PUT', `/api/v2/vouchers/${a}`, { amount: 1 }],
      ['POST', `/api/v2/vouchers/${a}/plaintext`, { password: PASSWORD }],
      ['POST', `/api/v2/vouchers/${a}/pdf-grant`, { password: PASSWORD }],
      ['DELETE', `/api/v2/vouchers/${a}`, { password: PASSWORD }],
    ])
      assert.equal((await call(own, method, p, body)).status, 404, `${method} ${p} on a deleted card`);
    assert.deepEqual(await listed(other), [], 'the household sees no voucher, deleted or not');
  });

  await t.test('a household member cannot restore it', async () => {
    assert.equal((await restore(other, a)).status, 404);
    assert.ok(await deletedAt(a), 'still deleted');
  });

  await t.test('the owner restores it with number and PIN', async () => {
    const r = await restore(own, a);
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.voucher.id, a);
    assert.equal(await deletedAt(a), null);
    assert.deepEqual((await listed(own)).sort(), [a, b].sort());
    const plain = await (await call(own, 'POST', `/api/v2/vouchers/${a}/plaintext`, { password: PASSWORD })).json();
    assert.deepEqual([plain.number, plain.pin], [NR_A, '4711'], 'the restored card still opens');
    assert.equal((await restore(own, a)).status, 404, 'a live card is not restored twice');
  });

  await t.test('the same number again: create works, restoring the old one then is 409', async () => {
    assert.equal((await remove(a)).status, 200);
    const again = await create(NR_A);
    assert.notEqual(again, a);
    const r = await restore(own, a);
    assert.deepEqual([r.status, (await r.json()).code], [409, 'voucher_exists']);
    assert.equal((await remove(again)).status, 200);
  });

  await t.test('past the window it can no longer be restored', async () => {
    await db.run("UPDATE vouchers SET deleted_at = NOW() - INTERVAL '8 days' WHERE id = $1", [a]);
    assert.equal((await restore(own, a)).status, 404);
  });

  await t.test('the cleanup removes only rows past the window, with their PDF', async () => {
    const c = await create(NR_C);
    fs.mkdirSync(pdfDir, { recursive: true });
    const file = path.join(pdfDir, `${a}.pdf`);
    fs.writeFileSync(file, 'x');
    await db.run('UPDATE vouchers SET pdf_path = $1 WHERE id = $2', [`${owner}/${a}.pdf`, a]);
    assert.equal((await remove(c)).status, 200);
    await db.run('UPDATE vouchers SET deleted_at = $1 WHERE id = $2', [new Date(Date.now() - DAY), c]);

    const n = await inSystemContext('test', () => testServices().vouchers.cleanup());
    assert.ok(n >= 1, `${n} removed`);
    assert.equal(await db.get('SELECT id FROM vouchers WHERE id = $1', [a]), undefined, 'the old row is gone');
    assert.ok(!fs.existsSync(file), 'its PDF is gone too');
    assert.ok(await deletedAt(c), 'the fresh deletion stays restorable');
    assert.equal((await restore(own, c)).status, 200);
  });
});
