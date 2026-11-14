/**
 * Eine Webapp-Sitzung ohne Betrieb läuft ab — eine mit Betrieb nicht.
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
 *   C  `ttl` aus startup/app.ts entfernt → rot in sitzung-app-db.test.js; die
 *      Fälle hier bauen ihren Speicher selbst und merken davon nichts.
 *
 * Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
 * Ohne DB: skip. Ausführen: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const db = testDaten();
const { drossleBeruehren, beruehrenMs } = _req('src/konto/sitzungsBeruehrung.js');
const { sitzungLeerlaufMs, sitzungLeerlaufSek, LEERLAUF_VORGABE_MIN } = _req('src/konto/sitzungsFrist.js');
// Die Vorgabe als gereichte Konfiguration, wie baueDienste sie reicht.
const VORGABE = { sitzungLeerlaufMin: LEERLAUF_VORGABE_MIN };
const SITZUNG_LEERLAUF_MS = sitzungLeerlaufMs(VORGABE);
const SITZUNG_LEERLAUF_SEK = sitzungLeerlaufSek(VORGABE);
const BERUEHREN_MS = beruehrenMs(SITZUNG_LEERLAUF_MS);
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
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
    pool: db.pool,
    tableName: 'user_sessions',
    createTableIfMissing: false,
    ...(ttlSek === null ? {} : { ttl: ttlSek }),
  });
  if (drosselMs !== null) drossleBeruehren(speicher, drosselMs);
  const app = express();
  app.use(
    session({
      store: speicher,
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'strict' }, // kein maxAge — wie in server.ts
    }),
  );
  app.get('/anmelden', (req, res) => {
    req.session.userId = UID;
    res.json({ ok: true });
  });
  app.get('/wer', (req, res) => {
    res.json({ uid: req.session?.userId ?? null });
  });
  const srv = app.listen(0);
  return { srv, base: `http://localhost:${srv.address().port}` };
}

const anmelden = async base => {
  const r = await fetch(base + '/anmelden');
  await r.text(); // die Sitzung steht erst nach dem letzten Byte im Speicher
  return (r.headers.get('set-cookie') || '').split(';')[0];
};
const wer = async (base, keks) => (await (await fetch(base + '/wer', { headers: { cookie: keks } })).json()).uid;
const { warte: schlafe } = require('./helpers/zeit');

/**
 * Aufräumen — und zwar in `after`, nicht am Ende eines Falls.
 */
after(async () => {
  await db.run('DELETE FROM user_sessions WHERE sess::text LIKE $1', [`%${UID}%`]).catch(() => {});
  await db.pool.end().catch(() => {});
});

test('ohne Betrieb verfällt die Sitzung', async t => {
  try {
    await db.get('SELECT 1');
  } catch {
    return t.skip('keine Test-Datenbank erreichbar');
  }

  // 5 s statt 2 s: Unter Last (paralleler Volllauf) lagen zwischen Anmelden
  // und erstem Lesen schon über 2 s, und die Vorbedingung kippte.
  const { srv, base } = await starteServer(5, null);
  try {
    const keks = await anmelden(base);
    assert.equal(
      await wer(base, keks),
      UID,
      'direkt nach dem Anmelden muss die Sitzung gelten — sonst misst der Rest nichts',
    );

    await schlafe(7000); // 5 s Frist, 2 s Reserve — siehe Kopf
    assert.equal(
      await wer(base, keks),
      null,
      'nach der Leerlauf-Frist darf die Sitzung nicht mehr gelten — ' +
        'fehlt dem Sitzungsspeicher das `ttl`, gilt wieder der Tag von connect-pg-simple',
    );
  } finally {
    await new Promise(r => srv.close(r));
  }
});

test('mit Betrieb bleibt die Sitzung', async t => {
  try {
    await db.get('SELECT 1');
  } catch {
    return t.skip('keine Test-Datenbank erreichbar');
  }

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
      assert.equal(
        await wer(base, keks),
        UID,
        `die tätige Sitzung ist bei Anfrage ${i + 1} von 20 gestorben — ` +
          'der Ablauf wird nicht nachgeführt (drosselt die Berührung länger als die Frist?)',
      );
    }
  } finally {
    await new Promise(r => srv.close(r));
  }
});

test('die Drosselung ist kürzer als die Frist', () => {
  // Der Kern der Kopplung, ohne Server: Wäre sie länger, flöge der ARBEITENDE
  // Benutzer heraus statt des untätigen.
  assert.ok(
    BERUEHREN_MS * 2 <= SITZUNG_LEERLAUF_MS,
    `Die Drosselung (${BERUEHREN_MS} ms) ist nicht deutlich kürzer als die ` +
      `Leerlauf-Frist (${SITZUNG_LEERLAUF_MS} ms) — dann wird der Ablauf nicht ` +
      'rechtzeitig nachgeführt und eine tätige Sitzung stirbt mitten im Betrieb.',
  );

  // Und die Vorgabe ist die, die im README steht.
  assert.equal(SITZUNG_LEERLAUF_MS, LEERLAUF_VORGABE_MIN * 60_000);
  assert.equal(SITZUNG_LEERLAUF_SEK, LEERLAUF_VORGABE_MIN * 60);
  // Bei vier Stunden bleibt die Drosselung bei den bisherigen fünf Minuten:
  // ein Viertel davon wäre eine Stunde, es gewinnt das Minimum.
  assert.equal(
    BERUEHREN_MS,
    5 * 60 * 1000,
    'Bei der Vorgabe von vier Stunden sollen es weiter fünf Minuten sein — ' +
      'sonst schreibt die Webapp wieder mehr als nötig',
  );
});
