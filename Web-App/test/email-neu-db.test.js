/**
 * Eine neue E-Mail-Adresse gilt erst nach dem Link an sie (Sicherheitsprüfung
 * Runde 12, N1). Bis dahin bleibt die alte, und die neue belegt nichts: Ihr
 * Inhaber kann sich mit ihr registrieren, und Passwort-vergessen findet über
 * eine unbestätigte Adresse kein Konto. Seit Runde 13 (N1) legt auch eine
 * Registrierung ihre Adresse nur als ausstehend ab; die erste Bestätigung
 * gewinnt. Migration 0096 macht aus dem Altbestand ausstehende Adressen (H5),
 * 0097 ebenso aus offenen Registrierungen, und der Start meldet die ohne Link.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  PUT /profile schreibt die Adresse wieder sofort nach users.email → rot:
 *      „eine neue Adresse gilt erst nach dem Link“
 *   B  registriereKonto() schreibt die Adresse wieder nach users.email → rot:
 *      „die ausstehende Adresse belegt nichts“ und „beim Einlösen …“
 *   C  aktivesKontoNachEmail() ohne `AND email_verified` → rot: „Passwort
 *      vergessen nur für bestätigte Adressen“
 *   D  assertLoginAllowed() ohne die Bedingung `registrierung_offen` → rot: „eine
 *      fremde Registrierung sperrt die Adresse nicht“ (mallory meldet sich an)
 *   E  uebernimmEmailNeu() ohne OHNE_RUECKSETZLINK → rot: „eingelöst gilt die
 *      neue Adresse“ (der Rücksetzlink an die alte Adresse gilt weiter)
 *   F  in 0096 die Bedingung `NOT registrierung_offen` gestrichen → rot:
 *      „Migration 0096 …“; in 0097 `email = NULL` gestrichen → rot: „Migrationen
 *      0096 und 0097 …“ (auf frischer DB gemessen, sonst greift die Prüfsumme)
 *   G  meldeAusstehendeAdressen() ohne Abfrage (leere Liste) → rot: dieselbe Prüfung
 *   H  erneuereEmailTokenWennFrei() ohne `HAVING COUNT(*) = 1` → rot: „ein neuer
 *      Link nur für die einzige offene Registrierung“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const fs     = require('node:fs');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';
process.env.APP_BASE_URL = 'http://localhost';

const ROOT = path.join(__dirname, '..');
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { testServer } = require('./helpers/server');
const { mailserverEintragen } = require('./helpers/mail-attrappe');

const post = [];
const echt = _req('src/infra/mailer.js');
require.cache[require.resolve(path.join(S.DIST, 'src/infra/mailer.js'))].exports = Object.assign({}, echt, {
  sendVerificationMail: async (an, token, _b, _l, art) => { post.push({ an, art: art ?? 'registrierung', token }); return { success: true, mode: 'smtp' }; },
  sendEmailGeaendertMail: async (an, _n, neu) => { post.push({ an, art: 'hinweis', neu }); return { success: true }; },
  sendRegistrierungsVersuchMail: async (an) => { post.push({ an, art: 'versuch' }); return { success: true, mode: 'smtp' }; },
  sendPasswordResetMail: async (an) => { post.push({ an, art: 'reset' }); return { success: true }; },
});

const db = _req('db/database.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const P = `en${process.pid}`, PASS = 'Passwort-Carol-2026';
const adr = (n) => `${n}_${P}@example.org`;
const ZAEHLER = ['register|%', 'register-ziel|%', 'forgot%', 'profil-vergabe%', 'email-bestaetigen|%', '%-bestaetigen|%', 'login%', 'bestaetigung%'];

test('neue E-Mail-Adresse erst nach Bestätigung', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  { const c = await db.pool.connect(); try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); } }
  const raeumen = async () => {
    await db.run('DELETE FROM users WHERE username LIKE $1', [`%_${P}`]);
    for (const k of ZAEHLER) await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [k]);
  };
  await raeumen();
  const regVorher = (await db.get("SELECT value FROM global_settings WHERE key = 'registration_enabled'"))?.value;
  await db.run(`INSERT INTO global_settings (key, value) VALUES ('registration_enabled', '1')
                ON CONFLICT (key) DO UPDATE SET value = '1'`);
  const mailZurueck = await mailserverEintragen(db);
  const uid = (await db.get(`INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`, [`carol_${P}`, adr('alt'), bcrypt.hashSync(PASS, 4)])).id;
  t.after(async () => {
    await raeumen();
    if (regVorher === undefined) await db.run("DELETE FROM global_settings WHERE key = 'registration_enabled'");
    else await db.run("UPDATE global_settings SET value = $1 WHERE key = 'registration_enabled'", [regVorher]);
    await mailZurueck();
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { sitzung: { userId: uid, username: `carol_${P}` },
    routen: { '/api/v1/auth': 'routes/auth.js' }, t });
  const ruf = async (methode, weg, body) => {
    const r = await fetch(`${base}/api/v1/auth${weg}`, { method: methode,
      headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const carol = () => db.get('SELECT email, email_verified, email_neu, reset_token FROM users WHERE id = $1', [uid]);
  const konto = (name) => db.get('SELECT id, email, email_neu FROM users WHERE username = $1', [`${name}_${P}`]);
  const registriere = (name, email) => ruf('POST', '/register', { username: `${name}_${P}`, email, password: 'Opfer-Passwort-2026!' });
  const linkAn = (an, art = 'adresse') => post.filter(m => m.an === an && m.art === art).at(-1)?.token;
  const anmelden = (name) => ruf('POST', '/login', { username: `${name}_${P}`, password: 'Opfer-Passwort-2026!', ohne_token: true });

  await t.test('eine neue Adresse gilt erst nach dem Link', async () => {
    const r = await ruf('PUT', '/profile', { username: `carol_${P}`, email: adr('opfer'), password_current: PASS });
    assert.deepEqual([r.status, r.body.emailChanged, r.body.emailSent], [200, true, true], JSON.stringify(r.body));
    assert.deepEqual(await carol(), { email: adr('alt'), email_verified: true, email_neu: adr('opfer'), reset_token: null });
    assert.ok(linkAn(adr('opfer')), 'der Link geht an die neue Adresse');
    assert.deepEqual(post.filter(m => m.art === 'hinweis'), [{ an: adr('alt'), art: 'hinweis', neu: adr('opfer') }]);
    const profil = await ruf('GET', '/profile');
    assert.deepEqual([profil.body.user.email, profil.body.user.email_neu], [adr('alt'), adr('opfer')]);
  });

  await t.test('die ausstehende Adresse belegt nichts', async () => {
    const r = await registriere('opfer', adr('opfer'));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(await konto('opfer'), { id: (await konto('opfer')).id, email: null, email_neu: adr('opfer') },
      'der Inhaber bekommt ein Konto, die Adresse bis zum Link nur ausstehend');
    assert.equal((await carol()).email, adr('alt'));
  });

  await t.test('Passwort vergessen nur für bestätigte Adressen', async () => {
    for (const email of [adr('opfer'), adr('alt')]) assert.equal((await ruf('POST', '/forgot-password', { email })).status, 200);
    const opfer = await db.get('SELECT reset_token FROM users WHERE username = $1', [`opfer_${P}`]);
    assert.equal(opfer.reset_token, null, 'Rücksetzlink über eine unbestätigte Adresse');
    // Gegenstück: Über die bestätigte Adresse entsteht einer, sonst prüfte der Fall nichts.
    assert.notEqual((await carol()).reset_token, null);
  });

  await t.test('beim Einlösen wird erneut geprüft', async () => {
    const opfer = await ruf('POST', '/email-bestaetigen', { token: linkAn(adr('opfer'), 'registrierung') });
    assert.equal(opfer.status, 200, 'die erste Bestätigung gewinnt');
    assert.equal((await konto('opfer')).email, adr('opfer'));
    const r = await ruf('POST', '/email-bestaetigen', { token: linkAn(adr('opfer')) });
    assert.deepEqual([r.status, r.body.code], [400, 'email_vergeben'], JSON.stringify(r.body));
    const c = await carol();
    assert.deepEqual([c.email, c.email_neu], [adr('alt'), null]);
  });

  await t.test('eingelöst gilt die neue Adresse', async () => {
    assert.equal((await ruf('PUT', '/profile', { email: adr('neu'), password_current: PASS })).status, 200);
    const token = linkAn(adr('neu'));
    assert.equal((await ruf('POST', '/email-bestaetigen', { token })).status, 200);
    assert.deepEqual(await carol(), { email: adr('neu'), email_verified: true, email_neu: null, reset_token: null });
    const nochmal = await ruf('POST', '/email-bestaetigen', { token });
    assert.deepEqual([nochmal.status, nochmal.body.code], [400, 'bestaetigungslink_ungueltig']);
  });

  const bremsenLoesen = () => db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'register%' OR key LIKE 'login%'");
  await t.test('eine fremde Registrierung sperrt die Adresse nicht', async () => {
    await bremsenLoesen();
    assert.equal((await registriere('mallory1', adr('ziel'))).status, 200);
    await db.run("UPDATE users SET created_at = NOW() - INTERVAL '25 hours' WHERE username = $1", [`mallory1_${P}`]);
    assert.equal((await registriere('mallory2', adr('ziel'))).status, 200);
    assert.equal((await registriere('ziel', adr('ziel'))).status, 200);
    assert.deepEqual(await konto('ziel'), { id: (await konto('ziel')).id, email: null, email_neu: adr('ziel') });
    assert.ok(!post.some(m => m.an === adr('ziel') && m.art === 'versuch'), 'eine unbestätigte Registrierung gilt als Inhaber');
    const login = await anmelden('mallory2');
    assert.deepEqual([login.status, login.body.code], [401, 'anmeldedaten_ungueltig'], 'eine offene Registrierung meldet sich an');
    assert.equal((await ruf('POST', '/email-bestaetigen', { token: linkAn(adr('ziel'), 'registrierung') })).status, 200);
    assert.equal((await konto('ziel')).email, adr('ziel'));
    assert.equal((await anmelden('ziel')).status, 200);
    await bremsenLoesen();
    const spaeter = await registriere('mallory3', adr('ziel'));
    assert.equal(spaeter.status, 200);
    assert.equal(await konto('mallory3'), undefined, 'nach der Bestätigung ist die Adresse vergeben');
    assert.equal(post.filter(m => m.an === adr('ziel') && m.art === 'versuch').length, 1);
  });

  await t.test('ein neuer Link nur für die einzige offene Registrierung', async () => {
    await bremsenLoesen();
    const erneut = async (email) => { const vorher = post.length; await ruf('POST', '/bestaetigung-erneut', { email }); return post.slice(vorher); };
    assert.equal((await registriere('allein', adr('allein'))).status, 200);
    await db.run("UPDATE users SET email_neu_bis = NOW() + INTERVAL '1 hour' WHERE username = $1", [`allein_${P}`]);
    assert.deepEqual((await erneut(adr('allein'))).map(m => [m.an, m.art]), [[adr('allein'), 'registrierung']]);
    assert.equal((await registriere('doppel', adr('allein'))).status, 200);
    await db.run("UPDATE users SET email_neu_bis = NOW() + INTERVAL '1 hour' WHERE username LIKE $1", [`%_${P}`]);
    assert.deepEqual(await erneut(adr('allein')), [], 'bei zwei offenen Registrierungen ginge ein fremder Link mit');
  });

  await t.test('Migrationen 0096 und 0097 machen den Altbestand ausstehend, der Start meldet ihn', async () => {
    const sql = fs.readFileSync(path.join(ROOT, 'db/migrations/0096-email-neu.sql'), 'utf8');
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      const neu = async (name, spalten) => (await c.query(`INSERT INTO users (username, password_hash, email, email_verified,
        registrierung_offen, verification_token, token_expires) VALUES ($1, 'x', $2, $3, $4, $5, NOW() + $6::interval) RETURNING id`,
        [`${name}_${P}`, adr(name), ...spalten])).rows[0].id;
      const ids = { gueltig: await neu('gueltig', [false, false, 'h1', '2 hours']), alt: await neu('altlink', [false, false, 'h2', '-2 hours']),
        offen: await neu('offen', [false, true, 'h3', '2 hours']), fest: await neu('fest', [true, false, null, '0 hours']) };
      await c.query(sql.slice(sql.indexOf('UPDATE users')));
      const z = Object.fromEntries((await c.query(`SELECT id, email, email_neu, email_neu_token, email_neu_bis IS NOT NULL AS bis,
        verification_token FROM users WHERE id = ANY($1)`, [Object.values(ids)])).rows.map(r => [r.id, r]));
      assert.deepEqual(z[ids.gueltig], { id: ids.gueltig, email: null, email_neu: adr('gueltig'), email_neu_token: 'h1', bis: true, verification_token: null });
      assert.deepEqual(z[ids.alt], { id: ids.alt, email: null, email_neu: adr('altlink'), email_neu_token: null, bis: false, verification_token: null });
      assert.equal(z[ids.offen].email, adr('offen'), 'eine offene Registrierung behält ihre Adresse');
      assert.equal(z[ids.fest].email, adr('fest'));
    } finally { await c.query('ROLLBACK'); c.release(); }
    const c2 = await db.pool.connect();
    try {
      await c2.query('BEGIN');
      const m97 = fs.readFileSync(path.join(ROOT, 'db/migrations/0097-registrierung-ausstehend.sql'), 'utf8');
      const ids = (await c2.query(`INSERT INTO users (username, password_hash, email, email_verified, registrierung_offen,
        verification_token, token_expires) VALUES ($1, 'x', $2, false, true, 'h4', NOW() + INTERVAL '2 hours'),
        ($3, 'x', $4, true, false, NULL, NULL) RETURNING id`, [`reg_${P}`, adr('reg'), `best_${P}`, adr('best')])).rows.map(r => r.id);
      await c2.query(m97);
      const z = (await c2.query(`SELECT email, email_neu, email_neu_token, email_neu_bis IS NOT NULL AS bis, verification_token
        FROM users WHERE id = ANY($1) ORDER BY id`, [ids])).rows;
      assert.deepEqual(z, [{ email: null, email_neu: adr('reg'), email_neu_token: 'h4', bis: true, verification_token: null },
        { email: adr('best'), email_neu: null, email_neu_token: null, bis: false, verification_token: null }], 'Migration 0097 …');
    } finally { await c2.query('ROLLBACK'); c2.release(); }
    const h5 = (await db.get(`INSERT INTO users (username, password_hash, email_neu) VALUES ($1, 'x', $2) RETURNING id`,
      [`h5_${P}`, adr('h5')])).id;
    const { meldeAusstehendeAdressen } = _req('src/konto/konten.js');
    assert.ok((await meldeAusstehendeAdressen()).includes(h5));
    assert.ok(!(await meldeAusstehendeAdressen()).includes(uid));
  });
});
