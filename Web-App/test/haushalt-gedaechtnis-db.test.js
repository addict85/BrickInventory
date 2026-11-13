/**
 * Das Blickfeld wird gemerkt — und bei jeder Änderung sofort vergessen.
 *
 * @superuser (Ratsche in test/rollen-trennung-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten, testZugang } = require('./helpers/sources');
const _req = buildAndRequire();
const db = testDaten();
const hh = { ..._req('src/haushalt/haushalt.js'), ..._req('src/haushalt/prozess.js').haushaltBereich() };

const HAUPT = 990501,
  UNTER = 990502;

const gesehen = [];
let zaehlen = false;
const altQuery = db.pool.query.bind(db.pool);
db.pool.query = (text, ...rest) => {
  if (zaehlen) gesehen.push(String(typeof text === 'string' ? text : text?.text || '').replace(/\s+/g, ' '));
  return altQuery(text, ...rest);
};
const linkAbfragen = () => gesehen.filter(q => /account_links/.test(q)).length;

async function aufraeumen() {
  await db
    .run('DELETE FROM account_links WHERE main_user_id = ANY($1) OR sub_user_id = ANY($1)', [[HAUPT, UNTER]])
    .catch(() => {});
  await db.run('DELETE FROM users WHERE id = ANY($1)', [[HAUPT, UNTER]]).catch(() => {});
}

test('Blickfeld: gemerkt, und bei Änderung sofort vergessen', async t => {
  try {
    await db.get('SELECT 1');
  } catch {
    return t.skip('keine Test-Datenbank erreichbar');
  }

  let lauscher = null;
  try {
    await aufraeumen();
    await db.run("INSERT INTO users (id, username, password_hash) VALUES ($1,'hh_haupt','x'), ($2,'hh_unter','x')", [
      HAUPT,
      UNTER,
    ]);
    await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [HAUPT, UNTER]);
    hh.leereHaushaltCache();

    // ── 1. Gemerkt: der zweite und jeder weitere Aufruf fragt nicht mehr ────
    gesehen.length = 0;
    zaehlen = true;
    const erst = await hh.haushaltVon(HAUPT);
    const nachErstem = linkAbfragen();
    for (let i = 0; i < 20; i++) await hh.haushaltVon(HAUPT);
    zaehlen = false;
    assert.equal(nachErstem, 2, 'der erste Aufruf soll die beiden Abfragen machen');
    assert.equal(
      linkAbfragen(),
      2,
      `21 Aufrufe ergaben ${linkAbfragen()} Abfragen auf account_links — erwartet 2 (nur der erste)`,
    );
    assert.deepEqual(erst.memberIds, [HAUPT, UNTER], 'das Unterkonto gehört ins Blickfeld');

    // ── 2. Die Mitgliederliste ist eine frische Liste ──────────────────────
    const a = await hh.haushaltVon(HAUPT);
    a.memberIds.push(999999);
    const b = await hh.haushaltVon(HAUPT);
    assert.deepEqual(
      b.memberIds,
      [HAUPT, UNTER],
      'wer die Mitgliederliste anfasst, darf den gemerkten Stand nicht verändern',
    );

    // ── 3. Nach dem Lösen ist das Blickfeld sofort wieder klein ────────────
    // Über kontenTrennen(), nicht über ein DELETE von Hand: Genau dieser Weg muss
    // das Gedächtnis leeren, und nur so ist das geprüft.
    await hh.kontenTrennen(HAUPT, UNTER);
    const nachher = await hh.haushaltVon(HAUPT);
    assert.deepEqual(
      nachher.memberIds,
      [HAUPT],
      'nach kontenTrennen() steht das gelöste Unterkonto noch im gemerkten Blickfeld',
    );

    // ── 4. Das Signal geht an die anderen Cluster-Worker raus ──────────────
    // Ohne dieses NOTIFY säße jeder andere Worker bis zum Ablauf der Frist auf
    // seinem alten Stand — der Nutzer löst eine Verknüpfung und sieht sie je
    // nach Worker mal so, mal so.
    lauscher = await db.eigeneVerbindung();
    await lauscher.query(`LISTEN ${hh.HAUSHALT_KANAL}`);
    const angekommen = new Promise((auf, ab) => {
      const uhr = setTimeout(
        () =>
          ab(
            new Error(
              `kein NOTIFY auf Kanal "${hh.HAUSHALT_KANAL}" innerhalb von 3 s — die anderen Worker erfahren nichts`,
            ),
          ),
        3000,
      );
      lauscher.on('notification', m => {
        if (m.channel === hh.HAUSHALT_KANAL) {
          clearTimeout(uhr);
          auf(m);
        }
      });
    });
    hh.meldeHaushaltsaenderung(testZugang());
    const meldung = await angekommen;
    assert.equal(meldung.channel, hh.HAUSHALT_KANAL);

    // Dass jeder Worker auf dem Kanal lauscht, prüft
    // signale-zwei-worker-db.test.js am echten Cluster.

    // ── GEGENPROBE ────────────────────────────────────────────────────────
    // Sieht der Zähler die Abfragen überhaupt? Nach dem Leeren muss der
    // nächste Aufruf wieder beide machen — sonst prüft Zusicherung 1 nichts.
    hh.leereHaushaltCache();
    gesehen.length = 0;
    zaehlen = true;
    await hh.haushaltVon(HAUPT);
    zaehlen = false;
    assert.equal(
      linkAbfragen(),
      2,
      'Gegenprobe: nach leereHaushaltCache() wurde nicht neu gelesen (oder der Zähler zählt nicht mit)',
    );
  } finally {
    db.pool.query = altQuery;
    if (lauscher) await lauscher.end().catch(() => {});
    await aufraeumen();
    await db.pool.end().catch(() => {});
  }
});
