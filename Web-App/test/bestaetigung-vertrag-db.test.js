/**
 * Ein einziger Bestätigungsweg: Jede Route mit `bestaetigung` im API-Vertrag
 * verlangt bei aktivem zweitem Faktor den Code (oder einen Passkey), auch mit
 * dem richtigen Passwort des Verwalters. Jede Route, die ein Passwort zur
 * Bestätigung annimmt, trägt die Marke; eine Route ohne Marke, die dennoch
 * bestätigt, antwortet in Tests mit 500.
 *
 * Gegenproben (03.11.2026 gemessen, je einzeln):
 *   A  in pruefeBestaetigung `mitFaktor = false` (nur Passwort, der alte
 *      Befund M1) → rot: „… ohne Code" für alle markierten Routen
 *   B  im Vertrag die Marke von DELETE /api/v1/bestand entfernt → rot: „die
 *      Pflichtrouten tragen die Marke"
 *   C  im Vertrag DELETE /users/:id mit `eingabe: { admin_password }` statt
 *      verwalterBestaetigt() → rot: „jede Passwort-Eingabe trägt die Marke"
 *   D  in bestaetigeMitFaktor die Prüfung auf die Marke entfernt → rot:
 *      „ohne Marke keine Bestätigung"
 *   E  in routes/api_v1/papierkorb.ts ein eigenes bcrypt.compare( → rot:
 *      „kein zweiter Weg zum Passwortvergleich"
 *   F  (05.11.2026) in NurCode (konto.ts) `password: txtLeer(…)` statt
 *      `z.null()` → rot: „jede Passwort-Eingabe trägt die Marke"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const zf = _req('src/konto/zweiterFaktor.js');
const { VERTRAG } = _req('src/infra/vertrag/index.js');
const { entschluessele } = _req('src/infra/geheimnis.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PASS = 'Vertrag-Passwort-1';

/** Was eine Route ausser Passwort und Code braucht, um bis zur Bestätigung zu kommen. */
const ZUSATZ = {
  'POST /api/v1/auth/users': { username: `bv_neu_${process.pid}`, password: 'Lang-genug-Passwort-1', is_admin: true },
  'PUT /api/v1/auth/users/:id/admin': { is_admin: true },
  'PUT /api/v1/auth/users/:id/aktiv': { is_active: false },
  'PUT /api/v1/auth/users/:id/password': { password: 'Lang-genug-Passwort-2' },
  'POST /api/v1/auth/change-password': { newPassword: 'Lang-genug-Passwort-3' },
  'PUT /api/v1/auth/profile': { email: `bv_${process.pid}@neu.example` },
  'POST /api/v1/settings/household/redeem': { code: 'EINLADUNG' },
  'POST /api/v1/settings': { smtp_host: 'mail.bv.example' },
};
/** Neue Zugänge prägen, Schutz abbauen, alles löschen (Bericht M1) — und die Notbremse. */
const PFLICHT = ['POST /api/v1/auth/token-create', 'POST /api/v1/auth/qr-token', 'POST /api/v1/auth/users',
  'PUT /api/v1/auth/users/:id/admin', 'PUT /api/v1/auth/users/:id/aktiv', 'PUT /api/v1/auth/users/:id/password',
  'DELETE /api/v1/auth/users/:id', 'DELETE /api/v1/auth/users/:id/zweiter-faktor', 'DELETE /api/v1/bestand',
  'POST /api/v1/auth/change-password', 'PUT /api/v1/auth/profile', 'DELETE /api/v1/auth/passkeys/:id',
  'POST /api/v1/auth/passkey/registrieren/optionen', 'POST /api/v1/auth/zweiter-faktor/abschalten',
  'POST /api/v1/settings/household/redeem', 'POST /api/v1/settings', 'POST /api/v1/settings/sessions/andere-beenden',
  'DELETE /api/v1/papierkorb', 'DELETE /api/v1/papierkorb/:id', 'DELETE /api/v1/vouchers/:id',
  'POST /api/v1/vouchers/:id/klartext', 'POST /api/v1/vouchers/:id/pdf-freigabe', 'POST /api/v1/vouchers/export/pdf-freigabe'];
/** Vor der Anmeldung gibt es nichts zu bestätigen. */
const OEFFENTLICH = ['POST /api/v1/auth/login', 'POST /api/v1/auth/register', 'POST /api/v1/auth/reset-password'];
const PASSWORTFELDER = ['password', 'admin_password', 'current', 'password_current'];

async function konto(name, admin) {
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  return (await db.get(`INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, $4, true, true) RETURNING id`, [name, `${name}@alt.example`, await bcrypt.hash(PASS, 4), admin])).id;
}
async function mitFaktor(uid) {
  await zf.beginneEinrichtung(uid);
  const z = await db.get('SELECT geheimnis FROM zweiter_faktor WHERE user_id = $1', [uid]);
  const codes = await zf.bestaetigeEinrichtung(uid, zf.hotp(zf.ausBase32(entschluessele(z.geheimnis, zf.faktorKontext(uid))), zf.zeitschritt()));
  assert.ok(Array.isArray(codes), 'Vorbedingung: Faktor aktiv');
  return codes;
}

test('ein einziger Bestätigungsweg', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber keine Test-DB: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  const CHEF = `bv_chef_${process.pid}`, ZIEL = `bv_ziel_${process.pid}`, OHNE = `bv_ohne_${process.pid}`;
  const chef = await konto(CHEF, true), ziel = await konto(ZIEL, false), ohne = await konto(OHNE, false);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1) OR username = $2', [[chef, ziel, ohne], ZUSATZ['POST /api/v1/auth/users'].username]).catch(() => {});
    await db.run("DELETE FROM global_settings WHERE key = 'smtp_host' AND value = 'mail.bv.example'").catch(() => {});
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2 OR key LIKE $3', [`%-bestaetigen|${chef}|%`, `%-bestaetigen|${ohne}|%`, `%-bestaetigen-konto|${chef}`]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const codes = await mitFaktor(chef);
  await mitFaktor(ziel);
  const routen = { '/api/v1/auth': 'routes/auth.js', '/api/v1': 'routes/api_v1/index.js' };
  const basis = testServer(_req, { sitzung: { userId: chef, username: CHEF, isAdmin: true }, routen, t }).base;
  const ruf = async (b, schluessel, body) => {
    const [methode, muster] = schluessel.split(' ');
    const r = await fetch(b + muster.replace(':id', String(ziel)), { method: methode,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const markiert = Object.entries(VERTRAG).filter(([, r]) => r.bestaetigung);

  await t.test('die Pflichtrouten tragen die Marke', () => {
    const fehlt = PFLICHT.filter(k => !VERTRAG[k]?.bestaetigung);
    assert.deepEqual(fehlt, []);
  });

  await t.test('jede Passwort-Eingabe trägt die Marke', () => {
    const ohneMarke = Object.entries(VERTRAG).filter(([k, r]) => !OEFFENTLICH.includes(k) && !r.bestaetigung
      && r.eingabe?.shape && PASSWORTFELDER.some(f => r.eingabe.shape[f]?.safeParse('x').success)).map(([k]) => k);
    assert.deepEqual(ohneMarke, []);
  });

  for (const [schluessel, route] of markiert) {
    await t.test(`${schluessel}: Passwort allein genügt nicht`, async () => {
      // Auch die Kontobremse (20 am Tag): Hier rät eine Sitzung absichtlich bei jeder Route falsch.
      await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2', [`%-bestaetigen|${chef}|%`, `%-bestaetigen-konto|${chef}`]);
      const { passwort, code } = route.bestaetigung;
      const rumpf = { ...ZUSATZ[schluessel], [passwort]: PASS };
      const ohneCode = await ruf(basis, schluessel, rumpf);
      assert.deepEqual([ohneCode.status, ohneCode.body.code], [400, 'zweiter_faktor_noetig'], `${schluessel} ohne Code`);
      const falsch = await ruf(basis, schluessel, { ...rumpf, [code]: '000000' });
      assert.deepEqual([falsch.status, falsch.body.code], [400, 'zweiter_faktor_falsch'], `${schluessel} mit falschem Code`);
    });
  }
  assert.ok(markiert.length >= PFLICHT.length, `nur ${markiert.length} markierte Routen`);

  await t.test('mit Code geht es, ohne Faktor wie bisher', async () => {
    const r = await ruf(basis, 'DELETE /api/v1/auth/users/:id/zweiter-faktor', { admin_password: PASS, code: codes[0] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await zf.istAktiv(ziel), false);
    const ohneFaktor = testServer(_req, { sitzung: { userId: ohne, username: OHNE }, routen, t }).base;
    const tok = await ruf(ohneFaktor, 'POST /api/v1/auth/token-create', { password: PASS });
    assert.equal(tok.status, 200, JSON.stringify(tok.body));
  });

  await t.test('kein zweiter Weg zum Passwortvergleich', () => {
    const fs = require('node:fs');
    const { ohneKommentare } = require('./helpers/sources');
    const ordner = [path.join(ROOT, 'routes'), path.join(ROOT, 'src'), path.join(ROOT, 'jobs')];
    const dateien = ordner.flatMap(o => fs.readdirSync(o, { recursive: true }).map(f => path.resolve(o, String(f))))
      .filter(f => f.endsWith('.ts')).concat(path.join(ROOT, 'server.ts'));
    const treffer = dateien.filter(f => /\bbcrypt\.compare\(/.test(ohneKommentare(fs.readFileSync(f, 'utf8'))))
      .map(f => path.relative(ROOT, f).replace(/\\/g, '/')).sort();
    assert.deepEqual(treffer, ['src/konto/bcryptPool.ts'], 'nur der Rückfall des Pools; alle anderen über passwortPasst()');
  });

  await t.test('ohne Marke keine Bestätigung', async () => {
    const route = VERTRAG['DELETE /api/v1/bestand'];
    const marke = route.bestaetigung;
    delete route.bestaetigung;
    try {
      const r = await ruf(basis, 'DELETE /api/v1/bestand', { password: PASS, code: codes[1] });
      assert.equal(r.status, 500, `ohne Marke keine Bestätigung: ${JSON.stringify(r.body)}`);
    } finally { route.bestaetigung = marke; }
  });
});
