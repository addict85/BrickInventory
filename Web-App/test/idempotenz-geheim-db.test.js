/**
 * Idempotency-Key und Geheimnisse: Kein Zugang, kein TOTP-Geheimnis und kein
 * Wiederherstellungscode steht im Klartext in der Datenbank; gespeicherte
 * Antworten sind verschlüsselt; die Wiederholung einer Route mit Geheimnis
 * bekommt 409 statt eines zweiten Laufs.
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  dienst.ts und middleware.ts auf Stand e21f747 → rot: alle fünf Fälle,
 *      zuerst „das TOTP-Geheimnis steht in keiner Spalte" (idempotenz: 1)
 *   B  antwortIstGeheim() liefert immer false → rot: Fälle 1–3 (Rumpf liegt,
 *      wenn auch verschlüsselt; die Wiederholung bekommt 200 mit Replay)
 *   C  in beende() verschluessele() weggelassen → rot: Fälle 4 und 5
 *   D  Migration 0086 durch `SELECT 1;` ersetzt → rot: Fall 5
 *   E  `geheim` an /auth/zweiter-faktor/codes im Vertrag entfernt → rot:
 *      „jede schreibende Route …" (die Route steht in der Liste der fehlenden)
 *
 * Gegenproben zu bestätigten Routen (03.11.2026 gemessen):
 *   I  nichtWiederholbar() prüft nur `geheim`, nicht `bestaetigung` → rot:
 *      „jede Route mit Bestätigung …“; zusammen mit `geheim` an
 *      /vouchers/:id/klartext entfernt auch „die Wiederholung mit falschem
 *      Passwort …“ (die PIN kam mit Idempotent-Replay)
 *   J  routeFuerAnfrage() liefert immer undefined → rot: die ersten vier
 *      Teiltests, „jede schreibende Route …“ und „jede Route mit Bestätigung …“
 *
 * Gegenproben zum Fingerabdruck (02.11.2026 gemessen), je rot: „der
 * Fingerabdruck verrät das Passwort nicht“:
 *   F  ohneGeheimnisse() lässt Passwortfelder stehen
 *   G  suchwert() durch den blossen Text ersetzt (kein HMAC)
 *   H  alteAbdrueckeLoeschen() löscht nichts
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const { umgebung } = require('./helpers/sources');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
umgebung({ DATA_KEY: Buffer.alloc(32, 7).toString('base64') });

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const zf = _req('src/konto/zweiterFaktor.js');
const geheimnis = _req('src/infra/geheimnis.js');
const { idempotenz, antwortIstGeheim } = _req('src/idempotenz/http/middleware.js');
const { nichtWiederholbar } = _req('src/vertrag/grund.js');
const { VERTRAG } = _req('src/vertrag/index.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

/** Wie oft der Text in irgendeiner Spalte irgendeiner Tabelle steht. */
async function fundstellen(text) {
  const tabellen = await db.all(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  const treffer = [];
  for (const { tablename } of tabellen) {
    const n = (await db.get(`SELECT count(*)::int n FROM "${tablename}" x WHERE x::text LIKE '%' || $1 || '%'`, [text]))
      .n;
    if (n) treffer.push(`${tablename}: ${n}`);
  }
  return treffer;
}

test('Idempotency-Key ohne Geheimnisse im Klartext', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;

  const NAME = `idem_geheim_${process.pid}`,
    PASS = 'Geheim-Pruefung-1';
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, $2, true, true) RETURNING id`,
      [NAME, bcrypt.hashSync(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: uid };
    if (!req.originalUrl.startsWith('/api/v1/auth')) req.apiUser = { user_id: uid, is_admin: 0 };
    next();
  });
  app.use('/api/v1', idempotenz);
  app.use('/api/v1/auth', _req('routes/auth.js'));
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const post = (pfad, schluessel, body, methode = 'POST') =>
    fetch(`http://127.0.0.1:${srv.address().port}/api/v1${pfad}`, {
      method: methode,
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'idempotency-key': schluessel },
    }).then(async r => ({ status: r.status, replay: r.headers.get('idempotent-replay'), body: await r.json() }));
  const zeile = k => db.get('SELECT status, antwort FROM idempotenz WHERE user_id = $1 AND schluessel = $2', [uid, k]);

  await t.test('die Wiederholung mit falschem Passwort bekommt weder PIN noch Antwort', async () => {
    const neu = await post('/vouchers', 'v-1', {
      number: '1234567890123456',
      pin: '4321',
      amount: 20,
      currency: 'CHF',
    });
    assert.equal(neu.status, 200, JSON.stringify(neu.body));
    const pfad = `/vouchers/${neu.body.voucher.id}/klartext`;
    const erst = await post(pfad, 'k-1', { password: PASS });
    assert.deepEqual([erst.status, erst.body.pin], [200, '4321'], JSON.stringify(erst.body));
    assert.deepEqual(await zeile('k-1'), { status: 200, antwort: null });
    const falsch = await post(pfad, 'k-1', { password: 'falsch-falsch-falsch' });
    assert.equal(falsch.status, 409, JSON.stringify(falsch.body));
    assert.equal(falsch.body.code, 'idempotenz_nicht_wiederholbar');
    assert.equal(falsch.replay, null);
    assert.ok(!JSON.stringify(falsch.body).includes('4321'));
  });

  let g;
  await t.test('das TOTP-Geheimnis steht in keiner Spalte der Datenbank', async () => {
    const r = await post('/auth/zweiter-faktor/einrichten', 'zf-1', { password: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    g = r.body.geheimnis;
    assert.match(g, /^[A-Z2-7]{32}$/);
    assert.deepEqual(await fundstellen(g), []);
    assert.deepEqual(await zeile('zf-1'), { status: 200, antwort: null });
  });

  await t.test('die Wiederholung bekommt 409 statt eines zweiten Geheimnisses', async () => {
    const r = await post('/auth/zweiter-faktor/einrichten', 'zf-1', { password: PASS });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'idempotenz_nicht_wiederholbar');
    assert.equal(r.replay, null);
  });

  await t.test('auch die Wiederherstellungscodes stehen nirgends im Klartext', async () => {
    const code = zf.hotp(zf.ausBase32(g), zf.zeitschritt());
    const r = await post('/auth/zweiter-faktor/bestaetigen', 'zf-2', { code });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.codes.length, 10);
    for (const wc of r.body.codes) assert.deepEqual(await fundstellen(wc), [], wc);
    assert.equal((await post('/auth/zweiter-faktor/bestaetigen', 'zf-2', { code })).status, 409);
  });

  await t.test('gewöhnliche Antworten liegen verschlüsselt und werden wiederholt', async () => {
    const erst = await post('/storage/locations', 'p-1', { name: 'Kiste 1' });
    assert.equal(erst.status, 200, JSON.stringify(erst.body));
    assert.equal(erst.replay, null);
    const z = await zeile('p-1');
    assert.ok(z.antwort.startsWith('v2:'), z.antwort);
    assert.equal(
      geheimnis.entschluessele(z.antwort, _req('src/idempotenz/dienst.js').antwortKontext(uid, 'p-1')),
      JSON.stringify(erst.body),
    );
    const nochmal = await post('/storage/locations', 'p-1', { name: 'Kiste 1' });
    assert.deepEqual(nochmal, { ...erst, replay: 'true' });
  });

  await t.test('der Fingerabdruck verrät das Passwort nicht', async () => {
    const dienst = _req('src/idempotenz/dienst.js');
    const pfad = '/api/v1/auth/zweiter-faktor/einrichten';
    const alt = require('node:crypto')
      .createHash('sha256')
      .update(`POST ${pfad}\n${JSON.stringify({ password: PASS })}`)
      .digest('hex');
    assert.deepEqual(await fundstellen(alt), [], 'der SHA-256 des Rumpfs mit Passwort liegt in der Tabelle');
    assert.match(
      (await db.get("SELECT anfrage FROM idempotenz WHERE user_id = $1 AND schluessel = 'zf-1'", [uid])).anfrage,
      /^h1:[0-9a-f]{64}$/,
    );
    const abdruck = rumpf => dienst.fingerabdruck('POST', pfad, rumpf);
    assert.equal(
      abdruck({ password: 'a', current: 'b', admin_password: 'c', code: '1', faktor_code: '2', pin: '3', x: 1 }),
      abdruck({ password: 'z', current: 'y', admin_password: 'w', code: '9', faktor_code: '8', pin: '7', x: 1 }),
    );
    assert.notEqual(
      abdruck({ password: 'a', x: 1 }),
      abdruck({ password: 'a', x: 2 }),
      'der übrige Inhalt zählt weiter',
    );
    const vorher = abdruck({ x: 1 });
    umgebung({ DATA_KEY: Buffer.alloc(32, 8).toString('base64') });
    geheimnis._vergissSchluessel();
    try {
      assert.notEqual(abdruck({ x: 1 }), vorher, 'ohne Datenschlüssel nachrechenbar');
    } finally {
      umgebung({ DATA_KEY: Buffer.alloc(32, 7).toString('base64') });
      geheimnis._vergissSchluessel();
    }

    await db.run(`INSERT INTO idempotenz (user_id, schluessel, anfrage, status) VALUES ($1, 'sha-1', $2, 200)`, [
      uid,
      alt,
    ]);
    assert.ok((await dienst.alteAbdrueckeLoeschen()) >= 1);
    const uebrig = (await db.all('SELECT schluessel FROM idempotenz WHERE user_id = $1 ORDER BY 1', [uid])).map(
      z => z.schluessel,
    );
    assert.ok(!uebrig.includes('sha-1') && uebrig.includes('zf-1'), uebrig.join(', '));
  });

  await t.test('die Migration entfernt Klartext und die Wiederholung wird abgesagt', async () => {
    const abdruck = _req('src/idempotenz/dienst.js').fingerabdruck('POST', '/api/v1/storage/locations', {
      name: 'Alt',
    });
    await db.run(
      `INSERT INTO idempotenz (user_id, schluessel, anfrage, status, antwort)
                  VALUES ($1, 'alt-1', $2, 200, '{"token":"klartext-aus-frueher"}')`,
      [uid, abdruck],
    );
    // Zur Zeit von 0086 war verschlüsselt gleich v1.
    await db.run(
      `INSERT INTO idempotenz (user_id, schluessel, anfrage, status, antwort) VALUES ($1, 'v1-1', 'x', 200, 'v1:AAAA')`,
      [uid],
    );
    await db.run(fs.readFileSync(path.join(ROOT, 'db/migrations/0086-idempotenz-ohne-klartext.sql'), 'utf8'));
    assert.deepEqual(await fundstellen('klartext-aus-frueher'), []);
    assert.equal((await zeile('v1-1')).antwort, 'v1:AAAA', 'verschlüsselte Zeilen bleiben');
    const r = await post('/storage/locations', 'alt-1', { name: 'Alt' });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'idempotenz_nicht_wiederholbar');
  });
});

test('jede schreibende Route mit Zugang oder Code steht auf der Liste', () => {
  // `code` ist sonst der Fehlercode; der Einladungscode steht deshalb unten einzeln.
  const GEHEIME_FELDER = ['token', 'codes', 'geheimnis', 'otpauth'];
  const gefunden = [],
    fehlt = [];
  for (const [schluessel, route] of Object.entries(VERTRAG)) {
    const [methode, pfad] = schluessel.split(' ');
    if (methode === 'GET' || !route.antwort?.shape) continue;
    if (!GEHEIME_FELDER.some(f => f in route.antwort.shape)) continue;
    (antwortIstGeheim(methode, pfad.replace(/:\w+/g, '1')) ? gefunden : fehlt).push(schluessel);
  }
  assert.deepEqual(fehlt, []);
  assert.ok(gefunden.length >= 9, `nur ${gefunden.length} Routen erkannt: ${gefunden.join(', ')}`);
  assert.equal(antwortIstGeheim('POST', '/api/v1/settings/household/invite'), true);
  assert.equal(antwortIstGeheim('POST', '/api/v1/vouchers/7/klartext'), true);
  assert.equal(antwortIstGeheim('PUT', '/api/v1/parts/3001/5'), false);
});

test('jede Route mit Bestätigung ist nicht wiederholbar', () => {
  const mitBestaetigung = Object.entries(VERTRAG).filter(([, r]) => r.bestaetigung);
  assert.ok(mitBestaetigung.length >= 20, `nur ${mitBestaetigung.length} Routen mit Bestätigung`);
  const wiederholbar = mitBestaetigung
    .map(([k]) => k.split(' '))
    .filter(([m, p]) => !antwortIstGeheim(m, p.replace(/:\w+/g, '1')))
    .map(x => x.join(' '));
  assert.deepEqual(wiederholbar, []);
  assert.equal(nichtWiederholbar({ antwort: undefined }), false);
});
