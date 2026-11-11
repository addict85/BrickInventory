/**
 * Die Gutscheinnummer liegt verschlüsselt in der Datenbank: nach dem Anlegen
 * in keiner Spalte im Klartext, über die API lesbar wie zuvor, Doppelte über
 * den HMAC in nummer_suche erkannt. PDF, Export und Import tragen die Nummer
 * weiter, und ein Altbestand aus der Zeit davor wird beim Start umgeschlüsselt,
 * samt der Sicherungskopie, die die Migration anlegt.
 *
 * Gegenproben (am 01.11.2026 gemessen):
 *   A  in gutscheinAnlegen die Nummer unverschlüsselt geschrieben → rot:
 *      „nach dem Anlegen …“ (500: der CHECK der Migration lehnt ab)
 *   B  wie A und zusätzlich den CHECK aus 0087 entfernt → rot: „nach dem
 *      Anlegen …“ (die Nummer steht in der Zeile)
 *   C  nummerSpalten() ohne das Konto im HMAC → rot: „Doppelte …“ (zwei
 *      Konten, derselbe Suchwert)
 *   D  in bereiteDatenbankVor() nummernNachverschluesseln() weggelassen →
 *      rot: „ein Altbestand …“
 *   E  kopienVerschluesseln() weggelassen → rot: „ein Altbestand …“ (die
 *      Kopie vor_migration_* trägt die Nummer im Klartext)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PDFKit = require('pdfkit');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATA_KEY = crypto.randomBytes(32).toString('base64');
// Vor dem Laden: appPaths rechnet DATA_DIR beim Einlesen aus APP_ROOT.
const SANDKASTEN = fs.mkdtempSync(path.join(os.tmpdir(), 'gutscheinnummer-'));
fs.mkdirSync(path.join(SANDKASTEN, 'data'), { recursive: true });
fs.writeFileSync(path.join(SANDKASTEN, 'package.json'), '{"name":"sandkasten"}');
process.env.APP_ROOT = SANDKASTEN;

const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const gr = { ..._req('src/gutscheine/repository/gutscheine.js'), ..._req('src/gutscheine/prozess.js').gutscheineBereich().gutscheine };
/** Das Format vor dem Kontext: v1, AES-GCM mit dem Rohschlüssel, ohne AAD. */
function alsV1(klar) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', Buffer.from(process.env.DATA_KEY, 'base64'), iv);
  const d = Buffer.concat([c.update(klar, 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), d]).toString('base64');
}
const g = _req('src/infra/geheimnis.js');

const PASS = 'Nummer-Passwort-1';
const NR1 = '5045076374451234567', NR2 = '5045076374459876543', NR3 = '5045076374450246802';

function baueGutschein(nummer, pin, betrag) {
  return new Promise((fertig) => {
    const d = new PDFKit({ size: 'A4' });
    const s = [];
    d.on('data', (c) => s.push(c));
    d.on('end', () => fertig(Buffer.concat(s)));
    d.fontSize(14).text(`Ihre LEGO-Geschenkkarte im Wert von ${betrag} CHF:`, 60, 100);
    d.fontSize(12).text(nummer, 60, 140).text(`PIN: ${pin}`, 60, 170);
    d.end();
  });
}

const zeileAlsText = async (id) => (await db.get('SELECT v::text AS t FROM vouchers v WHERE id = $1', [id])).t;

test('Gutscheinnummer verschlüsselt', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    keineDb(t, e); return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  const hash = require('bcryptjs').hashSync(PASS, 4);
  await db.run(`INSERT INTO users (username, password_hash) VALUES ('haupt', $1), ('fremd', $1)`, [hash]);
  const HAUPT = (await db.get(`SELECT id FROM users WHERE username = 'haupt'`)).id;
  const FREMD = (await db.get(`SELECT id FROM users WHERE username = 'fremd'`)).id;
  t.after(async () => {
    await db.pool.end().catch(() => {});
    fs.rmSync(SANDKASTEN, { recursive: true, force: true });
  });

  const haupt = testServer(_req, { sitzung: { userId: HAUPT }, apiNutzer: { user_id: HAUPT, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const fremd = testServer(_req, { sitzung: { userId: FREMD }, apiNutzer: { user_id: FREMD, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const ruf = async (srv, methode, weg, body) => {
    const r = await fetch(`${srv.base}/api/v1${weg}`, { method: methode,
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json() };
  };
  /** Nummer und PIN über den bestätigten Weg; die Liste zeigt nur die Maske. */
  const klartext = async (srv, id) => {
    const k = await ruf(srv, 'POST', `/vouchers/${id}/klartext`, { password: PASS });
    assert.equal(k.status, 200, JSON.stringify(k.body));
    return [k.body.number, k.body.pin];
  };
  let id1;

  await t.test('nach dem Anlegen steht die Nummer in keiner Spalte im Klartext', async () => {
    const r = await ruf(haupt, 'POST', '/vouchers', { number: NR1, pin: '2468', amount: 50, currency: 'CHF' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.voucher.number, '…' + NR1.slice(-4), 'nach aussen nur das Ende');
    id1 = r.body.voucher.id;
    assert.deepEqual(await klartext(haupt, id1), [NR1, '2468'], 'der Eigentümer liest die Nummer bestätigt');
    const zeile = await zeileAlsText(id1);
    assert.ok(!zeile.includes(NR1) && !zeile.includes(NR1.slice(-6)), zeile);
    const roh = await db.get('SELECT number, nummer_suche FROM vouchers WHERE id = $1', [id1]);
    assert.ok(roh.number.startsWith('v2:'), roh.number);
    assert.match(roh.nummer_suche, /^[0-9a-f]{64}$/);
  });

  await t.test('lesen und ändern', async () => {
    const liste = await ruf(haupt, 'GET', '/vouchers');
    assert.deepEqual(liste.body.vouchers.map(v => [v.id, v.number, v.pin]), [[id1, '…' + NR1.slice(-4), '•••']]);
    const suche = (await db.get('SELECT nummer_suche FROM vouchers WHERE id = $1', [id1])).nummer_suche;
    const r = await ruf(haupt, 'PUT', `/vouchers/${id1}`, { number: NR2 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await klartext(haupt, id1))[0], NR2);
    const zeile = await zeileAlsText(id1);
    assert.ok(!zeile.includes(NR2) && !zeile.includes(NR1), zeile);
    assert.notEqual((await db.get('SELECT nummer_suche FROM vouchers WHERE id = $1', [id1])).nummer_suche, suche);
    // Nur der Betrag: Die Nummer kommt entschlüsselt aus der Zeile und geht verschlüsselt zurück.
    const b = await ruf(haupt, 'PUT', `/vouchers/${id1}`, { amount: 40 });
    assert.deepEqual([b.status, (await klartext(haupt, id1))[0], b.body.voucher.amount], [200, NR2, 40]);
    assert.ok(!(await zeileAlsText(id1)).includes(NR2));
  });

  await t.test('Doppelte werden erkannt, je Konto', async () => {
    const doppelt = await ruf(haupt, 'POST', '/vouchers', { number: NR2, amount: 10 });
    assert.deepEqual([doppelt.status, doppelt.body.code], [409, 'gutschein_existiert']);
    const zweiter = await ruf(haupt, 'POST', '/vouchers', { number: NR3, amount: 10 });
    assert.equal(zweiter.status, 200);
    const umbenannt = await ruf(haupt, 'PUT', `/vouchers/${zweiter.body.voucher.id}`, { number: NR2 });
    assert.deepEqual([umbenannt.status, umbenannt.body.code], [409, 'gutschein_existiert']);
    const anderesKonto = await ruf(fremd, 'POST', '/vouchers', { number: NR2, amount: 10 });
    assert.equal(anderesKonto.status, 200, 'dieselbe Karte in einem anderen Konto ist erlaubt');
    const suchwerte = await db.all('SELECT DISTINCT nummer_suche FROM vouchers WHERE id = ANY($1)',
      [[id1, anderesKonto.body.voucher.id]]);
    assert.equal(suchwerte.length, 2, 'derselbe Suchwert in zwei Konten verriete, dass sie dieselbe Karte halten');
  });

  await t.test('PDF, Export und Import tragen die Nummer', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([await baueGutschein(NR1, '1357', '25')], { type: 'application/pdf' }), 'g.pdf');
    const r = await fetch(`${haupt.base}/api/v1/vouchers/pdf`, { method: 'POST', body: fd });
    const b = await r.json();
    assert.equal(r.status, 200, JSON.stringify(b));
    assert.deepEqual([(await klartext(haupt, b.voucher.id))[0], b.voucher.hat_pdf], [NR1, true]);
    assert.ok(!(await zeileAlsText(b.voucher.id)).includes(NR1));
    const ticket = async (weg) => (await ruf(haupt, 'POST', weg, { password: PASS })).body.ticket;
    const datei = await fetch(`${haupt.base}/api/v1/vouchers/${b.voucher.id}/pdf?download=1&ticket=${await ticket(`/vouchers/${b.voucher.id}/pdf-freigabe`)}`);
    await datei.arrayBuffer();
    assert.equal(datei.headers.get('content-disposition'), `attachment; filename="gutschein-${b.voucher.id}.pdf"`, 'die Nummer steht nicht im Dateinamen');

    const ex = await fetch(`${haupt.base}/api/v1/vouchers/export/pdf?ticket=${await ticket('/vouchers/export/pdf-freigabe')}`);
    assert.equal(ex.status, 200);
    const pdf = Buffer.from(await ex.arrayBuffer());
    const { seitenweiseLesen } = _req('src/gutscheine/gutscheinPdfSchreiben.js');
    assert.deepEqual((await seitenweiseLesen(pdf)).map(w => w.nummer).sort(), [NR1, NR2, NR3].sort());

    await db.run('DELETE FROM vouchers WHERE user_id = $1', [HAUPT]);
    const im = new FormData();
    im.append('file', new Blob([pdf], { type: 'application/pdf' }), 'alle.pdf');
    const imp = await (await fetch(`${haupt.base}/api/v1/vouchers/pdf`, { method: 'POST', body: im })).json();
    assert.deepEqual([imp.mehrere.added, imp.mehrere.errors], [3, 0], JSON.stringify(imp));
    const liste = await ruf(haupt, 'GET', '/vouchers');
    const nummern = [];
    for (const v of liste.body.vouchers) nummern.push((await klartext(haupt, v.id))[0]);
    assert.deepEqual(nummern.sort(), [NR1, NR2, NR3].sort());
    for (const v of liste.body.vouchers) assert.ok(!(await zeileAlsText(v.id)).includes((await klartext(haupt, v.id))[0]));
    const nochmal = new FormData();
    nochmal.append('file', new Blob([pdf], { type: 'application/pdf' }), 'alle.pdf');
    const zweit = await (await fetch(`${haupt.base}/api/v1/vouchers/pdf`, { method: 'POST', body: nochmal })).json();
    assert.deepEqual([zweit.mehrere.added, zweit.mehrere.updated], [0, 3], 'der zweite Import erkennt die Karten wieder');
  });

  await t.test('ein Altbestand wird beim Start umgeschlüsselt, samt Sicherungskopie', async () => {
    // Der Stand vor 0087: Nummer im Klartext, eindeutig über (user_id, number).
    await db.run('DELETE FROM vouchers');
    await db.run(`ALTER TABLE vouchers DROP CONSTRAINT vouchers_nummer_verschluesselt,
      DROP CONSTRAINT vouchers_user_id_nummer_suche_key, DROP COLUMN nummer_suche,
      ADD CONSTRAINT vouchers_user_id_number_key UNIQUE (user_id, number)`);
    await db.run(`DELETE FROM schema_migrations WHERE name IN ('0087-gutscheinnummer-verschluesselt.sql', '0088-geheimnisse-mit-kontext.sql')`);
    const alt = [[HAUPT, NR1, '1357'], [FREMD, NR1, null], [HAUPT, NR3, alsV1('8642')]];
    const ids = [];
    for (const [uid, nr, pin] of alt) ids.push((await db.get(`INSERT INTO vouchers (user_id, number, pin, amount, currency)
      VALUES ($1, $2, $3, 10, 'CHF') RETURNING id`, [uid, nr, pin])).id);

    await _req('startup/datenbank.js').bereiteDatenbankVor(_req('db/database.js').standardDb());

    assert.ok(await db.get(`SELECT 1 FROM schema_migrations WHERE name = '0087-gutscheinnummer-verschluesselt.sql'`));
    const zeilen = await db.all('SELECT id, user_id, number, nummer_suche FROM vouchers WHERE id = ANY($1) ORDER BY id', [ids]);
    assert.deepEqual(zeilen.map(z => g.entschluessele(z.number, gr.nummerKontext(z.user_id, z.id))), [NR1, NR1, NR3]);
    for (const z of zeilen) {
      assert.ok(z.number.startsWith('v2:') && z.nummer_suche, JSON.stringify(z));
      assert.ok(!(await zeileAlsText(z.id)).includes(NR1.slice(-6)) && !(await zeileAlsText(z.id)).includes(NR3.slice(-6)));
    }
    assert.notEqual(zeilen[0].nummer_suche, zeilen[1].nummer_suche);
    const liste = await ruf(haupt, 'GET', '/vouchers');
    const werte = [];
    for (const v of liste.body.vouchers) werte.push(await klartext(haupt, v.id));
    assert.deepEqual(werte.sort(), [[NR1, '1357'], [NR3, '8642']].sort());
    assert.equal((await ruf(haupt, 'POST', '/vouchers', { number: NR1, amount: 5 })).status, 409,
      'eine umgeschlüsselte Nummer zählt für die Doppelprüfung');
    const klar = await db.run(`INSERT INTO vouchers (user_id, number, amount, currency) VALUES ($1, '123456789', 1, 'CHF')`, [HAUPT])
      .then(() => null, e => e.code);
    assert.equal(klar, '23514', 'die Datenbank nimmt keine Nummer im Klartext mehr an');

    const kopie = (await db.get(`SELECT nspname FROM pg_namespace WHERE nspname ~ '^vor_migration_[0-9]+$'
      ORDER BY nspname DESC LIMIT 1`)).nspname;
    const gesichert = await db.all(`SELECT id, user_id, number, pin FROM ${kopie}.vouchers WHERE id = ANY($1) ORDER BY id`, [ids]);
    assert.equal(gesichert.length, 3, `die Kopie ${kopie} hat die Gutscheine nicht`);
    for (const z of gesichert) assert.ok(z.number.startsWith('v2:') && (z.pin === null || z.pin.startsWith('v2:')), JSON.stringify(z));
    assert.deepEqual(gesichert.map(z => g.entschluessele(z.number, gr.nummerKontext(z.user_id, z.id))), [NR1, NR1, NR3],
      'mit dem Schlüssel bleibt die Kopie lesbar');

    const gs = _req('src/gutscheine/prozess.js').gutscheineBereich().gutscheine;
    assert.equal(await gs.nummernNachverschluesseln() + await gs.kopienVerschluesseln(), 0, 'ein zweiter Start ändert nichts');
  });
});
