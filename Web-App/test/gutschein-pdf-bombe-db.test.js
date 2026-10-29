/**
 * Ein Gutschein-PDF darf weder Speicher noch Rechenzeit sprengen.
 *
 * Gemessen an 8f4f9d3: 299 KB wurden zu 300 MB entpackt (inflateSync ohne
 * Grenze), und das faule Muster `stream\r?\n([\s\S]*?)endstream` sowie der
 * Textoperator-Ausdruck liefen bei offenen Anfängen quadratisch.
 *
 * ── Gegenproben (durchgeführt, Befunde GEMESSEN) ────────────────────────────
 *
 *   a) ohne maxOutputLength → 1 rot (15 MB entpackt, nichts geworfen) und
 *      7 rot (die Bombe wurde mit getippten Werten abgelegt, Status 200)
 *   b) Summengrenze ENTPACKT_MAX_BYTES ausgeschaltet → 2 rot
 *   c) Stromzahl nicht gezählt → 3 rot
 *   d) Ströme wieder per faulem Muster gesucht → 4 rot („stream ohne Ende: 7485 ms")
 *   e) Textoperatoren wieder per TEXT_OP_RE → 4 rot („Literal ohne Ende:
 *      5850 ms") und 5 rot (die geschachtelte Klammer fehlte)
 *   f) Betragsmuster wieder mit `\s+`/`+?`/`\s*` → 4 rot („Leerraum im Text: 2693 ms")
 *   g) Schriftwahl nimmt die erste statt der letzten Tf → 6 rot
 *   h) Route ohne den Zweig für PdfZuGross → 7 rot (Status 200)
 *   i) Upload-Grenze wieder 20 MB → 8 rot (2,5 MB wurden abgelegt)
 *
 * Voraussetzung für 7 und 8: Test-DB via TEST_DATABASE_URL. Ohne DB: skip,
 * ausser REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const zlib   = require('node:zlib');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';
// Vor dem Laden: appPaths rechnet DATA_DIR aus APP_ROOT beim Einlesen aus.
const SANDKASTEN = fs.mkdtempSync(path.join(os.tmpdir(), 'gutschein-bombe-'));
fs.mkdirSync(path.join(SANDKASTEN, 'data'), { recursive: true });
fs.writeFileSync(path.join(SANDKASTEN, 'package.json'), '{"name":"sandkasten"}');
process.env.APP_ROOT = SANDKASTEN;

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { pdfText, werteAusPdf, PdfZuGross, STROM_MAX_BYTES, ENTPACKT_MAX_BYTES, STROEME_MAX } =
  _req('utils/gutscheinPdf.js');
const { testServer } = require('./helpers/server');

test.after(async () => {
  await db.pool.end().catch(() => {});
  fs.rmSync(SANDKASTEN, { recursive: true, force: true });
});

/** Ein PDF aus rohen Strominhalten — genug für pdfText. */
function pdfAus(stroeme) {
  const teile = [Buffer.from('%PDF-1.4\n')];
  stroeme.forEach((s, i) => {
    teile.push(Buffer.from(`${i + 1} 0 obj\n<< /Length ${s.length} /Filter /FlateDecode >>\nstream\n`),
      s, Buffer.from('\nendstream\nendobj\n'));
  });
  teile.push(Buffer.from('%%EOF\n'));
  return Buffer.concat(teile);
}

function dauer(f) {
  const t = process.hrtime.bigint();
  let fehler = null;
  try { f(); } catch (e) { fehler = e; }
  return { fehler, ms: Number(process.hrtime.bigint() - t) / 1e6 };
}

// Über der Grenze je Strom, unter der Summe: Fall 1 prüft die Grenze je Strom.
const BOMBE = pdfAus([zlib.deflateSync(Buffer.alloc(15 * 1024 * 1024))]);

test('1. ein Strom, der über die Grenze entpackt, wird abgewiesen', () => {
  assert.ok(BOMBE.length < 100 * 1024, `Vorbedingung: Bombe wiegt ${BOMBE.length} Bytes`);
  const { fehler } = dauer(() => pdfText(BOMBE));
  assert.ok(fehler instanceof PdfZuGross, `Erwartet PdfZuGross, bekam ${fehler}`);
});

test('2. viele Ströme knapp unter der Grenze zählen zusammen', () => {
  const fast = zlib.deflateSync(Buffer.alloc(STROM_MAX_BYTES - 1024));
  const n = Math.ceil(ENTPACKT_MAX_BYTES / STROM_MAX_BYTES) + 1;
  const { fehler } = dauer(() => pdfText(pdfAus(Array(n).fill(fast))));
  assert.ok(fehler instanceof PdfZuGross, `${n} Ströme: erwartet PdfZuGross, bekam ${fehler}`);
});

test('3. mehr Ströme als erlaubt werden abgewiesen', () => {
  const klein = zlib.deflateSync(Buffer.from('BT (x) Tj ET'));
  const { fehler } = dauer(() => pdfText(pdfAus(Array(STROEME_MAX + 1).fill(klein))));
  assert.ok(fehler instanceof PdfZuGross, `Erwartet PdfZuGross, bekam ${fehler}`);
  assert.equal(pdfText(pdfAus(Array(10).fill(klein))).split('\n').length, 10,
    'Zehn kleine Ströme sind erlaubt und werden gelesen');
});

test('4. offene Anfänge kosten keine quadratische Rechenzeit', () => {
  const n = 80000;
  const faelle = {
    'stream ohne Ende':  Buffer.from('%PDF-1.4\n' + 'stream\n'.repeat(n)),
    'Literal ohne Ende': Buffer.from('%PDF-1.4\nstream\n(' + '\\('.repeat(n) + '\nendstream'),
    'Feld ohne Ende':    Buffer.from('%PDF-1.4\nstream\n[(' + '\\('.repeat(n) + ')\nendstream'),
    'Leerraum im Text':  pdfAus([Buffer.from('(im Wert von 1' + ' '.repeat(n) + ') Tj')]),
  };
  for (const [name, pdf] of Object.entries(faelle)) {
    const { fehler, ms } = dauer(() => werteAusPdf(pdf));
    assert.equal(fehler, null, `${name}: ${fehler}`);
    assert.ok(ms < 500, `${name}: ${ms.toFixed(0)} ms — das Lesen ist nicht linear`);
  }
});

test('5. gültige Textoperatoren werden weiter gelesen', () => {
  const inhalt = 'BT /F1 14 Tf 60 700 Td [(Ihre LEGO-Geschenkkarte im Wert von )-20(400 CHF:)] TJ\n'
    + '0 -20 Td (5045076374450011166) Tj <50494E3A2035323235> Tj\n'
    + '(Karte \\(neu\\) \\061) \' (Geschenk (Ostern)) Tj <</MCID 0>> BDC ET';
  const text = pdfText(pdfAus([zlib.deflateSync(Buffer.from(inhalt, 'latin1'))]));
  assert.deepEqual(text.split('\n'), [
    'Ihre LEGO-Geschenkkarte im Wert von 400 CHF:', '5045076374450011166', 'PIN: 5225',
    'Karte (neu) 1', 'Geschenk (Ostern)',
  ]);
  assert.deepEqual(werteAusPdf(pdfAus([Buffer.from(inhalt, 'latin1')])),
    { nummer: '5045076374450011166', pin: '5225', betrag: 400, waehrung: 'CHF' },
    'Auch unkomprimiert');
});

/** Zwei Schriften, eine mit eigener Kodierung; `inhalt` wählt sie per Tf. */
async function zweiSchriften(inhalt) {
  const PL = require('@cantoo/pdf-lib');
  const doc = await PL.PDFDocument.create();
  const seite = doc.addPage([595, 842]);
  const ctx = doc.context;
  const eigen = ctx.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'Sonderbar',
    Encoding: ctx.obj({ Type: 'Encoding', Differences: ctx.obj([48, PL.PDFName.of('five')]) }) });
  const sicher = ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' });
  seite.node.set(PL.PDFName.of('Resources'), ctx.obj({
    Font: ctx.obj({ F1: ctx.register(sicher), F9: ctx.register(eigen) }) }));
  seite.node.set(PL.PDFName.of('Contents'), ctx.register(
    PL.PDFRawStream.of(ctx.obj({ Length: inhalt.length }), Buffer.from(inhalt, 'latin1'))));
  return Buffer.from(await doc.save());
}

test('6. beim Ersetzen zählt die letzte Schrift VOR dem Operator', async () => {
  const { ersetzeBetrag } = _req('utils/gutscheinPdfSchreiben.js');
  const rest = 'BT /F1 12 Tf (5045076374450011166) Tj (PIN: 5225) Tj ET\n';
  const unsicher = await ersetzeBetrag(await zweiSchriften(
    'BT /F1 12 Tf (Karte) Tj /F9 14 Tf (im Wert von 400 CHF:) Tj ET\n' + rest), 250);
  assert.equal(unsicher.daten, null, 'Der Betrag in der eigenen Kodierung wurde ersetzt');
  assert.equal(unsicher.abgelehnt, 1);

  const sicher = await ersetzeBetrag(await zweiSchriften(
    'BT /F9 14 Tf (Karte) Tj /F1 12 Tf (im Wert von 400 CHF:) Tj ET\n' + rest), 250);
  assert.ok(sicher.daten, `WinAnsi abgelehnt: ${sicher.grund}`);
  assert.equal(werteAusPdf(sicher.daten).betrag, 250);
});

test('Gutschein-Upload: Bombe und Übergrösse kommen nicht in die Ablage', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x')`);
  const uid = (await db.get(`SELECT id FROM users WHERE username='haupt'`)).id;
  const srv = testServer(_req, {
    sitzung: { userId: uid }, apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t,
  });

  // Mit getippten Werten: Die Route legt dann auch ein unlesbares PDF ab.
  async function hochladen(pdf, nummer) {
    const fd = new FormData();
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'gutschein.pdf');
    fd.append('number', nummer); fd.append('pin', '1234');
    fd.append('amount', '50'); fd.append('currency', 'CHF');
    const r = await fetch(`${srv.base}/api/v1/vouchers/pdf`, { method: 'POST', body: fd });
    const zeile = await db.get('SELECT id FROM vouchers WHERE number=$1', [nummer]);
    return { status: r.status, body: await r.json().catch(() => ({})), zeile };
  }

  await t.test('7. eine Entpackbombe wird auch mit getippten Werten abgewiesen', async () => {
    const r = await hochladen(BOMBE, '5045076374450099991');
    assert.equal(r.status, 422, `Status ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, 'pdf_unlesbar');
    assert.equal(r.zeile, undefined, 'Der Gutschein wurde trotzdem angelegt');
  });

  await t.test('8. ein PDF über 2 MB wird nicht angenommen', async () => {
    const gross = Buffer.concat([Buffer.from('%PDF-1.4\n%'), Buffer.alloc(2.5 * 1024 * 1024, 0x41),
      Buffer.from('\n%%EOF\n')]);
    const r = await hochladen(gross, '5045076374450099992');
    assert.ok(r.status >= 400, `Status ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.zeile, undefined, 'Der Gutschein wurde trotzdem angelegt');

    const klein = await hochladen(Buffer.from('%PDF-1.4\n%%EOF\n'), '5045076374450099993');
    assert.ok(klein.status < 300, `kleines PDF: ${klein.status} ${JSON.stringify(klein.body)}`);
    assert.ok(klein.zeile, 'Vorbedingung: Mit getippten Werten wird ein kleines PDF abgelegt');
  });
});
