/**
 * Eigene Anleitungen: Der Inhalt muss zum Typ passen, und je Konto ist der
 * Platz begrenzt.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  die Prüfung inhaltPasstZuTyp() im Upload entfernt → rot: „ein Text als
 *      PDF" (200, die Datei lag im Ordner)
 *   B  die Kontingentprüfung entfernt → rot: „über dem Kontingent"
 *   C  die Besitzprüfung entfernt → rot: „für ein Set, das das Konto nicht
 *      hat" (500 aus dem Fremdschlüssel, die Datei lag im Ordner; 28.10.2026)
 *   D  vorDemUpload aus der Route entfernt → rot: „abgewiesen, bevor der
 *      Inhalt ankommt“ (keine Antwort, solange der Inhalt fehlt) und „für ein
 *      Set, das das Konto nicht hat“ — die Besitzprüfung steht jetzt dort (28.10.2026)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const { DATA_DIR } = _req('utils/appPaths.js');
const db = _req('db/database.js');
const SET = '99073-1', NAME = `anl_hoch_${process.pid}`;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

test('Anleitung hochladen', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', 1, 1) RETURNING id`, [NAME])).id;
  await db.run(`INSERT INTO set_catalog (set_number, name, year, theme, pieces, minifigs)
                VALUES ($1, 'Hochladeprobe', 2024, 'Test', 10, 0) ON CONFLICT (set_number) DO NOTHING`, [SET]);
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [uid, SET]);
  const ordner = path.join(DATA_DIR, 'uploads', String(uid));
  const altKontingent = process.env.UPLOAD_KONTINGENT_MB;
  t.after(async () => {
    if (altKontingent === undefined) delete process.env.UPLOAD_KONTINGENT_MB; else process.env.UPLOAD_KONTINGENT_MB = altKontingent;
    fs.rmSync(ordner, { recursive: true, force: true });
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM set_catalog WHERE set_number = $1', [SET]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { sitzung: { userId: uid }, routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const hochladen = async (inhalt, typ, name, set = SET) => {
    const form = new FormData();
    form.append('file', new Blob([inhalt], { type: typ }), name);
    const r = await fetch(`${base}/api/v1/sets/${set}/instructions/upload`, { method: 'POST', body: form });
    return { status: r.status, body: await r.json() };
  };
  const dateien = () => (fs.existsSync(ordner) ? fs.readdirSync(ordner) : []);

  await t.test('ein echtes PDF', async () => {
    const r = await hochladen(PDF, 'application/pdf', 'anleitung.pdf');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(dateien().length, 1);
  });

  await t.test('ein Text als PDF', async () => {
    const r = await hochladen(Buffer.from('<script>alert(1)</script>'), 'application/pdf', 'boese.pdf');
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.code, 'datei_inhalt_falsch');
    assert.equal(dateien().length, 1, 'die abgewiesene Datei liegt noch im Ordner');
  });

  await t.test('ein PNG mit JPEG-Typ', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    assert.equal((await hochladen(png, 'image/jpeg', 'bild.jpg')).status, 400);
    assert.equal((await hochladen(png, 'image/png', 'bild.png')).status, 200);
  });

  await t.test('über dem Kontingent', async () => {
    process.env.UPLOAD_KONTINGENT_MB = String(1 / 1024);   // 1 KB
    const gross = Buffer.concat([PDF, Buffer.alloc(2048, 0x20)]);
    const vorher = dateien().length;
    const r = await hochladen(gross, 'application/pdf', 'gross.pdf');
    assert.equal(r.status, 413, JSON.stringify(r.body));
    assert.equal(r.body.code, 'upload_kontingent_voll');
    assert.equal(dateien().length, vorher, 'die Datei über dem Kontingent liegt noch im Ordner');
  });

  await t.test('abgewiesen, bevor der Inhalt ankommt', async () => {
    // Nur der Kopf mit 10 MB Content-Length, der Inhalt bleibt aus: Antwortet
    // der Server trotzdem, hat er vor dem Lesen entschieden.
    process.env.UPLOAD_KONTINGENT_MB = '1';
    const http = require('node:http');
    const status = await new Promise((fertig, fehl) => {
      const anfrage = http.request(`${base}/api/v1/sets/${SET}/instructions/upload`, { method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(10 * 1024 * 1024) } },
        (antwort) => { antwort.resume(); fertig(antwort.statusCode); anfrage.destroy(); });
      anfrage.on('error', () => {});
      anfrage.write('--x\r\n');
      setTimeout(() => { anfrage.destroy(); fehl(new Error('keine Antwort, solange der Inhalt fehlt')); }, 3000);
    });
    assert.equal(status, 413);
  });

  await t.test('für ein Set, das das Konto nicht hat', async () => {
    delete process.env.UPLOAD_KONTINGENT_MB;
    const vorher = dateien().length;
    const r = await hochladen(PDF, 'application/pdf', 'fremd.pdf', '99074-1');
    assert.equal(r.status, 404, JSON.stringify(r.body));
    assert.equal(dateien().length, vorher, 'die Datei zum fremden Set liegt noch im Ordner');
  });
});
