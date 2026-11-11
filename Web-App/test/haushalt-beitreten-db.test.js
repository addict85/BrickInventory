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
 * Gegenprobe (01.11.2026 gemessen): Code-Pflicht in der Route entfernt → rot:
 *   „mit zweitem Faktor braucht es auch den Code“
 * Gegenprobe (01.11.2026 gemessen): maskiereAdresse() im Konsolenweg des Mailers
 *   umgangen → rot: „mit Passwort verknüpft, und der Inhaber erfährt es“
 * Gegenprobe (04.11.2026 gemessen): kontoGedrosselt() aus redeem/pruefen
 *   entfernt → rot: „die Prüfung eines Codes ist je Konto gebremst“ (200 statt 429)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const PASS = 'eigenes-Passwort-1';
const HAUPT = `beitritt_haupt_${process.pid}`, KIND = `beitritt_kind_${process.pid}`, HAUPT2 = `beitritt_haupt2_${process.pid}`;

test('Haushalt beitreten', { concurrency: 1 }, async (t) => {
  if (!await dbOderSkip(t, _req)) return;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[HAUPT, KIND, HAUPT2]]);
  const hash = await bcrypt.hash(PASS, 4);
  const anlegen = async (n) => (await db.get(`INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`, [n, `${n}@example.org`, hash])).id;
  const haupt = await anlegen(HAUPT), kind = await anlegen(KIND), haupt2 = await anlegen(HAUPT2);
  await db.run("DELETE FROM global_settings WHERE key LIKE 'smtp_%'");
  const pruefZaehler = () => db.run('DELETE FROM rate_limit_attempts WHERE key = $1', [`haushalt-pruefen|konto:${kind}`]);
  await pruefZaehler();
  t.after(async () => {
    await pruefZaehler();
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%-bestaetigen|${kind}|%`]);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[haupt, kind, haupt2]]);
    await db.pool.end().catch(() => {});
  });
  const { createInvite } = { ..._req('src/haushalt/haushalt.js'), ..._req('src/haushalt/prozess.js').haushaltBereich().haushalt };
  const { base } = testServer(_req, { sitzung: { userId: kind }, apiNutzer: { user_id: kind, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const einloesen = (body) => fetch(`${base}/api/v1/settings/household/redeem`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, body: await r.json() }));
  const verknuepft = async () => !!await db.get(
    'SELECT 1 FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2', [haupt, kind]);

  await t.test('die Prüfung eines Codes ist je Konto gebremst', async () => {
    const { code } = await createInvite(haupt);
    const pruefe = () => fetch(`${base}/api/v1/settings/household/redeem/pruefen`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
      .then(async r => ({ status: r.status, body: await r.json() }));
    const erste = await pruefe();
    assert.deepEqual([erste.status, erste.body.inviter?.username], [200, HAUPT], JSON.stringify(erste.body));
    for (let i = 1; i < 30; i++) assert.equal((await pruefe()).status, 200, `Prüfung ${i + 1}`);
    const r = await pruefe();
    assert.deepEqual([r.status, r.body.code], [429, 'zu_viele_anfragen'], JSON.stringify(r.body));
    assert.equal(r.body.inviter, undefined, 'gebremst nennt die Antwort niemanden');
    await pruefZaehler();
  });

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
    // Die Konsole landet in app_logs: Die Adresse steht dort nur maskiert.
    assert.ok(zeilen.some(z => z.includes(`An:      ${KIND[0]}…@example.org`)), zeilen.join('\n'));
    assert.ok(!zeilen.some(z => z.includes(`${KIND}@`)), 'die volle Adresse steht im Protokoll');
    assert.ok(zeilen.some(z => /Haushalt/.test(z)), 'Betreff fehlt');
  });

  await t.test('mit zweitem Faktor braucht es auch den Code', async () => {
    const zf = _req('src/konto/zweiterFaktor.js');
    const geheim = await zf.beginneEinrichtung(kind);
    const codes = await zf.bestaetigeEinrichtung(kind, zf.hotp(zf.ausBase32(geheim), zf.zeitschritt()));
    const { code } = await createInvite(haupt2);
    const ohne = await einloesen({ code, password: PASS });
    assert.equal(ohne.status, 400, JSON.stringify(ohne.body));
    assert.equal(ohne.body.code, 'zweiter_faktor_noetig');
    // Die Hinweis-Mail abwarten: Spät auf stdout geschrieben, stört sie den Testlauf.
    const zeilen = [], echt = console.log;
    console.log = (...a) => { zeilen.push(a.join(' ')); };
    let mit;
    try {
      mit = await einloesen({ code, password: PASS, faktor_code: codes[0] });
      for (let i = 0; i < 50 && !zeilen.some(z => z.includes('An:')); i++) await new Promise(f => setTimeout(f, 50));
    } finally { console.log = echt; }
    assert.equal(mit.status, 200, JSON.stringify(mit.body));
  });
});
