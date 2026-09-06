/**
 * Angemeldete Geräte: auflisten und aussperren — beide Wege, echte Datenbank.
 *
 * ── Warum es diese Datei gibt ───────────────────────────────────────────────
 * Die Endpunkte /api/v1/settings/tokens gab es lange, einen Weg dorthin nicht.
 * test/api-aufrufer.test.js führte sie als ausdrücklich unbequeme Ausnahme:
 * „Oberfläche FEHLT — die Route bleibt, damit sie gebaut werden kann, statt
 * sie zu löschen und die Lücke damit unsichtbar zu machen." Wer sein Telefon
 * verlor, kam an den Zugang nur über einen Passwortwechsel — und der sperrt
 * ALLE Geräte aus, nicht nur das eine.
 *
 * Zwei Dinge mussten sich dafür ändern, und beide sind hier nachgemessen:
 *
 *  1. Die Endpunkte waren SITZUNGSGEBUNDEN und damit für die App unerreichbar.
 *     Jetzt nehmen sie Sitzung ODER Bearer-Token, wie der Rest von /api/v1.
 *  2. Sie sagten nicht, WELCHE Zeile zum Fragenden gehört. Ohne das kann man
 *     sich mit dem eigenen Knopf aussperren, ohne es zu merken.
 *
 * Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
 * Ohne DB: skip. Ausführen: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, einhaengung } = require('./helpers/sources');
const _req = buildAndRequire();
const AUTH     = einhaengung('auth');
const SETTINGS = einhaengung('settings');
const db = _req('db/database.js');
const express   = require(path.join(ROOT, 'node_modules', 'express'));
const session   = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt    = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = 'geraete_test', PASS = 'richtigesPasswort1';

test('Zugänge auflisten und aussperren — über Sitzung UND über Token',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  await db.run(
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,0,1,1)',
    [NAME, await bcrypt.hash(PASS, 4)]);

  const app = express();
  app.use(express.json());
  app.use(session({
    store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
  }));
  app.use(AUTH,     _req('routes/auth.js'));
  app.use(SETTINGS, _req('routes/settings.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}`;

  const ruf = async (weg, opt = {}) => {
    const r = await fetch(basis + weg, {
      method: opt.method || 'GET',
      headers: { 'content-type': 'application/json', ...(opt.headers || {}) },
      ...(opt.body ? { body: JSON.stringify(opt.body) } : {}),
    });
    return { status: r.status, cookie: r.headers.get('set-cookie'), body: await r.json().catch(() => null) };
  };
  const anmelden = (extra = {}) =>
    ruf(AUTH + '/login', { method: 'POST', body: { username: NAME, password: PASS, ...extra } });

  try {
    // Drei Anmeldungen: ein Browser und zwei „Telefone" mit eigenen Etiketten.
    const browser = await anmelden();
    assert.equal(browser.status, 200, JSON.stringify(browser.body));
    const telefon = await anmelden({ label: 'Pixel 8', never_expires: true });
    const tablet  = await anmelden({ label: 'Tablet',  never_expires: true });
    const cookie  = browser.cookie.split(';')[0];

    // ── 1. Über die SITZUNG (Webapp) ────────────────────────────────────────
    const perSitzung = await ruf(SETTINGS + '/tokens', { headers: { cookie } });
    assert.equal(perSitzung.status, 200, JSON.stringify(perSitzung.body));
    assert.equal(perSitzung.body.tokens.length, 3, 'Alle drei Anmeldungen müssen auftauchen');
    // Die Sitzung ALLEIN sagt nichts darüber, welche Zeile zu ihr gehört —
    // der Client muss seinen Token mitschicken. Genau das prüft der nächste
    // Block; hier darf also noch nichts markiert sein.
    assert.equal(perSitzung.body.tokens.filter(x => x.aktuell).length, 0,
      'Ohne mitgeschickten Token ist keine Zeile als „dieses Gerät" erkennbar');

    const mitEigenem = await ruf(SETTINGS + '/tokens',
      { headers: { cookie, authorization: `Bearer ${browser.body.token}` } });
    const markiert = mitEigenem.body.tokens.filter(x => x.aktuell);
    assert.equal(markiert.length, 1, 'Genau eine Zeile ist „dieses Gerät"');
    assert.equal(markiert[0].label, 'webapp-session');
    // Der Token selbst darf NICHT herauskommen — nur ein Stück seines Hashes.
    assert.ok(!JSON.stringify(mitEigenem.body).includes(browser.body.token),
      'Der Klartext-Token darf in der Übersicht nicht auftauchen');

    // ── 2. Über den TOKEN (App) ─────────────────────────────────────────────
    // Vorher war das gar nicht möglich: Die Route hing an der Sitzung, und die
    // App hat keine.
    const perToken = await ruf(SETTINGS + '/tokens',
      { headers: { authorization: `Bearer ${telefon.body.token}` } });
    assert.equal(perToken.status, 200, 'Die App muss ihre Zugänge sehen können');
    assert.equal(perToken.body.tokens.length, 3);
    assert.equal(perToken.body.tokens.find(x => x.aktuell)?.label, 'Pixel 8');
    // Und die Laufzeiten stehen richtig drin — daran hängt die Anzeige.
    //
    // Beide Zeilen tragen jetzt ein Datum: Auch der App-Token hat seit der
    // Gleitfrist ein echtes Ablaufdatum (utils/auth.ts), es rueckt bei jeder
    // Benutzung nur nach. Fuer die Anzeige heisst das: Webapp und App zeigen
    // in der Spalte „Laeuft ab" ein Datum statt „nie" — und das ist genau die
    // Auskunft, die vorher fehlte. „nie" war ein Versprechen, das der
    // Aufraeumjob nach 90 Tagen gebrochen hat.
    for (const label of ['Pixel 8', 'webapp-session']) {
      const zeile = perToken.body.tokens.find(x => x.label === label);
      assert.equal(zeile.never_expires, false, `${label}: kein Token laeuft mehr „nie" ab`);
      assert.ok(zeile.expires_at, `${label}: ohne Datum hat die Anzeige nichts zu zeigen`);
    }
    // Der des Telefons laeuft laenger als der des Browsers — sonst waere die
    // Gleitfrist keine Erleichterung, sondern eine Verschaerfung.
    assert.ok(
      new Date(perToken.body.tokens.find(x => x.label === 'Pixel 8').expires_at) >
      new Date(perToken.body.tokens.find(x => x.label === 'webapp-session').expires_at),
      'Der App-Token muss laenger laufen als die sieben Tage des Browsers');

    // ── 3. Ein fremdes Gerät aussperren ─────────────────────────────────────
    //
    // Vorbedingung: Der Token des Tablets muss IM CACHE liegen, sonst prüft
    // der Test darunter nichts. validateToken() legt einen Token erst beim
    // ERSTEN Gebrauch ab — ein frisch ausgestellter, nie benutzter steht nicht
    // drin, und dann wäre die Prüfung „gilt nicht mehr" auch ohne
    // Cache-Leerung grün. Genau das ist beim Gegenprobieren herausgekommen.
    const aufwaermen = await ruf(AUTH + '/me',
      { headers: { authorization: `Bearer ${tablet.body.token}` } });
    assert.equal(aufwaermen.body.loggedIn, true,
      'Vorbedingung: Der Token des Tablets muss VOR dem Löschen gelten und damit im Cache liegen');

    const zuLoeschen = perToken.body.tokens.find(x => x.label === 'Tablet');
    const weg = await ruf(SETTINGS + '/tokens/' + zuLoeschen.token_id,
      { method: 'DELETE', headers: { authorization: `Bearer ${telefon.body.token}` } });
    assert.equal(weg.status, 200);
    assert.equal(weg.body.deleted, 1);

    // Und zwar WIRKLICH: Der Token des Tablets gilt nicht mehr. Das ist der
    // Punkt der ganzen Übung — die Zeile zu löschen ist nur die halbe Miete,
    // wenn der Cache in utils/auth.ts sie noch bedient.
    const tabletVersucht = await ruf(AUTH + '/me',
      { headers: { authorization: `Bearer ${tablet.body.token}` } });
    assert.equal(tabletVersucht.status, 401,
      'Der ausgesperrte Zugang gilt weiter — dann nützt die ganze Verwaltung nichts');

    // Die übrigen zwei bleiben.
    const danach = await ruf(SETTINGS + '/tokens',
      { headers: { authorization: `Bearer ${telefon.body.token}` } });
    assert.deepEqual(danach.body.tokens.map(x => x.label).sort(), ['Pixel 8', 'webapp-session']);

    // ── 4. Fremde Zugänge sind tabu ─────────────────────────────────────────
    // Der Filter läuft über user_id. Ohne ihn könnte jeder Angemeldete jeden
    // beliebigen Zugang entwerten, wenn er den Hash-Anfang errät.
    await db.run('DELETE FROM users WHERE username = $1', [NAME + '_fremd']);
    await db.run(
      'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,0,1,1)',
      [NAME + '_fremd', await bcrypt.hash(PASS, 4)]);
    const fremd = await ruf(AUTH + '/login', { method: 'POST',
      body: { username: NAME + '_fremd', password: PASS, label: 'Fremd', never_expires: true } });
    const fremdSicht = await ruf(SETTINGS + '/tokens',
      { headers: { authorization: `Bearer ${fremd.body.token}` } });
    assert.deepEqual(fremdSicht.body.tokens.map(x => x.label), ['Fremd'],
      'Ein fremdes Konto darf die eigenen Zugänge nicht sehen');
    const fremdVersuch = await ruf(SETTINGS + '/tokens/' + danach.body.tokens[0].token_id,
      { method: 'DELETE', headers: { authorization: `Bearer ${fremd.body.token}` } });
    assert.equal(fremdVersuch.body.deleted, 0,
      'Ein fremdes Konto darf keinen Zugang entwerten');

    // ── 5. Der %-Fall, gegen den escapeLike steht ───────────────────────────
    // Ohne Maskierung wäre "%" ein LIKE-Platzhalter und löschte ALLE Zugänge
    // des Kontos auf einmal.
    const alles = await ruf(SETTINGS + '/tokens/' + encodeURIComponent('%'),
      { method: 'DELETE', headers: { authorization: `Bearer ${telefon.body.token}` } });
    assert.equal(alles.body.deleted, 0,
      'Ein "%" als Token-Kennung darf nicht alle Zugänge auf einmal löschen');
  } finally {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE username IN ($1, $2)', [NAME, NAME + '_fremd']).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
