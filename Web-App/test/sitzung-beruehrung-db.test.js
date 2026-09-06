/**
 * Die Ablaufzeit der Sitzung wird gedrosselt geschrieben.
 *
 * ── Was gemessen wurde ──────────────────────────────────────────────────────
 * Zwanzig Anfragen mit Sitzungs-Cookie, Abfragen am Verbindungs-Pool gezählt:
 *
 *     vorher   20x SELECT sess FROM user_sessions …     2,0 je Anfrage
 *              20x UPDATE user_sessions SET expire = …
 *     nachher  20x SELECT   +   1x UPDATE               1,1 je Anfrage
 *
 * Das gilt für JEDE Anfrage der Webapp, auch für jedes einzelne Bild einer
 * Galerie: Bei sechzig Kacheln waren das hundertzwanzig Abfragen allein für
 * die Sitzung, davon sechzig SCHREIBEND auf eine Tabelle, die sich alle
 * Cluster-Worker teilen.
 *
 * Die Begründung, warum das Schreiben warten darf (und das Lesen nicht),
 * steht in utils/sitzungsBeruehrung.ts.
 *
 * ── Warum der Test die Sitzung auch BENUTZT ─────────────────────────────────
 * Eine Drosselung, die zu viel drosselt, sieht in der Zählung besser aus und
 * ist kaputt: Wird gar nicht mehr geschrieben, läuft jede Sitzung nach einem
 * Tag ab, egal wie aktiv jemand ist. Deshalb drei Zusicherungen statt einer —
 * die Zahl der Schreibvorgänge, das Fortbestehen der Sitzung UND dass die
 * Ablaufzeit überhaupt einmal geschrieben wird.
 *
 * Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
 * Ohne DB: skip. Ausführen: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, ohneKommentare } = require('./helpers/sources');
const _req = buildAndRequire();
const db = _req('db/database.js');
const { drossleBeruehren } = _req('utils/sitzungsBeruehrung.js');
const express   = require(path.join(ROOT, 'node_modules', 'express'));
const session   = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);

const gesehen = [];
let zaehlen = false;
const altQuery = db.pool.query.bind(db.pool);
db.pool.query = (text, ...rest) => {
  if (zaehlen) gesehen.push(String(typeof text === 'string' ? text : (text && text.text) || '').replace(/\s+/g, ' '));
  return altQuery(text, ...rest);
};
const wieOft = muster => gesehen.filter(q => muster.test(q)).length;
const LESEN     = /SELECT sess FROM "?user_sessions"?/;
const SCHREIBEN = /UPDATE "?user_sessions"? SET expire/;

/** Ein Server mit echtem Sitzungsspeicher; `frist` steuert die Drosselung. */
async function starteServer(frist) {
  const speicher = new pgSession({ pool: db.pool, tableName: 'user_sessions', createTableIfMissing: false });
  if (frist !== null) drossleBeruehren(speicher, frist);
  const app = express();
  app.use(session({
    store: speicher, secret: process.env.SESSION_SECRET,
    resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  }));
  app.get('/anmelden', (req, res) => { req.session.userId = 990601; res.json({ ok: true }); });
  app.get('/bild',     (req, res) => { res.json({ uid: req.session?.userId ?? null }); });
  const srv = app.listen(0);
  return { srv, base: `http://localhost:${srv.address().port}` };
}

async function anmelden(base) {
  const r = await fetch(base + '/anmelden');
  return (r.headers.get('set-cookie') || '').split(';')[0];
}

test('Sitzung: gelesen wird immer, geschrieben nur alle paar Minuten', async (t) => {
  try { await db.get('SELECT 1'); }
  catch { return t.skip('keine Test-Datenbank erreichbar'); }

  const N = 20;
  const server = [];
  try {
    // ── 1. Mit Drosselung: N Lesevorgänge, EIN Schreibvorgang ──────────────
    const a = await starteServer(5 * 60 * 1000);
    server.push(a.srv);
    const keksA = await anmelden(a.base);
    gesehen.length = 0; zaehlen = true;
    let letzte = null;
    for (let i = 0; i < N; i++) letzte = await (await fetch(a.base + '/bild', { headers: { cookie: keksA } })).json();
    zaehlen = false;

    assert.equal(wieOft(LESEN), N, `gelesen wird bei jeder Anfrage — erwartet ${N}, gezählt ${wieOft(LESEN)}`);
    // GENAU einer, und beide Abweichungen sind Fehler: mehr heisst, die
    // Drosselung greift nicht; NULL heisst, sie drosselt zu viel und die
    // Ablaufzeit wird nie nachgeführt.
    assert.equal(wieOft(SCHREIBEN), 1,
      `${wieOft(SCHREIBEN)} Schreibvorgänge bei ${N} Anfragen — erwartet genau 1 `
      + `(mehr: die Drosselung greift nicht; keiner: sie drosselt zu viel)`);

    // ── 2. Die Sitzung lebt weiter ─────────────────────────────────────────
    // Ohne diese Zusicherung wäre „gar nicht mehr schreiben" die beste Note.
    assert.equal(letzte.uid, 990601, 'die Sitzung muss über alle Anfragen hinweg gültig bleiben');

    // ── 3. Und die Ablaufzeit steht wirklich in der Datenbank ──────────────
    const sid = decodeURIComponent(keksA.split('=')[1]).slice(2).split('.')[0];
    const zeile = await db.get('SELECT expire FROM user_sessions WHERE sid = $1', [sid]);
    assert.ok(zeile?.expire, 'die Sitzungszeile muss eine Ablaufzeit tragen');
    assert.ok(new Date(zeile.expire).getTime() > Date.now(),
      'die Ablaufzeit muss in der Zukunft liegen — sonst ist die Sitzung sofort tot');

    // ── GEGENPROBE: ohne Frist schreibt jede Anfrage ───────────────────────
    // Dieselbe Strecke mit Frist 0. Bliebe die Zahl auch hier bei 1, käme die
    // Ersparnis oben von etwas anderem als der Drosselung.
    const b = await starteServer(0);
    server.push(b.srv);
    const keksB = await anmelden(b.base);
    gesehen.length = 0; zaehlen = true;
    for (let i = 0; i < N; i++) await fetch(b.base + '/bild', { headers: { cookie: keksB } });
    zaehlen = false;
    assert.equal(wieOft(SCHREIBEN), N,
      `Gegenprobe: ohne Frist müssten es ${N} Schreibvorgänge sein, gezählt ${wieOft(SCHREIBEN)}`);

    // ── 4. Und server.ts benutzt die Drosselung überhaupt ──────────────────
    // Ein Helfer, den niemand aufruft, ist die teuerste Art, nichts zu tun —
    // und die Zusicherungen oben blieben dabei grün, weil sie ihren Speicher
    // selbst bauen.
    const quelle = ohneKommentare(fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8'));
    assert.match(quelle, /drossleBeruehren\(sitzungsSpeicher\)/,
      'server.ts drosselt seinen Sitzungsspeicher nicht — dann zahlt die Webapp weiter zwei Abfragen je Anfrage');
  } finally {
    db.pool.query = altQuery;
    for (const s of server) await new Promise(r => s.close(r));
    await db.run("DELETE FROM user_sessions WHERE sess::text LIKE '%990601%'").catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
