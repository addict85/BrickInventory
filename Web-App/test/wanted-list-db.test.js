/**
 * Read BrickLink wanted lists and map them to Rebrickable numbers.
 *
 * ── Counter-checks (performed, findings MEASURED — see commit) ──────────────
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip, unless
 * REQUIRE_DB=1. The pure reading cases need no DB and always run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const { readWantedList } = _req('src/wanted/wantedParser.js');
const { resolveLocalOn } = _req('src/wanted/wantedResolution.js');
const { importWantedList } = _req('src/wanted/wantedList.js');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

/** An ITEM block in Marco's notation. */
function item(typ, id, farbe, quantity = 1, condition = 'X', preis = '-1.0000') {
  return `<ITEM>
<ITEMTYPE>${typ}</ITEMTYPE>
<ITEMID>${id}</ITEMID>
${farbe === null ? '' : `<COLOR>${farbe}</COLOR>\n`}<MAXPRICE>${preis}</MAXPRICE>
<MINQTY>${quantity}</MINQTY>
<CONDITION>${condition}</CONDITION>
<NOTIFY>N</NOTIFY>
</ITEM>`;
}
const liste = (...items) => `<?xml version="1.0" encoding="UTF-8"?>\n<INVENTORY>\n${items.join('\n')}\n</INVENTORY>\n`;

test('1. every item is read individually, not the file as a whole', () => {
  // The error this case rules out: laying a pattern over the WHOLE file.
  // Then the first match per field wins, and 224 items become
  // one. Exactly this form has already gotten something wrong twice in this
  // tree (see readPageByPage in src/vouchers/pdfExport.ts).
  const xml = liste(item('P', '41879', 7), item('P', '973pb4536c01', 36, 2), item('P', 'x126', 95, 14));
  const r = readWantedList(xml);
  assert.equal(r.items.length, 3, `${r.items.length} items instead of 3`);
  assert.deepEqual(
    r.items.map(p => p.blId),
    ['41879', '973pb4536c01', 'x126'],
  );
  assert.deepEqual(
    r.items.map(p => p.blColor),
    [7, 36, 95],
  );
  assert.deepEqual(
    r.items.map(p => p.quantity),
    [1, 2, 14],
  );
});

test('2. CONDITION=X means “any” and does not become N', () => {
  // In this application the condition is part of the key (N and U are two
  // entries). Reading "any" as N would be a decision of this file about
  // something the account's setting determines — the same rule as for the
  // wishlist import.
  const r = readWantedList(
    liste(item('P', '3001', 4, 1, 'X'), item('P', '3002', 4, 1, 'N'), item('P', '3003', 4, 1, 'U')),
  );
  assert.deepEqual(
    r.items.map(p => p.condition),
    [null, 'N', 'U'],
  );
});

test('3. MAXPRICE=-1 is not a price', () => {
  // -1.0000 is in ALL 224 items of Marco's file. Taken over as a number
  // that would give a purchase price of minus one franc.
  const r = readWantedList(liste(item('P', '3001', 4, 1, 'X', '-1.0000'), item('P', '3002', 4, 1, 'X', '2.5000')));
  assert.equal(r.items[0].maxPrice, null, '-1 became a price');
  assert.equal(r.items[1].maxPrice, 2.5);
});

test('4. foreign kinds are counted, not swallowed', () => {
  // B (Book), G (Gear), I (Instruction) are not kept by this application. Whoever
  // uploads a list with accessories should READ that some of it was left behind —
  // a silent gap looks like a complete import.
  const r = readWantedList(
    liste(
      item('P', '3001', 4),
      item('B', '5002', null),
      item('G', '6001', null),
      item('B', '5003', null),
      item('M', 'sw0001', null),
      item('S', '75192-1', null),
    ),
  );
  assert.equal(r.items.length, 3, `${r.items.length} usable items instead of 3`);
  assert.deepEqual(
    r.items.map(p => p.kind),
    ['part', 'fig', 'set'],
  );
  assert.deepEqual(
    r.foreignTypes,
    { B: 2, G: 1 },
    `foreign kinds: ${JSON.stringify(r.foreignTypes)} — two books and one gear item`,
  );
});

test('5. an item without ITEMID is counted, not guessed', () => {
  const xml = liste(item('P', '3001', 4)).replace('<ITEMID>3001</ITEMID>', '');
  const r = readWantedList(xml);
  assert.equal(r.items.length, 0);
  assert.equal(r.withoutNumber, 1, 'The item without a number was not counted');
});

test('6. entities are resolved, and & last', () => {
  // &amp; MUST be replaced last: otherwise "&amp;lt;" first becomes "&lt;"
  // and then "<" — a string that was never there.
  const r = readWantedList(liste(item('P', 'A&amp;B', 4)));
  assert.equal(r.items[0].blId, 'A&B');
  const r2 = readWantedList(liste(item('P', 'A&amp;lt;B', 4)));
  assert.equal(r2.items[0].blId, 'A&lt;B', '&amp;lt; became „<" — the order of the replacements is wrong');
});

test('the local resolution separates mapping from guess', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c);
  } finally {
    c.release();
  }

  // Three situations, one per stage — and a fourth without anything.
  await db.run(`INSERT INTO part_catalog (part_number, part_name)
                VALUES ('3001','Brick 2x4'), ('98765','Umgetauft'), ('11111','Nur im Katalog')`);
  await db.run(`INSERT INTO bl_mapping (type, rb_id, bl_id) VALUES
                  ('part','98765','4162'),    -- abweichende Nummer: eingetragen
                  ('part','3001', NULL)       -- nachgesehen: keine abweichende`);
  await db.run(`INSERT INTO rb_colors (id, name, bl_color_id) VALUES
                  (4,'Red',5), (15,'White',1)`);

  const items = readWantedList(
    liste(
      item('P', '4162', 5), // stage 1 — mapping
      item('P', '3001', 1), // stage 2 — registered as identical
      item('P', '11111', 5), // stage 3 — catalog hit only
      item('P', '99999', 5), // nichts
      item('P', '3001', 77), // number yes, color unknown
    ),
  ).items;

  const auf = await resolveLocalOn(items);
  assert.equal(auf.length, 5);

  await t.test('stage 1: the registered deviating number', () => {
    assert.equal(auf[0].rbId, '98765', `4162 became ${auf[0].rbId} — expected 98765 from bl_mapping`);
    assert.equal(auf[0].confidence, 'zuordnung');
    assert.equal(auf[0].rbColor, 4, 'BL colour 5 is Rebrickable 4 (Red)');
  });

  await t.test('stage 2: “no deviating number” is also a mapping', () => {
    // Migration 0037 explicitly declares this NULL value a registration,
    // not an absence. Counting it like a catalog hit would be a
    // mapping downgraded to a guess.
    assert.equal(auf[1].rbId, '3001');
    assert.equal(
      auf[1].confidence,
      'gleich_vermerkt',
      `level „${auf[1].confidence}" — a NULL note in bl_mapping is a ` + 'mapping and not a mere catalogue hit',
    );
    assert.equal(auf[1].rbColor, 15);
  });

  await t.test('stage 3: the catalog hit stays marked as a guess', () => {
    assert.equal(auf[2].rbId, '11111');
    assert.equal(
      auf[2].confidence,
      'katalogtreffer',
      `level „${auf[2].confidence}“ — nobody looked up 11111 at BrickLink. ` +
        'Counted as „zuordnung“, a guess would look like a ' +
        'mapping, and exactly this separation is what the preview should show.',
    );
  });

  await t.test('without any hit it stays open — nothing is guessed', () => {
    assert.equal(auf[3].rbId, null, `99999 was resolved to ${auf[3].rbId}`);
    assert.equal(auf[3].confidence, null);
  });

  await t.test('an unknown color does not make the item fail', () => {
    // The number is there, only the color is not. Discarding the whole item
    // would mean leaving a known part behind because of a missing color
    // mapping; creating the item without a hint would mean claiming a wrong
    // color. Hence: number yes, `farbeOffen` set.
    assert.equal(auf[4].rbId, '3001');
    assert.equal(auf[4].rbColor, null);
    assert.equal(
      auf[4].colorPending,
      true,
      'The open colour is not reported — then the import silently creates it wrongly',
    );
    // Opposite direction: for the four others nothing is open.
    assert.deepEqual(
      auf.slice(0, 4).map(a => a.colorPending),
      [false, false, false, false],
    );
  });
});

/**
 * What the write path does with `farbeOffen`. Counter-checks, one change each in
 * src/wanted/wantedList.ts:
 *   A  `a.farbeOffen` removed from the abort condition (item with `color_id: 0`)
 *      → red: “an open color is not invented”, “a second run tops up instead of creating”,
 *      “nothing is written in the preview”
 *   B  `color_name`/`color_hex` not passed → red: “the color travels with name …”
 *   C  `action` of the creator ignored → red: “a second run tops up …”
 *   M  `unit_price` omitted → red: “MAXPRICE becomes the purchase price …”
 *   N  `unit_price` also for MAXPRICE=-1 (as null) → red: same place; the field must
 *      BE ABSENT, only then does the market price apply
 */
test('the import invents no color and writes its name', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }
  // The same scaffolding as above — the case runs on its own.
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c);
  } finally {
    c.release();
  }
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ('3001','Brick 2x4')`);
  await db.run(`INSERT INTO rb_colors (id, name, rgb, bl_color_id) VALUES (4,'Red','C91A09',5)`);

  // BL color 5 can be mapped, 85 cannot — exactly Marco's situation.
  const xml = `<INVENTORY>${item('P', '3001', 5, 10)}${item('P', '3001', 85, 7)}</INVENTORY>`;

  /** A creator that only records. `action` like addManualPart. */
  function zaehler(secondRun = false) {
    const gesehen = [];
    return {
      gesehen,
      creator: {
        teil: async (_u, body) => {
          gesehen.push(body);
          return { action: secondRun ? 'updated' : 'created' };
        },
        minifig: async () => ({ action: 'created' }),
        set: async () => ({ action: 'created' }),
      },
    };
  }

  const z1 = zaehler();
  const bericht = await importWantedList(1, xml, { creator: z1.creator });

  await t.test('an open color is not invented', () => {
    assert.equal(
      z1.gesehen.length,
      1,
      `The creator got ${z1.gesehen.length} items instead of one. The second has ` +
        'a colour the catalogue does not know — writing it with `color_id: 0` ' +
        'means BLACK, and next to it is the same part in its ' +
        "correct colour. That is the duplicate from Marco's screenshot.",
    );
    const open = bericht.items.find(p => p.outcome === 'open');
    assert.ok(open, 'The item with an open colour is not listed as „offen“ in the report');
    assert.match(
      open.reason || '',
      /BrickLink-Farbe 85/,
      `The reason does not name the colour: „${open.reason}" — then Marco does not know ` + 'what he has to fill in.',
    );
  });

  await t.test('the color travels with name and color value', () => {
    assert.equal(z1.gesehen[0].color_id, 4);
    assert.equal(
      z1.gesehen[0].color_name,
      'Red',
      'Without `color_name` the column stays empty. The parts list reads the ' +
        'name from there — the hex value falls back to the catalogue, the name ' +
        'does NOT. The result is a colour dot without a label.',
    );
    assert.equal(z1.gesehen[0].color_hex, 'C91A09');
  });

  await t.test('MAXPRICE becomes the purchase price — and -1 stays none', async () => {
    // Marco's decision of 21.10.
    const z = zaehler();
    await importWantedList(1, liste(item('P', '3001', 5, 2, 'N', '0.8578'), item('P', '3001', 5, 2, 'N', '-1.0000')), {
      creator: z.creator,
    });
    assert.equal(z.gesehen.length, 2, 'Both items must arrive at the creator');
    assert.equal(
      z.gesehen[0].unit_price,
      0.8578,
      `unit_price was ${JSON.stringify(z.gesehen[0].unit_price)}. Without the value ` +
        'the creator fetches the market price — and the finance view then does ' +
        'not show what Marco paid.',
    );
    assert.ok(
      !('unit_price' in z.gesehen[1]),
      `With MAXPRICE=-1 the body contains ${JSON.stringify(z.gesehen[1].unit_price)}. ` +
        'The field must be MISSING, not null: the creators distinguish ' +
        '„nothing given" (then the market price applies) from an explicit zero.',
    );
  });

  await t.test('a second run tops up instead of creating', async () => {
    const z2 = zaehler(true);
    const b2 = await importWantedList(1, xml, { creator: z2.creator });
    assert.equal(
      b2.created,
      0,
      `created: ${b2.created} — the creator reported „updated“. Before, ` +
        'the import counted up blindly: a second import of the same list reported ' +
        '„angelegt: 2, aufgestockt: 0“ although nothing new was created.',
    );
    assert.equal(b2.topped_up, 1);
  });

  await t.test('nothing is written in the preview', () => {
    // The opposite direction: the case above would also be green if the import
    // wrote nothing at all any more.
    assert.equal(bericht.preview, false, 'This run was not a preview');
    assert.equal(bericht.created, 1, 'The mappable item must be created');
  });

  // Abort

  await t.test('an abort stops after at most ten items', async () => {
    // 25 mappable items of the same number in different quantities; the
    // mapping is in the database (see above, 3001 → color 4).
    const viele = `<INVENTORY>${Array.from(
      { length: 25 },
      (_, i) =>
        `<ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>3001</ITEMID><COLOR>5</COLOR>` + `<MINQTY>${i + 1}</MINQTY></ITEM>`,
    ).join('')}</INVENTORY>`;
    const z = zaehler();
    let asked = 0;
    const b = await importWantedList(1, viele, {
      creator: z.creator,
      cancellation: async () => {
        asked++;
        return true;
      },
    });
    assert.equal(
      b.aborted,
      true,
      'The report must say that it was aborted — otherwise a ' + 'half import looks like a complete one',
    );
    assert.equal(
      z.gesehen.length,
      10,
      `The creator got ${z.gesehen.length} items. Ten are expected: ` +
        'the question is asked at every tenth, and at the first yes it stops.',
    );
    assert.equal(asked, 1, `The question was asked ${asked} times instead of once`);
    assert.equal(b.items.length, 10, 'The report lists only what was processed — the rest was left');
  });

  await t.test('without an abort the list runs through', async () => {
    // The opposite direction: the case above would also be green if the import
    // ALWAYS stopped after ten items.
    const viele = `<INVENTORY>${Array.from(
      { length: 25 },
      (_, i) =>
        `<ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>3001</ITEMID><COLOR>5</COLOR>` + `<MINQTY>${i + 1}</MINQTY></ITEM>`,
    ).join('')}</INVENTORY>`;
    const z = zaehler();
    const b = await importWantedList(1, viele, {
      creator: z.creator,
      cancellation: async () => false,
    });
    assert.equal(b.aborted, undefined, 'Nothing was aborted');
    assert.equal(z.gesehen.length, 25, `The creator got ${z.gesehen.length} instead of 25 items`);
  });

  await t.test('in the PREVIEW nothing is asked at all', async () => {
    // A preview writes nothing; there is nothing to abort, and a
    // database query every ten items would be pure load.
    const viele = `<INVENTORY>${Array.from(
      { length: 25 },
      (_, i) =>
        `<ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>3001</ITEMID><COLOR>5</COLOR>` + `<MINQTY>${i + 1}</MINQTY></ITEM>`,
    ).join('')}</INVENTORY>`;
    let asked = 0;
    const b = await importWantedList(1, viele, {
      preview: true,
      cancellation: async () => {
        asked++;
        return true;
      },
    });
    assert.equal(asked, 0, `The preview asked ${asked} times about aborting`);
    assert.equal(b.items.length, 25, 'The preview shows the whole list');
  });
});
