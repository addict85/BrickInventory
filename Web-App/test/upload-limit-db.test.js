/**
 * A voucher PDF with too many pages is rejected before it is read
 * page by page; reading happens in a worker thread. Per account at most
 * one voucher PDF and a limited number of uploads and event streams run
 * at the same time — a second account is not affected by it.
 *
 * Counter-checks (measured on 04.11.2026, one change each, reverted afterwards):
 *   A  MAX_PAGES query deleted in readUploadedPdf() → red:
 *      “250 pages: 422 with an understandable message” (the stack is read)
 *   B  readInBackground() calls readUploadedPdf() directly → red: “reading happens
 *      in a worker thread”
 *   C  kontoSchranke('voucherPdf') deleted on POST /vouchers/pdf → red:
 *      “a second voucher PDF of the same account does not wait”
 *   D  the release on 'close' deleted in kontoSchranke() → red: “… after
 *      the end it works again”
 *   E  kontoSchranke('strom') deleted on the CSV stream → red: “at most six
 *      event streams per account”
 *   F  the release on 'finish' deleted in kontoSchranke() → red: “the
 *      slot is free as soon as the response is handed over”
 *
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const wt = require('node:worker_threads');
const { bis } = require('./helpers/time');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const { testServer } = require('./helpers/server');
const { PDFDocument } = require(path.join(ROOT, 'node_modules', '@cantoo/pdf-lib'));

async function pdfWith(seiten) {
  const d = await PDFDocument.create();
  for (let i = 0; i < seiten; i++) d.addPage([200, 200]);
  return Buffer.from(await d.save());
}

async function uploadIt(base, daten) {
  const fd = new FormData();
  fd.append('file', new Blob([daten], { type: 'application/pdf' }), 'g.pdf');
  const r = await fetch(`${base}/api/v2/vouchers/pdf`, { method: 'POST', body: fd });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

/** An upload whose body only ends on call: it holds its slot. */
function hangingUpload(base) {
  const u = new URL(`${base}/api/v2/vouchers/pdf`);
  const grenze = 'xyzgrenze';
  const req = http.request({
    host: u.hostname,
    port: u.port,
    path: u.pathname,
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${grenze}` },
  });
  const response = new Promise(fertig =>
    req.on('response', r => {
      r.resume();
      r.on('end', () => fertig(r.statusCode));
    }),
  );
  req.on('error', () => {});
  req.write(
    `--${grenze}\r\nContent-Disposition: form-data; name="file"; filename="g.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n`,
  );
  return { response, ende: () => req.end(`\r\n--${grenze}--\r\n`) };
}

test('per-account limits on upload', { concurrency: 1, timeout: 120_000 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }
  await db.initSchema();
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  const neu = async name => {
    await db.run('DELETE FROM users WHERE username = $1', [name]);
    return (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
  };
  const A = await neu(`schranke_a_${process.pid}`),
    B = await neu(`schranke_b_${process.pid}`);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[A, B]]);
    await testAccess()
      .notification.close()
      .catch(() => {}); // the CSV stream listens to NOTIFY
    await db.pool.end().catch(() => {});
  });
  const server = uid => testServer(_req, { sitzung: { userId: uid }, t });
  const a = server(A),
    b = server(B);

  await t.test('250 pages: 422 with an understandable message', async () => {
    const r = await uploadIt(a.base, await pdfWith(250));
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.equal(r.body.code, 'pdf_too_many_pages');
    assert.match(r.body.error, /250 Seiten, höchstens 200/);
    assert.equal((await db.get('SELECT count(*)::int AS n FROM vouchers WHERE user_id = $1', [A])).n, 0);
  });

  await t.test('reading happens in a worker thread', async () => {
    const { readInBackground } = _req('src/vouchers/pdfReader.js');
    const Echt = wt.Worker;
    let started = 0;
    wt.Worker = class extends Echt {
      constructor(/** @type {ConstructorParameters<typeof Echt>} */ ...a) {
        super(...a);
        started++;
      }
    };
    try {
      const r = await readInBackground(await pdfWith(3));
      assert.equal(r.kind, 'gelesen');
      assert.equal(r.seiten, 3);
    } finally {
      wt.Worker = Echt;
    }
    assert.equal(started, 1);
  });

  await t.test('a second voucher PDF of the same account does not wait', async () => {
    const erster = hangingUpload(a.base);
    try {
      await new Promise(r => setTimeout(r, 200));
      const zweiter = await uploadIt(a.base, await pdfWith(1));
      assert.equal(zweiter.status, 429, JSON.stringify(zweiter.body));
      assert.equal(zweiter.body.code, 'upload_running');
      const fremd = await uploadIt(b.base, await pdfWith(1));
      assert.notEqual(fremd.status, 429, 'ein anderes Konto ist nicht betroffen');
    } finally {
      erster.ende(); // otherwise closing the server waits for it
      await erster.response;
    }
  });

  await t.test('… after the end it works again', async () => {
    const r = await uploadIt(a.base, await pdfWith(1));
    assert.notEqual(r.status, 429, JSON.stringify(r.body));
  });

  await t.test('at most six event streams per account', async () => {
    const open = [];
    const stream = () =>
      new Promise(fertig => {
        const req = http.get(`${a.base}/api/v2/sets/import/csv/stream`, r => {
          open.push(r);
          fertig(r.statusCode);
          r.resume();
        });
        req.on('error', () => fertig(0));
      });
    try {
      const statuses = [];
      for (let i = 0; i < 7; i++) statuses.push(await stream());
      assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 429]);
      for (const r of open) r.destroy();
      assert.ok(await bis(async () => (await stream()) === 200, 3000), 'geschlossene Ströme geben ihren Platz frei');
    } finally {
      for (const r of open) r.destroy();
    }
  });
});

// A client that sends the next file immediately after the response arrived in the
// full run before 'close' and got 429. Here without network so that it does not depend on the timing.
test('the slot is free as soon as the response is handed over', () => {
  const { EventEmitter } = require('node:events');
  const { accountGate: kontoSchranke } = _req('routes/api/middleware.js');
  const limit = kontoSchranke('voucherPdf');
  const anfrage = () => {
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json() {
        return this;
      },
      setHeader() {},
      getHeader() {},
      headersSent: false,
    });
    let weiter = false;
    limit({ session: { userId: 987654 }, headers: {}, get: () => undefined }, res, () => {
      weiter = true;
    });
    return { res, weiter };
  };
  const erste = anfrage();
  assert.equal(erste.weiter, true);
  erste.res.emit('finish');
  const zweite = anfrage();
  assert.equal(zweite.weiter, true, `zweite Datei abgewiesen (${zweite.res.statusCode})`);
  zweite.res.emit('finish');
});
