/**
 * Katalog: Wo beginnt ein Jahr in der Liste?
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 * „Im Katalog die Zeitleiste rechts anpassen. Diese soll nicht ein Filter sein,
 * sondern zum Schnellscrollen verwendet werden können, analog wie es in der
 * Android-Galerie-Foto-App der Fall ist."
 *
 * Der Unterschied ist wesentlich: Ein Filter WIRFT die anderen Jahre weg. Ein
 * Schnell-Scroll springt nur hin — davor und danach bleibt alles erreichbar.
 *
 * ── Warum der Server das rechnet ────────────────────────────────────────────
 * Der Katalog hat rund 25 000 Sets und wird seitenweise geliefert; die Clients
 * kennen immer nur die geladenen Seiten. Wohin ein Jahr gehört, weiss nur die
 * Datenbank — und beide Oberflächen sollen dieselbe Stelle treffen. Ein
 * Nachrechnen im Client wäre wieder eine zweite Fassung, diesmal einer, die
 * ohne die vollständige Liste gar nicht möglich ist.
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 * Nicht die Zahl für sich, sondern dass sie TRIFFT: Die Antwort wird benutzt,
 * um die Liste an genau dieser Stelle abzurufen, und dort muss das erste Set
 * des gesuchten Jahres stehen. Ein Test auf „offset ist 30" hätte jede
 * Verschiebung um eins mitgemacht.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('Katalog: der Jahres-Sprung trifft die erste Zeile des Jahres',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const NUTZER = `ky-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;

  await db.run(`CREATE TABLE IF NOT EXISTS rb_themes (id INT PRIMARY KEY, name TEXT, parent_id INT)`);
  await db.run(`INSERT INTO rb_themes (id,name,parent_id) VALUES (1,'Test',NULL) ON CONFLICT DO NOTHING`);
  await db.run(`DELETE FROM rb_sets WHERE set_num LIKE 'KY%'`);
  // Fünf Sets je Jahr von 2000 bis 2026 — 135 Stück, genug für 14 Seiten à 10.
  await db.run(`INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts)
                SELECT 'KY'||y||'-'||i, 'Set '||y||'/'||i, y, 1, 100
                  FROM generate_series(2000,2026) y, generate_series(1,5) i`);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: uid };
    req.apiUser = { user_id: uid, is_admin: 0 };
    next();
  });
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;
  const hol = async (p) => (await fetch(base + p)).json();

  try {
    for (const [jahr, sort] of [[2026, 'year_desc'], [2020, 'year_desc'],
                                [2000, 'year_desc'], [2020, 'year_asc'],
                                [2000, 'year_asc']]) {
      await t.test(`Jahr ${jahr}, Sortierung ${sort}`, async () => {
        const o = await hol(`/api/v1/catalog/year-offset?year=${jahr}&sort=${sort}&limit=10`);
        assert.equal(o.success, true);
        const seite = await hol(`/api/v1/catalog/sets?sort=${sort}&limit=10&page=${o.page}`);
        const index = o.offset - (o.page - 1) * 10;
        const treffer = seite.sets?.[index];
        assert.ok(treffer, `an Stelle ${o.offset} (Seite ${o.page}, Index ${index}) steht nichts`);
        assert.equal(treffer.year, jahr,
          `der Sprung landet im Jahr ${treffer.year} statt ${jahr}`);
        // Und es muss das ERSTE des Jahres sein — die Zeile davor gehört noch
        // zum Nachbarjahr. Ohne diese Prüfung wäre auch „irgendwo mitten im
        // Jahr\" grün, und der Sprung fühlte sich zufällig an.
        if (o.offset > 0) {
          const vorherSeite = Math.floor((o.offset - 1) / 10) + 1;
          const vs = await hol(`/api/v1/catalog/sets?sort=${sort}&limit=10&page=${vorherSeite}`);
          const davor = vs.sets[(o.offset - 1) - (vorherSeite - 1) * 10];
          assert.notEqual(davor.year, jahr,
            `die Zeile davor gehört schon zum Jahr ${jahr} — der Sprung liegt zu spät`);
        }
      });
    }

    await t.test('der Filter wird mitgezählt', async () => {
      // Mit einer Suche schrumpft die Liste, und die Stelle verschiebt sich.
      // Rechnete der Sprung ohne Filter, landete er weit hinter dem Ende.
      const o = await hol(`/api/v1/catalog/year-offset?year=2015&q=KY2015&sort=year_desc&limit=10`);
      assert.equal(o.total, 5, `Filter nicht berücksichtigt: total=${o.total}`);
      assert.equal(o.offset, 0, 'bei nur einem Jahr im Ergebnis beginnt es ganz oben');
    });

    await t.test('ein Jahr ohne Sets landet am nächsten erreichbaren Platz', async () => {
      // Lücken im Katalog und Filter machen einzelne Jahre leer. Springen soll
      // trotzdem etwas — lieber ans Ende als ins Nichts.
      const o = await hol(`/api/v1/catalog/year-offset?year=1980&sort=year_desc&limit=10`);
      assert.equal(o.success, true);
      assert.ok(o.offset < o.total, `offset ${o.offset} liegt ausserhalb der Liste (${o.total})`);
      const seite = await hol(`/api/v1/catalog/sets?sort=year_desc&limit=10&page=${o.page}`);
      assert.ok(seite.sets.length > 0, 'die Zielseite ist leer');
    });

    await t.test('ohne Jahr antwortet die Route mit einem Fehler', async () => {
      const r = await fetch(`${base}/api/v1/catalog/year-offset`);
      assert.equal(r.status, 400);
    });
  } finally {
    await db.run(`DELETE FROM rb_sets WHERE set_num LIKE 'KY%'`).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
