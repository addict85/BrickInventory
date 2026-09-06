/**
 * Die Gleitfrist des App-Tokens — echte Datenbank.
 *
 * ── Woher das kommt ─────────────────────────────────────────────────────────
 * Der Token der Android-App wurde OHNE Ablaufdatum angelegt. Verfallen ist er
 * trotzdem: TOKEN_IDLE_DAYS (90) hat ihn nach 90 Tagen ohne Nutzung entfernt —
 * aber per DELETE aus einem stuendlichen Aufraeumjob. Die Pruefung im
 * Anfrageweg sah ihn nie an, denn ihre Bedingung lautet
 * `expires_at IS NULL OR expires_at > NOW()`, und der erste Zweig traf immer
 * zu.
 *
 * Damit hing die Frist an einem Hintergrundjob: kein Primary-Worker, ein
 * Absturz, ein Neustart zur falschen Stunde — und der Token auf einem
 * verlorenen Telefon galt weiter. Zusaetzlich behaupteten beide Oberflaechen
 * in der Zugangsliste „laeuft nie ab", was schlicht nicht stimmte.
 *
 * Jetzt traegt die Zeile ein echtes Datum, das bei jeder Benutzung nachrueckt.
 * Dieselbe BEDEUTUNG wie vorher („90 Tage ohne Nutzung"), aber durchgesetzt
 * von der WHERE-Klausel, an der jede Anfrage ohnehin vorbeikommt.
 *
 * Was hier nachgemessen wird — und warum jedes Stueck einzeln:
 *   1. Der App-Token bekommt Datum und `sliding`.
 *   2. Der Browser-Token bekommt ein Datum und gleitet NICHT. Ohne diese
 *      Haelfte wuerde eine Umstellung „alles gleitet" gruen durchgehen — und
 *      der im sessionStorage liegende Token liefe so lange, wie ein Angreifer
 *      ihn benutzt.
 *   3. Die Benutzung schiebt das Datum wirklich nach vorn (die stille
 *      Erneuerung).
 *   4. Altzeilen ohne Datum werden nachgezogen, ohne ihre Laufzeit zu aendern.
 *
 * Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
 * Ohne DB: skip. Ausfuehren: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, einhaengung } = require('./helpers/sources');
const _req = buildAndRequire();
const AUTH = einhaengung('auth');
const db   = _req('db/database.js');
const auth = _req('utils/auth.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt  = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = 'gleitfrist_test', PASS = 'richtigesPasswort1';
const TAG = 86400_000;

test('das Ablaufdatum des App-Tokens gleitet mit der Benutzung',
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
  const basis = `http://localhost:${srv.address().port}`;

  const ruf = async (weg, opt = {}) => {
    const r = await fetch(basis + weg, {
      method: opt.method || 'GET',
      headers: { 'content-type': 'application/json', ...(opt.headers || {}) },
      ...(opt.body ? { body: JSON.stringify(opt.body) } : {}),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const zeile = (klartext) => db.get(
    'SELECT expires_at, sliding FROM api_tokens WHERE token = $1', [auth.hashToken(klartext)]);

  try {
    const frist = auth.TOKEN_IDLE_DAYS;
    assert.ok(frist > 0,
      'Dieser Test setzt die eingeschaltete Gleitfrist voraus; mit TOKEN_IDLE_DAYS=0 prueft er nichts');

    // ── 1. Der App-Token ────────────────────────────────────────────────────
    const appA = await ruf(AUTH + '/login', { method: 'POST',
      body: { username: NAME, password: PASS, label: 'Android App', never_expires: true } });
    assert.equal(appA.status, 200, `Anmeldung scheiterte: ${JSON.stringify(appA.body)}`);
    const appToken = appA.body.token;
    const appZeile = await zeile(appToken);
    assert.equal(appZeile.sliding, true, 'Der App-Token muss als gleitend markiert sein');
    // Auf den Tag genau statt auf die Millisekunde: Zwischen dem INSERT und
    // dieser Zeile liegt echte Zeit, und NOW() ist die der Datenbank.
    const tageBis = (d) => Math.round((new Date(d).getTime() - Date.now()) / TAG);
    assert.equal(tageBis(appZeile.expires_at), frist,
      `Der App-Token muss ${frist} Tage laufen — die Frist steht in TOKEN_IDLE_DAYS`);

    // ── 2. Der Browser-Token gleitet nicht ──────────────────────────────────
    const webA = await ruf(AUTH + '/login', { method: 'POST',
      body: { username: NAME, password: PASS } });
    const webZeile = await zeile(webA.body.token);
    assert.equal(webZeile.sliding, false,
      'Der Token im sessionStorage darf NICHT gleiten — sonst haelt ihn ein Angreifer durch Benutzung am Leben');
    assert.equal(tageBis(webZeile.expires_at), 7, 'Die sieben festen Tage des Browsers bleiben');

    // ── 3. Die stille Erneuerung ────────────────────────────────────────────
    //
    // Das Datum wird kuenstlich nach vorn geholt, so als waere das Telefon
    // lange nicht benutzt worden. Dann EINE Anfrage mit dem Token — mehr tut
    // die App auch nicht.
    //
    // Der Cache in utils/auth.ts wird vorher geleert: Er merkt sich pro Token,
    // wann zuletzt geschrieben wurde (gedrosselt auf fuenf Minuten). Ohne das
    // Leeren haette die Anmeldung von eben den Eintrag schon gefuellt und die
    // Drossel wuerde den Schreibvorgang ueberspringen — der Test pruefte dann
    // die Drossel statt der Erneuerung.
    await db.run('UPDATE api_tokens SET expires_at = NOW() + INTERVAL \'3 days\' WHERE token = $1',
      [auth.hashToken(appToken)]);
    auth.leereTokenCache();
    const wer = await ruf(AUTH + '/me', { headers: { authorization: `Bearer ${appToken}` } });
    assert.equal(wer.body?.user?.id, uid, 'Vorbedingung: Die Anfrage muss ueberhaupt durchgehen');

    // Das UPDATE laeuft ohne await im Anfrageweg (fire-and-forget, damit die
    // Auth keine zwei DB-Runden kostet). Deshalb wird gewartet statt geraten —
    // ein fester Schlaf waere entweder zu kurz oder Zeitverschwendung.
    let erneuert = null;
    for (let i = 0; i < 100; i++) {
      erneuert = await zeile(appToken);
      if (tageBis(erneuert.expires_at) > 3) break;
      await new Promise(r => setTimeout(r, 20));
    }
    assert.equal(tageBis(erneuert.expires_at), frist,
      'Die Benutzung muss das Ablaufdatum wieder auf die volle Frist schieben — sonst ' +
      'sperrt sich ein taeglich benutztes Telefon nach 90 Tagen selbst aus');

    // Gegenprobe in derselben Lage: Der Browser-Token wird ebenso benutzt und
    // darf sich NICHT verlaengern.
    await db.run('UPDATE api_tokens SET expires_at = NOW() + INTERVAL \'3 days\' WHERE token = $1',
      [auth.hashToken(webA.body.token)]);
    auth.leereTokenCache();
    await ruf(AUTH + '/me', { headers: { authorization: `Bearer ${webA.body.token}` } });
    await new Promise(r => setTimeout(r, 300));
    assert.equal(tageBis((await zeile(webA.body.token)).expires_at), 3,
      'Der Browser-Token darf durch Benutzung nicht laenger werden');

    // ── 4. Altzeilen nachziehen ─────────────────────────────────────────────
    //
    // Eine Zeile, wie sie vor der Umstellung entstand: kein Datum, zuletzt vor
    // zehn Tagen benutzt. purgeExpiredTokens() muss ihr die Frist geben, die
    // die alte Regel ihr gegeben haette — also Rest = frist - 10 Tage. Wuerde
    // stattdessen ab JETZT gerechnet, bekaeme ein vergessenes Telefon durch
    // die Umstellung zehn Tage geschenkt.
    const alt = 'a'.repeat(64);
    await db.run('DELETE FROM api_tokens WHERE token = $1', [alt]);
    await db.run(
      `INSERT INTO api_tokens (token, user_id, label, expires_at, created_at, last_used)
       VALUES ($1,$2,'Altzeile',NULL, NOW() - INTERVAL '40 days', NOW() - INTERVAL '10 days')`,
      [alt, uid]);
    await auth.purgeExpiredTokens();
    const nachgezogen = await db.get('SELECT expires_at, sliding FROM api_tokens WHERE token = $1', [alt]);
    assert.ok(nachgezogen, 'Die Altzeile darf nicht geloescht werden — sie ist noch gueltig');
    assert.equal(nachgezogen.sliding, true, 'Eine Altzeile ohne Datum war ein App-/QR-Token und gleitet');
    assert.equal(
      Math.round((new Date(nachgezogen.expires_at).getTime() - Date.now()) / TAG), frist - 10,
      'Nachgezogen wird ab der letzten Nutzung, nicht ab jetzt — sonst verlaengert die Umstellung jede Altzeile');
  } finally {
    // Beides ABGEWARTET, und der Pool wird geschlossen: Ohne das laeuft die
    // Datei nicht zu Ende, sondern in das 60-Sekunden-Zeitlimit von
    // `npm test` — die Pruefungen darin sind laengst gruen, die Datei gilt
    // trotzdem als gescheitert. Genau so ist es beim Schreiben dieses Tests
    // passiert. Die api_tokens-Zeilen haengen per ON DELETE CASCADE am Konto
    // und gehen mit ihm.
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
