/**
 * Eine Unicode-Schreibweise derselben Adresse ist dasselbe Konto — für den
 * Login, für die Sperre und für die Rücksetz-Mail. PostgreSQL schreibt „İ“ als
 * „i“ klein, JavaScript als „i̇“; vorher fand der Login das Konto, die Sperre
 * zählte aber unter einer neuen Kennung, und die Rücksetz-Mail ging an die
 * eingetippte Schreibweise.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  kontoKennung() wieder mit JavaScript-toLowerCase() und `= $1` → rot:
 *      „nach fünf Fehlversuchen ist auch die Unicode-Schreibweise gesperrt“
 *   B  sendPasswordResetMail wieder an `email` aus der Anfrage → rot: „die
 *      Rücksetz-Mail geht an die gespeicherte Adresse“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, einhaengung } = require('./helpers/sources');
const _req = buildAndRequire();
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = `unicode_${process.pid}`;
const MAIL = `opfer${process.pid}@mailbox.example`;
const VARIANTE = MAIL.replace('mailbox', 'maİlbox');

test('Unicode-Schreibweisen derselben Adresse', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, 1, 1) RETURNING id`, [NAME, MAIL, bcrypt.hashSync('richtig-geheim', 4)])).id;
  const aufraeumen = () => db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2`,
    [`%konto:${uid}`, `%${MAIL.split('@')[0]}%`]);
  await aufraeumen();
  await db.run("DELETE FROM global_settings WHERE key LIKE 'smtp_%'");
  t.after(async () => {
    await aufraeumen();
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const { pruefeAnmeldedaten } = _req('utils/auth.js');

  await t.test('nach fünf Fehlversuchen ist auch die Unicode-Schreibweise gesperrt', async () => {
    const anfrage = { ip: '203.0.113.9', socket: {}, headers: {} };
    for (let i = 0; i < 5; i++) {
      const r = await pruefeAnmeldedaten(anfrage, MAIL, 'falsch');
      assert.equal(r.absage?.status, 401, `Versuch ${i + 1}`);
    }
    const r = await pruefeAnmeldedaten(anfrage, VARIANTE, 'richtig-geheim');
    assert.equal(r.absage?.status, 429, 'die Variante bekam frische Zähler');
  });

  await t.test('die Rücksetz-Mail geht an die gespeicherte Adresse', async () => {
    const app = express();
    app.use(express.json());
    app.use(einhaengung('auth'), _req('routes/auth.js'));
    const srv = app.listen(0);
    const zeilen = [];
    const echt = console.log;
    console.log = (...a) => { zeilen.push(a.join(' ')); };
    try {
      const r = await fetch(`http://localhost:${srv.address().port}${einhaengung('auth')}/forgot-password`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: VARIANTE.toUpperCase() }) });
      assert.equal(r.status, 200);
      for (let i = 0; i < 50 && !zeilen.some(z => z.includes('An:')); i++) await new Promise(f => setTimeout(f, 50));
    } finally { console.log = echt; srv.close(); }
    const an = zeilen.find(z => z.includes('An:')) || '';
    assert.ok(an.includes(MAIL), `Empfänger: ${an}`);
  });
});
