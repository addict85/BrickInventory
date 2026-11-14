/**
 * Eigene Katalogangaben (Name, Farbname, Farbcode, Kategorie, Bild) sieht nur
 * das Konto, das sie eingetippt hat, und wer dessen Bestand sieht (Haushalt).
 * Geprüft über die echten Routen mit zwei unverbundenen Konten und einem
 * Haushalt: Listen der Teile und Figuren, manuelle Listen und der CSV-Export.
 *
 * Gegenproben (am 03.11.2026 gemessen, je eine Änderung, danach zurück):
 *   A  merkeTeil()/merkeTeilFarbe()/merkeFigur() ohne den Zweig für `von`
 *      (Eingaben wieder in den gemeinsamen Katalog) → rot: alle Teiltests
 *      ausser „Alice sieht ihre eigenen Angaben“
 *   B  in db/katalogSicht.ts teil_eigen ohne `te.user_id = konto` verbunden
 *      → rot: „Bob sieht Alices Eingaben …“, „jedes Konto behält …“ und
 *      beide Haushalt-Tests
 *   C  TEIL.name mit der eigenen Angabe vor dem geprüften Wert → rot: „der
 *      geprüfte Name hat Vorrang …“
 *
 * REQUIRE_DB=1.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten, testQuellen } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testDaten();

// Kein Netz: Rebrickable kennt nur 3003 (an der Verdrahtung gestellt, testQuellen).
testQuellen(null, {
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

test('eigene Katalogangaben bleiben beim Konto und seinem Haushalt', { concurrency: 1 }, async t => {
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
  const { buildPartsCsv, buildFigsCsv } = _req('src/bestand/bestandExport.js');

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

  await t.test('Alice sieht ihre eigenen Angaben', async () => {
    const l = await listen(A);
    for (const s of ['Alices Prototyp', 'Tresorrot', 'AB1234', 'Privat', 'media/alice.jpg', 'Geheimfigur'])
      assert.ok(l.includes(s), `Alices Liste ohne ${s}`);
    const csv = await buildPartsCsv(alice);
    assert.match(csv, /geheim-77,1,4,Tresorrot/);
  });

  await t.test('Bob sieht Alices Eingaben in keiner Liste und keinem Export', async () => {
    const l = (await listen(B)) + (await buildPartsCsv(bob)) + (await buildFigsCsv(bob));
    assert.ok(l.includes('geheim-77') && l.includes('fig-000001'), 'Testdaten: Bob führt beide Nummern');
    for (const s of ALICE) assert.ok(!l.includes(s), `Bob sieht ${s}`);
  });

  await t.test('der geprüfte Name hat Vorrang vor einer Eingabe', async () => {
    for (const X of [A, C]) {
      const m = (await X('GET', '/parts/manual')).parts.find(p => p.part_number === '3003');
      assert.equal(m?.part_name, 'Brick 2 x 2');
    }
    assert.ok(!(await listen(C)).includes('Gefälscht'), 'Carol sieht Alices Text');
  });

  await t.test('jedes Konto behält seinen eigenen Namen für dieselbe Nummer', async () => {
    await A('POST', '/parts', { part_number: 'privat-9', color_id: 1, quantity: 1, part_name: 'Alices Name' });
    await B('POST', '/parts', { part_number: 'privat-9', color_id: 1, quantity: 1, part_name: 'Bobs Name' });
    const name = async X => (await X('GET', '/parts/manual')).parts.find(p => p.part_number === 'privat-9')?.part_name;
    assert.equal(await name(A), 'Alices Name');
    assert.equal(await name(B), 'Bobs Name');
  });

  await t.test('Haushalt: das Hauptkonto sieht die Angaben des Unterkontos', async () => {
    await K('POST', '/parts', { part_number: 'haus-1', color_id: 1, quantity: 1, part_name: 'Kinds Name' });
    await B('POST', '/parts', { part_number: 'haus-1', color_id: 1, quantity: 1 });
    const zeilen = (await C('GET', '/parts/manual')).parts.filter(p => p.part_number === 'haus-1');
    assert.deepEqual(
      zeilen.map(p => [p.user_id, p.part_name]),
      [[kind, 'Kinds Name']],
    );
    assert.ok(!(await listen(B)).includes('Kinds Name'), 'Bob sieht den Namen des Unterkontos');
  });

  await t.test('Haushalt: das Unterkonto sieht die Angaben des Hauptkontos nicht', async () => {
    await C('POST', '/parts', { part_number: 'haus-2', color_id: 1, quantity: 1, part_name: 'Carols Name' });
    await K('POST', '/parts', { part_number: 'haus-2', color_id: 1, quantity: 1 });
    const l = await listen(K);
    assert.ok(l.includes('haus-2'), 'Testdaten: das Unterkonto führt haus-2');
    assert.ok(!l.includes('Carols Name'), 'das Unterkonto sieht die Angaben des Hauptkontos nicht');
  });
});
