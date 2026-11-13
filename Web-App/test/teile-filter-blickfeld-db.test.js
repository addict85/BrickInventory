/**
 * Farbfilter und Kategoriefilter zaehlen dasselbe Blickfeld.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { haeltSet, haeltTeil } = require('./helpers/bestand');
const db = testDaten();

test.after(async () => {
  await db.pool.end().catch(() => {});
});

test('Farb- und Kategorienliste sehen im Haushalt denselben Bestand', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;

  const hauptName = `tfhaupt-${process.pid}`,
    kindName = `tfkind-${process.pid}`;
  for (const n of [hauptName, kindName]) await db.run('DELETE FROM users WHERE username = $1', [n]).catch(() => {});
  const haupt = (
    await db.get('INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id', [hauptName, 'x'])
  ).id;
  const kind = (
    await db.get('INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id', [kindName, 'x'])
  ).id;

  try {
    await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [haupt, kind]);

    // Das Set traegt die Teile — beide Listen schliessen `source='manual'` aus.
    await haeltSet(db, haupt, '0001-1', 1);
    await haeltSet(db, kind, '0002-1', 1);
    // Je Konto ein Teil, VERSCHIEDENE Farben: Waere die Farbe gleich, faenden
    // beide Zaehlungen zufaellig dieselbe Zahl und der Test pruefte nichts.
    // Name, Farbbezeichnung und Kategorie stehen seit Migration 0034 in den
    // Katalogen — und sie sind hier der Kern der Sache: Beide Listen dieses …
    await db.run(`INSERT INTO part_catalog (part_number, part_name, category_name) VALUES
        ('3001','Brick 2x4','Bricks'), ('3002','Plate 1x2','Plates')
        ON CONFLICT (part_number) DO UPDATE SET category_name = EXCLUDED.category_name`);
    await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name) VALUES
        ('3001',4,'Red'), ('3002',1,'Blue')
        ON CONFLICT (part_number, color_id) DO UPDATE SET color_name = EXCLUDED.color_name`);
    await haeltTeil(db, haupt, '3001', { setNumber: '0001-1', menge: 2, colorId: 4 });
    await haeltTeil(db, kind, '3002', { setNumber: '0002-1', menge: 5, colorId: 1 });

    const { base } = testServer(_req, {
      sitzung: { userId: haupt },
      apiNutzer: { user_id: haupt, is_admin: 0 },
      routen: { '/api/v1': 'routes/api_v1/index.js' },
      t,
    });
    const hole = async pfad => (await fetch(base + pfad)).json();

    for (const modus of ['all', 'own']) {
      const farben = await hole(`/api/v1/parts/colors?accounts=${modus}`);
      const kats = await hole(`/api/v1/parts/categories?accounts=${modus}`);
      assert.ok(farben.success, `Farben (${modus}): ${JSON.stringify(farben)}`);
      assert.ok(kats.success, `Kategorien (${modus}): ${JSON.stringify(kats)}`);

      const summe = (l, f) => l.reduce((a, x) => a + Number(x[f] || 0), 0);
      assert.equal(
        summe(kats.categories, 'unique_parts'),
        summe(farben.colors, 'unique_parts'),
        `${modus}: Farb- und Kategorienliste zaehlen verschieden viele Teile — ` +
          `sie lesen dann verschiedene Blickfelder.\n` +
          `Farben: ${JSON.stringify(farben.colors)}\n` +
          `Kategorien: ${JSON.stringify(kats.categories)}`,
      );
    }

    // Und der Unterschied zwischen den Modi muss ueberhaupt da sein — sonst
    // waere die Gleichheit oben zweimal dieselbe Aussage.
    const alle = await hole('/api/v1/parts/categories?accounts=all');
    const eigen = await hole('/api/v1/parts/categories?accounts=own');
    assert.ok(
      alle.categories.length > eigen.categories.length,
      'Mit dem Haushalt muessen mehr Kategorien da sein als ohne — sonst greift ' +
        '`accounts` gar nicht und der Vergleich darueber ist wertlos',
    );
  } finally {
    await db.run('DELETE FROM parts WHERE user_id = ANY($1)', [[haupt, kind]]).catch(() => {});
    await db.run('DELETE FROM sets WHERE user_id = ANY($1)', [[haupt, kind]]).catch(() => {});
    await db.run('DELETE FROM account_links WHERE main_user_id = $1', [haupt]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[haupt, kind]]).catch(() => {});
  }
});
