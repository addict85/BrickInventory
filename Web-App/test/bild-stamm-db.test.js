/**
 * Fehlt eine lokale Bilddatei, findet der Server die CDN-Adresse über den
 * Dateinamen-Stamm — mit einem Index je Bildtabelle (Migration 0067) statt
 * LIKE '%/stamm.%' über sechs Tabellen, das keinen Index nutzen konnte und an
 * drei Tabellen ohne image_local mit einem Fehler endete.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  in der Abfrage wieder `image_local LIKE '%/' || $1 || '.%'` statt
 *      bild_stamm(image_local) = $1 → rot: „jede Bildtabelle fragt über ihren
 *      Index“ (die Teilindizes werden nur durchlaufen, keine Index Cond)
 *   B  bildStammAusPfad lässt _thumb stehen → rot: „eine fehlende Vorschau
 *      findet die Adresse des Teilebilds“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { katalogSet } = require('./helpers/bestand');
const { datenOderSkip } = require('./helpers/db');
const db = testDaten();

test('Bildadresse über den Dateinamen-Stamm', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const { cdnFuerFehlendesBild, CDN_ABFRAGE } = _req('src/bilder/bildNachschlagen.js');
  const P = `bst${process.pid}`;
  await db.run(
    `INSERT INTO part_color_catalog (part_number, color_id, image_url, image_local)
                VALUES ($1, 4, 'https://cdn.rebrickable.com/media/parts/x.png', $2)`,
    [P, `/images/parts/${P}_4.png`],
  );
  await db.run(
    `INSERT INTO minifigs_catalog (fig_number, image_url, image_local) VALUES ($1, 'https://cdn.rebrickable.com/f.jpg', $2)`,
    [`fig-${P}`, `/images/minifigs/fig-${P}.jpg`],
  );
  await katalogSet(db, `${P}-1`, {
    name: 'Test',
    image_url: 'https://img.bricklink.com/s.png',
    image_local: `/images/sets/${P}-1.png`,
  });

  try {
    await t.test('eine fehlende Vorschau findet die Adresse des Teilebilds', async () => {
      assert.equal(
        await cdnFuerFehlendesBild(`/images/parts/${P}_4_thumb.jpg`),
        'https://cdn.rebrickable.com/media/parts/x.png',
      );
    });
    await t.test('Figuren und Sets', async () => {
      assert.equal(await cdnFuerFehlendesBild(`/images/minifigs/fig-${P}.jpg`), 'https://cdn.rebrickable.com/f.jpg');
      assert.equal(await cdnFuerFehlendesBild(`/images/sets/${P}-1.png`), 'https://img.bricklink.com/s.png');
      assert.equal(await cdnFuerFehlendesBild(`/images/sets/${P}-9.png`), null);
    });
    await t.test('jede Bildtabelle fragt über ihren Index', async () => {
      const plan = await db.transaction(async tx => {
        await tx.run('SET LOCAL enable_seqscan = off');
        return (await tx.all(`EXPLAIN ${CDN_ABFRAGE.replaceAll('$1', `'${P}_4'`)}`))
          .map(z => z['QUERY PLAN'])
          .join('\n');
      });
      // set_minifigs_catalog ist seit Migration 0072 eine Sicht auf minifigs_catalog.
      for (const ix of [
        'idx_part_color_catalog_bild_stamm',
        'idx_minifigs_catalog_bild_stamm',
        'idx_set_catalog_bild_stamm',
      ])
        assert.ok(plan.includes(ix), `${ix} fehlt im Plan:\n${plan}`);
      // Nicht nur durchlaufen, sondern über den Stamm gesucht: Ohne Suchschlüssel
      // läse der Planer bei abgeschaltetem Seq Scan den Teilindex ganz.
      const gesucht = plan.match(/Index Cond: \(regexp_replace\(regexp_replace\(image_local/g) || [];
      assert.equal(gesucht.length, 3, `nicht jede Tabelle sucht über den Stamm:\n${plan}`);
    });
  } finally {
    await db.run('DELETE FROM part_color_catalog WHERE part_number=$1', [P]);
    await db.run('DELETE FROM minifigs_catalog WHERE fig_number=$1', [`fig-${P}`]);
    await db.run('DELETE FROM set_catalog WHERE set_number=$1', [`${P}-1`]);
    await db.pool.end().catch(() => {});
  }
});
