/**
 * Eine Webapp-Sitzung ohne Betrieb läuft ab — eine mit Betrieb nicht.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 * „webapp-session sollten sich nach ein paar Stunden inaktivität bereits
 * ausloggen."
 *
 * ── Was vorher galt (nachgesehen, nicht vermutet) ───────────────────────────
 *
 * Keine Leerlauf-Frist. Das Cookie trägt bewusst kein `maxAge`, stirbt also
 * erst beim Schliessen des Browsers; serverseitig lebte die Zeile EINEN TAG,
 * und dieser Tag war nicht gewählt, sondern die Voreinstellung von
 * connect-pg-simple, die greift, weil das Cookie kein `maxAge` hat.
 *
 * ── Warum hier zwei Zusicherungen stehen und nicht eine ─────────────────────
 *
 * Eine Frist, die zu scharf greift, sieht in der ersten Zusicherung besser aus
 * und ist kaputt: Würde die Sitzung IMMER nach der Frist sterben, egal wie
 * aktiv jemand ist, wäre „verfällt ohne Betrieb" grün — und die Webapp
 * unbenutzbar. Also beides, und das zweite ist das wichtigere.
 *
 * Dieselbe Falle wie bei test/sitzung-beruehrung-db.test.js: Dort wäre „gar
 * nicht mehr schreiben" die beste Note für die Drosselung gewesen.
 *
 * ── Die Kopplung, die dieser Test festhält ──────────────────────────────────
 *
 * Gedrosselt wird das NACHFÜHREN des Ablaufs (src/konto/sitzungsBeruehrung.ts).
 * Ist die Drosselung länger als die Leerlauf-Frist, wird der Ablauf nie
 * rechtzeitig nachgeführt — dann fliegt der ARBEITENDE Benutzer heraus, nicht
 * der untätige. Bei vier Stunden Frist und fünf Minuten Drosselung fällt das
 * nicht auf; bei `SESSION_IDLE_MINUTES=2` wäre es sofort da. Darum ist
 * BERUEHREN_MS seit dieser Änderung höchstens ein Viertel der Frist, und der
 * dritte Fall hier prüft genau dieses Verhältnis.
 *
 * ── Warum echte Zeit und keine zurückgedatete Zeile ─────────────────────────
 *
 * Ein `UPDATE user_sessions SET expire = …` in die Vergangenheit hätte den
 * Ablauf vorgetäuscht und dabei die eigentliche Frage übersprungen: ob das
 * `ttl` überhaupt in der Zeile landet. Hier läuft die Frist wirklich ab —
 * mit zwei Sekunden statt vier Stunden, messbare Dauer.
 *
 * ── Warum die Reserve ZWEI Sekunden ist und nicht 0,4 ───────────────────────
 *
 * Die erste Fassung nahm 1,2 s Frist und wartete 1,6 s. Sie war WACKELIG —
 * drei Läufe grün, der vierte rot, bei unverändertem Code. Der Grund steht
 * in connect-pg-simple/index.js und ist keine Vermutung:
 *
 *     Zeile  37   const currentTimestamp = () => Math.ceil(Date.now() / 1000)
 *     Zeile 299   expire = Math.ceil(Date.now() / 1000 + ttl)
 *     Zeile 364   … WHERE sid = $1 AND expire >= to_timestamp($2)
 *
 * BEIDE Seiten des Vergleichs sind auf ganze Sekunden AUFGERUNDET. Ob die
 * Sitzung nach dem Warten noch gilt, hängt damit daran, wo im Sekundentakt
 * das Anmelden lag:
 *
 *     Anmelden bei t=1000,0 → expire = ceil(1001,2) = 1002
 *                             Lesen bei 1001,6 → ceil = 1002 → 1002 >= 1002
 *                             → Sitzung gilt NOCH, der Fall wird rot
 *     Anmelden bei t=1000,5 → expire = ceil(1001,7) = 1002
 *                             Lesen bei 1002,1 → ceil = 1003 → abgelaufen
 *                             → der Fall wird grün
 *
 * Eine Reserve unter einer Sekunde kann die Rundung also auffressen. Mit
 * ganzzahliger Frist und zwei Sekunden Reserve geht die Rechnung in JEDEM
 * Fall auf: expire = ceil(t+5) liegt höchstens bei t+6, gelesen wird bei
 * t+7, und ceil(t+7) ist immer grösser als t+6.
 *
 * Das ist der Grund, warum hier keine krummen Millisekunden stehen. Eine
 * Prüfung, die vier von fünf Mälen grün ist, misst nichts — sie würfelt.
 *
 * ── Gegenproben (durchgeführt, Ergebnisse abgeschrieben) ────────────────────
 *
 * Jede trifft GENAU EINEN Fall — das ist der Punkt: Würde eine Variante
 * mehrere Fälle umlegen, wüssten wir nicht, welcher Fall was misst.
 *
 *   A  `ttl` aus dem Speicher entfernt (der Zustand VOR dieser Änderung)
 *      → nur Fall 1 rot. Die Sitzung lebt weiter, denn dann gilt wieder
 *        der Tag von connect-pg-simple.
 *   B  Drosselung 10000 ms bei 5 s Frist — also länger als die Frist
 *      (30.10.2026 mit den heutigen Zahlen erneut gemessen, ebenso A)
 *      → nur Fall 2 rot. Der Ablauf wird nicht nachgeführt, die TÄTIGE
 *        Sitzung stirbt mitten im Betrieb.
 *   C  `ttl` aus server.ts entfernt
 *      → nur Fall 4 rot. Die Fälle 1 und 2 bauen ihren Speicher selbst und
 *        merken davon nichts — genau deshalb gibt es Fall 4.
 *
 * Bei der ERSTEN Messung legte C zwei Fälle um (1 und 4), und der Rücklauf
 * nach dem Zurücksetzen war ebenfalls rot. Das war kein zweiter Mangel,
 * sondern der Wackler aus dem Abschnitt oben: Fall 1 hing an der Rundung auf
 * ganze Sekunden. Mit den berichtigten Zahlen trifft C nur noch Fall 4 —
 * und das ist die Probe darauf, dass die Reparatur wirklich die Ursache traf
 * und nicht blos den Symptomlauf glättete.
 *
 * Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
 * Ohne DB: skip. Ausführen: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, ohneKommentare } = require('./helpers/sources');
const _req = buildAndRequire();
const db = _req('db/database.js');
const { drossleBeruehren, BERUEHREN_MS } = _req('src/konto/sitzungsBeruehrung.js');
const { SITZUNG_LEERLAUF_MS, SITZUNG_LEERLAUF_SEK, LEERLAUF_VORGABE_MIN } = _req('src/konto/sitzungsFrist.js');
const express   = require(path.join(ROOT, 'node_modules', 'express'));
const session   = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);

/** Eine eigene Kennung je Lauf, damit das Aufräumen nichts Fremdes trifft. */
const UID = 990717;

/**
 * Ein Server wie in server.ts, nur mit kurzen Fristen.
 *
 * @param ttlSek    Leerlauf-Frist in Sekunden (als Bruchzahl erlaubt).
 * @param drosselMs Frist der Drosselung; `null` = gar nicht drosseln.
 */
async function starteServer(ttlSek, drosselMs) {
  const speicher = new pgSession({
    pool: db.pool, tableName: 'user_sessions', createTableIfMissing: false,
    ...(ttlSek === null ? {} : { ttl: ttlSek }),
  });
  if (drosselMs !== null) drossleBeruehren(speicher, drosselMs);
  const app = express();
  app.use(session({
    store: speicher, secret: process.env.SESSION_SECRET,
    resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },   // kein maxAge — wie in server.ts
  }));
  app.get('/anmelden', (req, res) => { req.session.userId = UID; res.json({ ok: true }); });
  app.get('/wer',      (req, res) => { res.json({ uid: req.session?.userId ?? null }); });
  const srv = app.listen(0);
  return { srv, base: `http://localhost:${srv.address().port}` };
}

const anmelden = async base =>
  (((await fetch(base + '/anmelden')).headers.get('set-cookie')) || '').split(';')[0];
const wer = async (base, keks) =>
  (await (await fetch(base + '/wer', { headers: { cookie: keks } })).json()).uid;
const schlafe = ms => new Promise(r => setTimeout(r, ms));

/**
 * Aufräumen — und zwar in `after`, nicht am Ende eines Falls.
 *
 * Der erste Versuch liess den Verbindungspool offen. `node --test` beendet
 * den Prozess erst, wenn kein Handle mehr offen ist: Die Prüfung lief
 * durch, meldete nichts und HÄNGTE dann — nach fünf Minuten abgebrochen,
 * ohne eine einzige Zeile Ausgabe. Das sah nach einer Endlosschleife im
 * Code aus und war ein offener Pool.
 *
 * test/sitzung-beruehrung-db.test.js schliesst ihn im `finally` seines
 * einzigen Falls. Hier sind es vier; der Haken gehört also nach `after`,
 * sonst risse der erste Fall den Teppich unter den übrigen weg.
 */
after(async () => {
  await db.run('DELETE FROM user_sessions WHERE sess::text LIKE $1', [`%${UID}%`]).catch(() => {});
  await db.pool.end().catch(() => {});
});

test('ohne Betrieb verfällt die Sitzung', async (t) => {
  try { await db.get('SELECT 1'); }
  catch { return t.skip('keine Test-Datenbank erreichbar'); }

  // 5 s statt 2 s: Unter Last (paralleler Volllauf) lagen zwischen Anmelden
  // und erstem Lesen schon über 2 s, und die Vorbedingung kippte.
  const { srv, base } = await starteServer(5, null);
  try {
    const keks = await anmelden(base);
    assert.equal(await wer(base, keks), UID,
      'direkt nach dem Anmelden muss die Sitzung gelten — sonst misst der Rest nichts');

    await schlafe(7000);                       // 5 s Frist, 2 s Reserve — siehe Kopf
    assert.equal(await wer(base, keks), null,
      'nach der Leerlauf-Frist darf die Sitzung nicht mehr gelten — '
      + 'fehlt dem Sitzungsspeicher das `ttl`, gilt wieder der Tag von connect-pg-simple');
  } finally {
    await new Promise(r => srv.close(r));
  }
});

test('mit Betrieb bleibt die Sitzung', async (t) => {
  try { await db.get('SELECT 1'); }
  catch { return t.skip('keine Test-Datenbank erreichbar'); }

  // Dasselbe Verhältnis wie im Betrieb: Die Drosselung ist ein Fünftel der
  // Frist, nicht länger. Mit einer Drosselung länger als die Frist wird
  // dieser Fall rot — gemessen, siehe Kopf.
  const { srv, base } = await starteServer(5, 1000);
  try {
    const keks = await anmelden(base);
    // Über die Frist HINAUS arbeiten: 20 Anfragen à 400 ms = 8 s bei 5 s
    // Frist. Ohne Nachführen wäre die Sitzung nach etwa Anfrage 13 tot.
    for (let i = 0; i < 20; i++) {
      await schlafe(400);
      assert.equal(await wer(base, keks), UID,
        `die tätige Sitzung ist bei Anfrage ${i + 1} von 20 gestorben — `
        + 'der Ablauf wird nicht nachgeführt (drosselt die Berührung länger als die Frist?)');
    }
  } finally {
    await new Promise(r => srv.close(r));
  }
});

test('die Drosselung ist kürzer als die Frist', () => {
  // Der Kern der Kopplung, ohne Server: Wäre sie länger, flöge der ARBEITENDE
  // Benutzer heraus statt des untätigen.
  assert.ok(BERUEHREN_MS * 2 <= SITZUNG_LEERLAUF_MS,
    `Die Drosselung (${BERUEHREN_MS} ms) ist nicht deutlich kürzer als die `
    + `Leerlauf-Frist (${SITZUNG_LEERLAUF_MS} ms) — dann wird der Ablauf nicht `
    + 'rechtzeitig nachgeführt und eine tätige Sitzung stirbt mitten im Betrieb.');

  // Und die Vorgabe ist die, die im README steht.
  assert.equal(SITZUNG_LEERLAUF_MS, LEERLAUF_VORGABE_MIN * 60_000);
  assert.equal(SITZUNG_LEERLAUF_SEK, LEERLAUF_VORGABE_MIN * 60);
  // Bei vier Stunden bleibt die Drosselung bei den bisherigen fünf Minuten:
  // ein Viertel davon wäre eine Stunde, es gewinnt das Minimum.
  assert.equal(BERUEHREN_MS, 5 * 60 * 1000,
    'Bei der Vorgabe von vier Stunden sollen es weiter fünf Minuten sein — '
    + 'sonst schreibt die Webapp wieder mehr als nötig');
});

test('server.ts gibt dem Speicher eine Frist', () => {
  // Eine Frist, die niemand übergibt, ist die teuerste Art, nichts zu tun —
  // und die Fälle oben blieben dabei grün, weil sie ihren Speicher selbst
  // bauen. Dieselbe Lücke wie in test/sitzung-beruehrung-db.test.js, dort mit
  // derselben Begründung geschlossen.
  const quelle = ohneKommentare(fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8'));
  assert.match(quelle, /ttl:\s*SITZUNG_LEERLAUF_SEK/,
    'server.ts übergibt dem Sitzungsspeicher kein `ttl` — dann gilt wieder der '
    + 'Tag von connect-pg-simple, und Marcos Frist gibt es nur auf dem Papier');

  // Und das Cookie bleibt ohne `maxAge`: Sonst würde es zu einem dauerhaften
  // Cookie, das den Neustart des Browsers überlebt — die Frist hätte dann
  // eine Eigenschaft hinzugefügt und eine andere weggenommen.
  const keksBlock = quelle.slice(quelle.indexOf('app.use(session({'));
  const bis = keksBlock.indexOf('}));');
  assert.ok(!/maxAge/.test(keksBlock.slice(0, bis)),
    'Das Sitzungs-Cookie hat ein `maxAge` bekommen — dann überlebt es das '
    + 'Schliessen des Browsers, was es vorher nicht tat');
});
