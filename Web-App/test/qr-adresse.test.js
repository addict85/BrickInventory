/**
 * Der QR-Code traegt die Adresse, unter der der Server von AUSSEN erreichbar
 * ist — oder es kommt kein Code.
 *
 * ── Marcos zwei Saetze vom 25.09. ───────────────────────────────────────────
 *
 *   „Kannst diese variable auch gleich fuer den qr Code fuer die Verknuepfung
 *    der App verwenden?"
 *   „Kannst du das location.origin nicht komplett entfernen?"
 *
 * Gemeint ist APP_BASE_URL, dieselbe Quelle wie fuer die Links in den Mails.
 *
 * ── Warum das mehr ist als eine Vereinheitlichung ───────────────────────────
 *
 * Der Code trug `window.location.origin`. Das ist genau dann falsch, wenn es
 * darauf ankommt: Wer die Webapp ueber die LAN-Adresse oder einen lokalen Namen
 * oeffnet (http://192.168.x.x:3000), reicht dem Telefon eine Adresse, die
 * ausser Haus nicht existiert. Scannen laesst sich der Code trotzdem — die App
 * verbindet sich einmal im WLAN und findet den Server unterwegs nie wieder.
 *
 * Das ist der unangenehmste Fehlertyp: Er entsteht im Wohnzimmer und zeigt
 * sich im Zug.
 *
 * Der Zwischenstand `d.url || location.origin` war das gefaehrlichere von
 * beiden, weil er nach einem vernuenftigen Rueckfall aussah. Er ist weg: Ohne
 * APP_BASE_URL verweigert die Route.
 *
 * ── Warum dieser Test einen Server startet ──────────────────────────────────
 *
 * Die ersten drei Schritte lasen Quelltext. Das haette die eine Aussage nicht
 * treffen koennen, auf die es ankommt: dass bei fehlender Variable KEINE Nonce
 * entsteht. Die Pruefung steht jetzt vor dem Datenbankzugriff — ob sie dort
 * WIRKLICH steht, sieht man nur, wenn man die Tabelle nachzaehlt. Ein
 * `indexOf`-Vergleich haette sie auch dann fuer richtig gehalten, wenn sie
 * zwanzig Zeilen weiter unten stuende.
 *
 * Nebenbei zeigt der Aufbau, dass basisUrl() die Umgebung bei JEDEM Aufruf
 * liest und nicht beim Laden des Moduls: Beide Faelle laufen in einem Prozess.
 *
 * Voraussetzung: Test-DB. Ohne DB: skip (mit REQUIRE_DB=1: Fehler).
 *
 * ── Gegenproben (durchgefuehrt, Ergebnis im Commit) ─────────────────────────
 *   a) Absage entfernt, `url: basis` bleibt         → Schritt 1 rot (200 statt 503)
 *   b) Absage NACH den INSERT verschoben            → Schritt 1 rot, mit genau der
 *                                                     Meldung „Nonce entstanden"
 *   c) `d.url || location.origin` wiederhergestellt → Schritt 2 rot
 *   d) Rueckfall auf den Host-Header im Server      → Schritte 1 UND 3 rot
 *
 * Bei d) waren es zwei, nicht einer: Schritt 3 sieht den geratenen Host im
 * Quelltext, Schritt 1 sieht die Folge — die Route antwortet dann mit 200 und
 * einer Adresse aus dem Testserver (`localhost:<Port>`) statt abzusagen. Beide
 * Meldungen sind richtig; die zweite ist die, auf die es ankommt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, einhaengung, ohneKommentare } = require('./helpers/sources');
const { testServer } = require('./helpers/server');
const _req = buildAndRequire();
// Die Einhaengung aus server.ts LESEN, nicht abschreiben: Ein Pruefstand mit
// fester Adresse bleibt gruen, waehrend der Router laengst woanders haengt.
const AUTH = einhaengung('auth');
const db = _req('db/database.js');

const lies = (rel) => ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

test('1. ohne APP_BASE_URL kommt kein Code — und keine Nonce', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await db.run("DELETE FROM users WHERE username = 'qr_pruefling'");
  const nutzer = await db.get(
    "INSERT INTO users (username,password_hash,is_admin,email_verified) VALUES ($1,$2,0,1) RETURNING id",
    ['qr_pruefling', 'x']);
  // Aufraeumen UND den Pool schliessen, beides hier: Ohne das `end()` haelt
  // die offene Verbindung den Prozess am Leben, und `node --test` haengt nach
  // dem letzten Schritt, statt rot oder gruen zu melden. Genau das ist beim
  // Schreiben dieser Datei passiert.
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [nutzer.id]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, {
    sitzung: { userId: nutzer.id, username: 'qr_pruefling', isAdmin: 0 },
    routen: { [AUTH]: 'routes/auth.js' }, t,
  });
  const hole = () => fetch(`${base}${AUTH}/qr-token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const nonces = async () => (await db.get(
    'SELECT COUNT(*)::int AS n FROM qr_login_tokens WHERE user_id = $1', [nutzer.id])).n;

  // ── Fall 1: Die Variable fehlt ────────────────────────────────────────────
  const vorher = process.env.APP_BASE_URL;
  t.after(() => { if (vorher === undefined) delete process.env.APP_BASE_URL;
                  else process.env.APP_BASE_URL = vorher; });
  delete process.env.APP_BASE_URL;

  const abgelehnt = await hole();
  assert.equal(abgelehnt.status, 503,
    'Ohne APP_BASE_URL muss die Route absagen — sonst traegt der Code die Browseradresse.');
  const grund = await abgelehnt.json();
  assert.equal(grund.success, false);
  assert.equal(grund.code, 'qr_ohne_basis_url',
    'Die Absage nennt ihren Grund nicht — die Oberflaeche kann nicht sagen, was zu tun ist.');
  assert.match(grund.error, /APP_BASE_URL/,
    'Der Satz fuer den Nutzer nennt die Variable nicht, die zu setzen ist.');

  // DAS ist der Kern: Die Absage steht VOR dem Datenbankzugriff. Stuende sie
  // dahinter, laege hier ein Zugangscode, der fuenf Minuten lang ein Konto
  // oeffnet und den niemand je einloest.
  assert.equal(await nonces(), 0,
    'Trotz Absage ist eine Nonce entstanden — die Pruefung steht zu spaet.');

  // ── Fall 2: Die Variable ist gesetzt ──────────────────────────────────────
  // Mit ueberzaehligem Schraegstrich, denn genau der wuerde sich sonst zu
  // `https://host//?set=…` durchschlagen.
  process.env.APP_BASE_URL = 'https://lego.example.org//';
  const gut = await hole();
  assert.equal(gut.status, 200, 'Mit APP_BASE_URL muss ein Code entstehen.');
  const d = await gut.json();
  assert.equal(d.url, 'https://lego.example.org',
    'Der Server nennt die Adresse nicht oder laesst den Schraegstrich stehen.');
  assert.match(d.token, /^bim:/, 'Der Token hat seine Form verloren.');
  assert.equal(await nonces(), 1, 'Im guten Fall MUSS genau eine Nonce entstehen.');
});

test('2. die Webapp hat keine eigene Meinung mehr zur Adresse', () => {
  const js = lies('public/js/05-settings.js');
  assert.match(js, /const serverUrl = d\.url;/,
    'Die Webapp nimmt nicht schlicht die Adresse des Servers.');
  // Der Rueckfall ist weg — das war Marcos zweiter Satz. `ohneKommentare`
  // sorgt dafuer, dass die Erklaerung DARUEBER (die den alten Ausdruck zitiert)
  // diese Zusicherung nicht scheinbar erfuellt.
  assert.ok(!/location\.origin/.test(js),
    'location.origin steht noch im Code der QR-Erzeugung.');

  // Das versteckte Feld ist entfallen: Es trug nur location.origin weiter und
  // war nie zu bearbeiten. Eine Zeile, die niemand mehr braucht, ist eine
  // Stelle, an der jemand spaeter etwas Falsches vermutet.
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(!/id="qr-server-url"/.test(html),
    'Das verwaiste Feld qr-server-url steht noch im Markup.');
  assert.ok(!/qr-server-url/.test(js), 'Die Webapp liest das entfallene Feld noch.');
});

test('3. eine Quelle fuer QR-Code, Mail-Knopf und Reset-Links', () => {
  // Der Kern von Marcos erstem Satz: EINE Adresse, nicht drei. Lesen darf sie
  // nur utils/basisUrl.ts; wer process.env.APP_BASE_URL selbst anfasst, hat
  // eine vierte Schreibweise begonnen.
  const helfer = lies('utils/basisUrl.ts');
  assert.match(helfer, /process\.env\.APP_BASE_URL/, 'utils/basisUrl.ts liest die Variable nicht.');
  assert.match(helfer, /replace\(\/\\\/\+\$\/, ''\)/,
    'Ein abschliessender Schraegstrich wird nicht entfernt.');

  for (const datei of ['routes/auth.ts', 'utils/mailer.ts']) {
    const quelle = lies(datei);
    assert.ok(!/process\.env\.APP_BASE_URL/.test(quelle),
      `${datei} liest APP_BASE_URL selbst — das ist die Kopie, die auseinanderlaeuft.`);
    assert.match(quelle, /basisUrl\(\)/, `${datei} benutzt den gemeinsamen Helfer nicht.`);
  }

  // Der QR-Zweig darf keinen Host raten: Fuer diesen Code gilt dasselbe wie
  // fuer einen Link in einer Mail — eine geratene Adresse ist schlechter als
  // keine. (getBaseUrl weiter unten DARF es, siehe die Begruendung dort.)
  const auth = lies('routes/auth.ts');
  const i = auth.indexOf("router.post('/qr-token'");
  assert.ok(i > 0, 'Die Route /qr-token ist verschwunden — umbenannt?');
  const rumpf = auth.slice(i, auth.indexOf('\nrouter.', i + 10));
  assert.ok(!/headers\['x-forwarded-host'\]|headers\.host/.test(rumpf),
    'Die Route faellt auf den Host-Header zurueck — genau das soll sie nicht.');

  // Und sie ist dokumentiert — sonst weiss niemand, dass es sie zu setzen gilt.
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /APP_BASE_URL/, 'README.md nennt APP_BASE_URL nicht.');
});
