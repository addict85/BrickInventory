/**
 * Own catalog details (name, color name, color code, category, image) are seen only by
 * the account that typed them and by whoever sees its stock (household).
 * Checked via the real routes with two unlinked accounts and a
 * household: lists of parts and minifigures, manual lists and the CSV export.
 *
 * Counter-checks (measured on 03.11.2026, one change each, reverted afterwards):
 *   A  rememberPart()/rememberPartColor()/rememberMinifig() without the branch for `von`
 *      (input into the shared catalog again) → red: all subtests
 *      except “Alice sees her own details”
 *   B  in db/catalogView.ts part_custom joined without `te.user_id = konto`
 *      → red: “Bob sees Alice's input …”, “every account keeps …” and
 *      both household tests
 *   C  TEIL.name with the own detail before the verified value → red: “the
 *      verified name takes precedence …”
 *
 * REQUIRE_DB=1.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testSources } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();

// No network: Rebrickable only knows 3003 (provided at the wiring, testSources).
testSources(null, {
  lookupPart: async nr =>
    nr === '3003'
      ? {
          part_name: 'Brick 2 x 2',
          category_name: 'Bricks',
          image_url: 'https://cdn.rebrickable.com/media/parts/3003.jpg',
        }
      : null,
  getMinifigInfo: async () => null,
});

test.after(async () => {
  await db.pool.end().catch(() => {});
});

test('own catalog details stay with the account and its household', { concurrency: 1 }, async t => {
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
  const suffix = process.pid;
  const konto = async n =>
    (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${n}-${suffix}`])).id;
  const alice = await konto('alice'),
    bob = await konto('bob'),
    carol = await konto('carol'),
    kind = await konto('kind');
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [carol, kind]);
  t.after(() => db.run('DELETE FROM users WHERE id = ANY($1)', [[alice, bob, carol, kind]]).catch(() => {}));

  const api = uid => {
    const { base } = testServer(_req, { sitzung: { userId: uid }, t });
    return async (methode, pfad, body) => {
      const r = await fetch(base + '/api/v1' + pfad, {
        method: methode,
        ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      const j = await r.json();
      assert.equal(r.status, 200, `${methode} ${pfad}: ${JSON.stringify(j)}`);
      return j;
    };
  };
  const A = api(alice),
    B = api(bob),
    C = api(carol),
    K = api(kind);
  const { partsCsv, minifigsCsv } = _req('src/inventory/inventoryExport.js');

  const ALICE = ['Alices Prototyp', 'Tresorrot', 'AB1234', 'Privat', 'media/alice.jpg', 'Geheimfigur', 'Gefälscht'];
  await A('POST', '/parts', {
    part_number: 'geheim-77',
    color_id: 4,
    quantity: 1,
    part_name: 'Alices Prototyp',
    color_name: 'Tresorrot',
    color_hex: 'AB1234',
    category_name: 'Privat',
    image_url: 'https://cdn.rebrickable.com/media/alice.jpg',
  });
  await A('POST', '/parts', {
    part_number: '3003',
    color_id: 4,
    quantity: 1,
    part_name: 'Gefälscht: Passwort an evil@example.com',
  });
  await A('POST', '/minifigs', { fig_number: 'fig-000001', quantity: 1, fig_name: 'Geheimfigur' });
  await B('POST', '/parts', { part_number: 'geheim-77', color_id: 4, quantity: 1 });
  await B('POST', '/minifigs', { fig_number: 'fig-000001', quantity: 1 });
  await C('POST', '/parts', { part_number: '3003', color_id: 4, quantity: 1 });

  const listen = async X =>
    JSON.stringify([
      await X('GET', '/parts?page=1&page_size=50'),
      await X('GET', '/parts/manual'),
      await X('GET', '/minifigs'),
      await X('GET', '/minifigs/manual'),
    ]);

  await t.test('Alice sees her own details', async () => {
    const l = await listen(A);
    for (const s of ['Alices Prototyp', 'Tresorrot', 'AB1234', 'Privat', 'media/alice.jpg', 'Geheimfigur'])
      assert.ok(l.includes(s), `Alices Liste ohne ${s}`);
    const csv = await partsCsv(alice);
    assert.match(csv, /geheim-77,1,4,Tresorrot/);
  });

  await t.test("Bob sees Alice's inputs in no list and no export", async () => {
    const l = (await listen(B)) + (await partsCsv(bob)) + (await minifigsCsv(bob));
    assert.ok(l.includes('geheim-77') && l.includes('fig-000001'), 'Testdaten: Bob führt beide Nummern');
    for (const s of ALICE) assert.ok(!l.includes(s), `Bob sieht ${s}`);
  });

  await t.test('the verified name takes precedence over an input', async () => {
    for (const X of [A, C]) {
      const m = (await X('GET', '/parts/manual')).parts.find(p => p.part_number === '3003');
      assert.equal(m?.part_name, 'Brick 2 x 2');
    }
    assert.ok(!(await listen(C)).includes('Gefälscht'), 'Carol sieht Alices Text');
  });

  await t.test('every account keeps its own name for the same number', async () => {
    await A('POST', '/parts', { part_number: 'privat-9', color_id: 1, quantity: 1, part_name: 'Alices Name' });
    await B('POST', '/parts', { part_number: 'privat-9', color_id: 1, quantity: 1, part_name: 'Bobs Name' });
    const name = async X => (await X('GET', '/parts/manual')).parts.find(p => p.part_number === 'privat-9')?.part_name;
    assert.equal(await name(A), 'Alices Name');
    assert.equal(await name(B), 'Bobs Name');
  });

  await t.test("household: the main account sees the sub-account's details", async () => {
    await K('POST', '/parts', { part_number: 'haus-1', color_id: 1, quantity: 1, part_name: 'Kinds Name' });
    await B('POST', '/parts', { part_number: 'haus-1', color_id: 1, quantity: 1 });
    const zeilen = (await C('GET', '/parts/manual')).parts.filter(p => p.part_number === 'haus-1');
    assert.deepEqual(
      zeilen.map(p => [p.user_id, p.part_name]),
      [[kind, 'Kinds Name']],
    );
    assert.ok(!(await listen(B)).includes('Kinds Name'), 'Bob sieht den Namen des Unterkontos');
  });

  await t.test("household: the sub-account does not see the main account's details", async () => {
    await C('POST', '/parts', { part_number: 'haus-2', color_id: 1, quantity: 1, part_name: 'Carols Name' });
    await K('POST', '/parts', { part_number: 'haus-2', color_id: 1, quantity: 1 });
    const l = await listen(K);
    assert.ok(l.includes('haus-2'), 'Testdaten: das Unterkonto führt haus-2');
    assert.ok(!l.includes('Carols Name'), 'das Unterkonto sieht die Angaben des Hauptkontos nicht');
  });
});
