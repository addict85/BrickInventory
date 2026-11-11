/**
 * Ein Gutschein-PDF mit zu vielen Seiten wird abgewiesen, bevor es seitenweise
 * gelesen wird; gelesen wird in einem Worker-Thread. Je Konto läuft höchstens
 * ein Gutschein-PDF und eine begrenzte Zahl Uploads und Ereignisströme
 * zugleich — ein zweites Konto ist davon nicht betroffen.
 *
 * Gegenproben (am 04.11.2026 gemessen, je eine Änderung, danach zurück):
 *   A  HOECHSTENS_SEITEN-Abfrage in liesHochgeladenesPdf() gestrichen → rot:
 *      „250 Seiten: 422 mit verständlicher Meldung“ (der Stapel wird gelesen)
 *   B  liesImHintergrund() ruft liesHochgeladenesPdf() direkt → rot: „gelesen wird
 *      in einem Worker-Thread“
 *   C  kontoSchranke('gutscheinPdf') an POST /vouchers/pdf gestrichen → rot:
 *      „ein zweites Gutschein-PDF desselben Kontos wartet nicht“
 *   D  in kontoSchranke() die Freigabe bei 'close' gestrichen → rot: „… nach
 *      dem Ende geht es wieder“
 *   E  kontoSchranke('strom') am CSV-Strom gestrichen → rot: „höchstens sechs
 *      Ereignisströme je Konto“
 *   F  in kontoSchranke() die Freigabe bei 'finish' gestrichen → rot: „der
 *      Platz ist frei, sobald die Antwort übergeben ist“
 *
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const path   = require('node:path');
const wt     = require('node:worker_threads');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = _req('db/database.js');
const { testServer } = require('./helpers/server');
const { PDFDocument } = require(path.join(ROOT, 'node_modules', '@cantoo/pdf-lib'));

async function pdfMit(seiten) {
  const d = await PDFDocument.create();
  for (let i = 0; i < seiten; i++) d.addPage([200, 200]);
  return Buffer.from(await d.save());
}

async function hochladen(base, daten) {
  const fd = new FormData();
  fd.append('file', new Blob([daten], { type: 'application/pdf' }), 'g.pdf');
  const r = await fetch(`${base}/api/v1/vouchers/pdf`, { method: 'POST', body: fd });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

/** Ein Upload, dessen Rumpf erst auf Zuruf endet: Er hält seinen Platz. */
function haengenderUpload(base) {
  const u = new URL(`${base}/api/v1/vouchers/pdf`);
  const grenze = 'xyzgrenze';
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${grenze}` } });
  const antwort = new Promise((fertig) => req.on('response', (r) => { r.resume(); r.on('end', () => fertig(r.statusCode)); }));
  req.on('error', () => {});
  req.write(`--${grenze}\r\nContent-Disposition: form-data; name="file"; filename="g.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n`);
  return { antwort, ende: () => req.end(`\r\n--${grenze}--\r\n`) };
}

test('Grenzen je Konto beim Hochladen', { concurrency: 1, timeout: 120_000 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    keineDb(t, e); return;
  }
  await db.initSchema();
  { const c = await db.pool.connect(); try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); } }
  const neu = async (name) => {
    await db.run('DELETE FROM users WHERE username = $1', [name]);
    return (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
  };
  const A = await neu(`schranke_a_${process.pid}`), B = await neu(`schranke_b_${process.pid}`);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[A, B]]);
    await _req('db/database.js').standardDb().benachrichtigung.close().catch(() => {});   // der CSV-Strom hört auf NOTIFY
    await db.pool.end().catch(() => {});
  });
  const server = (uid) => testServer(_req, { sitzung: { userId: uid }, apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const a = server(A), b = server(B);

  await t.test('250 Seiten: 422 mit verständlicher Meldung', async () => {
    const r = await hochladen(a.base, await pdfMit(250));
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.equal(r.body.code, 'pdf_zu_viele_seiten');
    assert.match(r.body.error, /250 Seiten, höchstens 200/);
    assert.equal((await db.get('SELECT count(*)::int AS n FROM vouchers WHERE user_id = $1', [A])).n, 0);
  });

  await t.test('gelesen wird in einem Worker-Thread', async () => {
    const { liesImHintergrund } = _req('src/gutscheine/pdfLesen.js');
    const Echt = wt.Worker;
    let gestartet = 0;
    wt.Worker = class extends Echt { constructor(...a) { super(...a); gestartet++; } };
    try {
      const r = await liesImHintergrund(await pdfMit(3));
      assert.equal(r.art, 'gelesen');
      assert.equal(r.seiten, 3);
    } finally { wt.Worker = Echt; }
    assert.equal(gestartet, 1);
  });

  await t.test('ein zweites Gutschein-PDF desselben Kontos wartet nicht', async () => {
    const erster = haengenderUpload(a.base);
    try {
      await new Promise(r => setTimeout(r, 200));
      const zweiter = await hochladen(a.base, await pdfMit(1));
      assert.equal(zweiter.status, 429, JSON.stringify(zweiter.body));
      assert.equal(zweiter.body.code, 'upload_laeuft');
      const fremd = await hochladen(b.base, await pdfMit(1));
      assert.notEqual(fremd.status, 429, 'ein anderes Konto ist nicht betroffen');
    } finally {
      erster.ende();   // sonst wartet das Schliessen des Servers auf ihn
      await erster.antwort;
    }
  });

  await t.test('… nach dem Ende geht es wieder', async () => {
    const r = await hochladen(a.base, await pdfMit(1));
    assert.notEqual(r.status, 429, JSON.stringify(r.body));
  });

  await t.test('höchstens sechs Ereignisströme je Konto', async () => {
    const offen = [];
    const strom = () => new Promise((fertig) => {
      const req = http.get(`${a.base}/api/v1/sets/import/csv/stream`, (r) => { offen.push(r); fertig(r.statusCode); r.resume(); });
      req.on('error', () => fertig(0));
    });
    try {
      const stati = [];
      for (let i = 0; i < 7; i++) stati.push(await strom());
      assert.deepEqual(stati, [200, 200, 200, 200, 200, 200, 429]);
      for (const r of offen) r.destroy();
      await new Promise(r => setTimeout(r, 200));
      assert.equal(await strom(), 200, 'geschlossene Ströme geben ihren Platz frei');
    } finally { for (const r of offen) r.destroy(); }
  });
});

// Ein Client, der nach der Antwort sofort die nächste Datei schickt, kam im
// Volllauf vor 'close' an und bekam 429. Hier ohne Netz, damit es nicht vom Takt abhängt.
test('der Platz ist frei, sobald die Antwort übergeben ist', () => {
  const { EventEmitter } = require('node:events');
  const { kontoSchranke } = _req('routes/api_v1/middleware.js');
  const schranke = kontoSchranke('gutscheinPdf');
  const anfrage = () => {
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200, status(c) { this.statusCode = c; return this; }, json() { return this; },
      setHeader() {}, getHeader() {}, headersSent: false,
    });
    let weiter = false;
    schranke({ session: { userId: 987654 }, headers: {}, get: () => undefined }, res, () => { weiter = true; });
    return { res, weiter };
  };
  const erste = anfrage();
  assert.equal(erste.weiter, true);
  erste.res.emit('finish');
  const zweite = anfrage();
  assert.equal(zweite.weiter, true, `zweite Datei abgewiesen (${zweite.res.statusCode})`);
  zweite.res.emit('finish');
});
