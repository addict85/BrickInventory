/**
 * Voucher PDFs are stored encrypted on disk and come out decrypted;
 * when an account is deleted its vouchers and instructions disappear
 * with it. Checked via the real routes and the startup run.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  in writeVoucherPdf() write the plain text again → red: “PIN
 *      and card number are in plain text on disk”
 *   B  encryptLegacyVoucherFiles() skips everything → red: “the
 *      legacy stock stays plain text”
 *   C  in removeAccount() (src/account) the call of deleteAccountFiles() removed → red:
 *      “data/uploads/<id> stays after deletion”
 *   D  GET /vouchers/:id/pdf delivers the file raw again (deliverFile) →
 *      red: “the delivered PDF is not the uploaded one”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PDFKit = require('pdfkit');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const AUTH = require('./helpers/sources').mounting('auth');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const db = testData();
const { DATA_DIR } = _req('src/infra/appPaths.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

const NR = '5045076374450077711',
  PIN = '8642';

function voucherPdf() {
  return new Promise(done => {
    const d = new PDFKit({ size: 'A4', compress: false });
    const s = [];
    d.on('data', c => s.push(c));
    d.on('end', () => done(Buffer.concat(s)));
    d.fontSize(14).text('Ihre LEGO-Geschenkkarte im Wert von 50 CHF:', 60, 100);
    d.fontSize(12).text(NR, 60, 140).text(`PIN: ${PIN}`, 60, 170);
    d.end();
  });
}

test('voucher PDFs encrypted, account files go with the account', { concurrency: 1 }, async t => {
  try {
    await db.initSchema();
  } catch (e) {
    noDb(t, e);
    return;
  }
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }

  const ADMIN = 'kd-admin',
    TARGET = 'kd-ziel',
    ADMIN_PW = 'verwalterPasswort1';
  await db.run('DELETE FROM users WHERE username IN ($1, $2)', [ADMIN, TARGET]);
  await db.run(
    `INSERT INTO users (username, password_hash, is_admin, is_active) VALUES ($1,$3,true,true), ($2,$3,false,true)`,
    [ADMIN, TARGET, await bcrypt.hash(ADMIN_PW, 4)],
  );
  const adminId = (await db.get('SELECT id FROM users WHERE username=$1', [ADMIN])).id;
  const targetId = (await db.get('SELECT id FROM users WHERE username=$1', [TARGET])).id;
  const uploads = path.join(DATA_DIR, 'uploads', String(targetId));
  const vouchers = path.join(DATA_DIR, 'vouchers', String(targetId));
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username IN ($1, $2)', [ADMIN, TARGET]).catch(() => {});
    fs.rmSync(uploads, { recursive: true, force: true });
    fs.rmSync(vouchers, { recursive: true, force: true });
    await db.pool.end().catch(() => {});
  });

  const target = testServer(_req, { session: { userId: targetId }, t });
  const codes = await adminWithFactor(_req, adminId);
  const admin = testServer(_req, { session: { userId: adminId, username: ADMIN, isAdmin: true }, t });

  const original = await voucherPdf();
  const { valuesFromPdf } = _req('src/vouchers/pdfParsing.js');
  /** What someone reads from the file alone. */
  const readable = data => {
    try {
      return valuesFromPdf(data);
    } catch {
      return {};
    }
  };
  assert.equal(readable(original).pin, PIN, 'Precondition: the PIN is readable from the PDF');

  await t.test('uploaded: encrypted on disk, delivered decrypted', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([original], { type: 'application/pdf' }), 'g.pdf');
    const r = await fetch(`${target.base}/api/v2/vouchers/pdf`, { method: 'POST', body: fd });
    const b = await r.json();
    assert.equal(r.status, 200, JSON.stringify(b));
    const raw = fs.readFileSync(path.join(vouchers, `${b.voucher.id}.pdf`));
    const ofDisk = readable(raw);
    assert.ok(ofDisk.pin !== PIN && ofDisk.number !== NR, 'PIN and card number are stored in plain text on disk');
    assert.notEqual(raw.subarray(0, 5).toString('latin1'), '%PDF-');
    const { ticket } = await (
      await fetch(`${target.base}/api/v2/vouchers/${b.voucher.id}/pdf-grant`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PW }),
      })
    ).json();
    const out = Buffer.from(
      await (await fetch(`${target.base}/api/v2/vouchers/${b.voucher.id}/pdf?ticket=${ticket}`)).arrayBuffer(),
    );
    assert.ok(out.equals(original), 'the delivered PDF is not the uploaded one');
  });

  await t.test('the plaintext legacy data is encrypted at startup', async () => {
    const alt = path.join(vouchers, '999999.pdf');
    fs.writeFileSync(alt, original);
    const { encryptLegacyVoucherFiles, readVoucherPdf } = _req('src/vouchers/voucherFiles.js');
    assert.ok((await encryptLegacyVoucherFiles()) >= 1);
    assert.notEqual(readable(fs.readFileSync(alt)).pin, PIN, 'the existing files stay plain text');
    assert.ok((await readVoucherPdf(alt)).equals(original));
    assert.equal(await encryptLegacyVoucherFiles(), 0, 'a second run encrypts twice');
  });

  await t.test('deleting an account removes instructions and vouchers', async () => {
    fs.mkdirSync(uploads, { recursive: true });
    fs.writeFileSync(path.join(uploads, '10294-1_abc.pdf'), original);
    const r = await fetch(`${admin.base}${AUTH}/users/${targetId}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admin_password: ADMIN_PW, code: codes.shift() }),
    });
    assert.equal(r.status, 200, await r.text());
    assert.equal(fs.existsSync(uploads), false, 'data/uploads/<id> remains after deletion');
    assert.equal(fs.existsSync(vouchers), false, 'data/vouchers/<id> remains after deletion');
  });
});
