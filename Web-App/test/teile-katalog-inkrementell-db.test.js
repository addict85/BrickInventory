/**
 * Eine Katalogänderung zieht in der Teile-Zusammenfassung nur die Gruppen
 * nach, die die geänderte Nummer enthalten, und nur in den Konten, die sie
 * führen (Migration 0079, zieheKatalogNach). Das Ergebnis gleicht einem
 * vollen Neuaufbau.
 *
 * Nachweis „nicht neu gebaut“: Eine Marke in der Spalte storage, die nur ein
 * Neuaufbau überschreibt, bleibt in fremden Konten und fremden Gruppen stehen.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in zieheKatalogNach() statt der Gruppen das ganze Konto gelöscht und
 *      neu gebaut (`nurGruppen` false, DELETE ohne part_key) → rot: „andere
 *      Gruppen desselben Kontos bleiben stehen“
 *   B  im Trigger merke_teilekatalog_beide() nur `neu` gelesen (die alte
 *      BrickLink-Nummer fehlt) → rot: „eine neue BrickLink-Zuordnung …“
 *      (die Gruppe von W zählt X weiter mit: 3 statt 1)
 *   C  in ensureFresh() den Nachzug weggelassen → rot: „ein geänderter
 *      Teilename …“ (alter Name)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { haeltSet, haeltTeil } = require('./helpers/bestand');

test('Teile-Zusammenfassung: Katalogänderungen je Teil', { concurrency: 1 }, async (t) => {
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const PS = _req('src/teile/partsSummary.js');
  const p = process.pid;
  const X = `kx${p}`, W = `kw${p}`, Z = `kz${p}`, Y = `ky${p}`, SA = `91${p % 1000}-1`, SB = `92${p % 1000}-1`;
  const konto = async (n) => {
    await db.run('DELETE FROM users WHERE username=$1', [n]);
    return (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [n])).id;
  };
  const a = await konto(`katalogA_${p}`), b = await konto(`katalogB_${p}`);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[a, b]]);
    await db.run('DELETE FROM part_catalog WHERE part_number = ANY($1)', [[X, W, Y, Z]]);
    await db.run(`DELETE FROM bl_zuordnung WHERE art = 'part' AND rb_id = ANY($1)`, [[X, W]]);
    await db.run('DELETE FROM set_teile WHERE set_number = ANY($1)', [[SA, SB]]);
    await db.pool.end().catch(() => {});
  });
  await haeltSet(db, a, SA, 1);
  await haeltTeil(db, a, X, { setNumber: SA, menge: 2, colorId: 4 });
  await haeltTeil(db, a, Z, { setNumber: SA, menge: 3, colorId: 4 });
  await haeltSet(db, b, SB, 1);
  await haeltTeil(db, b, Y, { setNumber: SB, menge: 5, colorId: 1 });
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ($1,'X alt'),($2,'Z'),($3,'Y')
                ON CONFLICT (part_number) DO UPDATE SET part_name = EXCLUDED.part_name`, [X, Z, Y]);
  await PS.rebuildNow(a);
  await PS.rebuildNow(b);
  await PS.zieheKatalogNach();   // was der Aufbau schon enthält, aus der Warteschlange räumen

  const zeilen = (uid) => db.all(`SELECT part_key, color_id, part_number, bl_part_number, part_name, total_quantity, in_sets, storage
                                    FROM parts_summary WHERE user_id = $1 ORDER BY part_key, color_id`, [uid]);
  const marke = (uid, teil) => db.run(`UPDATE parts_summary SET storage = 'Marke' WHERE user_id = $1 AND part_number = $2`, [uid, teil]);
  /** Ergebnis jetzt gegen einen vollen Neuaufbau desselben Kontos. */
  const gleichVollemAufbau = async (uid) => {
    const nach = await zeilen(uid);
    await PS.rebuildNow(uid);
    assert.deepEqual(nach, await zeilen(uid), 'Nachzug und voller Neuaufbau ergeben dieselben Zeilen');
  };

  await t.test('ein geänderter Teilename ist ohne Neuaufbau da', async () => {
    await marke(a, Z); await marke(b, Y);
    await db.run(`UPDATE part_catalog SET part_name = 'X neu' WHERE part_number = $1`, [X]);
    assert.equal(await PS.ensureFresh(a, { strict: true }), true);
    assert.equal((await db.get('SELECT part_name FROM parts_summary WHERE user_id=$1 AND part_number=$2', [a, X])).part_name, 'X neu');
  });

  await t.test('andere Konten und andere Gruppen bleiben stehen', async () => {
    assert.equal((await db.get('SELECT storage FROM parts_summary WHERE user_id=$1', [b])).storage, 'Marke', 'Konto B wurde neu gebaut');
    assert.equal((await db.get('SELECT storage FROM parts_summary WHERE user_id=$1 AND part_number=$2', [a, Z])).storage, 'Marke',
      'die Gruppe Z in Konto A wurde neu gebaut');
    await db.run(`UPDATE parts_summary SET storage = NULL WHERE storage = 'Marke' AND user_id = ANY($1)`, [[a, b]]);
    await gleichVollemAufbau(a);
  });

  await t.test('eine neue BrickLink-Zuordnung verschiebt die Gruppe', async () => {
    // W und X teilen sich eine BrickLink-Nummer; die Gruppe heisst nach W.
    await haeltTeil(db, a, W, { setNumber: SA, menge: 1, colorId: 4 });
    await PS.rebuildNow(a);
    await db.run(`INSERT INTO bl_zuordnung (art, rb_id, bl_id) VALUES ('part', $1, $3), ('part', $2, $3)`, [X, W, `${X}bl`]);
    assert.equal(await PS.ensureFresh(a, { strict: true }), true);
    assert.deepEqual((await zeilen(a)).map(z => [z.part_key, z.part_number, Number(z.total_quantity)]),
      [[`${X}bl`, W, 3], [Z, Z, 3]]);
    // X wandert weiter; die Gruppe von W enthält X dann nicht mehr.
    await db.run(`UPDATE bl_zuordnung SET bl_id = $2 WHERE art = 'part' AND rb_id = $1`, [X, `${X}neu`]);
    assert.equal(await PS.ensureFresh(a, { strict: true }), true);
    assert.deepEqual((await zeilen(a)).map(z => [z.part_key, z.part_number, Number(z.total_quantity)]),
      [[`${X}bl`, W, 1], [`${X}neu`, X, 2], [Z, Z, 3]]);
    await gleichVollemAufbau(a);
  });
});
