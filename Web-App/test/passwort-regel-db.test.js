/**
 * Eine Passwortregel für jeden Weg, der ein Passwort setzt: Registrierung,
 * Ändern, Zurücksetzen, Konto anlegen und Passwort setzen durch den
 * Verwalter, das Startpasswort aus ADMIN_PASSWORD. Abgewiesen werden zu kurze,
 * mehr als 72 Byte lange (bcrypt kürzte sie still) und häufige oder aus
 * Datenlecks bekannte Passwörter (mitgelieferte Liste, keine Netzabfrage).
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  Listenprüfung in passwortMangel() gestrichen → rot: alle Fälle,
 *      zuerst „häufige Passwörter …" (alle fünf Routen nehmen das häufige an)
 *   B  Byte-Grenze gestrichen → rot: „die Regel selbst" und „mehr als 72
 *      Byte …" (danach „ein gutes Passwort …": das Konto gibt es schon)
 *   C  /reset-password prüft wieder nur die Länge → rot: „häufige
 *      Passwörter …" und „mehr als 72 Byte …" (nur diese Route nimmt es an)
 *   D  src/konto/startVerwalter.ts nimmt ADMIN_PASSWORD ungeprüft → rot: „ein schwaches
 *      ADMIN_PASSWORD …"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (der letzte Fall legt das
 * Schema neu an).
 */
const test = require('node:test');
const { umgebung } = require('./helpers/sources');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
umgebung({ APP_BASE_URL: 'http://localhost' });
umgebung({ ADMIN_PASSWORD: undefined });

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { mailAttrappe, mailserverEintragen } = require('./helpers/mail-attrappe');
mailAttrappe();
const db = _req('db/database.js');
const { passwortMangel } = _req('src/infra/passwortRegel.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

test('die Regel selbst', () => {
  assert.equal(passwortMangel('Brick-Sammlung-2026'), null);
  assert.equal(passwortMangel('1234567'), 'passwort_zu_kurz');
  // Seit dem 04.11.2026 mindestens 12 Zeichen: Die häufigen darunter fallen schon an der Länge.
  assert.equal(passwortMangel('password1'), 'passwort_zu_kurz');
  for (const p of ['ichliebedich', 'Sonnenschein', 'SONNENSCHEIN'])
    assert.equal(passwortMangel(p), 'passwort_zu_haeufig', p);
  assert.equal(passwortMangel('Mein-Name-Ist-Lego', 'mein-name-ist-lego'), 'passwort_zu_haeufig', 'der Benutzername als Passwort');
  assert.equal(passwortMangel('a'.repeat(72)), null, '72 Byte gehen noch');
  assert.equal(passwortMangel('a'.repeat(73)), 'passwort_zu_lang');
  assert.equal(passwortMangel('ä'.repeat(37)), 'passwort_zu_lang', '37 Zeichen, aber 74 Byte');
});

test('Passwortregel auf allen Wegen', { concurrency: 1, timeout: 120_000 }, async (t) => {
  if (!await dbOderSkip(t, _req)) return;
  const CHEF = `regel_chef_${process.pid}`, ZIEL = `regel_ziel_${process.pid}`, PASS = 'Regel-Pruefung-7';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[CHEF, ZIEL]]);
  const hash = bcrypt.hashSync(PASS, 4);
  const chef = (await db.get(`INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, true, true, true) RETURNING id`, [CHEF, hash])).id;
  const ziel = (await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, $2, true, true) RETURNING id`, [ZIEL, hash])).id;
  const regVorher = await db.get("SELECT value FROM global_settings WHERE key = 'registration_enabled'");
  await db.run("INSERT INTO global_settings (key, value) VALUES ('registration_enabled', '1') ON CONFLICT (key) DO UPDATE SET value = '1'");
  const mailZurueck = await mailserverEintragen(db);
  t.after(async () => {
    await db.run("DELETE FROM global_settings WHERE key = 'registration_enabled'");
    if (regVorher) await db.run("INSERT INTO global_settings (key, value) VALUES ('registration_enabled', $1)", [regVorher.value]);
    await mailZurueck();
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[chef, ziel]]);
  });
  const { base } = testServer(_req, { sitzung: { userId: chef, username: CHEF, isAdmin: true },
    routen: { '/api/v1/auth': 'routes/auth.js' }, t });
  const wege = (pw) => [
    ['POST', '/register', { username: `regel_neu_${process.pid}`, email: `regel_${process.pid}@example.org`, password: pw }],
    ['POST', '/change-password', { current: PASS, newPassword: pw }],
    ['POST', '/reset-password', { token: 'a'.repeat(64), password: pw }],
    ['POST', '/users', { username: `regel_vw_${process.pid}`, password: pw, admin_password: PASS }],
    ['PUT', `/users/${ziel}/password`, { password: pw, admin_password: PASS }],
  ];
  const ruf = async ([methode, pfad, rumpf]) => {
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'register|%' OR key LIKE 'reset-password|%'");
    const r = await fetch(`${base}/api/v1/auth${pfad}`, { method: methode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(rumpf) });
    const b = await r.json();
    return `${pfad} ${r.status} ${b.code ?? ''}`;
  };

  await t.test('häufige Passwörter werden auf allen fünf Wegen abgewiesen', async () => {
    const ist = [];
    for (const w of wege('sonnenschein')) ist.push(await ruf(w));
    assert.deepEqual(ist, wege('').map(([, p]) => `${p} 400 passwort_zu_haeufig`));
    const text = (await (await fetch(`${base}/api/v1/auth/reset-password`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'x', password: 'ICHLIEBEDICH' }) })).json()).error;
    assert.match(text, /zu häufig oder aus Datenlecks bekannt/);
  });

  await t.test('mehr als 72 Byte werden gemeldet statt gekürzt', async () => {
    const ist = [];
    for (const w of wege('Ä'.repeat(40))) ist.push(await ruf(w));
    assert.deepEqual(ist, wege('').map(([, p]) => `${p} 400 passwort_zu_lang`));
  });

  await t.test('ein gutes Passwort geht durch', async () => {
    assert.equal(await ruf(wege('Brick-Sammlung-2026')[3]), '/users 200 ');
    await db.run('DELETE FROM users WHERE username = $1', [`regel_vw_${process.pid}`]);
  });

  // Gegenproben (02.11.2026 gemessen): in /change-password wieder
  // req.session?.username → rot (200 für den eigenen Namen); in
  // /users/:id/password wieder ohne Namen → rot (200 für den Namen des Ziels).
  await t.test('der Benutzername ist kein Passwort, auch ohne Namen in der Sitzung', async () => {
    const app = testServer(_req, { sitzung: { userId: chef, isAdmin: true }, routen: { '/api/v1/auth': 'routes/auth.js' }, t });
    const setze = (methode, pfad, rumpf) => fetch(`${app.base}/api/v1/auth${pfad}`, { method: methode,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(rumpf) })
      .then(async r => `${r.status} ${(await r.json()).code ?? ''}`);
    assert.equal(await setze('POST', '/change-password', { current: PASS, newPassword: CHEF.toUpperCase() }), '400 passwort_zu_haeufig');
    assert.equal(await setze('PUT', `/users/${ziel}/password`, { password: ZIEL, admin_password: PASS }), '400 passwort_zu_haeufig');
    assert.ok(bcrypt.compareSync(PASS, (await db.get('SELECT password_hash FROM users WHERE id = $1', [ziel])).password_hash));
  });

  // Gegenprobe (05.11.2026 gemessen): in /reset-password die zweite Prüfung
  // mit user.username gestrichen → rot (200, das Passwort ist der Name).
  await t.test('Zurücksetzen: der Benutzername ist kein Passwort', async () => {
    const roh = 'b'.repeat(64);
    await db.run(`UPDATE users SET reset_token = $2, reset_token_expires = NOW() + interval '1 hour' WHERE id = $1`,
      [ziel, require('node:crypto').createHash('sha256').update(roh).digest('hex')]);
    assert.equal(await ruf(['POST', '/reset-password', { token: roh, password: ZIEL.toUpperCase() + '-x' }]).then(r => r.split(' ')[1]), '200',
      'ein anderes Passwort geht (Prüfung des Tokens)');
    await db.run(`UPDATE users SET reset_token = $2, reset_token_expires = NOW() + interval '1 hour' WHERE id = $1`,
      [ziel, require('node:crypto').createHash('sha256').update(roh).digest('hex')]);
    assert.equal(await ruf(['POST', '/reset-password', { token: roh, password: ZIEL.toUpperCase() }]), '/reset-password 400 passwort_zu_haeufig');
    assert.ok(!bcrypt.compareSync(ZIEL.toUpperCase(), (await db.get('SELECT password_hash FROM users WHERE id = $1', [ziel])).password_hash));
  });

  await t.test('ein schwaches ADMIN_PASSWORD wird nicht übernommen', async () => {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    umgebung({ ADMIN_PASSWORD: 'passwort123' });
    const echt = { log: console.log, warn: console.warn }, warnungen = [];
    console.log = () => {}; console.warn = (...a) => warnungen.push(a.join(' '));
    try { await db.initSchema(); } finally { Object.assign(console, echt); umgebung({ ADMIN_PASSWORD: undefined }); }
    const admin = await db.get("SELECT password_hash, must_change_password FROM users WHERE username = 'admin'");
    assert.equal(bcrypt.compareSync('passwort123', admin.password_hash), false, 'das schwache Passwort gilt');
    assert.equal(admin.must_change_password, true);
    assert.ok(warnungen.some(w => /ADMIN_PASSWORD wird nicht verwendet/.test(w)), warnungen.join('\n'));
  });
  t.after(() => db.pool.end().catch(() => {}));
});
