/**
 * Einem Haushalt beitreten geht nur mit dem eigenen Passwort, und der Inhaber
 * bekommt eine Mail. Danach liest und schreibt das Hauptkonto den Bestand; mit
 * einem erbeuteten Token allein soll sich das nicht einrichten lassen.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  bestaetigePasswort() aus der Route entfernt → rot: „ohne Passwort keine
 *      Verknüpfung“
 *   B  die Hinweis-Mail nicht verschickt → rot: „mit Passwort verknüpft, und
 *      der Inhaber erfährt es“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const PASS = 'eigenes-Passwort-1';
const HAUPT = `beitritt_haupt_${process.pid}`, KIND = `beitritt_kind_${process.pid}`;

test('Haushalt beitreten', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[HAUPT, KIND]]);
  const hash = await bcrypt.hash(PASS, 4);
  const anlegen = async (n) => (await db.get(`INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, 1, 1) RETURNING id`, [n, `${n}@example.org`, hash])).id;
  const haupt = await anlegen(HAUPT), kind = await anlegen(KIND);
  await db.run("DELETE FROM global_settings WHERE key LIKE 'smtp_%'");
  t.after(async () => {
    await db.run('DELETE FROM rate_limit_attempts WHERE key = $1', [`passwort-bestaetigen|${kind}`]);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[haupt, kind]]);
    await db.pool.end().catch(() => {});
  });
  const { createInvite } = _req('src/haushalt/haushalt.js');
  const { base } = testServer(_req, { sitzung: { userId: kind }, apiNutzer: { user_id: kind, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const einloesen = (body) => fetch(`${base}/api/v1/settings/household/redeem`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, body: await r.json() }));
  const verknuepft = async () => !!await db.get(
    'SELECT 1 FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2', [haupt, kind]);

  await t.test('ohne Passwort keine Verknüpfung', async () => {
    const { code } = await createInvite(haupt);
    for (const body of [{ code }, { code, password: 'falsch' }]) {
      const r = await einloesen(body);
      assert.equal(r.status, 400, JSON.stringify(r.body));
      assert.equal(r.body.code, 'aktuelles_passwort_falsch');
    }
    assert.equal(await verknuepft(), false);
  });

  await t.test('mit Passwort verknüpft, und der Inhaber erfährt es', async () => {
    const { code } = await createInvite(haupt);
    const zeilen = [];
    const echt = console.log;
    console.log = (...a) => { zeilen.push(a.join(' ')); };
    let r;
    try {
      r = await einloesen({ code, password: PASS });
      for (let i = 0; i < 50 && !zeilen.some(z => z.includes('An:')); i++) await new Promise(f => setTimeout(f, 50));
    } finally { console.log = echt; }
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await verknuepft(), true);
    assert.ok(zeilen.some(z => z.includes(`An:      ${KIND}@example.org`)), zeilen.join('\n'));
    assert.ok(zeilen.some(z => /Haushalt/.test(z)), 'Betreff fehlt');
  });
});
