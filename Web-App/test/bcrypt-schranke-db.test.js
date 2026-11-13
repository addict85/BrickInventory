/**
 * Höchstens so viele bcrypt-Läufe gleichzeitig, wie die Schranke zulässt
 * (src/konto/bcryptSchranke.ts); dahinter eine begrenzte Warteschlange mit
 * Frist, alles darüber bekommt 503 server_ausgelastet — bei der Anmeldung und
 * bei jeder Passwortbestätigung.
 *
 * Gegenproben (am 03.11.2026 gemessen, je einzeln):
 *   A  in neueSchranke() die Grenze der Warteschlange entfernt → rot: beide
 *      Tests (der Überzählige wartete, statt abgewiesen zu werden)
 *   B  pruefeAnmeldedaten() ohne bcryptSchranke.mit() → rot: „bei voller
 *      Schranke …“ (die Anmeldung lief durch)
 *   C  pruefeBestaetigung() ohne bcryptSchranke.mit() → rot: „bei voller
 *      Schranke …“ (die Passwortbestätigung lief durch)
 *
 * Wer sich von dieser Adresse mit diesem Namen zuletzt angemeldet hat, wartet
 * vorne und wird nicht wegen der Länge der Schlange abgewiesen (Runde 12, H3).
 * Gegenproben (04.11.2026 gemessen):
 *   D  in neueSchranke() `vorrang` übergangen → rot: „Vorrang …“ und „bei
 *      voller Schranke …“ (die bekannte Anmeldung steht nicht in der Schlange)
 *   E  pruefeAnmeldedaten() ohne bekannteAnmeldung() (immer false) → rot:
 *      „bei voller Schranke …“ (dasselbe)
 *
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testDaten();
const { neueSchranke, bcryptSchranke, BcryptUeberlast } = _req('src/konto/bcryptSchranke.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

test.after(async () => {
  await db.pool.end().catch(() => {});
});

test('die Schranke lässt n laufen, m warten und weist den Rest ab', async () => {
  const s = neueSchranke(2, 1, 200);
  const offen = [];
  const blockiert = () => new Promise(r => offen.push(r));
  const a = s.mit(blockiert),
    b = s.mit(blockiert);
  const c = s.mit(async () => 'c');
  await assert.rejects(
    s.mit(async () => 'd'),
    BcryptUeberlast,
  );
  assert.deepEqual(s.stand(), { laufend: 2, wartend: 1 });
  offen.shift()('a');
  assert.equal(await a, 'a');
  assert.equal(await c, 'c', 'der Wartende bekommt den frei gewordenen Platz');
  offen.shift()('b');
  await b;
  assert.deepEqual(s.stand(), { laufend: 0, wartend: 0 });
  // Frist: wer zu lange wartet, wird abgewiesen und gibt seinen Platz in der Schlange frei.
  const x = s.mit(blockiert),
    y = s.mit(blockiert);
  await assert.rejects(
    s.mit(async () => 'z'),
    BcryptUeberlast,
  );
  assert.deepEqual(s.stand(), { laufend: 2, wartend: 0 });
  for (const r of offen.splice(0)) r();
  await x;
  await y;
});

test('Vorrang: vorne in die Schlange, auch wenn sie voll ist', async () => {
  const s = neueSchranke(1, 1, 1000);
  const offen = [],
    reihe = [];
  const a = s.mit(() => new Promise(r => offen.push(r)));
  const b = s.mit(async () => {
    reihe.push('b');
  });
  const v = s.mit(async () => {
    reihe.push('v');
  }, true);
  await assert.rejects(
    s.mit(async () => 'x'),
    BcryptUeberlast,
  );
  assert.deepEqual(s.stand(), { laufend: 1, wartend: 2 });
  offen.shift()();
  await Promise.all([a, b, v]);
  assert.deepEqual(reihe, ['v', 'b']);
});

test('bei voller Schranke antwortet die Anmeldung 503 und die Passwortbestätigung', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  const NAME = `schranke_${process.pid}`,
    PASS = 'Schranken-Passwort-1';
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, $2, true, true) RETURNING id`,
      [NAME, bcrypt.hashSync(PASS, 4)],
    )
  ).id;
  t.after(() => db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {}));

  const sitzung = {};
  const { base } = testServer(_req, { sitzung, routen: { '/api/v1/auth': 'routes/auth.js' }, t });
  const post = async (weg, body) => {
    const r = await fetch(`${base}/api/v1/auth${weg}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };

  // Alle Plätze und die ganze Warteschlange belegen.
  const kerne = Math.max(2, os.availableParallelism());
  const offen = [];
  const belegt = [];
  for (let i = 0; i < kerne * 9; i++) belegt.push(bcryptSchranke.mit(() => new Promise(r => offen.push(r))));
  assert.deepEqual(bcryptSchranke.stand(), { laufend: kerne, wartend: kerne * 8 });
  try {
    const anmeldung = await post('/login', { username: NAME, password: PASS });
    assert.deepEqual(
      [anmeldung.status, anmeldung.body.code],
      [503, 'server_ausgelastet'],
      JSON.stringify(anmeldung.body),
    );
    sitzung.userId = uid;
    sitzung.username = NAME;
    const bestaetigung = await post('/qr-token', { password: PASS });
    assert.deepEqual(
      [bestaetigung.status, bestaetigung.body.code],
      [503, 'server_ausgelastet'],
      JSON.stringify(bestaetigung.body),
    );
  } finally {
    while (offen.length || bcryptSchranke.stand().laufend) {
      for (const r of offen.splice(0)) r();
      await new Promise(r => setImmediate(r));
    }
    await Promise.all(belegt);
  }
  delete sitzung.userId;
  const danach = await post('/login', { username: NAME, password: PASS });
  assert.equal(danach.status, 200, JSON.stringify(danach.body));

  // Jetzt ist die Anmeldung von hier bekannt: Sie wartet vorne, eine fremde wird abgewiesen.
  for (let i = 0; i < kerne * 9; i++) belegt.push(bcryptSchranke.mit(() => new Promise(r => offen.push(r))));
  try {
    delete sitzung.userId;
    const bekannt = post('/login', { username: NAME, password: PASS });
    const fremd = await post('/login', { username: `${NAME}_x`, password: PASS });
    assert.deepEqual([fremd.status, fremd.body.code], [503, 'server_ausgelastet']);
    for (let i = 0; i < 200 && bcryptSchranke.stand().wartend <= kerne * 8; i++)
      await new Promise(r => setTimeout(r, 10));
    assert.equal(bcryptSchranke.stand().wartend, kerne * 8 + 1, 'die bekannte Anmeldung wartet nicht');
    offen.shift()();
    const r = await bekannt;
    assert.equal(r.status, 200, JSON.stringify(r.body));
  } finally {
    while (offen.length || bcryptSchranke.stand().laufend) {
      for (const r of offen.splice(0)) r();
      await new Promise(r => setImmediate(r));
    }
    await Promise.all(belegt);
  }
});
