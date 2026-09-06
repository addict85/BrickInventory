/**
 * Das Blickfeld wird gemerkt — und bei jeder Änderung sofort vergessen.
 *
 * ── Was gemessen wurde ──────────────────────────────────────────────────────
 * resolveHousehold() steht am Anfang praktisch jedes Lese-Endpunkts und machte
 * dort zwei Abfragen. Über die echten Routen gezählt (vorher → nachher):
 *
 *     /api/v1/sets          5 → 5 Abfragen   (die erste füllt das Gedächtnis)
 *     /api/v1/parts         6 → 4
 *     /api/v1/minifigs      5 → 3
 *     /api/v1/stats         9 → 7
 *     /api/v1/parts/stats   5 → 3
 *
 * Und die Funktion selbst: 0,438 ms → 0,001 ms je Aufruf (500 Aufrufe).
 *
 * ── Warum dieser Test mehr prüft als die Ersparnis ──────────────────────────
 * Ein Gedächtnis ist erst dann richtig, wenn es zur richtigen Zeit LEER ist.
 * Drei Wege können still falsch werden, und jeder hat hier eine Zusicherung:
 *
 *  1. Es wird gar nicht gemerkt → die Ersparnis fällt weg (Zusicherung 1).
 *  2. Es wird nach einer Änderung nicht geleert → ein gelöstes Unterkonto
 *     bliebe bis zu fünf Minuten im Blickfeld (Zusicherung 2).
 *  3. Das Signal an die anderen Cluster-Worker geht nicht raus → dort gilt 2.
 *     genauso, nur unsichtbar für jeden Test, der nur einen Worker kennt
 *     (Zusicherung 3).
 *
 * Dazu die vierte: Die zurückgegebene Mitgliederliste muss eine FRISCHE Liste
 * sein. scopeIds() gibt sie teilweise unverändert weiter; fasste ein Aufrufer
 * sie an, veränderte er sonst den gemerkten Stand für alle folgenden Anfragen
 * — ein Fehler, den man an der Fundstelle nie sähe.
 *
 * Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
 * Ohne DB: skip. Ausführen: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const db = _req('db/database.js');
const hh = _req('utils/household.js');

const HAUPT = 990501, UNTER = 990502;

const gesehen = [];
let zaehlen = false;
const altQuery = db.pool.query.bind(db.pool);
db.pool.query = (text, ...rest) => {
  if (zaehlen) gesehen.push(String(typeof text === 'string' ? text : (text && text.text) || '').replace(/\s+/g, ' '));
  return altQuery(text, ...rest);
};
const linkAbfragen = () => gesehen.filter(q => /account_links/.test(q)).length;

async function aufraeumen() {
  await db.run('DELETE FROM account_links WHERE main_user_id = ANY($1) OR sub_user_id = ANY($1)', [[HAUPT, UNTER]]).catch(() => {});
  await db.run('DELETE FROM users WHERE id = ANY($1)', [[HAUPT, UNTER]]).catch(() => {});
}

test('Blickfeld: gemerkt, und bei Änderung sofort vergessen', async (t) => {
  try { await db.get('SELECT 1'); }
  catch { return t.skip('keine Test-Datenbank erreichbar'); }

  let lauscher = null;
  try {
    await aufraeumen();
    await db.run("INSERT INTO users (id, username, password_hash) VALUES ($1,'hh_haupt','x'), ($2,'hh_unter','x')", [HAUPT, UNTER]);
    await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [HAUPT, UNTER]);
    hh.leereHaushaltCache();

    // ── 1. Gemerkt: der zweite und jeder weitere Aufruf fragt nicht mehr ────
    gesehen.length = 0; zaehlen = true;
    const erst = await hh.resolveHousehold(HAUPT);
    const nachErstem = linkAbfragen();
    for (let i = 0; i < 20; i++) await hh.resolveHousehold(HAUPT);
    zaehlen = false;
    assert.equal(nachErstem, 2, 'der erste Aufruf soll die beiden Abfragen machen');
    assert.equal(linkAbfragen(), 2,
      `21 Aufrufe ergaben ${linkAbfragen()} Abfragen auf account_links — erwartet 2 (nur der erste)`);
    assert.deepEqual(erst.memberIds, [HAUPT, UNTER], 'das Unterkonto gehört ins Blickfeld');

    // ── 2. Die Mitgliederliste ist eine frische Liste ──────────────────────
    const a = await hh.resolveHousehold(HAUPT);
    a.memberIds.push(999999);
    const b = await hh.resolveHousehold(HAUPT);
    assert.deepEqual(b.memberIds, [HAUPT, UNTER],
      'wer die Mitgliederliste anfasst, darf den gemerkten Stand nicht verändern');

    // ── 3. Nach dem Lösen ist das Blickfeld sofort wieder klein ────────────
    // Über unlink(), nicht über ein DELETE von Hand: Genau dieser Weg muss
    // das Gedächtnis leeren, und nur so ist das geprüft.
    await hh.unlink(HAUPT, UNTER);
    const nachher = await hh.resolveHousehold(HAUPT);
    assert.deepEqual(nachher.memberIds, [HAUPT],
      'nach unlink() steht das gelöste Unterkonto noch im gemerkten Blickfeld');

    // ── 4. Das Signal geht an die anderen Cluster-Worker raus ──────────────
    // Ohne dieses NOTIFY säße jeder andere Worker bis zum Ablauf der Frist auf
    // seinem alten Stand — der Nutzer löst eine Verknüpfung und sieht sie je
    // nach Worker mal so, mal so.
    lauscher = await db.eigeneVerbindung();
    await lauscher.query(`LISTEN ${hh.HAUSHALT_KANAL}`);
    const angekommen = new Promise((auf, ab) => {
      const uhr = setTimeout(() => ab(new Error(
        `kein NOTIFY auf Kanal "${hh.HAUSHALT_KANAL}" innerhalb von 3 s — die anderen Worker erfahren nichts`)), 3000);
      lauscher.on('notification', (m) => { if (m.channel === hh.HAUSHALT_KANAL) { clearTimeout(uhr); auf(m); } });
    });
    hh.meldeHaushaltsaenderung();
    const meldung = await angekommen;
    assert.equal(meldung.channel, hh.HAUSHALT_KANAL);

    // ── 5. Und jemand hört auf dem Kanal zu ────────────────────────────────
    // Ein Signal ohne Empfänger wäre die teuerste Art, nichts zu tun: Die
    // Zusicherung darüber bliebe grün, und die anderen Worker erführen
    // trotzdem nichts. Die Anmeldung steht in server.ts, wo auch die übrigen
    // Kanäle angemeldet werden — nachgesehen wird deshalb dort.
    const serverQuelle = require('node:fs').readFileSync(path.join(ROOT, 'server.ts'), 'utf8');
    assert.match(serverQuelle, /listen\(HAUSHALT_KANAL/,
      'server.ts meldet sich nicht auf dem Haushalts-Kanal an — das NOTIFY liefe ins Leere');

    // ── GEGENPROBE ────────────────────────────────────────────────────────
    // Sieht der Zähler die Abfragen überhaupt? Nach dem Leeren muss der
    // nächste Aufruf wieder beide machen — sonst prüft Zusicherung 1 nichts.
    hh.leereHaushaltCache();
    gesehen.length = 0; zaehlen = true;
    await hh.resolveHousehold(HAUPT);
    zaehlen = false;
    assert.equal(linkAbfragen(), 2,
      'Gegenprobe: nach leereHaushaltCache() wurde nicht neu gelesen (oder der Zähler zählt nicht mit)');
  } finally {
    db.pool.query = altQuery;
    if (lauscher) await lauscher.end().catch(() => {});
    await aufraeumen();
    await db.pool.end().catch(() => {});
  }
});
