/**
 * Adding a set: check and create in one step, without network in the
 * request; catalog, image and market price are fetched by the job „nacharbeit/ergaenzen“.
 *
 * Counter-checks (measured 09.11.2026, each on its own):
 *   A  the call repo.addLockSet() removed in setErfassen() → red:
 *      “added concurrently, created exactly once” (8 instead of 1 'added')
 *   B  in setErfassen() `await setAngaben(sn)` inserted before creating → red:
 *      “the request asks no network …” (network calls 1 instead of 0)
 *   C  placeJobOne() left out in setErfassen() → red: “… and enqueues the job”
 *   D  in setSupplement() the loop over the acquisitions without a price removed →
 *      red: “the job completes catalog and purchase price” (price null)
 *   E  (10.11.) in rememberCatalogPlaceholder() (src/catalog/repository/setMaster.ts) the
 *      INSERT INTO rb_sets removed → red:
 *      all three parts (set_catalog_rb_sets_fkey; the route answers 409 instead of 200)
 *   F  (10.11.) in rememberSetCatalog() `WHERE rb_sets.herkunft = 'api'` to 'csv' →
 *      red: “the job completes …” (name „Set …“ instead of „Testset“)
 *
 * Rebrickable, BrickLink, Brickset and the image fetch are set up at the wiring
 * (testSources, testImageWorker) and count every network call. The code asks in the account
 * (asAccount, route via testServer) as the runtime role; test data via the owner role.
 *   B' (13.11.) B repeated via the set-up sources → red: “the request asks
 *      no network …” (name „Testset“ already in the request) and “the job …”
 *   G  (13.11.) in setAngaben() (rebrickableCatalog.ts) again the imported holeSet
 *      instead of quellen(k) → red: “the job completes …” (no network call counted)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testSources, testImageWorker, asAccount } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

test('add a set without network and without a race', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  // Every source in the network set up and counted.
  const netz = [];
  testSources(t, {
    holeSet: async sn => {
      netz.push(`rebrickable ${sn}`);
      return { set_num: sn, name: 'Testset', year: 2020, theme_id: 990001, num_parts: 10, set_img_url: null };
    },
    getThemeName: async () => 'Test',
    setDetails: async () => null,
    bricklinkRequest: async (_m, pfad) => {
      netz.push(`preis ${pfad.split('/')[3]}`);
      return { avg_price: '42', qty_avg_price: '42', currency_code: 'EUR' };
    },
  });
  testImageWorker(t, {
    loadSetImage: async (_u, sn) => {
      netz.push(`bild ${sn}`);
      return null;
    },
  });
  const sets = require('./helpers/sources').areaPage('sets');
  const P = process.pid % 100000;
  const MAIN = `erf-haupt-${P}`,
    KIND = `erf-kind-${P}`;
  const SN = `${70000 + (P % 9000)}-1`,
    SN2 = `${80000 + (P % 9000)}-1`;
  const weg = async () => {
    for (const sn of [SN, SN2]) {
      await db.run('DELETE FROM set_acquisitions WHERE set_number = $1', [sn]);
      await db.run('DELETE FROM sets WHERE set_number = $1', [sn]);
      await db.run('DELETE FROM rb_sets WHERE set_num = $1', [sn]);
      await db.run("DELETE FROM jobs WHERE type = 'nacharbeit' AND payload->>'set_number' = $1", [sn]);
    }
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[MAIN, KIND]]);
  };
  await weg();
  // Without BrickLink access the price run did not ask at all; the fetch itself is set up.
  await _req('src/settings/settings.js').setGlobalSetting('bricklink_consumer_key', 'test');
  await db.run("INSERT INTO rb_themes (id, name) VALUES (990001, 'Test') ON CONFLICT (id) DO NOTHING");
  const neu = async n =>
    (await db.get("INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id", [n])).id;
  const haupt = await neu(MAIN),
    kind = await neu(KIND);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [haupt, kind]);
  t.after(async () => {
    await weg().catch(() => {});
    await db.run("DELETE FROM global_settings WHERE key = 'bricklink_consumer_key'").catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await t.test('added concurrently, created exactly once', async () => {
    // The main account sees both accounts; it creates partly for itself, partly for the child.
    const fuer = [haupt, kind, haupt, kind, haupt, kind, haupt, kind];
    const r = await Promise.all(
      fuer.map(b =>
        asAccount(haupt, () => sets.acquireSet({ requester: haupt, ownerWish: b, setNumber: SN, kaufpreis: null })),
      ),
    );
    assert.equal(r.filter(x => x.action === 'added').length, 1, JSON.stringify(r.map(x => x.action)));
    const zeilen = await db.all('SELECT user_id FROM sets WHERE set_number = $1', [SN]);
    assert.equal(zeilen.length, 1, 'Das Set steht mehrfach im Haushalt');
    const erf = await db.all('SELECT quantity, purchase_price FROM set_acquisitions WHERE set_number = $1', [SN]);
    assert.deepEqual(
      erf.map(z => [z.quantity, z.purchase_price]),
      [[1, null]],
      'genau eine Erfassung, noch ohne Preis',
    );
  });

  await t.test('the request asks no network and enqueues the job', async () => {
    netz.length = 0;
    const { base } = testServer(_req, { sitzung: { userId: haupt }, t });
    const r = await fetch(`${base}/api/v1/sets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ set_number: SN2, condition: 'U' }),
    });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.deepEqual(
      {
        action: j.action,
        set_number: j.set_number,
        name: j.name,
        katalog_offen: j.katalog_offen,
        ergaenzung: j.ergaenzung,
      },
      { action: 'added', set_number: SN2, name: `Set ${SN2}`, katalog_offen: true, ergaenzung: 'ausstehend' },
    );
    assert.deepEqual(netz, [], 'Netzaufrufe in der Anfrage');
    // rb_sets does not know the set: the capture creates it as 'api', including the set_catalog row.
    assert.deepEqual(
      await db.get(
        `SELECT r.name, r.source, (c.set_number IS NOT NULL) AS katalog
                      FROM rb_sets r LEFT JOIN set_catalog c ON c.set_number = r.set_num WHERE r.set_num = $1`,
        [SN2],
      ),
      { name: `Set ${SN2}`, source: 'api', katalog: true },
    );
    const a = await db.get(
      "SELECT payload, dedupe_key FROM jobs WHERE type = 'nacharbeit' AND payload->>'set_number' = $1",
      [SN2],
    );
    assert.ok(a, 'kein Auftrag eingestellt');
    assert.equal(a.payload.art, 'ergaenzen');
    assert.equal(a.dedupe_key, `nacharbeit:${haupt}:${SN2}`);
  });

  await t.test('the job completes catalog and purchase price', async () => {
    netz.length = 0;
    await asAccount(haupt, () => sets.setSupplement(SN2, haupt));
    const kat = await db.get(
      `SELECT r.name, r.year, t.name AS thema, r.source FROM rb_sets r
                                LEFT JOIN rb_themes t ON t.id = r.theme_id WHERE r.set_num = $1`,
      [SN2],
    );
    assert.deepEqual(kat, { name: 'Testset', year: 2020, thema: 'Test', source: 'api' });
    // The collection reads name, year and theme via rb_sets.
    const liste = await _req('src/sets/repository/sets.js').setList(db, [haupt], { seite: null, themen: false });
    const z = liste.sets.find(x => x.set_number === SN2);
    assert.deepEqual({ name: z.name, year: z.year, theme: z.theme }, { name: 'Testset', year: 2020, theme: 'Test' });
    const erf = await db.get(
      'SELECT purchase_price, price_estimated, condition FROM set_acquisitions WHERE user_id = $1 AND set_number = $2',
      [haupt, SN2],
    );
    assert.deepEqual(
      { preis: Number(erf.purchase_price), geschaetzt: erf.price_estimated, zustand: erf.condition },
      { preis: 42, geschaetzt: true, zustand: 'U' },
    );
    assert.ok(netz.includes(`rebrickable ${SN2}`) && netz.includes(`preis ${SN2}`), JSON.stringify(netz));
    // A second run does not ask the catalog again: stream and job do not interfere.
    netz.length = 0;
    await asAccount(haupt, () => sets.setSupplement(SN2, haupt));
    assert.equal(netz.filter(x => x.startsWith('preis')).length, 0, 'der Preis wurde doppelt geholt');
  });
});
