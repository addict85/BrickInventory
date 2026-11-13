/**
 * Der Katalog stösst nicht mehr Bilder an, als jemand ansieht.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Der Bild-Download über das Bildwerk der Dienste: gezählt, ohne Netz.
let angestossen = 0;

const { buildAndRequire, testDaten, testBildwerk } = require('./helpers/sources');
const _req = buildAndRequire();
testBildwerk(null, {
  setBildLaden: async () => {
    angestossen++;
    await new Promise(r => setTimeout(r, 2));
    return null;
  },
});
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testDaten();

test('die Katalogliste löst gar keine Bildarbeit aus', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;

  const NUTZER = `bq-${process.pid}`;
  await db.run(`CREATE TABLE IF NOT EXISTS rb_themes (id INT PRIMARY KEY, name TEXT, parent_id INT)`);
  await db.run(`INSERT INTO rb_themes (id,name,parent_id) VALUES (1,'T',NULL) ON CONFLICT DO NOTHING`);
  await db.run(`DELETE FROM rb_sets WHERE set_num LIKE 'BQ%'`);
  await db.run(`INSERT INTO rb_sets (set_num,name,year,theme_id,num_parts,set_img_url)
                SELECT 'BQ'||g, 'S'||g, 2020, 1, 100, 'https://example.invalid/'||g||'.jpg'
                  FROM generate_series(1,600) g`);
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;

  const { base, srv } = testServer(_req, { sitzung: { userId: uid }, t });

  try {
    // Zehn Seiten in schneller Folge — so wie beim Durchscrollen.
    for (let seite = 1; seite <= 10; seite++)
      await (await fetch(`${base}/api/v1/catalog/sets?limit=60&page=${seite}&sort=year_desc`)).json();
    // Warten, bis die Warteschlange durchgelaufen wäre.
    await new Promise(r => setTimeout(r, 2500));

    // Aus dem Deckel wurde eine Null
    assert.equal(
      angestossen,
      0,
      `${angestossen} Bild-Aufträge aus der LISTE. Sie darf gar keine mehr ` +
        'auslösen — jeder Aufruf von hier läuft an allen Drosselungen vorbei.',
    );
  } finally {
    await db.run(`DELETE FROM rb_sets WHERE set_num LIKE 'BQ%'`).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
