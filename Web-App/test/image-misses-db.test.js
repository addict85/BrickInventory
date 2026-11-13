/**
 * Fehlende Bilder werden EINMAL geholt — nicht je Prozess und Besuch neu.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Der Bild-Download über das Bildwerk der Dienste: null = das CDN hat kein Bild.
let versuche = 0;

const { buildAndRequire, testDaten, testBildwerk } = require('./helpers/sources');
const _req = buildAndRequire();
testBildwerk(null, {
  setBildLaden: async () => {
    versuche++;
    return null;
  },
});
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testDaten();

test('bildlose Sets werden nicht immer wieder beim CDN gesucht', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;

  const NUTZER = `im-${process.pid}`;
  const PRAEFIX = `IM${process.pid}_`;
  await db.run(`CREATE TABLE IF NOT EXISTS rb_themes (id INT PRIMARY KEY, name TEXT, parent_id INT)`);
  await db.run(`INSERT INTO rb_themes (id,name,parent_id) VALUES (1,'T',NULL) ON CONFLICT DO NOTHING`);
  await db.run(`DELETE FROM rb_sets WHERE set_num LIKE $1`, [PRAEFIX + '%']);
  await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + PRAEFIX + '%']).catch(() => {});
  // Ein Jahrgang ohne Bilder — wie 1958 im echten Katalog.
  await db.run(
    `INSERT INTO rb_sets (set_num,name,year,theme_id,num_parts,set_img_url)
                SELECT $1||g, 'Alt', 1958, 1, 50, 'https://example.invalid/'||g||'.jpg'
                  FROM generate_series(1,60) g`,
    [PRAEFIX],
  );
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;

  const { base, srv } = testServer(_req, {
    sitzung: { userId: uid },
    apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });

  // Die Warteschlange arbeitet nebenläufig — nach dem Abruf kurz warten.
  const besuch = async () => {
    await (await fetch(`${base}/api/v1/catalog/sets?limit=60&page=1&q=${PRAEFIX}`)).json();
    await new Promise(r => setTimeout(r, 700));
  };

  try {
    // Die Liste löst seit einer früheren Runde gar keine Bildarbeit mehr aus (sie lief
    // an allen Drosselungen vorbei). Der Weg führt jetzt über den Proxy und
    // src/katalog/bilder/bildbedarfLauf.ts — geprüft wird deshalb der MERKER selbst, nicht mehr
    // die Liste.
    await besuch();
    assert.equal(versuche, 0, `${versuche} Downloads aus der Liste — sie darf keine mehr auslösen`);

    await t.test('ein anderer Prozess weiss davon', async () => {
      // Der Kern der Sache: Der Server läuft im Cluster. Ein Merker im
      // Arbeitsspeicher hilft nur DEM Prozess, der ihn angelegt hat — bei vier
      // Arbeitsprozessen wird dasselbe Bild viermal geholt.
      const IM = _req('src/katalog/bilder/imageMisses.js');
      IM.merkeFehlend('set:' + PRAEFIX + '_probe');
      await IM._schreibePuffer();
      IM._leereVordergrund();
      assert.equal(
        IM.istBekanntFehlend('set:' + PRAEFIX + '_probe'),
        false,
        'Vorbedingung: der Arbeitsspeicher ist leer',
      );
      await IM._auffrischen();
      assert.equal(
        IM.istBekanntFehlend('set:' + PRAEFIX + '_probe'),
        true,
        'Ohne die Tabelle ist das Wissen nach einem Neustart weg — dann sucht ' + 'jeder Arbeitsprozess von vorn',
      );
    });

    await t.test('ein Bild, das es gibt, wird nicht gemerkt', async () => {
      // Gegenrichtung: Sonst wäre der Test auch grün, wenn pauschal alles als
      // fehlend gälte — und kein Bild würde je geladen.
      const IM = _req('src/katalog/bilder/imageMisses.js');
      IM._leereVordergrund();
      assert.equal(IM.istBekanntFehlend('set:gibt-es-nicht-in-der-tabelle'), false);
    });
  } finally {
    await db.run(`DELETE FROM rb_sets WHERE set_num LIKE $1`, [PRAEFIX + '%']).catch(() => {});
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + PRAEFIX + '%']).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
