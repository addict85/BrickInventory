/**
 * Voucher export and import via their real addresses.
 *
 * ── Counter-checks (carried out, findings MEASURED — see commit) ─────────────
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip, unless
 * REQUIRE_DB=1.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PDFKit = require('pdfkit');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
// APP_ROOT, not DATA_DIR
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'gutschein-wurzel-'));
fs.mkdirSync(path.join(SANDBOX, 'data'), { recursive: true });
// package.json, so that findRoot() stops here and does not run further up
// (it searches for the next package.json). APP_ROOT takes precedence, so this
// is only a belt next to the suspenders.
fs.writeFileSync(path.join(SANDBOX, 'package.json'), '{"name":"sandkasten"}');
process.env.APP_ROOT = SANDBOX;
const DATA_DIR = path.join(SANDBOX, 'data');

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const { testServer } = require('./helpers/server');
const PL = require('@cantoo/pdf-lib');
const suche = (uid, nr) => _req('src/vouchers/repository/vouchers.js').numberSearch(uid, nr);

test.after(async () => {
  await db.pool.end().catch(() => {});
});

let MAIN = 0,
  FREMD = 0;

const CARDS = [
  { nr: '5045076374450011166', pin: '5225', printedOut: '400', app: 250 },
  { nr: '5045076374450022277', pin: '1234', printedOut: '150', app: 150 },
];

function buildVoucher(amountText, number, pin) {
  return new Promise(fertig => {
    const d = new PDFKit({ size: 'A4' });
    const s = [];
    d.on('data', c => s.push(c));
    d.on('end', () => fertig(Buffer.concat(s)));
    d.fontSize(14).text(`Ihre LEGO-Geschenkkarte im Wert von ${amountText} CHF:`, 60, 100);
    d.fontSize(12).text(number, 60, 140).text(`PIN: ${pin}`, 60, 170);
    d.end();
  });
}

const PASS = 'Export-Passwort-1';

async function setup() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c);
  } finally {
    c.release();
  }
  const hash = require('bcryptjs').hashSync(PASS, 4);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt',$1),('fremd',$1)`, [hash]);
  MAIN = (await db.get(`SELECT id FROM users WHERE username='haupt'`)).id;
  FREMD = (await db.get(`SELECT id FROM users WHERE username='fremd'`)).id;

  const dir = path.join(DATA_DIR, 'vouchers', String(MAIN));
  await fs.promises.mkdir(dir, { recursive: true });
  const { createVoucher } = require('./helpers/sources').testArea('vouchers').vouchers;
  for (const k of CARDS) {
    const z = await createVoucher(MAIN, { number: k.nr, pin: k.pin, amount: k.app, currency: 'CHF' });
    await _req('src/vouchers/voucherFiles.js').writeVoucherPdf(
      path.join(dir, `${z.id}.pdf`),
      await buildVoucher(k.printedOut, k.nr, k.pin),
    );
    await db.run('UPDATE vouchers SET pdf_path=$1 WHERE id=$2', [`${MAIN}/${z.id}.pdf`, z.id]);
  }
  // A voucher WITHOUT an original — captured by hand.
  await createVoucher(MAIN, { number: '5045076374450033388', pin: null, amount: 42.5, currency: 'CHF' });
  // And one in a FOREIGN account, which has no business in the own export.
  await createVoucher(FREMD, { number: '9999999999999999999', pin: '0000', amount: 99, currency: 'CHF' });
}

test('vouchers: export and import via the real addresses', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }
  await setup();

  const srv = testServer(_req, { sitzung: { userId: MAIN }, t });

  let pdf = null,
    befunde = null;
  /** First the confirmed release, then the one fetch with the ticket. */
  const freigabe = () =>
    fetch(`${srv.base}/api/v2/vouchers/export/pdf-grant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASS }),
    });
  const exportIt = async () =>
    fetch(`${srv.base}/api/v2/vouchers/export/pdf?ticket=${(await (await freigabe()).json()).ticket}`);

  await t.test('1. the export delivers ONE PDF with all own vouchers', async () => {
    const r = await exportIt();
    assert.equal(r.status, 200, `The export answered with ${r.status}`);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    pdf = Buffer.from(await r.arrayBuffer());
    assert.equal(pdf.slice(0, 5).toString(), '%PDF-', 'That is not a PDF');
    assert.equal(
      (await PL.PDFDocument.load(pdf)).getPageCount(),
      3,
      'Expected three pages — two with an original, one generated',
    );

    const kopf = r.headers.get('x-gutschein-befunde');
    assert.ok(
      kopf,
      'The findings are missing in the header. The body IS the PDF, so the ' +
        'header is the only place that can say what became of each voucher.',
    );
    befunde = JSON.parse(Buffer.from(kopf, 'base64').toString('utf-8'));
    assert.equal(befunde.length, 3, `${befunde.length} findings instead of 3`);
    assert.deepEqual(
      befunde.map(b => b.kind),
      ['ersetzt', 'stimmte_schon', 'erzeugt'],
      `The findings read ${JSON.stringify(befunde.map(b => b.kind))} — expected: the ` +
        'first is replaced (400→250), the second is already right (150), the third has ' +
        'no original',
    );
    // „stimmte_schon" is a kind of its own and NOT an open point. Until
    // 15.10. this case carried `unveraendert` including a reason, and the UI
    // showed it as a warning — Marco read twice in his export
    // „⚠ …: Der Betrag im PDF stimmt schon", i.e. a warning about a
    // success. Here the difference is fixed.
    assert.equal(
      befunde.filter(b => b.kind === 'unveraendert' && b.reason).length,
      0,
      'An „already right" must not count as an open item',
    );
  });

  await t.test('2. the FOREIGN voucher is not included', async () => {
    // A voucher carries number and PIN. In the export of another account
    // that would be passing on a means of payment.
    const { readPageByPage } = _req('src/vouchers/pdfExport.js');
    const drin = (await readPageByPage(pdf)).map(w => w.number);
    assert.ok(
      !drin.includes('9999999999999999999'),
      `The own export contains the card of a foreign account: ${drin.join(', ')}`,
    );
    assert.equal(drin.length, 3, `${drin.length} cards in the PDF instead of 3`);
  });

  await t.test('3. the exported PDF carries the APP amount, not the printed one', async () => {
    const { readPageByPage } = _req('src/vouchers/pdfExport.js');
    const parsed = await readPageByPage(pdf);
    for (const k of CARDS) {
      const w = parsed.find(x => x.number === k.nr);
      assert.ok(w, `${k.nr} is missing in the export`);
      assert.equal(
        w.amount,
        k.app,
        `${k.nr}: ${w.amount} instead of ${k.app}. The card shows ${k.printedOut} — ` +
          'the export should show the state of the app, that is what Marco asked for.',
      );
    }
  });

  await t.test('4. the same PDF restores the emptied table', async () => {
    await db.run('DELETE FROM vouchers WHERE user_id=$1', [MAIN]);
    const fd = new FormData();
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'gutscheine.pdf');
    // THE SAME address as for a single voucher (Marco's review
    // of 15.10.: one file field, not two). The server sees three pages and
    // answers with `mehrere` instead of `voucher`.
    const r = await fetch(`${srv.base}/api/v2/vouchers/pdf`, { method: 'POST', body: fd });
    const b = await r.json();
    assert.equal(r.status, 200, `The import answered with ${r.status}: ${JSON.stringify(b)}`);
    assert.ok(b.multiple, `Expected the batch case, got ${JSON.stringify(b)}`);
    assert.equal(
      b.voucher,
      undefined,
      'With several vouchers no single „voucher" may appear next to them — ' +
        'otherwise an interface would have to guess which of the three is meant',
    );
    assert.equal(
      b.multiple.added,
      3,
      `${b.multiple.added} created instead of 3: ${JSON.stringify(b.multiple.results)}`,
    );
    assert.equal(b.multiple.errors, 0, `${b.multiple.errors} errors: ${JSON.stringify(b.multiple.results)}`);

    for (const k of CARDS) {
      const z = await db.get('SELECT id, amount, pin, currency FROM vouchers WHERE user_id=$1 AND number_search=$2', [
        MAIN,
        suche(MAIN, k.nr),
      ]);
      assert.ok(z, `${k.nr} did not come back`);
      assert.equal(Number(z.amount), k.app, `${k.nr}: ${z.amount} instead of ${k.app}`);
      assert.equal(
        _req('src/infra/secret.js').decrypt(z.pin, _req('src/vouchers/repository/vouchers.js').pinContext(MAIN, z.id)),
        k.pin,
        `${k.nr}: PIN ${z.pin} instead of ${k.pin}`,
      );
    }
    // And the one captured by hand, which never had a PDF.
    const ohne = await db.get('SELECT amount, pin FROM vouchers WHERE user_id=$1 AND number_search=$2', [
      MAIN,
      suche(MAIN, '5045076374450033388'),
    ]);
    assert.ok(ohne, 'The manually recorded voucher did not come back');
    assert.equal(Number(ohne.amount), 42.5);
    assert.equal(ohne.pin, null, '„keine PIN“ became something else');
  });

  await t.test('5. a second import refreshes the amount instead of doing nothing', async () => {
    // The case the import exists for: the account already knows the cards,
    // and the amount has changed. With ON CONFLICT DO NOTHING the
    // import would be ineffective here — and exactly then one needs it.
    await db.run('UPDATE vouchers SET amount = 1 WHERE user_id=$1', [MAIN]);
    const fd = new FormData();
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'gutscheine.pdf');
    const b = (await (await fetch(`${srv.base}/api/v2/vouchers/pdf`, { method: 'POST', body: fd })).json()).multiple;
    assert.equal(b.added, 0, `${b.added} newly created — the cards already existed`);
    assert.equal(b.updated, 3, `${b.updated} refreshed instead of 3`);
    assert.equal(
      Number(
        (
          await db.get('SELECT amount FROM vouchers WHERE user_id=$1 AND number_search=$2', [
            MAIN,
            suche(MAIN, CARDS[0].nr),
          ])
        ).amount,
      ),
      CARDS[0].app,
      'The amount was not refreshed',
    );
    assert.equal(
      (await db.get('SELECT COUNT(*)::int c FROM vouchers WHERE user_id=$1', [MAIN])).c,
      3,
      'The second import doubled the table',
    );
  });

  await t.test('6. without a voucher an information comes, not an empty PDF', async () => {
    await db.run('DELETE FROM vouchers WHERE user_id=$1', [MAIN]);
    const r = await freigabe();
    assert.equal(r.status, 404, `expected 404, got ${r.status}`);
    const b = await r.json().catch(() => ({}));
    assert.match(
      String(b.error || ''),
      /keine Gutscheine/i,
      `Rejected with „${b.error}" — the text should say that none are recorded`,
    );
  });

  await t.test('7. a file that is not a PDF yields 422 and no entry', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from('kein PDF, nur Text')], { type: 'application/pdf' }), 'kaputt.pdf');
    const r = await fetch(`${srv.base}/api/v2/vouchers/pdf`, { method: 'POST', body: fd });
    assert.equal(
      r.status,
      422,
      `Expected 422, got ${r.status}. A broken file is a statement about the ` + 'file, not a server error.',
    );
    assert.equal(
      (await r.json()).code,
      'pdf_unreadable',
      'Since both paths share one address, the broken file arrives at the ' +
        'SINGLE path. Without a code of its own it would say „amount_invalid" — ' +
        'information about a field that does not even exist in this file.',
    );
    assert.equal(
      (await db.get('SELECT COUNT(*)::int c FROM vouchers WHERE user_id=$1', [MAIN])).c,
      0,
      'Something was created anyway',
    );
  });

  await t.test('8. ONE voucher in the PDF stays the single case — with file', async () => {
    // The decision „one or several" is made by the server, and it must be right in
    // both directions. For a single voucher the old
    // contract applies unchanged: `voucher` instead of `mehrere`, and the file is
    // STORED as the original of the voucher (not for the stack — there it is
    // the backup, not the card).
    await db.run('DELETE FROM vouchers WHERE user_id=$1', [MAIN]);
    const eine = await buildVoucher('250', CARDS[0].nr, CARDS[0].pin);
    const fd = new FormData();
    fd.append('file', new Blob([eine], { type: 'application/pdf' }), 'einer.pdf');
    const r = await fetch(`${srv.base}/api/v2/vouchers/pdf`, { method: 'POST', body: fd });
    const b = await r.json();
    assert.equal(r.status, 200, `response ${r.status}: ${JSON.stringify(b)}`);
    assert.equal(b.multiple, undefined, `A single voucher must not count as a batch: ${JSON.stringify(b)}`);
    assert.ok(b.voucher, 'The single case answers with `voucher`');
    assert.equal(b.parsed.number, CARDS[0].nr);
    assert.equal(b.voucher.number, '…' + CARDS[0].nr.slice(-4), 'only the end to the outside');
    assert.equal(b.voucher.has_pdf, true, 'For a single voucher the file is stored as its original');
  });
});
