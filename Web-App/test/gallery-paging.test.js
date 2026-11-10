/**
 * Seitenweise Listen am Server, an den Routen gegen die Datenbank:
 * Sortier-Whitelist mit Rückfall, gebundener Suchbegriff, Themenliste über
 * den ganzen Bestand nur auf Seite 1, Zähler über Gruppen, ohne page_size
 * alles. Das Verhalten der Oberfläche prüft test/listen-paging-oberflaeche.test.js.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, zurückgenommen):
 *   A  in SET_SORTS qty_asc auf `s.quantity DESC, …` → rot: „nach Anzahl …“
 *   B  ausTabelle(SET_SORTS, …) durch `SET_SORTS[sort] ?? …` ersetzt → rot:
 *      „unbekannte Sortierung …“ (constructor liefert eine Funktion → 500)
 *   C  in getSets `themen: !!page_size && …` durch `themen: !!page_size` →
 *      rot: „die Themenliste …“ (Seite 2 trägt Themen)
 *   D  im Figurenzähler GROUP BY ohne m.source/LOWER(TRIM) durch
 *      `GROUP BY m.set_number, m.fig_number` → rot: „Minifiguren zählen …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { haeltSet, haeltFigur, haeltTeil } = require('./helpers/bestand');

// Fünf Sets: Menge, Thema und Aufnahmezeit so, dass jede Sortierung eine andere Folge ergibt.
const SETS = [
  { nr: '77101-1', name: 'Alpha', theme: 'Burg', menge: 3, vor: 5 },
  { nr: '77102-1', name: "O'Brien 100%", theme: 'Stadt', menge: 1, vor: 4 },
  { nr: '77103-1', name: 'Gamma', theme: 'Burg', menge: 2, vor: 3 },
  { nr: '77104-1', name: 'Delta', theme: 'Weltraum', menge: 1, vor: 2 },
  { nr: '77105-1', name: 'Epsilon', theme: 'Stadt', menge: 3, vor: 1 },
];

test('seitenweise Listen am Server', { concurrency: 1 }, async (t) => {
  const db = await dbOderSkip(t, _req);
  if (!db) return;
  const NAME = `paging_${process.pid}`;
  const nummern = SETS.map(s => s.nr);
  const aufraeumen = async () => {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]);
    await db.run('DELETE FROM set_figuren WHERE set_number = ANY($1)', [nummern]);
    await db.run('DELETE FROM set_catalog WHERE set_number = ANY($1)', [nummern]);
  };
  await aufraeumen();
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  for (const s of SETS) {
    await db.run('INSERT INTO set_catalog (set_number, name, theme) VALUES ($1,$2,$3)', [s.nr, s.name, s.theme]);
    await haeltSet(db, uid, s.nr, s.menge);
    await db.run(`UPDATE sets SET added_at = NOW() - make_interval(days => $3) WHERE user_id = $1 AND set_number = $2`, [uid, s.nr, s.vor]);
  }
  // Dieselbe Figur in zwei Sets und eine zweite: zwei Gruppen.
  await haeltFigur(db, uid, 'fig-0001', { setNumber: '77101-1' });
  await haeltFigur(db, uid, 'FIG-0001 ', { setNumber: '77103-1' });
  await haeltFigur(db, uid, 'fig-0002', { setNumber: '77104-1' });
  for (const nr of ['91001', '91002', '91003']) await haeltTeil(db, uid, nr);
  t.after(async () => { await aufraeumen().catch(() => {}); await db.pool.end().catch(() => {}); });

  const { base } = testServer(_req, { sitzung: { userId: uid }, apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const hole = async (pfad) => {
    const r = await fetch(`${base}/api/v1${pfad}`);
    const b = await r.json();
    assert.equal(r.status, 200, `${pfad}: ${JSON.stringify(b)}`);
    return b;
  };
  const folge = async (abfrage) => (await hole(`/sets?${abfrage}`)).sets.map(s => s.name[0]);

  await t.test('nach Anzahl lässt sich in beide Richtungen sortieren, Gleichstand nach Aufnahme', async () => {
    assert.deepEqual(await folge('sort=qty_desc'), ['E', 'A', 'G', 'D', 'O']);
    assert.deepEqual(await folge('sort=qty_asc'), ['D', 'O', 'G', 'E', 'A']);
  });

  await t.test('unbekannte Sortierung fällt auf „zuletzt aufgenommen“', async () => {
    const vorgabe = ['E', 'D', 'G', 'O', 'A'];
    assert.deepEqual(await folge('sort=added_desc'), vorgabe);
    for (const s of ['constructor', '__proto__', 'toString', 'name_asc;DROP TABLE sets', 'x'])
      assert.deepEqual(await folge(`sort=${encodeURIComponent(s)}`), vorgabe, s);
  });

  await t.test('der Suchbegriff ist gebunden, nicht eingesetzt', async () => {
    assert.deepEqual(await folge(`search=${encodeURIComponent("o'brien")}`), ['O']);
    assert.deepEqual(await folge(`search=${encodeURIComponent("' OR 1=1 --")}`), []);
  });

  await t.test('ohne page_size alles, mit page_size Seiten und Gesamtzahl', async () => {
    const alle = await hole('/sets');
    assert.equal(alle.sets.length, 5);
    assert.equal(alle.themes, undefined, 'ohne page_size keine Themenliste');
    const s1 = await hole('/sets?page=1&page_size=2&sort=num_asc');
    const s3 = await hole('/sets?page=3&page_size=2&sort=num_asc');
    assert.deepEqual([s1.sets.map(s => s.set_number), s1.total], [['77101-1', '77102-1'], 5]);
    assert.deepEqual([s3.sets.map(s => s.set_number), s3.total], [['77105-1'], 5]);
  });

  await t.test('die Themenliste kommt über den ganzen Bestand und nur auf Seite 1', async () => {
    const s1 = await hole('/sets?page=1&page_size=1&sort=num_asc');
    assert.deepEqual([...s1.themes].sort(), ['Burg', 'Stadt', 'Weltraum'], 'Themen der übrigen Seiten fehlen');
    const s2 = await hole('/sets?page=2&page_size=1&sort=num_asc');
    assert.ok(!s2.themes?.length, `Folgeseite trägt Themen: ${s2.themes}`);
  });

  await t.test('Minifiguren zählen je Figur, nicht je Set, und laden seitenweise', async () => {
    const alle = await hole('/minifigs');
    assert.equal(alle.figs.length, 2, JSON.stringify(alle.figs.map(f => f.fig_number)));
    const s1 = await hole('/minifigs?page=1&page_size=1');
    const s2 = await hole('/minifigs?page=2&page_size=1');
    assert.deepEqual([s1.figs.length, s1.total, s2.figs.length, s2.total], [1, 2, 1, 2]);
    assert.notEqual(s1.figs[0].fig_number.toLowerCase().trim(), s2.figs[0].fig_number.toLowerCase().trim());
  });

  await t.test('auch die manuellen Teile laden seitenweise', async () => {
    const s1 = await hole('/parts/manual?page=1&page_size=2');
    const s2 = await hole('/parts/manual?page=2&page_size=2');
    assert.equal(s1.parts.length, 2);
    assert.equal(s2.parts.length, 1);
    assert.deepEqual([...s1.parts, ...s2.parts].map(p => p.part_number).sort(), ['91001', '91002', '91003']);
  });
});
