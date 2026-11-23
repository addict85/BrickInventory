/**
 * The wishlist — against a real database.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const { holdsSet, quantityOf, haltRow, catalogSet } = require('./helpers/inventory');
const db = testData();

const U = {};

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }
  for (const name of ['grandparent', 'grandchild']) {
    await db.run(`INSERT INTO users (username, password_hash) VALUES ($1,'x')`, [name]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
  // A catalog entry so that the LEFT JOIN has something to show — and deliberately
  // ONLY one: the second wishlist item checks the case „set not in the catalog".
  await db.run(
    `INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts, set_img_url)
     VALUES ('75192-1', 'Millennium Falcon', 2017, 158, 7541, 'http://x/75192.jpg')`,
  );
  // The wishlist only reads the image from set_catalog (0108).
  await db.run(`INSERT INTO set_catalog (set_number, image_url) VALUES ('75192-1', 'http://x/75192.jpg')`);
}

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

test('wishlist against a real database', { concurrency: 1 }, async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    noDb(t);
    return;
  }
  await seed();
  const W = _req('src/wanted/wanted.js');

  await t.test('a wishlist item is NOT ownership', async () => {
    const a = await W.addWantedItem(U.grandparent, '75192-1', 'N');
    assert.equal(a.was_new, true);

    // The core statement of the whole change. If the wishlist item stood in `sets`, it would count
    // in the gallery, in the portfolio value and in the finance view —
    // each of these views would from then on need a filter it does not have.
    const inSets = await db.get('SELECT COUNT(*)::int AS n FROM sets WHERE user_id=$1', [U.grandparent]);
    assert.equal(inSets.n, 0, 'The wanted item created a row in `sets`');
  });

  await t.test('the master data comes from the catalog, not from a copy', async () => {
    const [w] = await W.wantedItemsOf([U.grandparent]);
    assert.equal(w.name, 'Millennium Falcon');
    assert.equal(w.year, 2017);
    assert.equal(w.num_parts, 7541);

    // And they are NOT stored along: if the catalog changes the name, the
    // wishlist changes it too. Exactly for that there is no name column in 0021.
    await db.run(`UPDATE rb_sets SET name='Millennium Falcon (UCS)' WHERE set_num='75192-1'`);
    const [later] = await W.wantedItemsOf([U.grandparent]);
    assert.equal(later.name, 'Millennium Falcon (UCS)', 'The name comes from a copy and goes stale');
    await db.run(`UPDATE rb_sets SET name='Millennium Falcon' WHERE set_num='75192-1'`);
  });

  await t.test('a set the catalog does not know shows its number', async () => {
    // The named price for no master data lying here (0021).
    // It should be VISIBLE and not show up as a crash.
    await W.addWantedItem(U.grandparent, '99999-1', 'N');
    const w = (await W.wantedItemsOf([U.grandparent])).find(x => x.set_number === '99999-1');
    assert.ok(w, 'The wanted item is missing entirely — the LEFT JOIN is an INNER JOIN');
    assert.equal(w.name, null);
    assert.equal(w.year, null);
  });

  await t.test('without the Rebrickable catalog name and image come from set_catalog', async () => {
    // Counter-check (28.10.2026): rb.name instead of COALESCE(rb.name, sc.name) → red, name null.
    await catalogSet(db, '10316-1', { name: 'Rivendell', year: 2023, pieces: 6167, image_url: 'http://x/10316.jpg' });
    await W.addWantedItem(U.grandparent, '10316-1', 'N');
    const w = (await W.wantedItemsOf([U.grandparent])).find(x => x.set_number === '10316-1');
    assert.equal(w.name, 'Rivendell');
    assert.equal(w.year, 2023);
    assert.equal(w.num_parts, 6167);
    assert.equal(w.image_url, 'http://x/10316.jpg');
    assert.ok(
      (await W.wantedItemsOf([U.grandparent], undefined, 'EUR', { search: 'riven' })).some(
        x => x.set_number === '10316-1',
      ),
      'The search does not find the name from set_catalog',
    );
    await db.run(`DELETE FROM wanted WHERE set_number = '10316-1'`);
  });

  await t.test('new and used are TWO wishlist items', async () => {
    // Whoever looks for a used one for building and a sealed one for keeping has
    // two wishlist items with two thresholds. Since 0019 price_alerts carries the condition
    // in the key just the same.
    const b = await W.addWantedItem(U.grandparent, '75192-1', 'U');
    assert.equal(b.was_new, true, 'The used wanted item overwrote the new one');
    const bothOnes = (await W.wantedItemsOf([U.grandparent], '75192-1')).map(w => w.condition).sort();
    assert.deepEqual(bothOnes, ['N', 'U']);
  });

  await t.test('adding the same wishlist item twice is not a second entry', async () => {
    const again = await W.addWantedItem(U.grandparent, '75192-1', 'N');
    assert.equal(again.was_new, false, 'war_neu reports a new addition that did not happen');
    const n = await db.get(`SELECT COUNT(*)::int AS n FROM wanted WHERE user_id=$1 AND set_number='75192-1'`, [
      U.grandparent,
    ]);
    assert.equal(n.n, 2, 'N and U — no more');
  });

  await t.test("the grandfather sees the grandchild's wishlist items", async () => {
    // Marco's decision. Here the account tree is not only consistent
    // but the purpose: whoever looks for a gift looks exactly there.
    await W.addWantedItem(U.grandchild, '75192-1', 'N');
    const onlyGrandparent = await W.wantedItemsOf([U.grandparent]);
    assert.ok(
      !onlyGrandparent.some(w => w.user_id === U.grandchild),
      'Without a scope foreign wanted items come along',
    );

    const together = await W.wantedItemsOf([U.grandparent, U.grandchild]);
    const fromGrandchild = together.find(w => w.user_id === U.grandchild);
    assert.ok(fromGrandchild, "The grandchild's wanted item is missing in the shared scope");
    assert.equal(fromGrandchild.set_number, '75192-1');
  });

  await t.test('owned checks the VIEW, not only the own account', async () => {
    // „Do I have that by now?" is the question that comes up in the list
    // immediately. For the grandfather „I have it" also means: the grandchild has it.
    await holdsSet(db, U.grandchild, '75192-1', 1);
    const aloneGrandparent = await W.wantedItemsOf([U.grandparent], '75192-1');
    assert.equal(aloneGrandparent[0].owned, false);
    const inScope = await W.wantedItemsOf([U.grandparent, U.grandchild], '75192-1');
    assert.ok(
      inScope.every(w => w.owned === true),
      'owned only looks at the own account',
    );
    await db.run(`DELETE FROM set_acquisitions WHERE user_id=$1`, [U.grandchild]);
    await db.run(`DELETE FROM sets WHERE user_id=$1`, [U.grandchild]);
  });

  await t.test('deleting hits exactly ONE condition', async () => {
    const route = await W.removeWantedItem(U.grandparent, '75192-1', 'U');
    assert.equal(route, 1);
    const remaining = (await W.wantedItemsOf([U.grandparent], '75192-1')).map(w => w.condition);
    assert.deepEqual(remaining, ['N'], 'Deleting took the other condition along');

    // Deleting twice is no error — the goal is reached.
    assert.equal(await W.removeWantedItem(U.grandparent, '75192-1', 'U'), 0);
  });

  await t.test('the takeover creates the set via acquireSet() — with an entry row', async () => {
    // „Take over directly into the gallery" must be the same as capturing
    // a set number. An own INSERT INTO sets would have neither the
    // acquisition row nor the condition nor the enrichment — and exactly
    // by that one would only notice it in the finance view.
    await W.addWantedItem(U.grandparent, '75192-1', 'N');
    const r = await W.fulfillWantedItem(U.grandparent, U.grandparent, '75192-1', 'N', { quantity: 2 });
    assert.equal(r.action, 'added');

    assert.ok(await haltRow(db, U.grandparent, '75192-1'), 'The set did not land in the gallery');
    // The quantity from the acquisitions (migration 0036).
    assert.equal(await quantityOf(db, U.grandparent, '75192-1'), 2);

    const erf = await db.get(`SELECT COUNT(*)::int AS n FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [
      U.grandparent,
      '75192-1',
    ]);
    assert.equal(erf.n, 1, 'No acquisition row — the takeover does not call acquireSet()');
  });

  await t.test('after the takeover wishlist item AND alert are gone', async () => {
    // Marco's decision on the follow-up question: „Eintrag weg, Alarm auch."
    await W.addWantedItem(U.grandchild, '10276-1', 'U');
    // The second wishlist item for the same set, in the other condition — it is the
    // actual statement below. It used to stand in the note test, which no longer
    // exists since the field was removed (migration 0022).
    await W.addWantedItem(U.grandchild, '10276-1', 'N');
    const P = {
      ..._req('src/finances/priceAlert.js'),
      ...require('./helpers/sources').testArea('finances').priceAlert,
    };
    await P.setAlert(U.grandchild, '10276-1', 'EUR', { direction: 'below', threshold: 249, condition: 'U' });
    assert.equal((await P.alertsFor(U.grandchild, '10276-1')).length, 1, 'setup: alert is missing');

    await W.fulfillWantedItem(U.grandchild, U.grandchild, '10276-1', 'U', {});

    // Exactly the U wishlist item is gone. The N wishlist item for the same set stays
    // — it is a DIFFERENT wishlist item, and exactly for that the condition stands
    // in the key.
    const remaining = (await W.wantedItemsOf([U.grandchild], '10276-1')).map(w => w.condition);
    assert.deepEqual(remaining, ['N'], 'The U wanted item is still there — or the N wanted item was taken along');
    assert.equal((await P.alertsFor(U.grandchild, '10276-1')).length, 0, 'The alert is still there');
  });

  await t.test('taking over a set one already has does NOT top up', async () => {
    // The same rule as when capturing (src/sets/addSet.ts): already in the scope
    // means „open detail", not „increase quantity". It must not depend
    // on which of the four paths somebody comes by.
    const prior = await quantityOf(db, U.grandparent, '75192-1');
    await W.addWantedItem(U.grandparent, '75192-1', 'N');
    const r = await W.fulfillWantedItem(U.grandparent, U.grandparent, '75192-1', 'N', { quantity: 5 });
    assert.equal(r.action, 'exists');
    const later = await quantityOf(db, U.grandparent, '75192-1');
    assert.equal(later, prior, 'The quantity was topped up');
    // The wishlist item is done nevertheless — otherwise it would remain for a set
    // that one has long had.
    assert.equal((await W.wantedItemsOf([U.grandparent], '75192-1')).length, 0);
  });

  await t.test('quantity, purchase price and condition can be set on takeover', async () => {
    // Marco's addendum: „gewisse Inhalte wie zB. Preis und Zustand, Anzahl
    // müssen beim Übernehmen angepasst werden."
    await W.addWantedItem(U.grandparent, '10497-1', 'N');
    await W.fulfillWantedItem(U.grandparent, U.grandparent, '10497-1', 'N', {
      quantity: 3,
      purchase_price: 88.5,
      condition: 'U',
    });

    assert.equal(await quantityOf(db, U.grandparent, '10497-1'), 3, 'The quantity was not taken over');

    // Since migration 0032 purchase price and condition only stand in the acquisition —
    // before, this place checked the price on the sets row.
    const erf = await db.get(
      `SELECT purchase_price, condition FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`,
      [U.grandparent, '10497-1'],
    );
    assert.equal(parseFloat(erf.purchase_price), 88.5, 'The purchase price was not taken over');
    assert.equal(
      erf.condition,
      'U',
      'The acquisition is in the condition of the WANTED ITEM instead of the one that was bought',
    );
  });

  await t.test('the wishlist item disappears by ITS condition, not by the purchased one', async () => {
    // The case that used to be silently wrong: wishlist item „gebraucht", a new one
    // was bought. Then the USED wishlist item must go — that one was
    // fulfilled — and the set goes into the gallery as new.
    await W.addWantedItem(U.grandchild, '21034-1', 'U');
    await W.addWantedItem(U.grandchild, '21034-1', 'N');

    await W.fulfillWantedItem(U.grandchild, U.grandchild, '21034-1', 'U', { condition: 'N' });

    const remaining = (await W.wantedItemsOf([U.grandchild], '21034-1')).map(w => w.condition);
    assert.deepEqual(remaining, ['N'], 'Clearing went by the BOUGHT condition — that hits the wrong wanted item');
  });

  await t.test('the price comparison hangs on the wishlist item, not on the catalog', async () => {
    // The address only needs the set number, not the catalog (that does not know every set).
    //
    // Counter-checks (carried out, result in the commit):
    //   a) `preisvergleich_url: forSet(...)` removed from wantedItemsOf() →
    //      both assertions below turn red.
    //   b) forSet() only called with the number (name left out) → “the
    //      name makes the search usable” turns red.
    // Freshly created: the subtests before delete and take over, the wishlist item
    // from above need not stand here any more.
    await W.addWantedItem(U.grandparent, '75192-1', 'N');
    const [withCatalog] = await W.wantedItemsOf([U.grandparent], '75192-1');
    const url = decodeURIComponent(withCatalog.price_comparison_url || '');
    assert.ok(url.startsWith('http'), 'Without an address the button leads nowhere');
    assert.ok(url.includes('75192'), `The set number is missing in the address: ${url}`);
    assert.ok(
      url.includes('Millennium Falcon'),
      `The name makes the search usable — "LEGO 75192 Millennium Falcon" finds it, ` +
        `the bare number often does not: ${url}`,
    );

    // And the case that so far made the button disappear: a set that does not
    // stand in the catalog at all. The name is missing then — the address is not.
    await W.addWantedItem(U.grandparent, '99999-1', 'N');
    const [withoutCatalog] = await W.wantedItemsOf([U.grandparent], '99999-1');
    assert.equal(withoutCatalog.name, null, 'precondition: the catalogue does not know this set');
    const url2 = decodeURIComponent(withoutCatalog.price_comparison_url || '');
    assert.ok(
      url2.includes('99999'),
      `Exactly here the address must be present — the catalogue returns nothing for this set: ${url2}`,
    );
  });

  await t.test('the image comes locally — and if it is missing, it is ordered', async () => {
    // Marco's two findings in one test:
    //
    // Counter-checks (carried out, result in the commit):
    //   a) rememberUsed() line removed from wantedItemsOf() → „bestellt" red.
    //   b) image_local fixed to null → “the local file wins” red.
    const fs = require('node:fs');
    const path = require('node:path');
    const IQ = _req('src/images/imageDemandRun.js');
    const FOLDER = path.join(__dirname, '..', 'data', 'images', 'sets');

    // TWO set numbers, and that is no coincidence: imageIfPresent() remembers
    // a „does not exist" for ten minutes (src/images/images.ts). Checking the same number
    // first without and then with a file would check the cache instead of the rule.
    const withoutFile = `wlimg${process.pid}a-1`;
    const withFile = `wlimg${process.pid}b-1`;
    const file = path.join(FOLDER, `${withFile}.jpg`);
    // The file BEFORE creating the wishlist item: addWantedItem() reads the list
    // itself once more, and this look would hold on to the „does not exist" for the
    // next ten minutes.
    fs.mkdirSync(FOLDER, { recursive: true });
    fs.writeFileSync(file, 'x');
    for (const sn of [withoutFile, withFile]) {
      await db.run(
        `INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts, set_img_url)
         VALUES ($1,'Testset',2024,158,100,$2)`,
        [sn, `http://cdn.example/media/sets/${sn}.jpg`],
      );
      await db.run('INSERT INTO set_catalog (set_number, image_url) VALUES ($1,$2)', [
        sn,
        `http://cdn.example/media/sets/${sn}.jpg`,
      ]);
      await W.addWantedItem(U.grandparent, sn, 'N');
    }

    try {
      // ── Without a file: no image_local, but an order instead ──────────────
      const [a] = await W.wantedItemsOf([U.grandparent], withoutFile);
      assert.equal(a.image_local, null, 'precondition: there is no file for this set');
      await IQ._writeBuffer();
      const note = await db.get('SELECT set_number FROM image_wanted WHERE url=$1', [
        `http://cdn.example/media/sets/${withoutFile}.jpg`,
      ]);
      assert.ok(
        note,
        'The missing image was not ordered — then the ' +
          'background job never fetches it, and the display stays stuck on the proxy forever',
      );
      assert.equal(note.set_number, withoutFile);

      // ── With a file: the local one wins ────────────────────────────────────
      const [b] = await W.wantedItemsOf([U.grandparent], withFile);
      assert.ok(
        String(b.image_local || '').startsWith('/images/sets/'),
        `image_local is missing or points elsewhere: ${b.image_local}`,
      );
    } finally {
      fs.rmSync(file, { force: true });
      await db
        .run('DELETE FROM image_wanted WHERE url LIKE $1', ['http://cdn.example/media/sets/wlimg%'])
        .catch(() => {});
    }
  });

  await t.test('the owner can be changed — with alert and date', async () => {
    // Counter-checks (carried out, result in the commit):
    //   a) the UPDATE of price_alerts removed in moveWantedItem() →
    //      “the alert moves along” turns red.
    //   b) instead of UPDATE a delete and re-create → “the date added
    //      stays” turns red.
    //   c) the `schon` branch removed → “a wishlist item that the target already has”
    //      turns red (UNIQUE violation instead of merging).
    const P = {
      ..._req('src/finances/priceAlert.js'),
      ...require('./helpers/sources').testArea('finances').priceAlert,
    };
    const sn = `wlmv${process.pid}-1`;
    await db.run(
      `INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts, set_img_url)
       VALUES ($1,'Umzugsset',2024,158,100,NULL)`,
      [sn],
    );

    await W.addWantedItem(U.grandparent, sn, 'N');
    await P.setAlert(U.grandparent, sn, 'EUR', { direction: 'below', threshold: 99, condition: 'N' });
    const [prior] = await W.wantedItemsOf([U.grandparent], sn);
    assert.ok(prior, 'setup: the wanted item is missing');

    // ── The same owner is not a move ─────────────────────────────────
    const nix = await W.moveWantedItem(U.grandparent, sn, 'N', U.grandparent);
    assert.equal(nix.moved, false, 'A move to the same account is no move');

    // ── The move ───────────────────────────────────────────────────────
    const r = await W.moveWantedItem(U.grandparent, sn, 'N', U.grandchild);
    assert.equal(r.moved, true);
    assert.equal(r.merged, false);

    const onGrandparent = await W.wantedItemsOf([U.grandparent], sn);
    assert.deepEqual(onGrandparent, [], 'The wanted item is still at the old account');
    const [later] = await W.wantedItemsOf([U.grandchild], sn);
    assert.ok(later, 'The wanted item did not arrive at the new account');

    // The date added is the only detail a wishlist item carries about
    // itself — re-creating would set it to today.
    assert.equal(
      new Date(later.created_at).getTime(),
      new Date(prior.created_at).getTime(),
      'The date added was reset — then it is not the same wanted item',
    );

    assert.equal(
      (await P.alertsFor(U.grandparent, sn)).length,
      0,
      'The alert stayed with the old account — it would get messages for something ' + 'that is no longer on its list',
    );
    const alarm = (await P.alertsFor(U.grandchild, sn)).find(a => a.condition === 'N');
    assert.ok(alarm, 'The alert did not move along');
    assert.equal(parseFloat(alarm.threshold), 99);

    // ── And if the target already has the wishlist item ──────────────────────────
    await W.addWantedItem(U.grandparent, sn, 'N');
    const r2 = await W.moveWantedItem(U.grandparent, sn, 'N', U.grandchild);
    assert.equal(r2.merged, true, 'A wanted item the target already has must be merged');
    assert.deepEqual(await W.wantedItemsOf([U.grandparent], sn), [], 'The source is still there');
    const nachMerge = (await P.alertsFor(U.grandchild, sn)).find(a => a.condition === 'N');
    assert.equal(parseFloat(nachMerge.threshold), 99, "The TARGET's threshold was overwritten");
  });

  await t.test('close connections', async () => {
    await db.pool.end();
  });
});
