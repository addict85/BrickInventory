/**
 * Das Jahres-Etikett am Scrollbalken nennt das Jahr, das dort WIRKLICH steht.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 * „Wenn dann die Bilder geladen werden, erscheinen sie von einem anderen Jahr,
 * als rechts im Scrollbalken angezeigt wird. Es wurden die Sets von 1999
 * geladen, obwohl rechts 1965 steht."
 *
 * ── Die Annahme, die niemand ausgesprochen hatte ────────────────────────────
 * Das Etikett rechnete die Position LINEAR auf den Jahresbereich um — als läge
 * zwischen 1949 und 2027 in jedem Jahr gleich viel. Tatsächlich stammt der
 * weitaus grösste Teil des Katalogs aus den letzten Jahrzehnten. Wer neun
 * Zehntel hinunterzieht, ist deshalb noch lange nicht bei den Sechzigern.
 *
 * Gemessen an einer schiefen Verteilung wie im echten Katalog (1960–1969 je 2
 * Sets, 1990–1999 je 20, 2010–2019 je 100):
 *
 *     Position   dort steht   Etikett neu   Etikett alt (linear)
 *          25%         2016          2016                   2004
 *          50%         2013          2013                   1990
 *          75%         2010          2010                   1975
 *          90%         1995          1995                   1966
 *
 * ── Was dieser Test prüft ───────────────────────────────────────────────────
 * Nicht die Verteilung für sich, sondern dass sie TRIFFT: Zu jeder Position
 * wird das Set an dieser laufenden Nummer aus der echten Liste geholt und sein
 * Jahr mit dem verglichen, was das Etikett sagen würde. Ein Test auf „die Route
 * liefert Jahre" hätte die lineare Schätzung nie auffliegen lassen.
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

test('das Jahres-Etikett trifft die Stelle', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const NUTZER = `jv-${process.pid}`;
  await db.run(`CREATE TABLE IF NOT EXISTS rb_themes (id INT PRIMARY KEY, name TEXT, parent_id INT)`);
  await db.run(`INSERT INTO rb_themes (id,name,parent_id) VALUES (1,'T',NULL),(2,'U',NULL)
                ON CONFLICT DO NOTHING`);
  await db.run(`DELETE FROM rb_sets WHERE set_num LIKE 'JV%'`);
  // Schiefe Verteilung — der ganze Punkt der Sache. Bei gleicher Anzahl je Jahr
  // wäre auch die lineare Schätzung richtig gewesen, und der Test wertlos.
  for (const [von, bis, n, thema] of [[1960, 1969, 2, 1], [1990, 1999, 20, 1], [2010, 2019, 100, 2]])
    await db.run(`INSERT INTO rb_sets (set_num,name,year,theme_id,num_parts)
                  SELECT 'JV'||y||'_'||i, 'S', y, $4::int, 50
                    FROM generate_series($1::int,$2::int) y, generate_series(1,$3::int) i`,
                 [von, bis, n, thema]);
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;

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
  // rb_sets ist eine GLOBALE Tabelle — andere Tests legen dort eigene Zeilen an.
  // Ohne diese Einschränkung zählte die Verteilung fremde Sets mit, und der
  // Test wäre allein gelaufen grün und im vollen Durchlauf rot. Die Suche über
  // die Setnummer ist derselbe Filter, den auch die Liste anwendet.
  const NUR = '&q=JV';

  /** Dieselbe Rechnung wie im Browser: Anteil → laufende Nummer → Jahr. */
  const etikett = (verteilung, gesamt, anteil) => {
    let nummer = Math.round(anteil * (gesamt - 1));
    for (const e of verteilung) { if (nummer < e.n) return e.year; nummer -= e.n; }
    return verteilung[verteilung.length - 1].year;
  };
  /** Was an dieser Stelle wirklich steht — aus der echten Liste. */
  const dortSteht = async (gesamt, anteil, filter = '') => {
    const nr = Math.round(anteil * (gesamt - 1));
    const seite = Math.floor(nr / 60) + 1;
    const d = await hol(`/api/v1/catalog/sets?limit=60&page=${seite}${NUR}${filter}`);
    return d.sets[nr - (seite - 1) * 60].year;
  };

  try {
    for (const sort of ['year_desc', 'year_asc']) {
      await t.test(`Sortierung ${sort}`, async () => {
        const v = (await hol(`/api/v1/catalog/year-verteilung?sort=${sort}${NUR}`)).years.filter(x => x.year);
        const gesamt = v.reduce((s, e) => s + e.n, 0);
        assert.ok(gesamt > 1000, `zu wenige Sets: ${gesamt}`);
        for (const anteil of [0, 0.25, 0.5, 0.75, 0.9, 1]) {
          const echt = await dortSteht(gesamt, anteil, `&sort=${sort}`);
          assert.equal(etikett(v, gesamt, anteil), echt,
            `bei ${Math.round(anteil * 100)} % steht ${echt}, das Etikett sagt ` +
            `${etikett(v, gesamt, anteil)}`);
        }
      });
    }

    await t.test('mit Themenfilter stimmt es auch', async () => {
      // Die Verteilung MUSS die Filter kennen. Eine über den ganzen Katalog
      // läge bei gesetztem Thema genauso daneben wie die lineare Schätzung —
      // Thema 2 enthält nur die 2010er.
      const v = (await hol(`/api/v1/catalog/year-verteilung?sort=year_desc&theme_id=2${NUR}`))
        .years.filter(x => x.year);
      const gesamt = v.reduce((s, e) => s + e.n, 0);
      assert.equal(gesamt, 1000, `Filter nicht berücksichtigt: ${gesamt}`);
      for (const anteil of [0, 0.5, 1]) {
        const echt = await dortSteht(gesamt, anteil, '&sort=year_desc&theme_id=2');
        assert.equal(etikett(v, gesamt, anteil), echt,
          `bei ${Math.round(anteil * 100)} % steht ${echt}, das Etikett sagt ` +
          `${etikett(v, gesamt, anteil)}`);
      }
    });

    await t.test('die lineare Schätzung wäre falsch gewesen', async () => {
      // Gegenprobe im Test selbst: Ohne sie könnte jemand die Verteilung wieder
      // durch eine Gerade ersetzen und der Test bliebe grün, falls die Bühne
      // zufällig gleichverteilt wäre.
      const v = (await hol(`/api/v1/catalog/year-verteilung?sort=year_desc${NUR}`)).years.filter(x => x.year);
      const gesamt = v.reduce((s, e) => s + e.n, 0);
      const min = Math.min(...v.map(x => x.year)), max = Math.max(...v.map(x => x.year));
      const linear = (a) => Math.round(max - a * (max - min));
      const echt = await dortSteht(gesamt, 0.9, '&sort=year_desc');
      assert.notEqual(linear(0.9), echt,
        'Die Bühne ist gleichverteilt — dann prüft dieser Test die Verteilung nicht');
    });
  } finally {
    await db.run(`DELETE FROM rb_sets WHERE set_num LIKE 'JV%'`).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
