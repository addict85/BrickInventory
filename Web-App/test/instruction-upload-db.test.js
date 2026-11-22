/**
 * Own instructions: the content must match the type, and space per account
 * is limited.
 *
 * Counter-checks (measured on 27.10.):
 *   A  the check contentFitsToType() removed in the upload → red: “a text as
 *      PDF" (200, the file lay in the folder)
 *   B  the quota check removed → red: “above the quota"
 *   C  the ownership check removed → red: “for a set the account does not
 *      have" (500 from the foreign key, the file lay in the folder; 28.10.2026)
 *   D  beforeTheUpload removed from the route → red: “rejected before the
 *      content arrives” (no response as long as the content is missing) and “for a
 *      set the account does not have” — the ownership check stands there now (28.10.2026)
 *   E  (04.11.2026) chmod of the file removed in the upload → red: “only readable for the
 *      service” (0644); privaterFolder() without chmod → red: the same check
 *      (the already existing folder stayed 0755)
 *   F  (14.11.2026) in beforeTheUpload the total limit deleted → red: “above the limit
 *      of all accounts …” (no response as long as the content is missing); additionally the check
 *      after writing deleted → red: the same (200, the file lay in the folder)
 *   G  (14.11.2026) in POST /vouchers/pdf the total limit deleted → red: the same
 *      check (“voucher PDF”: 422 instead of 507)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const { environment, testData } = require('./helpers/sources');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
environment({ SESSION_SECRET: 'test-secret-lang-genug-fuer-die-pruefung' });

const _req = require('./helpers/sources').buildAndRequire();
const { catalogSet } = require('./helpers/inventory');
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { DATA_DIR } = _req('src/infra/appPaths.js');
const db = testData();
const SET = '99073-1',
  NAME = `anl_hoch_${process.pid}`;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

test('upload an instruction', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  await catalogSet(db, SET, { name: 'Hochladeprobe', year: 2024, theme: 'Test', pieces: 10, minifigs: 0 });
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [uid, SET]);
  const ordner = path.join(DATA_DIR, 'uploads', String(uid));
  // Start empty: the same account number also exists in the copies of the other test files.
  fs.rmSync(ordner, { recursive: true, force: true });
  const altQuota = process.env.UPLOAD_QUOTA_MB;
  t.after(async () => {
    if (altQuota === undefined) environment({ UPLOAD_QUOTA_MB: undefined });
    else environment({ UPLOAD_QUOTA_MB: altQuota });
    fs.rmSync(ordner, { recursive: true, force: true });
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM set_catalog WHERE set_number = $1', [SET]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { sitzung: { userId: uid }, t });
  const uploadIt = async (inhalt, typ, name, set = SET) => {
    const form = new FormData();
    form.append('file', new Blob([inhalt], { type: typ }), name);
    const r = await fetch(`${base}/api/v2/sets/${set}/instructions/upload`, { method: 'POST', body: form });
    return { status: r.status, body: await r.json() };
  };
  const dateien = () => (fs.existsSync(ordner) ? fs.readdirSync(ordner) : []);

  await t.test('a real PDF', async () => {
    const r = await uploadIt(PDF, 'application/pdf', 'anleitung.pdf');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(dateien().length, 1);
  });

  await t.test('readable only by the service, even in an older folder', async () => {
    for (const o of [path.dirname(ordner), ordner]) fs.chmodSync(o, 0o755);
    const r = await uploadIt(PDF, 'application/pdf', 'zweite.pdf');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const rechte = p => (fs.statSync(p).mode & 0o777).toString(8);
    const datei = path.join(ordner, path.basename(r.body.instruction.url));
    assert.deepEqual([rechte(datei), rechte(ordner), rechte(path.dirname(ordner))], ['600', '700', '700']);
    fs.rmSync(datei);
  });

  await t.test('a text as a PDF', async () => {
    const r = await uploadIt(Buffer.from('<script>alert(1)</script>'), 'application/pdf', 'boese.pdf');
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.code, 'file_content_wrong');
    assert.equal(dateien().length, 1, 'the rejected file is still in the folder');
  });

  await t.test('a PNG with a JPEG type', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    assert.equal((await uploadIt(png, 'image/jpeg', 'bild.jpg')).status, 400);
    assert.equal((await uploadIt(png, 'image/png', 'bild.png')).status, 200);
  });

  await t.test('above the quota', async () => {
    environment({ UPLOAD_QUOTA_MB: String(1 / 1024) }); // 1 KB
    const gross = Buffer.concat([PDF, Buffer.alloc(2048, 0x20)]);
    const vorher = dateien().length;
    const r = await uploadIt(gross, 'application/pdf', 'gross.pdf');
    assert.equal(r.status, 413, JSON.stringify(r.body));
    assert.equal(r.body.code, 'upload_quota_full');
    assert.equal(dateien().length, vorher, 'the file above the quota is still in the folder');
  });

  await t.test('above the limit of all accounts together: 507, nothing stored', async st => {
    environment({ UPLOAD_QUOTA_MB: '1000', UPLOAD_TOTAL_MB: String(1 / 1024) }); // together 1 KB
    st.after(() => environment({ UPLOAD_TOTAL_MB: undefined }));
    const vorher = dateien().length;
    const r = await uploadIt(Buffer.concat([PDF, Buffer.alloc(2048, 0x20)]), 'application/pdf', 'gesamt.pdf');
    assert.deepEqual([r.status, r.body.code], [507, 'upload_total_full'], JSON.stringify(r.body));
    assert.match(r.body.error, /alle Konten|all accounts/);
    assert.equal(dateien().length, vorher);
    const form = new FormData();
    form.append('file', new Blob([PDF, Buffer.alloc(2048, 0x20)], { type: 'application/pdf' }), 'gutschein.pdf');
    const g = await fetch(`${base}/api/v2/vouchers/pdf`, { method: 'POST', body: form });
    assert.deepEqual([g.status, (await g.json()).code], [507, 'upload_total_full'], 'Gutschein-PDF');
    // Already at the header: a response although the content never comes.
    const upfront = await new Promise((fertig, fehl) => {
      const a = require('node:http').request(
        `${base}/api/v2/sets/${SET}/instructions/upload`,
        { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': '4096' } },
        response => {
          response.resume();
          fertig(response.statusCode);
          a.destroy();
        },
      );
      a.on('error', () => {});
      a.write('--x\r\n');
      setTimeout(() => {
        a.destroy();
        fehl(new Error('no response as long as the content is missing'));
      }, 3000);
    });
    assert.equal(upfront, 507);
    // Without a limit (default 20 GB) the same passes.
    environment({ UPLOAD_TOTAL_MB: undefined });
    assert.equal((await uploadIt(PDF, 'application/pdf', 'gesamt.pdf')).status, 200);
  });

  await t.test('rejected before the content arrives', async () => {
    // Only the header with 10 MB Content-Length, the content stays away: if the
    // server answers anyway, it decided before reading.
    environment({ UPLOAD_QUOTA_MB: '1' });
    const http = require('node:http');
    const status = await new Promise((fertig, fehl) => {
      const anfrage = http.request(
        `${base}/api/v2/sets/${SET}/instructions/upload`,
        {
          method: 'POST',
          headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(10 * 1024 * 1024) },
        },
        response => {
          response.resume();
          fertig(response.statusCode);
          anfrage.destroy();
        },
      );
      anfrage.on('error', () => {});
      anfrage.write('--x\r\n');
      setTimeout(() => {
        anfrage.destroy();
        fehl(new Error('no response as long as the content is missing'));
      }, 3000);
    });
    assert.equal(status, 413);
  });

  await t.test('for a set the account does not have', async () => {
    environment({ UPLOAD_QUOTA_MB: undefined });
    const vorher = dateien().length;
    const r = await uploadIt(PDF, 'application/pdf', 'fremd.pdf', '99074-1');
    assert.equal(r.status, 404, JSON.stringify(r.body));
    assert.equal(dateien().length, vorher, 'the file for the foreign set is still in the folder');
  });
});
