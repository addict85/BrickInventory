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
const { keineDb } = require('./helpers/db');
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
  { nr: '5045076374450011166', pin: '5225', gedruckt: '400', app: 250 },
  { nr: '5045076374450022277', pin: '1234', gedruckt: '150', app: 150 },
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
      await buildVoucher(k.gedruckt, k.nr, k.pin),
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
    keineDb(t, e);
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
  const exportiere = async () =>
    fetch(`${srv.base}/api/v2/vouchers/export/pdf?ticket=${(await (await freigabe()).json()).ticket}`);

  await t.test('1. the export delivers ONE PDF with all own vouchers', async () => {
    const r = await exportiere();
    assert.equal(r.status, 200, `Der Export antwortete mit ${r.status}`);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    pdf = Buffer.from(await r.arrayBuffer());
    assert.equal(pdf.slice(0, 5).toString(), '%PDF-', 'Das ist kein PDF');
    assert.equal(
      (await PL.PDFDocument.load(pdf)).getPageCount(),
      3,
      'Erwartet drei Seiten — zwei mit Original, eine erzeugt',
    );

    const kopf = r.headers.get('x-gutschein-befunde');
    assert.ok(
      kopf,
      'Die Befunde fehlen im Kopf. Der Rumpf IST das PDF, also ist der ' +
        'Kopf der einzige Platz, an dem stehen kann, was aus jedem Gutschein wurde.',
    );
    befunde = JSON.parse(Buffer.from(kopf, 'base64').toString('utf-8'));
    assert.equal(befunde.length, 3, `${befunde.length} Befunde statt 3`);
    assert.deepEqual(
      befunde.map(b => b.kind),
      ['ersetzt', 'stimmte_schon', 'erzeugt'],
      `Die Befunde lauten ${JSON.stringify(befunde.map(b => b.kind))} — erwartet: der ` +
        'erste wird ersetzt (400→250), der zweite stimmt schon (150), der dritte hat ' +
        'kein Original',
    );
    // „stimmte_schon" is a kind of its own and NOT an open point. Until
    // 15.10. this case carried `unveraendert` including a reason, and the UI
    // showed it as a warning — Marco read twice in his export
    // „⚠ …: Der Betrag im PDF stimmt schon", i.e. a warning about a
    // success. Here the difference is fixed.
    assert.equal(
      befunde.filter(b => b.kind === 'unveraendert' && b.reason).length,
      0,
      'Ein „stimmt schon" darf nicht als offener Punkt zählen',
    );
  });

  await t.test('2. the FOREIGN voucher is not included', async () => {
    // A voucher carries number and PIN. In the export of another account
    // that would be passing on a means of payment.
    const { readPageByPage } = _req('src/vouchers/pdfExport.js');
    const drin = (await readPageByPage(pdf)).map(w => w.number);
    assert.ok(
      !drin.includes('9999999999999999999'),
      `Im eigenen Export steht die Karte eines fremden Kontos: ${drin.join(', ')}`,
    );
    assert.equal(drin.length, 3, `${drin.length} Karten im PDF statt 3`);
  });

  await t.test('3. the exported PDF carries the APP amount, not the printed one', async () => {
    const { readPageByPage } = _req('src/vouchers/pdfExport.js');
    const parsed = await readPageByPage(pdf);
    for (const k of CARDS) {
      const w = parsed.find(x => x.number === k.nr);
      assert.ok(w, `${k.nr} fehlt im Export`);
      assert.equal(
        w.amount,
        k.app,
        `${k.nr}: ${w.amount} statt ${k.app}. Auf der Karte steht ${k.gedruckt} — ` +
          'der Export soll den Stand der App zeigen, das war Marcos Vorgabe.',
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
    assert.equal(r.status, 200, `Der Import antwortete mit ${r.status}: ${JSON.stringify(b)}`);
    assert.ok(b.multiple, `Erwartet den Stapelfall, bekam ${JSON.stringify(b)}`);
    assert.equal(
      b.voucher,
      undefined,
      'Bei mehreren Gutscheinen darf kein einzelner „voucher" danebenstehen — ' +
        'eine Oberfläche müsste sonst raten, welcher der drei gemeint ist',
    );
    assert.equal(b.multiple.added, 3, `${b.multiple.added} angelegt statt 3: ${JSON.stringify(b.multiple.results)}`);
    assert.equal(b.multiple.errors, 0, `${b.multiple.errors} Fehler: ${JSON.stringify(b.multiple.results)}`);

    for (const k of CARDS) {
      const z = await db.get('SELECT id, amount, pin, currency FROM vouchers WHERE user_id=$1 AND number_search=$2', [
        MAIN,
        suche(MAIN, k.nr),
      ]);
      assert.ok(z, `${k.nr} kam nicht zurück`);
      assert.equal(Number(z.amount), k.app, `${k.nr}: ${z.amount} statt ${k.app}`);
      assert.equal(
        _req('src/infra/secret.js').decrypt(z.pin, _req('src/vouchers/repository/vouchers.js').pinContext(MAIN, z.id)),
        k.pin,
        `${k.nr}: PIN ${z.pin} statt ${k.pin}`,
      );
    }
    // And the one captured by hand, which never had a PDF.
    const ohne = await db.get('SELECT amount, pin FROM vouchers WHERE user_id=$1 AND number_search=$2', [
      MAIN,
      suche(MAIN, '5045076374450033388'),
    ]);
    assert.ok(ohne, 'Der von Hand erfasste Gutschein kam nicht zurück');
    assert.equal(Number(ohne.amount), 42.5);
    assert.equal(ohne.pin, null, 'Aus „keine PIN" wurde etwas anderes');
  });

  await t.test('5. a second import refreshes the amount instead of doing nothing', async () => {
    // The case the import exists for: the account already knows the cards,
    // and the amount has changed. With ON CONFLICT DO NOTHING the
    // import would be ineffective here — and exactly then one needs it.
    await db.run('UPDATE vouchers SET amount = 1 WHERE user_id=$1', [MAIN]);
    const fd = new FormData();
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'gutscheine.pdf');
    const b = (await (await fetch(`${srv.base}/api/v2/vouchers/pdf`, { method: 'POST', body: fd })).json()).multiple;
    assert.equal(b.added, 0, `${b.added} neu angelegt — die Karten gab es schon`);
    assert.equal(b.updated, 3, `${b.updated} aufgefrischt statt 3`);
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
      'Der Betrag wurde nicht aufgefrischt',
    );
    assert.equal(
      (await db.get('SELECT COUNT(*)::int c FROM vouchers WHERE user_id=$1', [MAIN])).c,
      3,
      'Der zweite Import hat die Tabelle verdoppelt',
    );
  });

  await t.test('6. without a voucher an information comes, not an empty PDF', async () => {
    await db.run('DELETE FROM vouchers WHERE user_id=$1', [MAIN]);
    const r = await freigabe();
    assert.equal(r.status, 404, `Erwartet 404, bekam ${r.status}`);
    const b = await r.json().catch(() => ({}));
    assert.match(
      String(b.error || ''),
      /keine Gutscheine/i,
      `Abgelehnt mit „${b.error}" — der Text soll sagen, dass keine erfasst sind`,
    );
  });

  await t.test('7. a file that is not a PDF yields 422 and no entry', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from('kein PDF, nur Text')], { type: 'application/pdf' }), 'kaputt.pdf');
    const r = await fetch(`${srv.base}/api/v2/vouchers/pdf`, { method: 'POST', body: fd });
    assert.equal(
      r.status,
      422,
      `Erwartet 422, bekam ${r.status}. Eine kaputte Datei ist eine Aussage über die ` + 'Datei, kein Serverfehler.',
    );
    assert.equal(
      (await r.json()).code,
      'pdf_unreadable',
      'Seit beide Wege auf einer Adresse liegen, kommt die kaputte Datei beim ' +
        'EINZELweg an. Ohne eigenen Code stünde dort „amount_invalid" — eine ' +
        'Auskunft über ein Feld, das es in dieser Datei gar nicht gibt.',
    );
    assert.equal(
      (await db.get('SELECT COUNT(*)::int c FROM vouchers WHERE user_id=$1', [MAIN])).c,
      0,
      'Es wurde trotzdem etwas angelegt',
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
    assert.equal(r.status, 200, `Antwort ${r.status}: ${JSON.stringify(b)}`);
    assert.equal(b.multiple, undefined, `Ein einzelner Gutschein darf nicht als Stapel gelten: ${JSON.stringify(b)}`);
    assert.ok(b.voucher, 'Der Einzelfall antwortet mit `voucher`');
    assert.equal(b.parsed.number, CARDS[0].nr);
    assert.equal(b.voucher.number, '…' + CARDS[0].nr.slice(-4), 'nach aussen nur das Ende');
    assert.equal(b.voucher.has_pdf, true, 'Beim Einzelgutschein wird die Datei als sein Original gespeichert');
  });
});
