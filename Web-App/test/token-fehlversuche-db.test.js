/**
 * Eine Adresse, die ständig unbekannte Bearer-Token vorlegt, wird gebremst,
 * ohne dass gültige Zugänge oder die Wiederverwendungserkennung leiden.
 * Gemessen an Eingang (anmeldungAmEingang) und Repository-Aufrufen.
 *
 * Gegenproben (am 08.11.2026 gemessen, je einzeln):
 *   A  in pruefeToken() die Zeile mit zuVieleFehlversuche() entfernt → rot:
 *      „nach dem Limit kostet ein unbekannter Token keine Datenbankabfrage“
 *      und „die Drossel antwortet 429, nicht 401“
 *   B  in pruefeToken() zaehleFehlversuch() auch für Token aus einer Familie
 *      (Rückgabewert von meldeWiederverwendung ignoriert) → rot: „ein
 *      wiederverwendeter Token zählt nicht als Fehlversuch“
 *   C  in sendeTokenAbsage() immer 401 → rot: „die Drossel antwortet 429,
 *      nicht 401“
 *   D  die Cache-Prüfung hinter die Drossel gestellt → rot: „ein gültiger
 *      Token im Cache wird auch gebremster Adresse bedient“
 *   E  (08.11.) in zaehleFehlversuch() wieder im Prozess gezählt (eine Map,
 *      die vergissSperrenImProzess() mit leert) statt über zaehleAnfrage() →
 *      rot: „ein zweiter Web-Prozess zählt die Fehlversuche des ersten mit“
 *      (401 statt 429)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const auth = _req('src/konto/auth.js');
const bremse = _req('src/konto/tokenFehlversuche.js');
const { anmeldungAmEingang } = _req('routes/api_v1/middleware.js');

const NAME = `fehlversuch_${process.pid}`;

test('Fehlversuche mit unbekannten Token', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const server = testServer(_req, { t, sitzung: {}, routen: {} });
  server.app.use('/api/v1', anmeldungAmEingang);
  server.app.get('/api/v1/probe', (_req2, res) => res.json({ ok: true }));
  t.after(async () => {
    await db.run('DELETE FROM api_tokens WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  // Gezählt wird die Token-Abfrage an der Verbindung, nicht ein Aufruf im Quelltext.
  const echt = db.pool.query.bind(db.pool);
  let abfragen = 0;
  db.pool.query = (sql, ...rest) => {
    if (typeof sql === 'string' && /FROM api_tokens t JOIN users u/.test(sql)) abfragen++;
    return echt(sql, ...rest);
  };
  t.after(() => {
    db.pool.query = echt;
  });

  const ruf = async token => {
    const r = await fetch(`${server.base}/api/v1/probe`, { headers: { authorization: `Bearer ${token}` } });
    return { status: r.status, body: await r.json() };
  };
  const zufall = i => `unbekannt-${process.pid}-${i}-${Math.random()}`;

  await t.test('bis zum Limit prüft jeder unbekannte Token die Datenbank', async () => {
    await bremse.vergissFehlversuche();
    abfragen = 0;
    for (let i = 0; i < bremse.FEHLVERSUCH_MAX; i++) assert.equal((await ruf(zufall(i))).status, 401);
    assert.equal(abfragen, bremse.FEHLVERSUCH_MAX);
  });

  await t.test('ein gültiger Token im Cache wird auch gebremster Adresse bedient', async () => {
    await bremse.vergissFehlversuche();
    const token = await auth.createToken(uid, 'Cache');
    assert.equal((await ruf(token)).status, 200, 'Vorbedingung: der Token gilt und steht im Cache');
    for (let i = 0; i < bremse.FEHLVERSUCH_MAX + 1; i++) await ruf(zufall(i));
    assert.equal((await ruf(token)).status, 200);
  });

  await t.test('nach dem Limit kostet ein unbekannter Token keine Datenbankabfrage', async () => {
    abfragen = 0;
    const r = await ruf(zufall('danach'));
    assert.equal(abfragen, 0);
    assert.equal(r.body.code, 'zu_viele_anfragen');
  });

  await t.test('die Drossel antwortet 429, nicht 401', async () => {
    assert.equal((await ruf(zufall('noch'))).status, 429);
  });

  await t.test('nach dem Fenster gilt die Adresse wieder als unbescholten', async () => {
    const jetzt = Date.now() + bremse.FEHLVERSUCH_FENSTER_MS + 1000;
    assert.equal(bremse.zuVieleFehlversuche('::1', jetzt), false);
    assert.equal(bremse.zuVieleFehlversuche('127.0.0.1', jetzt), false);
  });

  await t.test('ein wiederverwendeter Token zählt nicht als Fehlversuch', async () => {
    await bremse.vergissFehlversuche();
    const alt = await auth.createToken(uid, 'Alt', true);
    const neu = await auth.rotiereToken(alt, null);
    assert.ok(neu && neu !== 'laeuft', 'Vorbedingung: der Tausch hat geklappt');
    assert.equal((await ruf(neu.token)).status, 200, 'der Nachfolger wird benutzt, der Vorgänger ist damit verbraucht');
    await db.run(`UPDATE api_tokens_verbraucht SET verbraucht_am = NOW() - INTERVAL '2 minutes' WHERE user_id = $1`, [
      uid,
    ]);
    auth.leereTokenCache();
    for (let i = 0; i < bremse.FEHLVERSUCH_MAX; i++) await ruf(zufall(i));
    assert.equal((await ruf(alt)).status, 401);
    // Wäre der Familien-Treffer mitgezählt, läge die Adresse jetzt über dem Limit.
    assert.equal((await ruf(zufall('letzter'))).status, 401);
    assert.equal(
      (await db.all(`SELECT 1 FROM api_tokens WHERE user_id = $1 AND label = 'Alt'`, [uid])).length,
      0,
      'die Familie ist gesperrt',
    );
  });

  // Ein zweiter Prozess hat eigenen Speicher, aber dieselbe Datenbank.
  await t.test('ein zweiter Web-Prozess zählt die Fehlversuche des ersten mit', async () => {
    await bremse.vergissFehlversuche();
    for (let i = 0; i < bremse.FEHLVERSUCH_MAX; i++) assert.equal((await ruf(zufall(`a${i}`))).status, 401);
    bremse.vergissSperrenImProzess();
    abfragen = 0;
    assert.equal((await ruf(zufall('b1'))).status, 401, 'der erste Versuch im zweiten Prozess prüft noch');
    assert.equal((await ruf(zufall('b2'))).status, 429, 'danach gilt die gemeinsame Grenze');
    assert.equal(abfragen, 1);
    await bremse.vergissFehlversuche();
  });
});
