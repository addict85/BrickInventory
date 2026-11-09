/**
 * Die waehlbare Laufzeit eines QR-Zugangs — und wer sie waehlen darf.
 * Ausführlich: docs/begruendungen/test/token-laufzeit-db.test.js.md#kopf
 *
 * Gegenprobe (am 28.10. gemessen): in /qr-token die Prüfung von Sitzung und
 * Passwort entfernt → rot im Schritt „0. Ein Code nur mit Sitzung UND
 * Passwort"
 * Gegenprobe (am 03.11. gemessen): in /qr-token `?? APP_HOECHSTDAUER_TAGE`
 * entfernt → rot „Ohne Wahl gilt die Höchstdauer von 180 Tagen"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';
// Seit der QR-Code die Adresse des Servers traegt (src/infra/basisUrl.ts), ist
// APP_BASE_URL eine VORBEDINGUNG der Route: Ohne sie sagt sie mit 503 ab,
// damit kein Code mit der Browseradresse hinausgeht. Diese Datei prueft etwas
// anderes — hier wird die Vorbedingung nur erfuellt, nicht geprueft. Das tut
// test/qr-adresse.test.js.
process.env.APP_BASE_URL = 'https://lego.example.org';

const { buildAndRequire, einhaengung, ohneKommentare } = require('./helpers/sources');
const { qrKoppeln } = require('./helpers/qr');
const _req = buildAndRequire();
const AUTH = einhaengung('auth');
const db = _req('db/database.js');
const auth = _req('src/konto/auth.js');
const express   = require(path.join(ROOT, 'node_modules', 'express'));
const session   = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt    = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = `qr_laufzeit_${process.pid}`, PASS = 'richtigesPasswort1';

/** Wie viele Tage liegt dieser Zeitpunkt in der Zukunft? */
const tageVoraus = (wert) => (new Date(wert).getTime() - Date.now()) / 86400_000;

test('QR-Zugang: die Laufzeit waehlt der Erzeuger, nicht der Einloeser',
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
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,false,true,true)',
    [NAME, await bcrypt.hash(PASS, 4)]);
  const uid = (await db.get('SELECT id FROM users WHERE username=$1', [NAME])).id;

  const app = express();
  app.use(express.json());
  app.use(session({
    store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
  }));
  app.use(AUTH, _req('routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}${AUTH}`;

  const ruf = async (weg, opt = {}) => {
    const r = await fetch(basis + weg, {
      method: opt.method || 'GET',
      headers: { 'content-type': 'application/json', ...(opt.headers || {}) },
      ...(opt.body ? { body: JSON.stringify(opt.body) } : {}),
    });
    return { status: r.status, cookie: r.headers.get('set-cookie'), body: await r.json().catch(() => null) };
  };
  const koppeln = (qr, keks) => qrKoppeln((p, body, kopf) => ruf(p, { method: 'POST', headers: kopf, body }), qr, { cookie: keks });
  /** Die api_tokens-Zeile zu einem ausgegebenen Klartext-Token. */
  const zeile = (token) => db.get(
    'SELECT expires_at, hard_expires_at, sliding FROM api_tokens WHERE token = $1',
    [auth.hashToken(token)]);

  try {
    const an = await ruf('/login', { method: 'POST', body: { username: NAME, password: PASS, ohne_token: true } });
    assert.equal(an.status, 200, `Anmeldung scheiterte: ${JSON.stringify(an.body)}`);
    const keks = an.cookie.split(';')[0];

    // ── 0. Ein Code nur mit Sitzung UND Passwort ──────────────────────────
    // Sonst machte ein erbeuteter Token (oder eine offene Sitzung) über den
    // QR-Weg einen neuen Dauerzugang — ohne das Passwort, das /token-create
    // für genau denselben Zweck verlangt.
    const ohnePw = await ruf('/qr-token', { method: 'POST', headers: { cookie: keks }, body: { gueltigkeit: '6m' } });
    assert.equal(ohnePw.status, 400, `ohne Passwort: ${ohnePw.status} ${JSON.stringify(ohnePw.body)}`);
    const falsch = await ruf('/qr-token', { method: 'POST', headers: { cookie: keks },
      body: { gueltigkeit: '6m', password: 'falsch-falsch' } });
    assert.equal(falsch.status, 400);
    const geraet = await auth.createToken(uid, 'Probe', true);
    const perToken = await ruf('/qr-token', { method: 'POST',
      headers: { authorization: `Bearer ${geraet}` }, body: { gueltigkeit: 'unbegrenzt', password: PASS } });
    assert.equal(perToken.status, 403, 'Mit einem Token allein darf kein neuer Zugang entstehen');

    // ── 1. Die Wahl landet bei der Nonce ───────────────────────────────────
    const sechs = await ruf('/qr-token', { method: 'POST', headers: { cookie: keks },
      body: { gueltigkeit: '6m', password: PASS } });
    assert.equal(sechs.status, 200, JSON.stringify(sechs.body));
    assert.equal(sechs.body.token_days, 180, 'Sechs Monate sind 180 Tage');

    // ── 2. Beim Einloesen entstehen BEIDE Fristen ──────────────────────────
    const ein = await koppeln(sechs.body, keks);
    assert.equal(ein.status, 200, JSON.stringify(ein.body));
    const z = await zeile(ein.body.token);
    assert.ok(z, 'Zum ausgegebenen Token muss eine Zeile existieren');
    assert.equal(z.sliding, true, 'Die Gleitfrist bleibt — sie ist der Rueckhalt gegen vergessene Geraete');
    assert.ok(Math.abs(tageVoraus(z.hard_expires_at) - 180) < 1,
      `Die feste Frist soll 180 Tage betragen, gemessen: ${tageVoraus(z.hard_expires_at)}`);
    assert.ok(tageVoraus(z.expires_at) < tageVoraus(z.hard_expires_at),
      'Die gleitende Frist (90 Tage) liegt frueher — sie greift zuerst, genau wie zugesagt');

    // ── 3. Der Einloeser kann sich NICHTS aussuchen ────────────────────────
    //
    // Dieselbe Anfrage wie oben, nur ohne Wahl beim Erzeugen und mit einem
    // Wunsch im Rumpf der EINLOESUNG. Faellt diese Zusicherung, ist die
    // ganze Neuerung eine Schwachstelle statt einer Haertung.
    const ohne = await ruf('/qr-token', { method: 'POST', headers: { cookie: keks }, body: { password: PASS } });
    assert.equal(ohne.body.token_days, 180, 'Ohne Wahl gilt die Höchstdauer von 180 Tagen');
    const versuch = await ruf('/qr-login', { method: 'POST',
      body: { token: ohne.body.token, gueltigkeit: 'unbegrenzt', token_days: 3650 } });
    // Der Vertrag kennt beim Einlösen keinen Wunsch: 400, und der Code bleibt unverbraucht.
    assert.deepEqual([versuch.status, versuch.body.code], [400, 'feld_unbekannt'], JSON.stringify(versuch.body));
    const eingeloest = await koppeln(ohne.body, keks);
    assert.equal(eingeloest.status, 200, JSON.stringify(eingeloest.body));
    const zv = await zeile(eingeloest.body.token);
    assert.ok(zv.hard_expires_at && Math.abs(tageVoraus(zv.hard_expires_at) - 180) < 1,
      'Das einloesende Geraet darf sich keine Laufzeit erteilen — sonst reicht ein abfotografierter Code');
    assert.ok(zv.expires_at,
      'Und erst recht keine unbegrenzte: Der Zugang muss die gewoehnliche Gleitfrist tragen');

    // 3b. „Unbegrenzt" heisst wirklich unbegrenzt
    // Ausführlich: docs/begruendungen/test/token-laufzeit-db.test.js.md#ewig
    const ewig = await ruf('/qr-token', { method: 'POST', headers: { cookie: keks },
      body: { gueltigkeit: 'unbegrenzt', password: PASS } });
    assert.equal(ewig.body.token_days, 0,
      '„unbegrenzt" reist als 0 mit — null hiesse „nichts gewaehlt"');
    const zugangEwig = await koppeln(ewig.body, keks);
    const rohEwig = zugangEwig.body.token;
    const ze = await zeile(rohEwig);
    assert.equal(ze.expires_at, null, 'Unbegrenzt heisst: keine gleitende Frist');
    assert.equal(ze.hard_expires_at, null, 'Unbegrenzt heisst: auch keine feste Frist');
    assert.equal(ze.sliding, false, 'Ohne Datum darf die Zeile auch nicht gleiten');

    await db.run(
      `UPDATE api_tokens SET last_used = NOW() - INTERVAL '400 days',
                             created_at = NOW() - INTERVAL '400 days'
        WHERE token = $1`, [auth.hashToken(rohEwig)]);
    await auth.purgeExpiredTokens();
    const nachher = await zeile(rohEwig);
    assert.ok(nachher, 'Der unbegrenzte Zugang darf vom Aufraeumjob nicht geloescht werden');
    assert.equal(nachher.expires_at, null,
      'Der Aufraeumjob darf ihm auch kein Ablaufdatum verpassen — sonst waere die Wahl still weg');
    auth.invalidateToken(rohEwig);
    assert.ok(await auth.validateToken(rohEwig),
      'Und er muss nach dem Aufraeumen noch gelten');

    // ── 4. Ein Wert ausserhalb der Liste weist nicht ab, er waehlt nichts ──
    //
    // Auch `constructor`: Ein direkter Zugriff auf die Tabelle lieferte dafuer
    // die geerbte Object-Funktion — wahrheitswertig, und damit waere sie als
    // Tageszahl an die Datenbank gegangen (ausTabelle, src/infra/validate).
    for (const unsinn of ['99m', 'constructor', '__proto__', 999999]) {
      const r = await ruf('/qr-token', { method: 'POST', headers: { cookie: keks },
        body: { gueltigkeit: unsinn, password: PASS } });
      assert.equal(r.status, 200, `„${unsinn}" soll nicht scheitern, sondern nichts waehlen`);
      assert.equal(r.body.token_days, 180, `„${unsinn}" darf nur die Vorgabe von 180 Tagen ergeben`);
    }

    // ── 5. Die feste Frist sperrt auch dann aus, wenn die gleitende offen ist ──
    //
    // Der eigentliche Zweck der zweiten Spalte. Ohne die Bedingung in
    // validateToken() waere sie nur Zierde.
    const abgelaufen = await ruf('/qr-token', { method: 'POST', headers: { cookie: keks },
      body: { gueltigkeit: '1m', password: PASS } });
    const zugang = await koppeln(abgelaufen.body, keks);
    const roh = zugang.body.token;
    assert.ok(await auth.validateToken(roh), 'Frisch ausgestellt muss der Zugang gelten');
    await db.run(
      `UPDATE api_tokens SET hard_expires_at = NOW() - INTERVAL '1 day' WHERE token = $1`,
      [auth.hashToken(roh)]);
    auth.invalidateToken(roh);   // sonst antwortet bis zu eine Minute der Cache
    assert.equal(await auth.validateToken(roh), null,
      'Ist der feste Termin erreicht, gilt der Zugang nicht mehr — auch wenn die Gleitfrist noch laeuft');
  } finally {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});

test('QR-Zugang: die Oberflaeche waehlt beim ERZEUGEN, nicht beim Einloesen', () => {
  const einst = ohneKommentare(
    require('./helpers/sources').ansichtQuelle('05'));

  assert.ok(/api\('POST', '\/v1\/auth\/qr-token', \{ gueltigkeit, password\b/.test(einst),
    'Die Webapp soll die gewaehlte Laufzeit beim Erzeugen des Codes mitschicken');
  assert.ok(!/qr-login/.test(einst),
    'Die Webapp loest keine QR-Codes ein — taete sie es, waere hier die zweite Stelle, ' +
    'an der eine Laufzeit gewaehlt werden koennte');

  // Und die Auswahl muss es im Markup ueberhaupt geben — ein Feld, das
  // 05-settings.js liest, aber niemand fuellt, waere still wirkungslos.
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(/id="qr-validity"/.test(html), 'Das Auswahlfeld fehlt in der Oberflaeche');

  // Und die Auswahl deckt sich mit der Liste des Servers
  // Ausführlich: docs/begruendungen/test/token-laufzeit-db.test.js.md#serverliste
  const serverListe = ohneKommentare(fs.readFileSync(path.join(ROOT, 'src/konto/auth.ts'), 'utf8'))
    .split('const TOKEN_LAUFZEITEN')[1].split('};')[0]
    .match(/'(\w+)':/g).map(x => x.replace(/'|:/g, ''));
  const markupListe = [...html.matchAll(/<option value="(\w+)" data-i18n="qr\.validity_/g)]
    .map(m => m[1]);
  assert.deepEqual(markupListe, serverListe,
    'Die Auswahl im Markup und die Liste in TOKEN_LAUFZEITEN laufen auseinander');
  assert.ok(serverListe.length >= 5, 'Die Liste wurde nicht gefunden — Muster veraltet?');
  assert.ok(serverListe.includes('unbegrenzt'), 'Die Wahl „unbegrenzt" fehlt auf der Serverseite');
});
