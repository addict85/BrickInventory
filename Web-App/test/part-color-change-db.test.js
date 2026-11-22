/**
 * Change the color of a manually captured part AFTERWARDS.
 *
 * ── Counter-checks (MEASURED on 19.10., numbers copied) ──────────────────
 *
 * Starting point: `# pass 8 / # fail 0` (before the three image cases of 20.10.,
 * since then `# pass 11 / # fail 0`). Every counter-check is ONE change,
 * reverted afterwards (the files were compared against their backup).
 *
 *   A  the adding of identical days left out (`vereint = { changes: 0 }`,
 *      UPDATE and DELETE before it deleted)
 *      → `pass 6 / fail 2`. Exactly case 3 is red, with the real reason:
 *        `500 duplicate key value violates unique constraint
 *        "idx_part_acq_tag_zustand"`.
 *   B  no merging of the stock rows (always `UPDATE parts SET
 *      color_id`)
 *      → `pass 4 / fail 4`. Cases 2, 3 and 4 are red, all three with
 *        `duplicate key value violates unique constraint
 *        "idx_parts_unique"` — every case in which the target color already
 *        stands there. Marco's normal case.
 *   C  rememberPartColor() not called
 *      → `pass 6 / fail 2`. Case 1 is red: „Der Farbkatalog nennt die Farbe
 *        „undefined" — erwartet „Red" aus rb_colors". That is the color dot
 *        without a label.
 *   D  in the route `V.colorId(req.body?.color_id)` instead of the refusal
 *      → `pass 6 / fail 2`. Case 5 is red: status 200 instead of 400 — the
 *        missing color became 0.
 *   E  `AND source = 'manual'` removed from the source query
 *      → `pass 6 / fail 2`. Case 6 is red: status 200, the set part was
 *        recolored.
 *   F  the shortcut `if (alt === neu)` removed
 *      → `pass 6 / fail 2`. Case 7 is red, and what was measured is worse
 *        than the number: the row finds ITSELF as the target, adds its
 *        acquisition onto itself (`vereint: 1`, quantity 5 → 10) and then deletes itself
 *        as the „source". On the running server with a part in color 4,
 *        quantity 5, and the call 4 → 4:
 *
 *            before  parts: [ { color_id: 4 } ]   erf: [ { 4, 5 } ]
 *            after   parts: [ ]                   erf: [ ]
 *
 *        A misclick on the same color would have deleted the part.
 *
 * ── The three image cases, counter-checks of 20.10. ─────────────────────────────
 *
 * Marco's finding: „Wenn ich die Farbe der manuell erfassten Teile ändere wird
 * das Bild nicht aktualisiert." Starting point `# pass 11 / # fail 0`.
 *
 *   G  (dropped on 28.10.2026: since migration 0062 the set lists carry
 *      no images of their own any more, theirs stand at the color — the case
 *      “from the set parts lists” is the same as “vorhanden”.)
 *   H  the question whether an image already stands there switched off
 *      (`if (false && lokal?.bildQuelle === 'farbe')`; re-measured on
 *      28.10.2026) → `pass 9 / fail 2`. Red is “an already existing color image
 *      is not overwritten”: „Die Antwort sagt „null" —
 *      erwartet „vorhanden"". The UI hangs its hint on this
 *      response.
 *   I  on „nothing found" `'vorhanden'` reported anyway
 *      → `pass 9 / fail 2`. Red is “if nobody knows an image, the response says
 *        so”: a guessed „vorhanden" takes the hint away from the UI, and
 *        Marco would stand in front of an empty spot a second time without knowing
 *        why.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip, unless
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const { testServer } = require('./helpers/server');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

test('the color of a manual part can be changed afterwards', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }

  await db.run(`INSERT INTO users (username,password_hash) VALUES ('marco','x')`);
  const UID = (await db.get(`SELECT id FROM users WHERE username='marco'`)).id;

  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ('3001','Brick 2x4')`);
  // Color 4 stands in the color catalog, color 0 is the one the import invented.
  // rb_colors is the source from which the change fetches name and color code
  // when the caller passes none.
  await db.run(`INSERT INTO rb_colors (id,name,rgb,bl_color_id)
                VALUES (4,'Red','C91A09',5), (7,'Blue','0055BF',7)`);

  const { base } = testServer(_req, { sitzung: { userId: UID }, t });
  const changeOne = async (number, oldColor, koerper) => {
    const r = await fetch(`${base}/api/v2/parts/${number}/${oldColor}/color`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(koerper),
    });
    return { status: r.status, body: await r.json() };
  };
  const holding = async () =>
    db.all(
      `SELECT color_id, source, storage_id FROM parts WHERE user_id=$1 AND part_number='3001'
      ORDER BY color_id`,
      [UID],
    );
  const acqList = async () =>
    (
      await db.all(
        `SELECT color_id, quantity, (created_at AT TIME ZONE 'UTC')::date AS tag
       FROM part_acquisitions WHERE user_id=$1 AND part_number='3001'
      ORDER BY color_id, tag`,
        [UID],
      )
    ).map(r => ({ farbe: r.color_id, quantity: Number(r.quantity), tag: String(r.tag).slice(0, 10) }));
  const leeren = async () => {
    await db.run(`DELETE FROM part_acquisitions`);
    await db.run(`DELETE FROM parts`);
    await db.run(`DELETE FROM part_color_catalog`);
    // Since 20.10. the set parts lists are the first image source of the
    // color change — without clearing, the next case would carry the image of the previous one.
    await db.run(`DELETE FROM set_parts`);
  };
  const colorImage = async farbe =>
    db.get(
      `SELECT image_url, image_local FROM part_color_catalog
      WHERE part_number='3001' AND color_id=$1`,
      [farbe],
    );

  await t.test('without a target row the row moves including acquisitions', async () => {
    await leeren();
    await db.run(
      `INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',0,'manual')`,
      [UID],
    );
    await db.run(
      `INSERT INTO part_acquisitions
                    (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                  VALUES ($1,'3001',0,10,0.40,'N', NOW() - INTERVAL '2 days')`,
      [UID],
    );

    const a = await changeOne('3001', 0, { color_id: 4 });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.combined, false, 'There was no target row — nothing to merge');

    assert.deepEqual(
      (await holding()).map(r => r.color_id),
      [4],
      'After the change there must be EXACTLY ONE row, and in colour 4',
    );
    assert.deepEqual(
      await acqList(),
      [{ farbe: 4, quantity: 10, tag: (await acqList())[0].tag }],
      'The acquisition must have moved along — if it stays behind in colour 0, the ' +
        'purchase price is cut off from the part and the quantity of the new row is zero',
    );

    // Color label and color code: without a catalog entry for (3001, 4) the
    // parts list shows a color dot without a label — exactly the state
    // Marco complained about during the import. The caller passed
    // NOTHING here; the values must come from rb_colors.
    const kat = await db.get(
      `SELECT color_name, color_hex FROM part_color_catalog
        WHERE part_number='3001' AND color_id=4`,
    );
    assert.equal(
      kat?.color_name,
      'Red',
      `The colour catalogue names the colour „${kat?.color_name}" — expected „Red" from rb_colors`,
    );
    assert.equal(kat?.color_hex, 'C91A09');
  });

  await t.test('if the target color already exists, the rows are merged', async () => {
    await leeren();
    await db.run(
      `INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',0,'manual'), ($1,'3001',4,'manual')`,
      [UID],
    );
    // Different days: idx_part_acq_tag_zustand allows only one acquisition per position
    // and day, the setup could not be produced otherwise.
    await db.run(
      `INSERT INTO part_acquisitions
                    (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                  VALUES ($1,'3001',0,7,0.40,'N', NOW() - INTERVAL '3 days'),
                         ($1,'3001',4,10,0.50,'N', NOW() - INTERVAL '2 days')`,
      [UID],
    );

    const a = await changeOne('3001', 0, { color_id: 4 });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(
      a.body.combined,
      true,
      'The target colour already existed — the response must say so, otherwise the ' +
        'caller mistakes a merge for a move',
    );

    assert.deepEqual(
      (await holding()).map(r => r.color_id),
      [4],
      'The duplicate is the whole reason for this function: afterwards only ' + 'the row in colour 4 may remain',
    );
    const erf = await acqList();
    assert.deepEqual(
      erf.map(e => ({ farbe: e.farbe, quantity: e.quantity })),
      [
        { farbe: 4, quantity: 7 },
        { farbe: 4, quantity: 10 },
      ],
      `Both acquisitions must be in colour 4 and BOTH must be kept — ` +
        `there is ${JSON.stringify(erf)}. Together they are 17 pieces, and neither ` +
        'of the two purchase prices may disappear.',
    );
  });

  await t.test('two acquisitions from the SAME day are added, not rejected', async () => {
    await leeren();
    await db.run(
      `INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',0,'manual'), ($1,'3001',4,'manual')`,
      [UID],
    );
    await db.run(
      `INSERT INTO part_acquisitions
                    (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                  VALUES ($1,'3001',0,7,0.50,'N', NOW()),
                         ($1,'3001',4,10,0.50,'N', NOW())`,
      [UID],
    );

    const a = await changeOne('3001', 0, { color_id: 4 });
    // Without the adding BEFORE the move the UPDATE runs into idx_part_acq_tag_zustand
    // and the whole request fails with 500 — but only on a day on which
    // both acquisitions happen to coincide.
    assert.equal(
      a.status,
      200,
      `status ${a.status}: ${JSON.stringify(a.body)} — if the request aborts on the ` +
        'unique day index, the correction depends on the clock.',
    );
    assert.equal(a.body.united, 1, 'An acquisition had to be added up');
    assert.deepEqual(
      (await acqList()).map(e => ({ farbe: e.farbe, quantity: e.quantity })),
      [{ farbe: 4, quantity: 17 }],
      '7 and 10 from the same day must become ONE acquisition with 17 — ' +
        'if one of the two disappears, Marco is missing pieces.',
    );
  });

  await t.test('different prices from the same day stay rows of their own', async () => {
    await leeren();
    await db.run(
      `INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',0,'manual'), ($1,'3001',4,'manual')`,
      [UID],
    );
    await db.run(
      `INSERT INTO part_acquisitions
                    (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                  VALUES ($1,'3001',0,7,0.40,'N', NOW()),
                         ($1,'3001',4,10,0.50,'N', NOW())`,
      [UID],
    );
    const a = await changeOne('3001', 0, { color_id: 4 });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual(
      (await acqList()).map(e => e.quantity).sort((x, y) => x - y),
      [7, 10],
      'Since migration 0047 no mixed price: two purchases, two rows, 17 in total',
    );
  });

  await t.test('the storage location moves along if the target row has none', async () => {
    await leeren();
    await db.run(`INSERT INTO storage_locations (user_id,name) VALUES ($1,'Kiste 3')`, [UID]);
    const ORT = (await db.get(`SELECT id FROM storage_locations WHERE name='Kiste 3'`)).id;
    await db.run(
      `INSERT INTO parts (user_id,part_number,color_id,source,storage_id)
                  VALUES ($1,'3001',0,'manual',$2), ($1,'3001',4,'manual',NULL)`,
      [UID, ORT],
    );

    assert.equal((await changeOne('3001', 0, { color_id: 4 })).status, 200);
    const zeilen = await holding();
    assert.equal(zeilen.length, 1);
    assert.equal(
      zeilen[0].storage_id,
      ORT,
      '„Kiste 3“ is a human entry and must not disappear because of a colour ' + 'correction',
    );
  });

  await t.test('without color_id there is a refusal, no silent 0', async () => {
    await leeren();
    await db.run(
      `INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',4,'manual')`,
      [UID],
    );
    const a = await changeOne('3001', 4, {});
    assert.equal(
      a.status,
      400,
      `status ${a.status} — if the colour is missing, V.colorId() turns it into 0, and ` +
        '0 IS a colour („ohne Angabe“). That would be a silent clearing with a ' +
        'success message.',
    );
    assert.deepEqual(
      (await holding()).map(r => r.color_id),
      [4],
      'The rejected request must not have changed anything',
    );
  });

  await t.test('a part FROM A SET stays untouched', async () => {
    await leeren();
    await db.run(`INSERT INTO sets (user_id,set_number) VALUES ($1,'10497-1') ON CONFLICT DO NOTHING`, [UID]);
    await db.run(
      `INSERT INTO parts (user_id,set_number,part_number,color_id,source)
                  VALUES ($1,'10497-1','3001',0,'set')`,
      [UID],
    );
    const a = await changeOne('3001', 0, { color_id: 4 });
    assert.equal(
      a.status,
      404,
      `status ${a.status} — the colour of a set part comes from the Rebrickable ` +
        'parts list. Changing it here would mean disputing the parts list, ' +
        'and the next set import would reset it.',
    );
    assert.deepEqual(
      (await holding()).map(r => r.color_id),
      [0],
      'The set part must not have been touched',
    );
  });

  await t.test('the same color again is no change', async () => {
    // The opposite direction: the cases above would be green too if the function
    // simply deleted and rewrote EVERY time. Here nothing happens, and
    // the response says so.
    await leeren();
    await db.run(
      `INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',4,'manual')`,
      [UID],
    );
    await db.run(
      `INSERT INTO part_acquisitions
                    (user_id,part_number,color_id,quantity,condition,created_at)
                  VALUES ($1,'3001',4,5,'N', NOW())`,
      [UID],
    );
    const a = await changeOne('3001', 4, { color_id: 4 });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual(
      { v: a.body.moved, u: a.body.united, z: a.body.combined },
      { v: 0, u: 0, z: false },
      'Same colour means: nothing moved, nothing united, nothing merged',
    );
    assert.deepEqual(
      (await acqList()).map(e => e.quantity),
      [5],
      'The acquisition must remain unchanged',
    );
  });

  // The image of the new color (Marco's finding of 20.10.)

  await t.test('an already existing color image is not overwritten', async () => {
    await leeren();
    await db.run(
      `INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',4,'manual')`,
      [UID],
    );
    await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name,image_url)
                  VALUES ('3001',7,'Blue','https://cdn.example/schon-da.jpg')`);

    const a = await changeOne('3001', 4, { color_id: 7 });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.image, 'vorhanden', `The response says „${a.body.image}“ — expected „vorhanden“`);
    assert.equal(
      (await colorImage(7))?.image_url,
      'https://cdn.example/schon-da.jpg',
      'The existing image counts. Replacing it on every colour change would mean ' +
        'swapping an image fetched exactly for this colour for the first arbitrary one from ' +
        'a set parts list.',
    );
  });

  await t.test('if nobody knows an image, the response says so — the color changes anyway', async () => {
    await leeren();
    await db.run(
      `INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',4,'manual')`,
      [UID],
    );
    await db.run(
      `INSERT INTO part_acquisitions
                    (user_id,part_number,color_id,quantity,condition,created_at)
                  VALUES ($1,'3001',4,5,'N', NOW())`,
      [UID],
    );

    const a = await changeOne('3001', 4, { color_id: 7 });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    // Without a Rebrickable key lookupPart() returns null immediately; in
    // this environment there is none. So what is measured is the case „nothing
    // found" — and that must NOT take the change along.
    assert.equal(
      a.body.image,
      null,
      `The response says „${a.body.image}“ — expected null. A guessed ` +
        '„vorhanden“ would rob the interface of its hint.',
    );
    assert.deepEqual(
      (await holding()).map(r => r.color_id),
      [7],
      'The colour must be changed even if no image was found — ' +
        'a missing image is no reason to undo the correction',
    );
    assert.deepEqual(
      (await acqList()).map(e => ({ farbe: e.farbe, quantity: e.quantity })),
      [{ farbe: 7, quantity: 5 }],
      'The acquisition moves along',
    );
  });
});
