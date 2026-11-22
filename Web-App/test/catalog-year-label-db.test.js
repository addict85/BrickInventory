/**
 * The year label on the scrollbar names the year that REALLY stands there.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();

test('the year label hits the spot', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NUTZER = `jv-${process.pid}`;
  await db.run(`CREATE TABLE IF NOT EXISTS rb_themes (id INT PRIMARY KEY, name TEXT, parent_id INT)`);
  await db.run(`INSERT INTO rb_themes (id,name,parent_id) VALUES (1,'T',NULL),(2,'U',NULL)
                ON CONFLICT DO NOTHING`);
  await db.run(`DELETE FROM rb_sets WHERE set_num LIKE 'JV%'`);
  // Skewed distribution — the whole point of the matter. With the same count per year
  // the linear estimate would also have been right, and the test worthless.
  for (const [von, bis, n, thema] of [
    [1960, 1969, 2, 1],
    [1990, 1999, 20, 1],
    [2010, 2019, 100, 2],
  ])
    await db.run(
      `INSERT INTO rb_sets (set_num,name,year,theme_id,num_parts)
                  SELECT 'JV'||y||'_'||i, 'S', y, $4::int, 50
                    FROM generate_series($1::int,$2::int) y, generate_series(1,$3::int) i`,
      [von, bis, n, thema],
    );
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;

  const { base, srv } = testServer(_req, { sitzung: { userId: uid }, t });
  const hol = async p => (await fetch(base + p)).json();
  // rb_sets is a GLOBAL table — other tests create their own rows there.
  // Without this restriction the distribution would count foreign sets, and the
  // test would be green run alone and red in the full run. The search via
  // the set number is the same filter the list applies.
  const NUR = '&q=JV';

  /** The same computation as in the browser: share → running number → year. */
  const etikett = (verteilung, total, anteil) => {
    let number = Math.round(anteil * (total - 1));
    for (const e of verteilung) {
      if (number < e.n) return e.year;
      number -= e.n;
    }
    return verteilung[verteilung.length - 1].year;
  };
  /** What really stands at this place — from the real list. */
  const thereStands = async (total, anteil, filter = '') => {
    const nr = Math.round(anteil * (total - 1));
    const seite = Math.floor(nr / 60) + 1;
    const d = await hol(`/api/v2/catalog/sets?limit=60&page=${seite}${NUR}${filter}`);
    return d.sets[nr - (seite - 1) * 60].year;
  };

  try {
    for (const sort of ['year_desc', 'year_asc']) {
      await t.test(`sorting ${sort}`, async () => {
        const v = (await hol(`/api/v2/catalog/year-distribution?sort=${sort}${NUR}`)).years.filter(x => x.year);
        const total = v.reduce((s, e) => s + e.n, 0);
        assert.ok(total > 1000, `zu wenige Sets: ${total}`);
        for (const anteil of [0, 0.25, 0.5, 0.75, 0.9, 1]) {
          const echt = await thereStands(total, anteil, `&sort=${sort}`);
          assert.equal(
            etikett(v, total, anteil),
            echt,
            `bei ${Math.round(anteil * 100)} % steht ${echt}, das Etikett sagt ` + `${etikett(v, total, anteil)}`,
          );
        }
      });
    }

    await t.test('with a theme filter it is right too', async () => {
      // The distribution MUST know the filters. One over the whole catalog
      // would be just as far off with a set theme as the linear estimate —
      // theme 2 contains only the 2010s.
      const v = (await hol(`/api/v2/catalog/year-distribution?sort=year_desc&theme_id=2${NUR}`)).years.filter(
        x => x.year,
      );
      const total = v.reduce((s, e) => s + e.n, 0);
      assert.equal(total, 1000, `Filter nicht berücksichtigt: ${total}`);
      for (const anteil of [0, 0.5, 1]) {
        const echt = await thereStands(total, anteil, '&sort=year_desc&theme_id=2');
        assert.equal(
          etikett(v, total, anteil),
          echt,
          `bei ${Math.round(anteil * 100)} % steht ${echt}, das Etikett sagt ` + `${etikett(v, total, anteil)}`,
        );
      }
    });

    await t.test('the linear estimate would have been wrong', async () => {
      // Counter-check in the test itself: without it someone could replace the distribution
      // with a straight line again and the test would stay green if the stage
      // happened to be evenly distributed.
      const v = (await hol(`/api/v2/catalog/year-distribution?sort=year_desc${NUR}`)).years.filter(x => x.year);
      const total = v.reduce((s, e) => s + e.n, 0);
      const min = Math.min(...v.map(x => x.year)),
        max = Math.max(...v.map(x => x.year));
      const linear = a => Math.round(max - a * (max - min));
      const echt = await thereStands(total, 0.9, '&sort=year_desc');
      assert.notEqual(linear(0.9), echt, 'Die Bühne ist gleichverteilt — dann prüft dieser Test die Verteilung nicht');
    });
  } finally {
    await db.run(`DELETE FROM rb_sets WHERE set_num LIKE 'JV%'`).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
