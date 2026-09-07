/**
 * Die waehlbare Laufzeit eines QR-Zugangs — und wer sie waehlen darf.
 *
 * ── Marcos Wunsch ───────────────────────────────────────────────────────────
 * „Wie waere es, wenn man fuer die Tokens einstellen kann wie lange sie
 * gueltig sein sollen z.B. 1 Monat, 2 Monate, 6 Monate, 12 Monate. Pro QR-Code
 * soll das der User definieren koennen. Waere das ein Risiko aus Security
 * Sicht?"
 *
 * ── Die zwei Fristen ────────────────────────────────────────────────────────
 * api_tokens traegt jetzt zwei:
 *
 *   expires_at       gleitend — „so lange UNGENUTZT" (TOKEN_IDLE_DAYS, 90 Tage).
 *                    _touchLastUsed() schiebt sie bei jeder Benutzung vor.
 *   hard_expires_at  fest — „so lange UEBERHAUPT", die Wahl des Nutzers.
 *
 * Gueltig ist der Token bis zum FRUEHEREN der beiden Termine. Die feste Frist
 * kann also nur kuerzer machen, nie laenger — deshalb ist die Neuerung
 * sicherheitstechnisch ein Gewinn und kein Risiko.
 *
 * ── Der Punkt, an dem es ein Risiko WAERE ───────────────────────────────────
 * POST /qr-login ist unangemeldet erreichbar — es ist ja der Weg, auf dem ein
 * Geraet sich erstmals ausweist. Duerfte das einloesende Geraet seine Laufzeit
 * selbst in die Anfrage schreiben, koennte jeder, der einen QR-Code
 * abfotografiert oder ueber die Schulter scannt, sich die laengste aussuchen.
 * Die Wahl trifft deshalb die ANGEMELDETE Sitzung beim Erzeugen des Codes und
 * reist in qr_login_tokens.token_days mit.
 *
 * Genau das prueft Teil 3 — mit einer Anfrage, die es versucht.
 *
 * Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
 * Ohne DB: skip. Ausfuehren: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, einhaengung, ohneKommentare } = require('./helpers/sources');
const _req = buildAndRequire();
const AUTH = einhaengung('auth');
const db = _req('db/database.js');
const auth = _req('utils/auth.js');
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
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,0,1,1)',
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
  /** Die api_tokens-Zeile zu einem ausgegebenen Klartext-Token. */
  const zeile = (token) => db.get(
    'SELECT expires_at, hard_expires_at, sliding FROM api_tokens WHERE token = $1',
    [auth.hashToken(token)]);

  try {
    const an = await ruf('/login', { method: 'POST', body: { username: NAME, password: PASS } });
    assert.equal(an.status, 200, `Anmeldung scheiterte: ${JSON.stringify(an.body)}`);
    const keks = an.cookie.split(';')[0];

    // ── 1. Die Wahl landet bei der Nonce ───────────────────────────────────
    const sechs = await ruf('/qr-token', { method: 'POST', headers: { cookie: keks },
      body: { gueltigkeit: '6m' } });
    assert.equal(sechs.status, 200, JSON.stringify(sechs.body));
    assert.equal(sechs.body.token_days, 180, 'Sechs Monate sind 180 Tage');

    // ── 2. Beim Einloesen entstehen BEIDE Fristen ──────────────────────────
    const ein = await ruf('/qr-login', { method: 'POST', body: { token: sechs.body.token } });
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
    const ohne = await ruf('/qr-token', { method: 'POST', headers: { cookie: keks }, body: {} });
    assert.equal(ohne.body.token_days, null, 'Ohne Wahl gibt es keine feste Frist');
    const versuch = await ruf('/qr-login', { method: 'POST',
      body: { token: ohne.body.token, gueltigkeit: '12m', token_days: 3650 } });
    assert.equal(versuch.status, 200, JSON.stringify(versuch.body));
    const zv = await zeile(versuch.body.token);
    assert.equal(zv.hard_expires_at, null,
      'Das einloesende Geraet darf sich keine Laufzeit erteilen — sonst reicht ein abfotografierter Code');

    // ── 4. Ein Wert ausserhalb der Liste weist nicht ab, er waehlt nichts ──
    //
    // Auch `constructor`: Ein direkter Zugriff auf die Tabelle lieferte dafuer
    // die geerbte Object-Funktion — wahrheitswertig, und damit waere sie als
    // Tageszahl an die Datenbank gegangen (ausTabelle, utils/validate).
    for (const unsinn of ['99m', 'constructor', '__proto__', 999999]) {
      const r = await ruf('/qr-token', { method: 'POST', headers: { cookie: keks },
        body: { gueltigkeit: unsinn } });
      assert.equal(r.status, 200, `„${unsinn}" soll nicht scheitern, sondern nichts waehlen`);
      assert.equal(r.body.token_days, null, `„${unsinn}" darf keine Frist setzen`);
    }

    // ── 5. Die feste Frist sperrt auch dann aus, wenn die gleitende offen ist ──
    //
    // Der eigentliche Zweck der zweiten Spalte. Ohne die Bedingung in
    // validateToken() waere sie nur Zierde.
    const abgelaufen = await ruf('/qr-token', { method: 'POST', headers: { cookie: keks },
      body: { gueltigkeit: '1m' } });
    const zugang = await ruf('/qr-login', { method: 'POST', body: { token: abgelaufen.body.token } });
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
    fs.readFileSync(path.join(ROOT, 'public/js/05-settings.js'), 'utf8'));

  assert.ok(/api\('POST', '\/v1\/auth\/qr-token', \{ gueltigkeit \}\)/.test(einst),
    'Die Webapp soll die gewaehlte Laufzeit beim Erzeugen des Codes mitschicken');
  assert.ok(!/qr-login/.test(einst),
    'Die Webapp loest keine QR-Codes ein — taete sie es, waere hier die zweite Stelle, ' +
    'an der eine Laufzeit gewaehlt werden koennte');

  // Und die Auswahl muss es im Markup ueberhaupt geben — ein Feld, das
  // 05-settings.js liest, aber niemand fuellt, waere still wirkungslos.
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(/id="qr-validity"/.test(html), 'Das Auswahlfeld fehlt in der Oberflaeche');

  // ── Und die Auswahl deckt sich mit der Liste des Servers ─────────────────
  //
  // Die Werte stehen an zwei Stellen — in TOKEN_LAUFZEITEN und im Markup —,
  // und das laesst sich nicht sinnvoll vermeiden: Das Auswahlfeld wird
  // gebraucht, BEVOR die Seite den Server nach etwas fragt. Also wird die
  // Deckung hier gemessen statt behauptet. Eine Wahl, die der Server nicht
  // kennt, waere im Markup sichtbar und in der Wirkung nichts.
  const serverListe = ohneKommentare(fs.readFileSync(path.join(ROOT, 'utils/auth.ts'), 'utf8'))
    .split('const TOKEN_LAUFZEITEN')[1].split('};')[0]
    .match(/'(\w+)':/g).map(x => x.replace(/'|:/g, ''));
  const markupListe = [...html.matchAll(/<option value="(\w+)" data-i18n="qr\.validity_/g)]
    .map(m => m[1]);
  assert.deepEqual(markupListe, serverListe,
    'Die Auswahl im Markup und die Liste in TOKEN_LAUFZEITEN laufen auseinander');
  assert.ok(serverListe.length >= 4, 'Die Liste wurde nicht gefunden — Muster veraltet?');
});
