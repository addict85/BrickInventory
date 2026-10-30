/**
 * Gutschein-PDFs liegen verschlüsselt auf der Platte und kommen entschlüsselt
 * heraus; beim Löschen eines Kontos verschwinden seine Gutscheine und
 * Anleitungen mit. Geprüft über die echten Routen und den Startlauf.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in schreibeGutscheinPdf() wieder den Klartext schreiben → rot: „PIN
 *      und Kartennummer stehen im Klartext auf der Platte“
 *   B  verschluesseleGutscheinAltbestand() überspringt alles → rot: „der
 *      Altbestand bleibt Klartext“
 *   C  in routes/auth.ts den Aufruf von loescheKontoDateien() entfernt → rot:
 *      „data/uploads/<id> bleibt nach dem Löschen liegen“
 *   D  GET /vouchers/:id/pdf liefert die Datei wieder roh (liefereDatei) →
 *      rot: „das ausgelieferte PDF ist nicht das hochgeladene“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const PDFKit = require('pdfkit');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const AUTH = require('./helpers/sources').einhaengung('auth');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const { DATA_DIR } = _req('utils/appPaths.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

const NR = '5045076374450077711', PIN = '8642';

function gutscheinPdf() {
  return new Promise((fertig) => {
    const d = new PDFKit({ size: 'A4', compress: false });
    const s = [];
    d.on('data', (c) => s.push(c));
    d.on('end', () => fertig(Buffer.concat(s)));
    d.fontSize(14).text('Ihre LEGO-Geschenkkarte im Wert von 50 CHF:', 60, 100);
    d.fontSize(12).text(NR, 60, 140).text(`PIN: ${PIN}`, 60, 170);
    d.end();
  });
}

test('Gutschein-PDFs verschlüsselt, Kontodateien gehen mit dem Konto', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  { const c = await db.pool.connect(); try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); } }

  const ADMIN = 'kd-admin', ZIEL = 'kd-ziel', ADMIN_PW = 'verwalterPasswort1';
  await db.run('DELETE FROM users WHERE username IN ($1, $2)', [ADMIN, ZIEL]);
  await db.run(`INSERT INTO users (username, password_hash, is_admin, is_active) VALUES ($1,$3,1,1), ($2,'x',0,1)`,
    [ADMIN, ZIEL, await bcrypt.hash(ADMIN_PW, 4)]);
  const adminId = (await db.get('SELECT id FROM users WHERE username=$1', [ADMIN])).id;
  const zielId  = (await db.get('SELECT id FROM users WHERE username=$1', [ZIEL])).id;
  const uploads = path.join(DATA_DIR, 'uploads', String(zielId));
  const vouchers = path.join(DATA_DIR, 'vouchers', String(zielId));
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username IN ($1, $2)', [ADMIN, ZIEL]).catch(() => {});
    fs.rmSync(uploads, { recursive: true, force: true });
    fs.rmSync(vouchers, { recursive: true, force: true });
    await db.pool.end().catch(() => {});
  });

  const ziel = testServer(_req, { sitzung: { userId: zielId }, apiNutzer: { user_id: zielId, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const admin = testServer(_req, { sitzung: { userId: adminId, username: ADMIN, isAdmin: true },
    apiNutzer: { user_id: adminId, is_admin: 1 }, routen: { [AUTH]: 'routes/auth.js' }, t });

  const original = await gutscheinPdf();
  const { werteAusPdf } = _req('utils/gutscheinPdf.js');
  /** Was jemand mit der Datei allein aus ihr liest. */
  const lesbar = (daten) => { try { return werteAusPdf(daten); } catch { return {}; } };
  assert.equal(lesbar(original).pin, PIN, 'Vorbedingung: die PIN ist aus dem PDF lesbar');

  await t.test('hochgeladen: verschlüsselt auf der Platte, entschlüsselt ausgeliefert', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([original], { type: 'application/pdf' }), 'g.pdf');
    const r = await fetch(`${ziel.base}/api/v1/vouchers/pdf`, { method: 'POST', body: fd });
    const b = await r.json();
    assert.equal(r.status, 200, JSON.stringify(b));
    const roh = fs.readFileSync(path.join(vouchers, `${b.voucher.id}.pdf`));
    const vonPlatte = lesbar(roh);
    assert.ok(vonPlatte.pin !== PIN && vonPlatte.nummer !== NR, 'PIN und Kartennummer stehen im Klartext auf der Platte');
    assert.notEqual(roh.subarray(0, 5).toString('latin1'), '%PDF-');
    const aus = Buffer.from(await (await fetch(`${ziel.base}/api/v1/vouchers/${b.voucher.id}/pdf`)).arrayBuffer());
    assert.ok(aus.equals(original), 'das ausgelieferte PDF ist nicht das hochgeladene');
  });

  await t.test('der Klartext-Altbestand wird beim Start verschlüsselt', async () => {
    const alt = path.join(vouchers, '999999.pdf');
    fs.writeFileSync(alt, original);
    const { verschluesseleGutscheinAltbestand, liesGutscheinPdf } = _req('utils/gutscheinDateien.js');
    assert.ok(await verschluesseleGutscheinAltbestand() >= 1);
    assert.notEqual(lesbar(fs.readFileSync(alt)).pin, PIN, 'der Altbestand bleibt Klartext');
    assert.ok((await liesGutscheinPdf(alt)).equals(original));
    assert.equal(await verschluesseleGutscheinAltbestand(), 0, 'ein zweiter Lauf verschlüsselt doppelt');
  });

  await t.test('Konto löschen entfernt Anleitungen und Gutscheine', async () => {
    fs.mkdirSync(uploads, { recursive: true });
    fs.writeFileSync(path.join(uploads, '10294-1_abc.pdf'), original);
    const r = await fetch(`${admin.base}${AUTH}/users/${zielId}`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admin_password: ADMIN_PW }),
    });
    assert.equal(r.status, 200, await r.text());
    assert.equal(fs.existsSync(uploads), false, 'data/uploads/<id> bleibt nach dem Löschen liegen');
    assert.equal(fs.existsSync(vouchers), false, 'data/vouchers/<id> bleibt nach dem Löschen liegen');
  });
});
