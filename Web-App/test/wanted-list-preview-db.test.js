/**
 * The preview BEFORE the import — with image, color, description and corrections.
 *
 * ── Counter-checks (MEASURED on 19.10., numbers copied) ─────────────────────
 *
 * Baseline `# pass 9 / # fail 0` (eight sub-cases plus the frame). Each
 * counter-check is ONE change, reverted afterwards; the files were
 * compared against their backup (`diff` said identical).
 *
 *   A  correction looked up via kind+number instead of at the index
 *      → `pass 7 / fail 2`. Red is case 3: „Menge 2 — korrigiert war Index
 *        1, also der Posten mit 5." Exactly the error this is about: in
 *        a list with 3001 twice in color 85 the correction hit the
 *        first one instead of the intended one.
 *   B  backfillColors() omitted
 *      → `pass 7 / fail 2`. Red is case 3: „Ohne Nachtragen geht die
 *        eingetragene Farbe ohne Namen an den Anleger" — the color dot without
 *        a label, again.
 *   C  the counter-check of the correction (kind and number) omitted
 *      → `pass 7 / fail 2`. Red is case 4: the correction acts on a foreign
 *        item.
 *   D  rememberNumber called for EVERY stage, not only for 'korrigiert'
 *      → `pass 7 / fail 2`. Red is case 5: a catalog hit — a
 *        guess — would be registered as a mapping.
 *   E  `opt.vorschau` removed from the abort condition of the write path
 *      → `pass 7 / fail 2`. Red is case 6: the preview remembers something.
 *   F  in describeItem one query per item put in front
 *      → `pass 7 / fail 2`. Red is case 7: „64 Abfragen für 100 Posten."
 *        This counter-check at first reported NOTHING (`pass 9 / fail 0`) —
 *        the reason and the lesson are at case 7 itself.
 *   G  name and image not put into the report
 *      → `pass 7 / fail 2`. Red is case 1.
 *
 * The numbers come from the run with eight sub-cases; the former case 7
 * (“the export invents no BrickLink color”) was dropped because Marco does not
 * need the export. The remaining cases and their counter-checks are
 * unchanged — recalculated again after the removal.
 *
 * On 20.10. case 2b was added (Marco's condition column). That makes it
 * eight sub-cases again, and the numbers above still hold — RECOUNTED,
 * not assumed: `# tests 9 / # pass 9`, and the run with a deliberately
 * wrong 2b reported `pass 7 / fail 2`, i.e. the same shape as A to G.
 *
 * Separate counter-check for 2b: `standardZustand: await userDefaultCondition(uid)`
 * replaced by the fixed `'N'` → `pass 7 / fail 2`, red is 2b with
 * „'N' statt 'U' — die Einstellung des Kontos gewinnt".
 *
 * With case 5b (second run) the baseline is `# pass 10 / # fail 0` — nine
 * sub-cases plus the frame.
 *
 *   H  `|| a.sicherheit === 'rebrickable'` removed from the remember condition
 *      → `pass 8 / fail 2`. Red is 5b: „Gemerkt wurde []".
 *   I  the same condition widened to EVERY stage (`if (a.sicherheit …)`)
 *      → `pass 8 / fail 2`. Red is 5: a catalog hit — a guess —
 *        is registered as a mapping.
 *
 * H and I pin the rule from both sides: too narrow and too wide. Case 5
 * alone would never have reported H, case 5b alone not I.
 *
 * On 21.10. cases 8 and 9 were added (Marco's empty image and
 * name column after the import). Baseline thus `# pass 12 / # fail 0` —
 * eleven sub-cases plus the frame.
 *
 *   J  describeItem() called only for the preview again (the state of
 *      Marco's finding)
 *      → `pass 9 / fail 3`. Red are BOTH new cases: “name and image
 *        are in the report EVEN after writing” and “an image fetched on
 *        creation is in the report”.
 *   K  the call placed BEFORE the loop instead of after it
 *      → `pass 10 / fail 2`. Red is only case 9. That is the proof that the
 *        position counts and not merely the call: before the loop the
 *        just-created parts are not yet in the catalog, and the import is
 *        about exactly those.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip, unless
 * REQUIRE_DB=1.
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testSources } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();

// Rebrickable stubbed at the wiring (testSources).
testSources(null, {
  // At Rebrickable 98765 is called 12345 — a DEVIATING number, as only listed
  // there. Nothing else knows this pair.
  blPartToRb: async blId => (blId === '98765' ? '12345' : null),
  blFilterIneffective: () => false,
  lookupPart: async () => null,
  getMinifigInfo: async () => null,
});
const { importWantedList } = _req('src/wanted/wantedList.js');
const { describeItem, resolveLocalOn } = _req('src/wanted/wantedResolution.js');
const { readWantedList } = _req('src/wanted/wantedParser.js');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

/** An ITEM block in Marco's notation (as in wanted-list-db.test.js). */
/**
 * `zustand` since 20.10. — previously this was a fixed `X`.
 */
function item(typ, id, farbe, quantity = 1, condition = 'X') {
  return (
    `<ITEM>\n<ITEMTYPE>${typ}</ITEMTYPE>\n<ITEMID>${id}</ITEMID>\n` +
    `${farbe === null ? '' : `<COLOR>${farbe}</COLOR>\n`}<MINQTY>${quantity}</MINQTY>\n` +
    `${condition === null ? '' : `<CONDITION>${condition}</CONDITION>\n`}</ITEM>`
  );
}
const liste = (...items) => `<INVENTORY>\n${items.join('\n')}\n</INVENTORY>\n`;

test('preview, corrections and color translation', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
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

  // The catalog: the tree knows 3001 with name and one image per color,
  // 3002 only via the CSV sync (rb_parts), nobody knows 9999.
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ('3001','Brick 2 x 4')`);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, image_url)
                VALUES ('3001',4,'Red','C91A09','https://cdn.example/3001-rot.png')`);
  await db.run(`INSERT INTO rb_parts (part_num, name, part_img_url)
                VALUES ('3002','Brick 2 x 2','https://cdn.example/3002.png')`);
  // bl_color_id: 5 → Red(4), 11 → Black(0), 7 → Blue(7). BrickLink color
  // 85 is mapped to NONE — exactly Marco's situation.
  await db.run(`INSERT INTO rb_colors (id, name, rgb, bl_color_id)
                VALUES (4,'Red','C91A09',5), (0,'Black','05131D',11), (7,'Blue','0055BF',7)`);

  await t.test('1. the preview carries name, image and color — and invents nothing', async () => {
    const xml = liste(item('P', '3001', 5, 10), item('P', '3002', 5, 3), item('P', '9999', 5, 1));
    // `vorschau: true` is there EXPLICITLY. The default of this function is
    // WRITE (`vorschau: !!opt.vorschau`), and that is right: whoever calls it
    // brings a creator along. The decision "preview or for real"
    // is made by the route from `?write=1` — not by a default value here.
    const b = await importWantedList(1, xml, { preview: true });
    assert.equal(b.preview, true, 'Mit vorschau: true muss es eine Vorschau sein');
    assert.equal(b.created, 0, 'Eine Vorschau schreibt nichts');

    const nach = new Map(b.items.map(p => [p.blId, p]));
    assert.equal(
      nach.get('3001').name,
      'Brick 2 x 4',
      'Der Name aus part_catalog fehlt — dann zeigt die Vorschau nur Nummern, ' +
        'und Marco kann an Posten 57 nicht erkennen, dass es der falsche Stein ist.',
    );
    assert.equal(
      nach.get('3001').image,
      'https://cdn.example/3001-rot.png',
      'Das Bild hängt an Teil UND Farbe (ein roter 2x4 sieht anders aus als ein ' + 'blauer). Hier fehlt das Farbbild.',
    );
    assert.equal(nach.get('3001').colorName, 'Red');
    assert.equal(nach.get('3001').colorHex, 'C91A09');

    // 3002 is ONLY in rb_parts (the CSV sync), not in part_catalog.
    // The resolution therefore leaves it OPEN — stage 3 reads part_catalog, and
    // it should: it is a guess, and widening it to the 50,000 rows of
    // rb_parts would mean many more items on the strength of a guess …
    assert.equal(
      nach.get('3002').outcome,
      'open',
      'Stufe 3 liest part_catalog; 3002 steht dort nicht und bleibt offen',
    );
    assert.equal(
      nach.get('3002').name,
      'Brick 2 x 2',
      'Der Rückfall auf rb_parts (CSV-Abgleich) greift nicht — dann bleibt ' +
        'jedes Teil namenlos, das noch in keinem Set war.',
    );
    assert.equal(
      nach.get('3002').image,
      'https://cdn.example/3002.png',
      'Ohne Farbbild muss das allgemeine Teilebild einspringen',
    );
    assert.equal(
      nach.get('3002').nameGuessed,
      true,
      'Der Name wurde unter der BrickLink-Nummer gefunden, nicht über eine ' +
        'Abbildung. Ohne dieses Kennzeichen sieht die Zeile aus wie ein Treffer.',
    );
    assert.equal(nach.get('3001').nameGuessed, false, '3001 ist abgebildet — da ist nichts geraten.');

    // 9999 is in no catalog. Empty is the HONEST answer here.
    assert.equal(
      nach.get('9999').name ?? null,
      null,
      `Für 9999 steht „${nach.get('9999').name}" da — das kennt kein Katalog ` +
        'dieses Baums. Ein geratener Name ist schlimmer als eine leere Zelle.',
    );
    assert.notEqual(
      nach.get('9999').nameGuessed,
      true,
      'Eine leere Zeile „geraten" zu nennen wäre eine Behauptung über nichts',
    );
  });

  await t.test('2. quantity, BL color and condition travel into the preview', async () => {
    // Without it the preview cannot show the row — and the correction
    // cannot say which color was meant.
    const b = await importWantedList(1, liste(item('P', '3001', 85, 7)), { preview: true });
    const p = b.items[0];
    assert.equal(p.blColor, 85, 'Die BrickLink-Farbnummer aus der Datei fehlt');
    assert.equal(p.quantity, 7);
    assert.equal(p.outcome, 'open', 'Farbe 85 ist nicht abbildbar — der Posten bleibt offen');
    assert.match(p.reason || '', /BrickLink-Farbe 85/);
  });

  await t.test('2b. the account default condition travels ONCE per report', async () => {
    // Asked for by Marco on 20.10.
    const ohne = await importWantedList(1, liste(item('P', '3001', 5, 1, 'X')), { preview: true });
    assert.equal(ohne.defaultCondition, 'N', 'Ohne Einstellung gilt die Vorgabe des Baums (userDefaultCondition)');
    assert.equal(ohne.items[0].condition, null, 'Am ITEM steht weiterhin, was in der Datei stand — nicht der Standard');

    await db.run(`INSERT INTO user_settings (user_id, key, value)
                  VALUES (1,'user_default_condition','U')
                  ON CONFLICT (user_id, key) DO UPDATE SET value='U'`);
    const mit = await importWantedList(
      1,
      liste(
        item('P', '3001', 5, 1, 'N'),
        item('P', '3001', 5, 1, 'U'),
        item('P', '3001', 5, 1, 'X'),
        item('P', '3001', 5, 1, null),
      ),
      { preview: true },
    );
    assert.equal(mit.defaultCondition, 'U', 'Die Einstellung des Kontos gewinnt');
    assert.deepEqual(
      mit.items.map(x => x.condition),
      ['N', 'U', null, null],
      'N und U bleiben, X bleibt null — der Standard ersetzt sie NICHT im Posten. ' +
        'Die Vorschau setzt beides zusammen (row() in public/js/wanted-xml.js)',
    );
    await db.run(`DELETE FROM user_settings WHERE user_id=1 AND key='user_default_condition'`);
  });

  await t.test('3. a correction hits the item at the index, not the number', async () => {
    // The same number and the same color TWICE — a key of kind,
    // number and color would hit both rows.
    const xml = liste(item('P', '3001', 85, 2), item('P', '3001', 85, 5));
    const zaehler = [];
    const b = await importWantedList(1, xml, {
      preview: false,
      corrections: [{ index: 1, blId: '3001', kind: 'part', rbColor: 7 }],
      creator: {
        part: async (_u, body) => {
          zaehler.push(body);
          return { action: 'created' };
        },
        minifig: async () => ({ action: 'created' }),
        set: async () => ({ action: 'created' }),
      },
    });
    assert.equal(b.corrections?.applied, 1, JSON.stringify(b.corrections));
    assert.deepEqual(b.corrections?.rejected, []);
    assert.equal(
      zaehler.length,
      1,
      `Der Anleger bekam ${zaehler.length} Posten. Genau EINER wurde korrigiert; ` +
        'der andere hat weiterhin keine abbildbare Farbe und muss offen bleiben.',
    );
    assert.equal(
      zaehler[0].quantity,
      5,
      `Menge ${zaehler[0].quantity} — korrigiert war Index 1, also der Posten mit 5. ` +
        'Trifft die Korrektur den ersten, zeigt sie auf die Nummer statt auf den Index.',
    );
    assert.equal(zaehler[0].color_id, 7);
    // The COLOR NAME must be fetched afterwards: the resolution fetches it for the
    // colors from the FILE, and 7 was not there.
    assert.equal(
      zaehler[0].color_name,
      'Blue',
      'Ohne Nachtragen geht die eingetragene Farbe ohne Namen an den Anleger — ' +
        'und das ist genau der Farbpunkt ohne Beschriftung vom 19.10.',
    );
    assert.equal(zaehler[0].color_hex, '0055BF');
    assert.equal(
      b.items[1].confidence,
      'korrigiert',
      'Eine eingetragene Nummer ist nicht „zuordnung" — der Bericht darf nicht ' +
        'behaupten, der Katalog habe geliefert, was jemand getippt hat.',
    );
  });

  await t.test('4. a correction on a foreign item is rejected, not applied', async () => {
    // The case: between preview and writing a DIFFERENT file was
    // chosen. Without the counter-check the correction would act on a foreign
    // item — silently, because both numbers would look plausible.
    const xml = liste(item('P', '3001', 85, 2));
    const zaehler = [];
    const b = await importWantedList(1, xml, {
      preview: false,
      corrections: [{ index: 0, blId: '4444', kind: 'part', rbColor: 7 }],
      creator: {
        part: async (_u, body) => {
          zaehler.push(body);
          return { action: 'created' };
        },
        minifig: async () => ({ action: 'created' }),
        set: async () => ({ action: 'created' }),
      },
    });
    assert.equal(b.corrections?.applied, 0);
    assert.equal(
      b.corrections?.rejected.length,
      1,
      'Die abgewiesene Korrektur muss im Bericht STEHEN — stillschweigend zu ' +
        'übergehen heisst: Marco korrigiert, und nichts passiert.',
    );
    assert.equal(zaehler.length, 0, 'Der Posten hat weiterhin keine Farbe und bleibt offen');
  });

  await t.test('5. only a REGISTERED number is remembered, no catalog hit', async () => {
    const gemerkt = [];
    const creator = {
      part: async () => ({ action: 'created' }),
      minifig: async () => ({ action: 'created' }),
      set: async () => ({ action: 'created' }),
    };
    // 3001 resolves via the catalog (stage 3, a guess), 9999 does not.
    // 9999 is corrected → 3002.
    const xml = liste(item('P', '3001', 5, 1), item('P', '9999', 5, 1));
    const b = await importWantedList(1, xml, {
      preview: false,
      creator,
      corrections: [{ index: 1, blId: '9999', kind: 'part', rbId: '3002', rbColor: 4 }],
      rememberNumber: async (kind, rbId, blId) => {
        gemerkt.push({ kind, rbId, blId });
      },
    });
    assert.equal(b.corrections?.applied, 1, JSON.stringify(b.corrections));
    assert.deepEqual(
      gemerkt,
      [{ kind: 'part', rbId: '3002', blId: '9999' }],
      `Gemerkt wurde ${JSON.stringify(gemerkt)}. Erwartet ist GENAU die ` +
        'eingetragene Zuordnung 9999→3002. Steht 3001 mit dabei, wird ein ' +
        'Katalogtreffer — also eine Vermutung — als Abbildung eingetragen.',
    );
  });

  await t.test('5b. a number looked up at Rebrickable is remembered too', async () => {
    const gemerkt = [];
    const xml = liste(item('P', '98765', 5, 1));
    const b = await importWantedList(1, xml, {
      preview: false,
      viaRebrickable: true,
      creator: {
        part: async () => ({ action: 'created' }),
        minifig: async () => ({ action: 'created' }),
        set: async () => ({ action: 'created' }),
      },
      rememberNumber: async (kind, rbId, blId) => {
        gemerkt.push({ kind, rbId, blId });
      },
    });
    assert.deepEqual(
      b.levels,
      { rebrickable: 1 },
      'Der Posten muss ueber Rebrickable aufgeloest worden sein — sonst sagt ' + 'der Fall nichts ueber diese Stufe',
    );
    assert.deepEqual(
      gemerkt,
      [{ kind: 'part', rbId: '12345', blId: '98765' }],
      `Gemerkt wurde ${JSON.stringify(gemerkt)}. Ohne diesen Eintrag fragt der ` +
        'naechste Import dieselbe Nummer wieder bei Rebrickable — 1,5 Sekunden ' +
        'und ein Abruf aus dem Tageskontingent je Posten, bei jedem Lauf',
    );
  });

  await t.test('6. a preview remembers nothing', async () => {
    // The opposite direction to case 5: without this case it would also be green
    // if the preview already wrote. A preview that stores something is
    // not one.
    const gemerkt = [];
    // WITH creator: without it writing fails, and the callback would
    // not be reached for that reason alone — the case would be green without
    // saying anything about the preview.
    const b = await importWantedList(1, liste(item('P', '9999', 5, 1)), {
      preview: true,
      corrections: [{ index: 0, blId: '9999', kind: 'part', rbId: '3002', rbColor: 4 }],
      creator: {
        part: async () => ({ action: 'created' }),
        minifig: async () => ({ action: 'created' }),
        set: async () => ({ action: 'created' }),
      },
      rememberNumber: async (...a) => {
        gemerkt.push(a);
      },
    });
    assert.equal(b.corrections?.applied, 1, 'Vorbedingung: die Korrektur muss greifen, sonst sagt der Fall nichts');
    assert.equal(b.created, 0, 'Eine Vorschau legt nichts an');
    assert.deepEqual(gemerkt, [], 'In der Vorschau darf nichts gemerkt werden');
  });

  await t.test('7. describeItem does not make one query per item', async () => {
    // Marco's file has 224 rows. One query per row would be a preview
    // one waits for.
    const echt = db.pool.query.bind(db.pool);
    let abfragen = 0;
    db.pool.query = (...a) => {
      abfragen++;
      return echt(...a);
    };
    try {
      const parsed = readWantedList(
        liste(
          ...Array.from({ length: 60 }, (_, i) => item('P', `300${i % 10}`, 5, 1)),
          ...Array.from({ length: 20 }, (_, i) => item('M', `fig${i}`, null, 1)),
          ...Array.from({ length: 20 }, (_, i) => item('S', `1049${i}-1`, null, 1)),
        ),
      );
      const auf = await resolveLocalOn(parsed.items);
      abfragen = 0;
      await describeItem(auf);
      assert.ok(
        abfragen <= 4,
        `${abfragen} Abfragen für 100 Posten. Erlaubt sind höchstens 4 (Teile, ` +
          'Farbbilder, Figuren, Sets). Eine je Posten wären 100.',
      );
    } finally {
      db.pool.query = echt;
    }
  });

  await t.test('8. name and image are in the report EVEN after writing', async () => {
    // Marco's finding of 21.10.
    const creator = {
      part: async () => ({ action: 'created' }),
      minifig: async () => ({ action: 'created' }),
      set: async () => ({ action: 'created' }),
    };
    const b = await importWantedList(1, liste(item('P', '3001', 5, 1)), {
      preview: false,
      creator,
    });
    assert.equal(
      b.items[0].outcome,
      'created',
      'Der Posten muss wirklich geschrieben worden sein — sonst sagt der Fall ' +
        'nichts über den Weg NACH dem Schreiben',
    );
    assert.equal(b.items[0].name, 'Brick 2 x 4');
    assert.equal(
      b.items[0].image,
      'https://cdn.example/3001-rot.png',
      'Ohne das zeichnet der Dialog nach dem Import leere Zellen — genau ' + 'Marcos Befund',
    );
  });

  await t.test('9. an image fetched on creation is in the report', async () => {
    // The gain from describeItem running AFTER the loop: a
    // part whose color image the catalog did not have yet gets it on
    // creation (addManualPart → lookupPart → rememberPartColor). A call BEFORE
    // the loop would show nothing for exactly these items.
    await db.run(`INSERT INTO part_catalog (part_number, part_name)
                  VALUES ('7777','Noch ohne Bild') ON CONFLICT DO NOTHING`);
    const vorher = await importWantedList(1, liste(item('P', '7777', 5, 1)), { preview: true });
    assert.equal(
      vorher.items[0].image,
      null,
      'In der Vorschau gibt es das Bild noch nicht — sonst sagt der Fall nichts',
    );

    const b = await importWantedList(1, liste(item('P', '7777', 5, 1)), {
      preview: false,
      creator: {
        // The way addManualPart would do it: fill the catalog first, then report.
        part: async () => {
          await db.run(`INSERT INTO part_color_catalog (part_number, color_id, image_url)
                        VALUES ('7777',4,'https://cdn.example/7777.png')
                        ON CONFLICT DO NOTHING`);
          return { action: 'created' };
        },
        minifig: async () => ({ action: 'created' }),
        set: async () => ({ action: 'created' }),
      },
    });
    assert.equal(
      b.items[0].image,
      'https://cdn.example/7777.png',
      'Das beim Anlegen geschriebene Bild muss im Bericht ankommen',
    );
  });
});
