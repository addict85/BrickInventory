/**
 * Multi-step writes of the services are atomic: account and log,
 * voucher row and PDF, reading and writing when changing a voucher.
 *
 * Counter-checks (measured 13.11.2026, each on its own, dist rebuilt):
 *   A  createAccount (src/account/accounts.ts) without db.transaction, the body directly →
 *      red: “if the log entry fails, there is no account”
 *   B  aktivSetzen (src/account/adminActions.ts) without withAccessEnd → red:
 *      “… the account stays active”
 *   C  createVoucherWithPdf (src/vouchers/service.ts) without the deletion in the
 *      catch → red: “… no orphaned file”
 *   D  createVoucherWithPdf without db.transaction → red: “… no voucher row”
 *   E  changeVoucher reads with voucher() instead of lockedVoucher() → red:
 *      “two concurrent changes” (the amount of the first got lost)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const sources = require('./helpers/sources');
const _req = sources.buildAndRequire();
const { accessOrSkip } = require('./helpers/db');

/** Before loading the services: they hold the module object they get when loading. */
const replace = (rel, zusatz) => {
  const file = require.resolve(path.join(sources.DIST, rel));
  _req(rel);
  require.cache[file].exports = Object.assign({}, require.cache[file].exports, zusatz);
};
const stoerung = { log: false, rememberPdf: false, writePdf: false };
const kaputt = was => {
  throw new Error(`Störung: ${was}`);
};
const realLog = _req('src/account/repository/log.js');
replace('src/account/repository/log.js', {
  logEntry: (...a) => (stoerung.log ? kaputt('protokoll') : realLog.logEntry(...a)),
});
const realFiles = _req('src/vouchers/voucherFiles.js');
replace('src/vouchers/voucherFiles.js', {
  writeVoucherPdf: (...a) => (stoerung.writePdf ? kaputt('pdf') : realFiles.writeVoucherPdf(...a)),
});

/** Two readers: the first waits after reading until the second has begun
 * to read. Without a row lock both then read the same old state. */
let limit = null;
const echtRepo = _req('src/vouchers/repository/vouchers.js');
const withLimit =
  name =>
  async (...a) => {
    const s = limit;
    const ich = s ? ++s.n : 0;
    if (ich === 2) s.secondDa();
    const z = await echtRepo[name](...a);
    if (ich === 1) await s.zweiter;
    return z;
  };
replace('src/vouchers/repository/vouchers.js', {
  voucher: withLimit('voucher'),
  lockedVoucher: withLimit('lockedVoucher'),
  rememberVoucherPdf: (...a) => (stoerung.rememberPdf ? kaputt('pdf merken') : echtRepo.rememberVoucherPdf(...a)),
});

test('services write all or nothing', { concurrency: 1, timeout: 60_000 }, async t => {
  const db = await accessOrSkip(t, _req);
  if (!db) return;
  const NAME = `atomar-${process.pid}`;
  await db.run('DELETE FROM users WHERE username LIKE $1', [`${NAME}%`]);
  const neu = async (n, admin = false) =>
    (
      await db.get(`INSERT INTO users (username, password_hash, is_admin) VALUES ($1, 'x', $2) RETURNING id`, [
        n,
        admin,
      ])
    ).id;
  const chef = await neu(`${NAME}-chef`, true);
  const nutzer = await neu(`${NAME}-nutzer`);
  const K = require('./helpers/sources').testServices().account;
  const G = _req('src/vouchers/service.js');
  const ordner = path.join(_req('src/vouchers/index.js').VOUCHER_DIR, String(nutzer));
  t.after(async () => {
    fs.rmSync(ordner, { recursive: true, force: true });
    await db.run('DELETE FROM users WHERE username LIKE $1', [`${NAME}%`]);
    await db.pool.end().catch(() => {});
  });
  const disrupt = async (was, work) => {
    stoerung[was] = true;
    try {
      await assert.rejects(work, /Störung/);
    } finally {
      stoerung[was] = false;
    }
  };

  await t.test('if the log entry fails, there is no account', async () => {
    await disrupt('log', () => K.addAccount(chef, `${NAME}-neu`, 'Ein-Langes-Passwort-2026', false));
    assert.equal(await db.get('SELECT id FROM users WHERE username = $1', [`${NAME}-neu`]), undefined);
    // Without interference account and entry arise together.
    const id = await K.addAccount(chef, `${NAME}-neu`, 'Ein-Langes-Passwort-2026', false);
    const eintrag = await db.get('SELECT action FROM admin_log WHERE target_id = $1', [id]);
    assert.equal(eintrag?.action, 'account_created');
  });

  await t.test('if the log entry fails while locking, the account stays active', async () => {
    await disrupt('log', () => K.admin.setActive(chef, nutzer, false));
    assert.equal((await db.get('SELECT is_active FROM users WHERE id = $1', [nutzer])).is_active, true);
  });

  const pdf = Buffer.from('%PDF-1.4\n% Test\n');
  const zeilen = async () => (await db.all('SELECT id FROM vouchers WHERE user_id = $1', [nutzer])).length;
  const dateien = () => (fs.existsSync(ordner) ? fs.readdirSync(ordner).filter(n => n.endsWith('.pdf')) : []);

  await t.test('if remembering the path fails, no voucher row and no orphaned file remain', async () => {
    const w = { number: '6000111122223333', pin: '123', amount: 25, currency: 'EUR' };
    await disrupt('rememberPdf', () => G.createVoucherWithPdf(nutzer, w, pdf));
    assert.equal(await zeilen(), 0);
    assert.deepEqual(dateien(), []);
    await disrupt('writePdf', () => G.createVoucherWithPdf(nutzer, w, pdf));
    assert.equal(await zeilen(), 0);
    // Without interference: row and file, and the row knows the file.
    const z = await G.createVoucherWithPdf(nutzer, w, pdf);
    assert.equal(z.pdf_path, `${nutzer}/${z.id}.pdf`);
    assert.deepEqual(dateien(), [`${z.id}.pdf`]);
    assert.deepEqual(await G.voucherPdf(nutzer, z.id), pdf);
  });

  await t.test('two concurrent changes lose none', async () => {
    const z = await G.createVoucher(nutzer, { number: '6000444455556666', pin: '111', amount: 10 });
    let secondDa;
    limit = { n: 0, zweiter: new Promise(r => (secondDa = r)) };
    limit.secondDa = secondDa;
    try {
      await Promise.all([
        G.changeVoucher(nutzer, z.id, { amount: 42 }),
        G.changeVoucher(nutzer, z.id, { pin: '999', number: G.masked(z).number }),
      ]);
    } finally {
      limit = null;
    }
    const now = await G.voucherPlaintext(nutzer, z.id);
    assert.equal(Number(now.amount), 42, 'der Betrag der ersten Änderung ging verloren');
    assert.equal(now.pin, '999');
    assert.equal(now.number, '6000444455556666');
  });
});
