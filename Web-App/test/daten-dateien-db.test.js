/**
 * Hochgeladene Anleitungen: der Haushalt liest mit, Fremde nicht — auch nicht
 * über einen Schrägstrich, der als %2F im Segment steckt.
 *
 * Express dekodiert %2F erst nach dem Aufteilen am Schrägstrich. Aus
 * `/data/uploads/x%2F..%2F7/a.pdf` wird das Segment `x/../7`; die alte
 * Besitzerprüfung las daraus keine Zahl und liess die Anfrage durch.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  die alte Prüfung (parseInt auf segments[0], NaN = keine Prüfung, Segmente
 *      nur auf '..' geprüft) → rot: „%2F im Segment" (200 statt 404) und
 *      „kein Benutzerordner" (200 statt 404)
 *   B  scopeIds-Abfrage entfernt (nur eigene ID) → rot: „Hauptkonto liest Unterkonto"
 *   C  (28.10.) die Verwalter-Ausnahme wieder eingebaut → rot: „auch ein
 *      Verwalter liest fremde Uploads nicht"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

// Ein eigenes Datenverzeichnis, bevor appPaths geladen wird.
const WURZEL = fs.mkdtempSync(path.join(os.tmpdir(), 'daten-dateien-'));
fs.writeFileSync(path.join(WURZEL, 'package.json'), '{}');
process.env.APP_ROOT = WURZEL;
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');

const NAMEN = ['dd_haupt', 'dd_unter', 'dd_fremd'].map(n => `${n}_${process.pid}`);

test('Uploads: Haushalt ja, Fremde nein, %2F nie', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  const ids = [];
  for (const n of NAMEN)
    ids.push((await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
                            VALUES ($1, 'x', 1, 1) RETURNING id`, [n])).id);
  const [H, U, F] = ids;
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [H, U]);
  for (const id of [H, U]) {
    fs.mkdirSync(path.join(WURZEL, 'data', 'uploads', String(id)), { recursive: true });
    fs.writeFileSync(path.join(WURZEL, 'data', 'uploads', String(id), 'a.pdf'), `pdf von ${id}`);
  }
  fs.writeFileSync(path.join(WURZEL, 'data', 'uploads', 'lose.pdf'), 'ohne Benutzerordner');

  const sitzung = {};
  const { base } = testServer(_req, { sitzung, routen: { '/': 'routes/datenDateien.js' }, t });
  const hole = async (als, weg, verwalter = false) => {
    sitzung.userId = als;
    sitzung.isAdmin = verwalter;
    const r = await fetch(base + weg);
    return { status: r.status, text: await r.text() };
  };

  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.pool.end().catch(() => {});
    fs.rmSync(WURZEL, { recursive: true, force: true });
  });

  await t.test('die eigene Datei', async () => {
    const r = await hole(H, `/data/uploads/${H}/a.pdf`);
    assert.equal(r.status, 200);
    assert.equal(r.text, `pdf von ${H}`);
  });

  await t.test('Hauptkonto liest Unterkonto', async () => {
    const r = await hole(H, `/data/uploads/${U}/a.pdf`);
    assert.equal(r.status, 200, 'Das Hauptkonto sieht die Anleitung des Unterkontos und muss sie öffnen können');
  });

  await t.test('Unterkonto liest Hauptkonto nicht', async () => {
    assert.equal((await hole(U, `/data/uploads/${H}/a.pdf`)).status, 403);
  });

  await t.test('Fremde lesen nicht', async () => {
    assert.equal((await hole(F, `/data/uploads/${H}/a.pdf`)).status, 403);
  });

  await t.test('auch ein Verwalter liest fremde Uploads nicht', async () => {
    await db.run('UPDATE users SET is_admin = 1 WHERE id = $1', [F]);
    assert.equal((await hole(F, `/data/uploads/${H}/a.pdf`, true)).status, 403,
      'Rechnungen und Gutscheine anderer gehen die Kontoverwaltung nichts an');
  });

  await t.test('%2F im Segment', async () => {
    for (const weg of [`/data/uploads/x%2F..%2F${H}/a.pdf`, `/data/uploads/${F}%2F..%2F${H}/a.pdf`,
                       `/data/uploads/..%2F${H}%2Fa.pdf`, `/data/uploads/${H}%5Ca.pdf`]) {
      const r = await hole(F, weg);
      assert.equal(r.status, 404, `${weg} → ${r.status}: ${r.text}`);
    }
  });

  await t.test('kein Benutzerordner', async () => {
    assert.equal((await hole(F, '/data/uploads/lose.pdf')).status, 404);
  });

  await t.test('ohne Anmeldung', async () => {
    assert.equal((await hole(undefined, `/data/uploads/${H}/a.pdf`)).status, 401);
  });
});
