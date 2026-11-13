/**
 * Gutschein-Export und -Import über ihre echten Adressen.
 *
 * ── Gegenproben (durchgeführt, Befunde GEMESSEN — siehe Commit) ─────────────
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
 * REQUIRE_DB=1.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PDFKit = require('pdfkit');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
// APP_ROOT, nicht DATA_DIR
const SANDKASTEN = fs.mkdtempSync(path.join(os.tmpdir(), 'gutschein-wurzel-'));
fs.mkdirSync(path.join(SANDKASTEN, 'data'), { recursive: true });
// package.json, damit findRoot() hier stehenbleibt und nicht weiter nach oben
// laeuft (es sucht die naechste package.json). APP_ROOT hat Vorrang, also ist
// das nur ein Gurt neben dem Hosentraeger.
fs.writeFileSync(path.join(SANDKASTEN, 'package.json'), '{"name":"sandkasten"}');
process.env.APP_ROOT = SANDKASTEN;
const DATEN_DIR = path.join(SANDKASTEN, 'data');

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testDaten();
const { testServer } = require('./helpers/server');
const PL = require('@cantoo/pdf-lib');
const suche = (uid, nr) => _req('src/gutscheine/repository/gutscheine.js').nummerSuche(uid, nr);

test.after(async () => {
  await db.pool.end().catch(() => {});
});

let HAUPT = 0,
  FREMD = 0;

const KARTEN = [
  { nr: '5045076374450011166', pin: '5225', gedruckt: '400', app: 250 },
  { nr: '5045076374450022277', pin: '1234', gedruckt: '150', app: 150 },
];

function baueGutschein(betragText, nummer, pin) {
  return new Promise(fertig => {
    const d = new PDFKit({ size: 'A4' });
    const s = [];
    d.on('data', c => s.push(c));
    d.on('end', () => fertig(Buffer.concat(s)));
    d.fontSize(14).text(`Ihre LEGO-Geschenkkarte im Wert von ${betragText} CHF:`, 60, 100);
    d.fontSize(12).text(nummer, 60, 140).text(`PIN: ${pin}`, 60, 170);
    d.end();
  });
}

const PASS = 'Export-Passwort-1';

async function aufbau() {
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
  HAUPT = (await db.get(`SELECT id FROM users WHERE username='haupt'`)).id;
  FREMD = (await db.get(`SELECT id FROM users WHERE username='fremd'`)).id;

  const dir = path.join(DATEN_DIR, 'vouchers', String(HAUPT));
  await fs.promises.mkdir(dir, { recursive: true });
  const { gutscheinAnlegen } = require('./helpers/sources').testBereich('gutscheine').gutscheine;
  for (const k of KARTEN) {
    const z = await gutscheinAnlegen(HAUPT, { number: k.nr, pin: k.pin, amount: k.app, currency: 'CHF' });
    await _req('src/gutscheine/gutscheinDateien.js').schreibeGutscheinPdf(
      path.join(dir, `${z.id}.pdf`),
      await baueGutschein(k.gedruckt, k.nr, k.pin),
    );
    await db.run('UPDATE vouchers SET pdf_path=$1 WHERE id=$2', [`${HAUPT}/${z.id}.pdf`, z.id]);
  }
  // Ein Gutschein OHNE Original — von Hand erfasst.
  await gutscheinAnlegen(HAUPT, { number: '5045076374450033388', pin: null, amount: 42.5, currency: 'CHF' });
  // Und einer in einem FREMDEN Konto, der im eigenen Export nichts zu suchen hat.
  await gutscheinAnlegen(FREMD, { number: '9999999999999999999', pin: '0000', amount: 99, currency: 'CHF' });
}

test('Gutscheine: Export und Import über die echten Adressen', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await aufbau();

  const srv = testServer(_req, { sitzung: { userId: HAUPT }, t });

  let pdf = null,
    befunde = null;
  /** Erst die bestätigte Freigabe, dann der eine Abruf mit dem Ticket. */
  const freigabe = () =>
    fetch(`${srv.base}/api/v1/vouchers/export/pdf-freigabe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASS }),
    });
  const exportiere = async () =>
    fetch(`${srv.base}/api/v1/vouchers/export/pdf?ticket=${(await (await freigabe()).json()).ticket}`);

  await t.test('1. der Export liefert EIN PDF mit allen eigenen Gutscheinen', async () => {
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
      befunde.map(b => b.art),
      ['ersetzt', 'stimmte_schon', 'erzeugt'],
      `Die Befunde lauten ${JSON.stringify(befunde.map(b => b.art))} — erwartet: der ` +
        'erste wird ersetzt (400→250), der zweite stimmt schon (150), der dritte hat ' +
        'kein Original',
    );
    // „stimmte_schon" ist eine eigene Art und KEIN offener Punkt. Bis zum
    // 15.10. trug dieser Fall `unveraendert` samt Grund, und die Oberfläche
    // zeigte ihn als Warnung — Marco las in seinem Export zweimal
    // „⚠ …: Der Betrag im PDF stimmt schon", also eine Warnung vor einem
    // Erfolg. Hier steht der Unterschied fest.
    assert.equal(
      befunde.filter(b => b.art === 'unveraendert' && b.grund).length,
      0,
      'Ein „stimmt schon" darf nicht als offener Punkt zählen',
    );
  });

  await t.test('2. der FREMDE Gutschein ist nicht dabei', async () => {
    // Ein Gutschein traegt Nummer und PIN. Im Export eines anderen Kontos
    // waere das die Weitergabe eines Zahlungsmittels.
    const { seitenweiseLesen } = _req('src/gutscheine/gutscheinPdfSchreiben.js');
    const drin = (await seitenweiseLesen(pdf)).map(w => w.nummer);
    assert.ok(
      !drin.includes('9999999999999999999'),
      `Im eigenen Export steht die Karte eines fremden Kontos: ${drin.join(', ')}`,
    );
    assert.equal(drin.length, 3, `${drin.length} Karten im PDF statt 3`);
  });

  await t.test('3. das exportierte PDF trägt den APP-Betrag, nicht den gedruckten', async () => {
    const { seitenweiseLesen } = _req('src/gutscheine/gutscheinPdfSchreiben.js');
    const gelesen = await seitenweiseLesen(pdf);
    for (const k of KARTEN) {
      const w = gelesen.find(x => x.nummer === k.nr);
      assert.ok(w, `${k.nr} fehlt im Export`);
      assert.equal(
        w.betrag,
        k.app,
        `${k.nr}: ${w.betrag} statt ${k.app}. Auf der Karte steht ${k.gedruckt} — ` +
          'der Export soll den Stand der App zeigen, das war Marcos Vorgabe.',
      );
    }
  });

  await t.test('4. dasselbe PDF stellt die geleerte Tabelle wieder her', async () => {
    await db.run('DELETE FROM vouchers WHERE user_id=$1', [HAUPT]);
    const fd = new FormData();
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'gutscheine.pdf');
    // DIESELBE Adresse wie fuer einen einzelnen Gutschein (Marcos Durchsicht
    // vom 15.10.: ein Dateifeld, nicht zwei). Der Server sieht drei Seiten und
    // antwortet mit `mehrere` statt mit `voucher`.
    const r = await fetch(`${srv.base}/api/v1/vouchers/pdf`, { method: 'POST', body: fd });
    const b = await r.json();
    assert.equal(r.status, 200, `Der Import antwortete mit ${r.status}: ${JSON.stringify(b)}`);
    assert.ok(b.mehrere, `Erwartet den Stapelfall, bekam ${JSON.stringify(b)}`);
    assert.equal(
      b.voucher,
      undefined,
      'Bei mehreren Gutscheinen darf kein einzelner „voucher" danebenstehen — ' +
        'eine Oberfläche müsste sonst raten, welcher der drei gemeint ist',
    );
    assert.equal(b.mehrere.added, 3, `${b.mehrere.added} angelegt statt 3: ${JSON.stringify(b.mehrere.results)}`);
    assert.equal(b.mehrere.errors, 0, `${b.mehrere.errors} Fehler: ${JSON.stringify(b.mehrere.results)}`);

    for (const k of KARTEN) {
      const z = await db.get('SELECT id, amount, pin, currency FROM vouchers WHERE user_id=$1 AND nummer_suche=$2', [
        HAUPT,
        suche(HAUPT, k.nr),
      ]);
      assert.ok(z, `${k.nr} kam nicht zurück`);
      assert.equal(Number(z.amount), k.app, `${k.nr}: ${z.amount} statt ${k.app}`);
      assert.equal(
        _req('src/infra/geheimnis.js').entschluessele(
          z.pin,
          _req('src/gutscheine/repository/gutscheine.js').pinKontext(HAUPT, z.id),
        ),
        k.pin,
        `${k.nr}: PIN ${z.pin} statt ${k.pin}`,
      );
    }
    // Und der von Hand erfasste, der nie ein PDF hatte.
    const ohne = await db.get('SELECT amount, pin FROM vouchers WHERE user_id=$1 AND nummer_suche=$2', [
      HAUPT,
      suche(HAUPT, '5045076374450033388'),
    ]);
    assert.ok(ohne, 'Der von Hand erfasste Gutschein kam nicht zurück');
    assert.equal(Number(ohne.amount), 42.5);
    assert.equal(ohne.pin, null, 'Aus „keine PIN" wurde etwas anderes');
  });

  await t.test('5. ein zweiter Import frischt den Betrag auf, statt nichts zu tun', async () => {
    // Der Fall, für den es den Import gibt: Das Konto kennt die Karten schon,
    // und der Betrag hat sich geändert. Mit ON CONFLICT DO NOTHING wäre der
    // Import hier wirkungslos — und genau dann braucht man ihn.
    await db.run('UPDATE vouchers SET amount = 1 WHERE user_id=$1', [HAUPT]);
    const fd = new FormData();
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'gutscheine.pdf');
    const b = (await (await fetch(`${srv.base}/api/v1/vouchers/pdf`, { method: 'POST', body: fd })).json()).mehrere;
    assert.equal(b.added, 0, `${b.added} neu angelegt — die Karten gab es schon`);
    assert.equal(b.updated, 3, `${b.updated} aufgefrischt statt 3`);
    assert.equal(
      Number(
        (
          await db.get('SELECT amount FROM vouchers WHERE user_id=$1 AND nummer_suche=$2', [
            HAUPT,
            suche(HAUPT, KARTEN[0].nr),
          ])
        ).amount,
      ),
      KARTEN[0].app,
      'Der Betrag wurde nicht aufgefrischt',
    );
    assert.equal(
      (await db.get('SELECT COUNT(*)::int c FROM vouchers WHERE user_id=$1', [HAUPT])).c,
      3,
      'Der zweite Import hat die Tabelle verdoppelt',
    );
  });

  await t.test('6. ohne Gutschein kommt eine Auskunft, kein leeres PDF', async () => {
    await db.run('DELETE FROM vouchers WHERE user_id=$1', [HAUPT]);
    const r = await freigabe();
    assert.equal(r.status, 404, `Erwartet 404, bekam ${r.status}`);
    const b = await r.json().catch(() => ({}));
    assert.match(
      String(b.error || ''),
      /keine Gutscheine/i,
      `Abgelehnt mit „${b.error}" — der Text soll sagen, dass keine erfasst sind`,
    );
  });

  await t.test('7. eine Datei, die kein PDF ist, ergibt 422 und keinen Eintrag', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from('kein PDF, nur Text')], { type: 'application/pdf' }), 'kaputt.pdf');
    const r = await fetch(`${srv.base}/api/v1/vouchers/pdf`, { method: 'POST', body: fd });
    assert.equal(
      r.status,
      422,
      `Erwartet 422, bekam ${r.status}. Eine kaputte Datei ist eine Aussage über die ` + 'Datei, kein Serverfehler.',
    );
    assert.equal(
      (await r.json()).code,
      'pdf_unlesbar',
      'Seit beide Wege auf einer Adresse liegen, kommt die kaputte Datei beim ' +
        'EINZELweg an. Ohne eigenen Code stünde dort „betrag_ungueltig" — eine ' +
        'Auskunft über ein Feld, das es in dieser Datei gar nicht gibt.',
    );
    assert.equal(
      (await db.get('SELECT COUNT(*)::int c FROM vouchers WHERE user_id=$1', [HAUPT])).c,
      0,
      'Es wurde trotzdem etwas angelegt',
    );
  });

  await t.test('8. EIN Gutschein im PDF bleibt der Einzelfall — mit Datei', async () => {
    // Die Entscheidung „einer oder mehrere" trifft der Server, und sie muss in
    // beide Richtungen stimmen. Bei einem einzigen Gutschein gilt der alte
    // Vertrag unverändert: `voucher` statt `mehrere`, und die Datei wird als
    // Original des Gutscheins GESPEICHERT (beim Stapel nicht — dort ist sie
    // die Sicherung, nicht die Karte).
    await db.run('DELETE FROM vouchers WHERE user_id=$1', [HAUPT]);
    const eine = await baueGutschein('250', KARTEN[0].nr, KARTEN[0].pin);
    const fd = new FormData();
    fd.append('file', new Blob([eine], { type: 'application/pdf' }), 'einer.pdf');
    const r = await fetch(`${srv.base}/api/v1/vouchers/pdf`, { method: 'POST', body: fd });
    const b = await r.json();
    assert.equal(r.status, 200, `Antwort ${r.status}: ${JSON.stringify(b)}`);
    assert.equal(b.mehrere, undefined, `Ein einzelner Gutschein darf nicht als Stapel gelten: ${JSON.stringify(b)}`);
    assert.ok(b.voucher, 'Der Einzelfall antwortet mit `voucher`');
    assert.equal(b.gelesen.number, KARTEN[0].nr);
    assert.equal(b.voucher.number, '…' + KARTEN[0].nr.slice(-4), 'nach aussen nur das Ende');
    assert.equal(b.voucher.hat_pdf, true, 'Beim Einzelgutschein wird die Datei als sein Original gespeichert');
  });
});
