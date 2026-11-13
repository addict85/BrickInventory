/**
 * Freitextsuche: `%` und `_` in der Eingabe gelten wörtlich (db/likeSuche.ts).
 * Sonst fände `%` jeden Eintrag und `_` jedes einzelne Zeichen.
 *
 * Gegenproben (am 03.11.2026 gemessen, je einzeln):
 *   A  likeWoertlich() gibt den Text unverändert zurück → rot: alle vier
 *      Teiltests (jede Liste lieferte beide Einträge)
 *   B  LIKE_ESCAPE mit `!` statt `\` (Maske und ESCAPE passen nicht) → rot:
 *      alle vier Teiltests
 *
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { haeltSet, haeltTeil, haeltFigur, katalogSet } = require('./helpers/bestand');
const db = testDaten();

test.after(async () => {
  await db.pool.end().catch(() => {});
});

test('Suche mit % und _ findet nur wörtliche Treffer', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  const NAME = `like_${process.pid}`;
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [NAME])).id;
  t.after(() => db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {}));

  await haeltTeil(db, uid, 'pr%z', { colorId: 1, menge: 1 });
  await haeltTeil(db, uid, 'przz', { colorId: 1, menge: 1 });
  await haeltFigur(db, uid, 'fig_9', { menge: 1 });
  await haeltFigur(db, uid, 'figx9', { menge: 1 });
  await db.run(`INSERT INTO rb_sets (set_num, name, year) VALUES ('77701-1', '100% Stein', 2020), ('77702-1', 'Ganz Stein', 2020)
                ON CONFLICT (set_num) DO NOTHING`);
  await katalogSet(db, '77701-1', { name: '100% Stein' });
  await katalogSet(db, '77702-1', { name: 'Ganz Stein' });
  await haeltSet(db, uid, '77701-1', 1);
  await haeltSet(db, uid, '77702-1', 1);

  const { base } = testServer(_req, {
    sitzung: { userId: uid },
    apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const hole = async pfad => {
    const r = await fetch(base + '/api/v1' + pfad);
    const j = await r.json();
    assert.equal(r.status, 200, `${pfad}: ${JSON.stringify(j)}`);
    return j;
  };

  await t.test('Teile', async () => {
    const r = await hole('/parts/manual?search=' + encodeURIComponent('%'));
    assert.deepEqual(
      r.parts.map(p => p.part_number),
      ['pr%z'],
    );
    const l = await hole('/parts?page=1&page_size=50&search=' + encodeURIComponent('r%'));
    assert.deepEqual(
      l.parts.map(p => p.part_number),
      ['pr%z'],
    );
  });

  await t.test('Figuren', async () => {
    const r = await hole('/minifigs/manual?search=' + encodeURIComponent('_'));
    assert.deepEqual(
      r.figs.map(f => f.fig_number),
      ['fig_9'],
    );
    const l = await hole('/minifigs?search=' + encodeURIComponent('g_'));
    assert.deepEqual(
      l.figs.map(f => f.fig_number),
      ['fig_9'],
    );
  });

  await t.test('Sets', async () => {
    const r = await hole('/sets?search=' + encodeURIComponent('%'));
    assert.deepEqual(
      r.sets.map(s => s.set_number),
      ['77701-1'],
    );
  });

  await t.test('Katalog', async () => {
    const r = await hole('/catalog/sets?q=' + encodeURIComponent('0%'));
    assert.deepEqual(
      r.sets.map(s => s.set_num ?? s.set_number),
      ['77701-1'],
    );
  });
});
