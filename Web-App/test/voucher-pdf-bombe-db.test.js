/**
 * A voucher PDF must blow up neither memory nor computing time.
 *
 * Found at 8f4f9d3: 299 KB were unpacked to 300 MB (inflateSync without a
 * limit), and the lazy pattern `stream\r?\n([\s\S]*?)endstream` as well as the
 * text operator expression ran quadratically on open beginnings.
 *
 * ── Counter-checks (carried out, findings MEASURED) ────────────────────────────
 *
 *   a) without maxOutputLength → 1 red (15 MB unpacked, nothing thrown) and
 *      7 red (the bomb was stored with typed values, status 200)
 *   b) sum limit UNPACKED_MAX_BYTES switched off → 2 red
 *   c) stream count not counted → 3 red
 *   d) streams searched again via the lazy pattern → 4 red („stream ohne Ende: 7485 ms")
 *   e) text operators again via TEXT_OP_RE → 4 red („Literal ohne Ende:
 *      5850 ms") and 5 red (the nested parenthesis was missing)
 *   f) amount pattern again with `\s+`/`+?`/`\s*` → 4 red („Leerraum im Text: 2693 ms")
 *   g) font choice takes the first instead of the last Tf → 6 red
 *   h) route without the branch for PdfTooLarge → 7 red (status 200)
 *   i) upload limit again 20 MB → 8 red (2.5 MB were stored)
 *
 * Prerequisite for 7 and 8: test DB via TEST_DATABASE_URL. Without DB: skip,
 * unless REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
// Before loading: appPaths computes DATA_DIR from APP_ROOT when reading in.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'gutschein-bombe-'));
fs.mkdirSync(path.join(SANDBOX, 'data'), { recursive: true });
fs.writeFileSync(path.join(SANDBOX, 'package.json'), '{"name":"sandkasten"}');
process.env.APP_ROOT = SANDBOX;

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const { pdfText, valuesFromPdf, PdfTooLarge, STREAM_MAX_BYTES, UNPACKED_MAX_BYTES, STREAMS_MAX } =
  _req('src/vouchers/pdfParsing.js');
const { testServer } = require('./helpers/server');

test.after(async () => {
  await db.pool.end().catch(() => {});
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/** A PDF from raw stream contents — enough for pdfText. */
function pdfFrom(streams) {
  const parts = [Buffer.from('%PDF-1.4\n')];
  streams.forEach((s, i) => {
    parts.push(
      Buffer.from(`${i + 1} 0 obj\n<< /Length ${s.length} /Filter /FlateDecode >>\nstream\n`),
      s,
      Buffer.from('\nendstream\nendobj\n'),
    );
  });
  parts.push(Buffer.from('%%EOF\n'));
  return Buffer.concat(parts);
}

function duration(f) {
  const t = process.hrtime.bigint();
  let error = null;
  try {
    f();
  } catch (e) {
    error = e;
  }
  return { error, ms: Number(process.hrtime.bigint() - t) / 1e6 };
}

// Above the limit per stream, below the sum: case 1 checks the limit per stream.
const BOMBE = pdfFrom([zlib.deflateSync(Buffer.alloc(15 * 1024 * 1024))]);

test('1. a stream that unpacks beyond the limit is rejected', () => {
  assert.ok(BOMBE.length < 100 * 1024, `Vorbedingung: Bombe wiegt ${BOMBE.length} Bytes`);
  const { error } = duration(() => pdfText(BOMBE));
  assert.ok(error instanceof PdfTooLarge, `expected PdfTooLarge, got ${error}`);
});

test('2. many streams just below the limit add up', () => {
  const fast = zlib.deflateSync(Buffer.alloc(STREAM_MAX_BYTES - 1024));
  const n = Math.ceil(UNPACKED_MAX_BYTES / STREAM_MAX_BYTES) + 1;
  const { error } = duration(() => pdfText(pdfFrom(Array(n).fill(fast))));
  assert.ok(error instanceof PdfTooLarge, `${n} streams: expected PdfTooLarge, got ${error}`);
});

test('3. more streams than allowed are rejected', () => {
  const klein = zlib.deflateSync(Buffer.from('BT (x) Tj ET'));
  const { error } = duration(() => pdfText(pdfFrom(Array(STREAMS_MAX + 1).fill(klein))));
  assert.ok(error instanceof PdfTooLarge, `expected PdfTooLarge, got ${error}`);
  assert.equal(
    pdfText(pdfFrom(Array(10).fill(klein))).split('\n').length,
    10,
    'Ten small streams are allowed and are read',
  );
});

test('4. open beginnings cost no quadratic computing time', () => {
  const n = 80000;
  const faelle = {
    'stream ohne Ende': Buffer.from('%PDF-1.4\n' + 'stream\n'.repeat(n)),
    'Literal ohne Ende': Buffer.from('%PDF-1.4\nstream\n(' + '\\('.repeat(n) + '\nendstream'),
    'Feld ohne Ende': Buffer.from('%PDF-1.4\nstream\n[(' + '\\('.repeat(n) + ')\nendstream'),
    'Leerraum im Text': pdfFrom([Buffer.from('(im Wert von 1' + ' '.repeat(n) + ') Tj')]),
  };
  for (const [name, pdf] of Object.entries(faelle)) {
    const { error, ms } = duration(() => valuesFromPdf(pdf));
    assert.equal(error, null, `${name}: ${error}`);
    assert.ok(ms < 500, `${name}: ${ms.toFixed(0)} ms — reading is not linear`);
  }
});

test('5. valid text operators are still read', () => {
  const inhalt =
    'BT /F1 14 Tf 60 700 Td [(Ihre LEGO-Geschenkkarte im Wert von )-20(400 CHF:)] TJ\n' +
    '0 -20 Td (5045076374450011166) Tj <50494E3A2035323235> Tj\n' +
    "(Karte \\(neu\\) \\061) ' (Geschenk (Ostern)) Tj <</MCID 0>> BDC ET";
  const text = pdfText(pdfFrom([zlib.deflateSync(Buffer.from(inhalt, 'latin1'))]));
  assert.deepEqual(text.split('\n'), [
    'Ihre LEGO-Geschenkkarte im Wert von 400 CHF:',
    '5045076374450011166',
    'PIN: 5225',
    'Karte (neu) 1',
    'Geschenk (Ostern)',
  ]);
  assert.deepEqual(
    valuesFromPdf(pdfFrom([Buffer.from(inhalt, 'latin1')])),
    { number: '5045076374450011166', pin: '5225', amount: 400, currency: 'CHF' },
    'uncompressed as well',
  );
});

/** Two fonts, one with its own encoding; `inhalt` chooses them via Tf. */
async function twoFonts(inhalt) {
  const PL = require('@cantoo/pdf-lib');
  const doc = await PL.PDFDocument.create();
  const seite = doc.addPage([595, 842]);
  const ctx = doc.context;
  const eigen = ctx.obj({
    Type: 'Font',
    Subtype: 'TrueType',
    BaseFont: 'Sonderbar',
    Encoding: ctx.obj({ Type: 'Encoding', Differences: ctx.obj([48, PL.PDFName.of('five')]) }),
  });
  const sicher = ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' });
  seite.node.set(
    PL.PDFName.of('Resources'),
    ctx.obj({
      Font: ctx.obj({ F1: ctx.register(sicher), F9: ctx.register(eigen) }),
    }),
  );
  seite.node.set(
    PL.PDFName.of('Contents'),
    ctx.register(PL.PDFRawStream.of(ctx.obj({ Length: inhalt.length }), Buffer.from(inhalt, 'latin1'))),
  );
  return Buffer.from(await doc.save());
}

test('6. when replacing, the last font BEFORE the operator counts', async () => {
  const { replaceAmount } = _req('src/vouchers/pdfExport.js');
  const rest = 'BT /F1 12 Tf (5045076374450011166) Tj (PIN: 5225) Tj ET\n';
  const uncertain = await replaceAmount(
    await twoFonts('BT /F1 12 Tf (Karte) Tj /F9 14 Tf (im Wert von 400 CHF:) Tj ET\n' + rest),
    250,
  );
  assert.equal(uncertain.data, null, 'The amount in the custom encoding was replaced');
  assert.equal(uncertain.rejected, 1);

  const sicher = await replaceAmount(
    await twoFonts('BT /F9 14 Tf (Karte) Tj /F1 12 Tf (im Wert von 400 CHF:) Tj ET\n' + rest),
    250,
  );
  assert.ok(sicher.data, `WinAnsi rejected: ${sicher.reason}`);
  assert.equal(valuesFromPdf(sicher.data).amount, 250);
});

test('voucher upload: bomb and oversize do not get into storage', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c);
  } finally {
    c.release();
  }
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x')`);
  const uid = (await db.get(`SELECT id FROM users WHERE username='haupt'`)).id;
  const srv = testServer(_req, { sitzung: { userId: uid }, t });

  // With typed values: the route then also stores an unreadable PDF.
  async function uploadIt(pdf, number) {
    const fd = new FormData();
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'gutschein.pdf');
    fd.append('number', number);
    fd.append('pin', '1234');
    fd.append('amount', '50');
    fd.append('currency', 'CHF');
    const r = await fetch(`${srv.base}/api/v2/vouchers/pdf`, { method: 'POST', body: fd });
    const nummer_suche = _req('src/vouchers/repository/vouchers.js').numberSearch(uid, number);
    const row = await db.get('SELECT id FROM vouchers WHERE user_id=$1 AND number_search=$2', [uid, nummer_suche]);
    return { status: r.status, body: await r.json().catch(() => ({})), row };
  }

  await t.test('7. a decompression bomb is rejected even with typed-in values', async () => {
    const r = await uploadIt(BOMBE, '5045076374450099991');
    assert.equal(r.status, 422, `Status ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, 'pdf_unreadable');
    assert.equal(r.row, undefined, 'The voucher was created anyway');
  });

  await t.test('8. a PDF over 2 MB is not accepted', async () => {
    const gross = Buffer.concat([
      Buffer.from('%PDF-1.4\n%'),
      Buffer.alloc(2.5 * 1024 * 1024, 0x41),
      Buffer.from('\n%%EOF\n'),
    ]);
    const r = await uploadIt(gross, '5045076374450099992');
    assert.ok(r.status >= 400, `Status ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.row, undefined, 'The voucher was created anyway');

    const klein = await uploadIt(Buffer.from('%PDF-1.4\n%%EOF\n'), '5045076374450099993');
    assert.ok(klein.status < 300, `kleines PDF: ${klein.status} ${JSON.stringify(klein.body)}`);
    assert.ok(klein.row, 'precondition: with typed values a small PDF is stored');
  });
});
