/**
 * Die Set-Routen (routes/api_v1/sets.ts) gegen eine ECHTE Datenbank.
 *
 * ── Gegenproben (durchgeführt) ──────────────────────────────────────────────
 * Siehe die einzelnen Prüfungen — jede nennt den Eingriff, mit dem sie rot
 * wurde.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 * Ohne DB: skip — ausser REQUIRE_DB=1, dann Fehler.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

const U = {};
async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // Und die MIGRATIONEN, nicht nur das Schema
  {
    const mc = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(mc);
    } finally {
      mc.release();
    }
  }
  for (const name of ['anna', 'bruno']) {
    await db.run("INSERT INTO users (username, password_hash) VALUES ($1,'x')", [name]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
}

let _srv,
  _base,
  _actingAs = null;
async function startApi() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: _actingAs };
    next();
  });
  app.use('/api/v1', require('./helpers/sources').routerAus(_req, 'routes/api_v1/index.js'));
  _srv = app.listen(0);
  _base = `http://localhost:${_srv.address().port}`;
}
async function alsKonto(actor, pfad, opts = {}) {
  _actingAs = actor;
  const r = await fetch(_base + pfad, opts);
  return { status: r.status, body: await r.json().catch(() => null) };
}

/** Eine Anleitungs-Zeile anlegen, wie sie der Upload erzeugt. */
async function anleitung(uid, sn, relPath) {
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2) ON CONFLICT DO NOTHING', [uid, sn]);
  await db.run('INSERT INTO instructions (user_id,set_number,url,description,local_path) VALUES ($1,$2,$3,$4,$5)', [
    uid,
    sn,
    relPath,
    'Anleitung',
    relPath,
  ]);
  return (await db.get('SELECT id FROM instructions WHERE user_id=$1 AND local_path=$2', [uid, relPath])).id;
}

test('routes/sets gegen echte Datenbank', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    keineDb(t);
    return;
  }
  await seed();
  await startApi();

  await t.test('das eigene Konto kann seine Anleitung löschen', async () => {
    const id = await anleitung(U.anna, '10001-1', '/data/uploads/1/a_1.pdf');
    const r = await alsKonto(U.anna, `/api/v1/sets/10001-1/instructions/${id}`, { method: 'DELETE' });
    assert.equal(r.status, 200);
    assert.equal(
      await db.get('SELECT id FROM instructions WHERE id=$1', [id]),
      undefined,
      'Die Zeile wurde nicht gelöscht',
    );
  });

  await t.test('ein fremdes Konto kann sie NICHT löschen', async () => {
    // ── Gegenprobe ─────────────────────────────────────────────────────────
    // In der Route wurde `AND user_id = $2` aus dem SELECT entfernt. Ergebnis:
    // Diese Prüfung wird rot (204/200 statt 404, Zeile weg). Zurückgebaut.
    //
    // Das ist der teuerste Ausfall im ganzen Modul: Er meldet keinen Fehler,
    // er löscht einfach die Daten von jemand anderem.
    const id = await anleitung(U.anna, '10002-1', '/data/uploads/1/b_1.pdf');
    const r = await alsKonto(U.bruno, `/api/v1/sets/10002-1/instructions/${id}`, { method: 'DELETE' });
    assert.equal(r.status, 404, 'Ein fremdes Konto bekam Zugriff auf die Anleitung');
    assert.ok(
      await db.get('SELECT id FROM instructions WHERE id=$1', [id]),
      'Die Zeile eines anderen Kontos wurde gelöscht',
    );
  });

  await t.test('die geteilte Datei bleibt liegen, solange eine Zeile darauf zeigt', async () => {
    // Beim Verschieben eines Sets wird die Zeile kopiert und der Pfad wörtlich
    // übernommen — zwei Konten teilen sich dann EINE Datei. Löscht das eine
    // seine Zeile, muss die Datei bleiben; sonst zeigt der Eintrag des anderen
    // ins Leere und gibt beim Klick 404.
    //
    // ── Gegenprobe ─────────────────────────────────────────────────────────
    // Die Zählung in der Route wurde durch `const rest = null` ersetzt — also
    // die alte Fassung, die ungefragt löschte. Ergebnis: Diese Prüfung wird
    // rot. Zurückgebaut, wieder 6/6 grün.
    const rel = '/data/uploads/geteilt/x.pdf';
    const abs = path.join(ROOT, rel.slice(1));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'PDF');
    const idA = await anleitung(U.anna, '10003-1', rel);
    await anleitung(U.bruno, '10003-1', rel);

    const r = await alsKonto(U.anna, `/api/v1/sets/10003-1/instructions/${idA}`, { method: 'DELETE' });
    assert.equal(r.status, 200);
    assert.ok(fs.existsSync(abs), 'Die Datei wurde gelöscht, obwohl das andere Konto noch darauf zeigt');
    fs.rmSync(path.dirname(abs), { recursive: true, force: true });
  });

  await t.test('zeigt keine Zeile mehr auf die Datei, wird sie entfernt', async () => {
    // Die Gegenrichtung derselben Regel: Ohne sie sammeln sich Dateien an, die
    // niemandem mehr gehören.
    const rel = '/data/uploads/allein/y.pdf';
    const abs = path.join(ROOT, rel.slice(1));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'PDF');
    const id = await anleitung(U.anna, '10004-1', rel);

    await alsKonto(U.anna, `/api/v1/sets/10004-1/instructions/${id}`, { method: 'DELETE' });
    assert.equal(fs.existsSync(abs), false, 'Die verwaiste Datei blieb liegen');
    fs.rmSync(path.dirname(abs), { recursive: true, force: true });
  });

  await t.test('eine unbekannte Anleitungs-ID meldet 404 statt 500', async () => {
    const r = await alsKonto(U.anna, '/api/v1/sets/10005-1/instructions/999999', { method: 'DELETE' });
    assert.equal(r.status, 404);
    assert.equal(r.body?.success, false);
  });

  _srv?.close();
  await db.pool.end().catch(() => {});
});
