/**
 * Since db/base.sql the state BEFORE this migration no longer exists: the
 * cases on bolt, addendum and intermediate state are dropped. What is checked is
 * the final state and the read paths.
 *
 *      Counter-check: missing catalog row (filled in), drift (stopped),
 *      duplicates (merged) — and each time the run WITHOUT the step that
 *      prevents it, so that it is proven that it prevents it.
 *   3. Nobody WRITES the two columns any more.
 *   4. The read paths still deliver the piece count — from the catalog for a
 *      set part, from the acquisitions for a manual position. With
 *      counter-checks: if the source changes, the response follows.
 *   5. Every read place is EXECUTED. That is no accessory: subsetFrom()
 *      reads the alias `tm_e` that only teilmengeJoin() attaches. If the
 *      JOIN is missing, that is not a silent error but „missing FROM-clause entry
 *      for table tm_e" — MEASURED in computeMinifigStats(), where exactly that had
 *      happened. A pattern over the source text did NOT find this case
 *      (two of its three hits were false reports: a fragment is inserted into
 *      a query that carries the JOIN). Executing finds it.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip, unless
 * REQUIRE_DB=1.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { catalogSet } = require('./helpers/inventory');
const db = testData();

// The same reasoning as in test/set-quantity-from-entries-db.test.js: this
// file builds the database from zero several times. Whoever runs afterwards must
// find it COMPLETE — schema AND migrations. Without that the next
// file inherits half a database, and its failure looks like its own.
test.after(async () => {
  try {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  } catch (e) {
    console.error('[teilemengen-abgeleitet] Aufraeumen fehlgeschlagen:', e.message);
  }
  await db.pool.end().catch(() => {});
});

const columnsOf = async tabelle =>
  (await db.all(`SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [tabelle]))
    .map(r => r.column_name)
    .sort();

const indizes = async () =>
  (await db.all(`SELECT indexname FROM pg_indexes WHERE schemaname='public'`)).map(r => r.indexname);

const dbDa = async t => {
  try {
    await db.run('SELECT 1');
    return true;
  } catch (e) {
    keineDb(t, e);
    return false;
  }
};

/** Fresh database, schema, all migrations. */
async function fullChain() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c);
  } finally {
    c.release();
  }
}

test('after the whole chain parts and minifigs carry no quantity any more', { concurrency: 1 }, async t => {
  if (!(await dbDa(t))) return;

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  // The state before the migrations no longer exists: an empty
  // database gets db/base.sql. What is checked is the final state.
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }

  for (const tab of ['parts', 'minifigs']) {
    assert.ok(
      !(await columnsOf(tab)).includes('quantity'),
      `${tab}.quantity ist nach allen Migrationen noch da — Migration 0038 hat ` +
        `nicht geloescht, oder etwas legt die Spalte danach wieder an.`,
    );
  }

  // What a stock row still is: THIS account has THIS part, from THAT
  // set, at THAT place, in THAT condition.
  const parts = await columnsOf('parts');
  for (const sp of ['id', 'user_id', 'part_number', 'color_id', 'set_number', 'source', 'storage_id']) {
    assert.ok(parts.includes(sp), `parts.${sp} fehlt — die Spalte gehoert zum Bestand`);
  }

  // Not disappeared but moved — and to TWO places, depending
  // on what the number means.
  for (const [tab, sp] of [
    ['set_parts_catalog', 'quantity'],
    ['set_minifigs_catalog', 'quantity'],
    ['part_acquisitions', 'quantity'],
    ['minifig_acquisitions', 'quantity'],
  ]) {
    assert.ok((await columnsOf(tab)).includes(sp), `${tab}.${sp} fehlt — dann gibt es die Stueckzahl nirgends mehr`);
  }

  // The four indexes from steps 5 and 6. The two unique ones are not
  // cosmetics: without them the `ON CONFLICT DO NOTHING` of the imports was
  // INEFFECTIVE (there was no conflict it could hit), and
  // every repeated import of the same set created new rows. From 0038 on …
  const ix = await indizes();
  for (const name of [
    'idx_parts_unique',
    'idx_minifigs_unique',
    'idx_part_acq_acquisition_day',
    'idx_minifig_acq_acquisition_day',
  ]) {
    assert.ok(ix.includes(name), `${name} fehlt (Migration 0038, Schritt 5/6)`);
  }

  // And they really are UNIQUE — an index with the same name but
  // without UNIQUE could not be told apart here otherwise.
  for (const name of ['idx_parts_unique', 'idx_minifigs_unique']) {
    const r = await db.get(
      `SELECT indisunique FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = $1`,
      [name],
    );
    assert.equal(r?.indisunique, true, `${name} ist nicht eindeutig`);
  }
});

test('nobody writes the piece count of a part or a figure any more', () => {
  // Only the SOURCE TEXT, and only the WRITE side. The read side is not checked by
  // this test but by the database: after migration 0038 the columns
  // do not exist, every remaining read place is a hard error — and
  // exactly for that reason the read paths in the next case run against a migrated
  // database instead of against a pattern here.
  const dateien = [];
  const lauf = verz => {
    for (const e of fs.readdirSync(verz, { withFileTypes: true })) {
      const p = path.join(verz, e.name);
      if (e.isDirectory()) {
        lauf(p);
        continue;
      }
      if (/\.(ts|js)$/.test(e.name)) dateien.push(p);
    }
  };
  for (const teil of ['routes', 'src', 'jobs', 'db', 'clients', 'scripts']) {
    const v = path.join(ROOT, teil);
    if (fs.existsSync(v)) lauf(v);
  }
  dateien.push(path.join(ROOT, 'server.ts'));
  assert.ok(dateien.length > 100, `Nur ${dateien.length} Quelldateien gefunden — der Pfad stimmt nicht`);

  // Lines without comments: an explanatory text that QUOTES a statement is
  // not a write access. Exactly this trap has already made a rule in this tree
  // report its own reasoning text — and the comments in
  // src/sets/setMove.ts and db/migrations/0038 quote the removed
  // statements literally.
  const codeRows = txt =>
    txt.split('\n').filter(z => {
      const t = z.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('--'));
    });

  // Only parts and minifigs. The catalog and acquisition tables of course keep
  // writing their quantity — they are the truth, not the copy.
  /** @type {[string, RegExp][]} */
  const muster = [
    ['setzt parts', /UPDATE\s+parts\s+SET\s+[^;`']*\bquantity\s*=/i],
    ['setzt minifigs', /UPDATE\s+minifigs\s+SET\s+[^;`']*\bquantity\s*=/i],
    ['parts bei Konflikt', /INSERT\s+INTO\s+parts\b[^;]*DO\s+UPDATE\s+SET\s+[^;]*\bquantity\s*=/i],
    ['figs bei Konflikt', /INSERT\s+INTO\s+minifigs\b[^;]*DO\s+UPDATE\s+SET\s+[^;]*\bquantity\s*=/i],
    // And the columns must not be created again — an
    // `ADD COLUMN quantity` would bring the copy back without violating a single
    // one of the rules above.
    ['legt parts an', /ALTER\s+TABLE\s+parts\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?quantity/i],
    ['legt minifigs an', /ALTER\s+TABLE\s+minifigs\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?quantity/i],
  ];

  const stellen = [];
  for (const datei of dateien) {
    const rel = path.relative(ROOT, datei);
    const txt = fs.readFileSync(datei, 'utf8');
    for (const z of codeRows(txt)) {
      for (const [was, m] of muster) {
        if (m.test(z)) stellen.push(`${rel} (${was}): ${z.trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(
    stellen,
    [],
    'Diese Stellen schreiben die Stueckzahl eines Teils oder einer Figur:\n  ' +
      stellen.join('\n  ') +
      '\nSie steht seit Migration 0038 im Set-Katalog (fuer source=set) bzw. in den ' +
      'Erfassungen (fuer source=manual). Eine Abschrift daneben laeuft auseinander — ' +
      'genau das war bei sets.quantity gemessen worden: 10 bei drei Erfassungen mit Summe 7.',
  );

  // Selbstbeweis
  const proben = [
    ['UPDATE parts SET quantity = $1 WHERE user_id=$2', 'setzt parts'],
    ['UPDATE minifigs SET quantity = $2 WHERE user_id=$1', 'setzt minifigs'],
    [
      `INSERT INTO parts (user_id,part_number,quantity) VALUES ($1,$2,$3)
        ON CONFLICT (user_id,part_number) DO UPDATE SET quantity = EXCLUDED.quantity`,
      'parts bei Konflikt',
    ],
    [
      `INSERT INTO minifigs (user_id,fig_number,quantity) VALUES ($1,$2,$3)
        ON CONFLICT (user_id,fig_number) DO UPDATE SET quantity = EXCLUDED.quantity`,
      'figs bei Konflikt',
    ],
    ['ALTER TABLE parts ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1', 'legt parts an'],
    ['ALTER TABLE minifigs ADD COLUMN quantity INTEGER DEFAULT 1', 'legt minifigs an'],
  ];
  for (const [row, name] of proben) {
    const m = muster.find(([was]) => was === name)[1];
    assert.ok(m.test(row), `Das Muster „${name}" greift nicht mehr auf seine eigene Probe: ${row.slice(0, 60)}`);
  }
  // And the opposite direction: what is allowed must NOT trigger. Without this
  // half a pattern that fits every line would be green too.
  for (const row of [
    'UPDATE part_acquisitions SET quantity = quantity - $1 WHERE id=$2',
    'UPDATE minifig_acquisitions SET quantity = $1 WHERE id=$2',
    `INSERT INTO set_parts (set_number,part_number,color_id,quantity) VALUES ($1,$2,$3,$4)
       ON CONFLICT (set_number,part_number,color_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
    'UPDATE sets SET storage_id = $1 WHERE id=$2',
  ]) {
    for (const [was, m] of muster) {
      assert.ok(!m.test(row), `Das Muster „${was}" meldet eine erlaubte Zeile: ${row.trim().slice(0, 70)}`);
    }
  }
});

test('the read paths deliver the piece count from catalog and acquisitions', { concurrency: 1 }, async t => {
  if (!(await dbDa(t))) return;

  await fullChain();

  const haupt = (await db.get(`INSERT INTO users (username,password_hash) VALUES ('tmleser','x') RETURNING id`)).id;
  const kind = (await db.get(`INSERT INTO users (username,password_hash) VALUES ('tmleser_kind','x') RETURNING id`)).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [haupt, kind]);
  const SN = '75192-1';

  // The situation
  await catalogSet(db, SN, { name: 'Millennium Falcon', year: 2017, pieces: 7541 });
  await db.run(`INSERT INTO sets (user_id,set_number) VALUES ($1,$2),($3,$2)`, [haupt, SN, kind]);
  // Different days: idx_set_acq_tag_zustand (migration 0008) allows per account, set
  // and DAY only one acquisition.
  await db.run(
    `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
                VALUES ($1,$2,2,100,'N', NOW() - INTERVAL '3 days'),
                       ($3,$2,1, 90,'N', NOW() - INTERVAL '2 days')`,
    [haupt, SN, kind],
  );

  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES
                  ('3001','Brick 2x4'), ('3070b','Tile 1x1')
                ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name) VALUES
                  ('3001',4,'Rot'), ('3070b',0,'Schwarz')
                ON CONFLICT (part_number,color_id) DO NOTHING`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name) VALUES
                  ('sw0001','Han Solo'), ('fig-m','Eigenbau')
                ON CONFLICT (fig_number) DO NOTHING`);

  // Set part: the piece count stands ONCE in the catalog of the set — shared by
  // all accounts that hold the set.
  await db.run(
    `INSERT INTO set_parts (set_number,part_number,color_id,quantity)
                VALUES ($1,'3001',4,6)`,
    [SN],
  );
  await db.run(
    `INSERT INTO parts (user_id,set_number,part_number,color_id,source)
                VALUES ($1,$2,'3001',4,'set'), ($3,$2,'3001',4,'set')`,
    [haupt, SN, kind],
  );
  await db.run(
    `INSERT INTO set_minifigs (set_number,fig_number,quantity)
                VALUES ($1,'sw0001',1)`,
    [SN],
  );
  await db.run(
    `INSERT INTO minifigs (user_id,set_number,fig_number,source)
                VALUES ($1,$2,'sw0001','set'), ($3,$2,'sw0001','set')`,
    [haupt, SN, kind],
  );

  // Manual position: the piece count is the sum of its acquisitions.
  await db.run(
    `INSERT INTO parts (user_id,part_number,color_id,source)
                VALUES ($1,'3070b',0,'manual')`,
    [haupt],
  );
  await db.run(
    `INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                VALUES ($1,'3070b',0,2,0.50,'N', NOW() - INTERVAL '2 days'),
                       ($1,'3070b',0,3,0.60,'N', NOW() - INTERVAL '1 day')`,
    [haupt],
  );
  await db.run(
    `INSERT INTO minifigs (user_id,fig_number,source)
                VALUES ($1,'fig-m','manual')`,
    [haupt],
  );
  await db.run(
    `INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition)
                VALUES ($1,'fig-m',2,9.00,'N')`,
    [haupt],
  );

  const P = _req('src/parts/queries.js');
  const M = _req('src/minifigs/queries.js');
  const S = _req('src/inventory/metrics.js');
  const SH = _req('src/inventory/shared.js');

  // ── Metrics, one account ────────────────────────────────────────────────
  //
  // 6 in the set × 2 copies = 12, plus 5 manual = 17. The manual position
  // must NOT be multiplied by the set quantity — it belongs to no
  // set. If 22 stood here, exactly that would have happened.
  const st1 = await S.getStats([haupt]);
  assert.equal(
    Number(st1.total_parts),
    17,
    `Ein Konto: 6 im Set × 2 Exemplare + 5 manuell = 17, bekam ${st1.total_parts}`,
  );
  assert.equal(
    Number(st1.total_minifigs),
    4,
    `Ein Konto: 1 im Set × 2 Exemplare + 2 manuell = 4, bekam ${st1.total_minifigs}`,
  );

  // ── Metrics, household ─────────────────────────────────────────────────
  //
  // Plus the one copy of the child: 6 × 1 = 6, so 23. The catalog number is
  // THE SAME for both accounts — that is the point of the move: before, every
  // account carried its own copy, and two copies of the same number
  // can drift apart.
  const st2 = await S.getStats([haupt, kind]);
  assert.equal(Number(st2.total_parts), 23, `Haushalt: 12 + 5 + 6 = 23, bekam ${st2.total_parts}`);
  assert.equal(Number(st2.total_minifigs), 5, `Haushalt: 2 + 2 + 1 = 5, bekam ${st2.total_minifigs}`);

  // ── The lists ───────────────────────────────────────────────────────────
  const liste = await P.partsQuery([haupt], { page_size: 60 });
  const rowOf = (l, nr) => (l.parts || []).find(x => x.part_number === nr);
  assert.equal(
    Number(rowOf(liste, '3001').total_quantity),
    12,
    'Die Teileliste multipliziert die Katalogzahl nicht mit der Setmenge',
  );
  assert.equal(
    Number(rowOf(liste, '3070b').total_quantity),
    5,
    'Die Teileliste liest die manuelle Position nicht aus den Erfassungen',
  );
  // The driver delivers BIGINT as a STRING. Without the ::int cast the
  // JSON type depends on which branch answered — exactly this error
  // already surfaced once in src/parts/queries.ts.
  assert.equal(
    typeof rowOf(liste, '3001').total_quantity,
    'number',
    'total_quantity muss eine Zahl sein, keine Zeichenkette',
  );

  const figList = await M.readMinifigs([haupt], { page_size: 60 });
  const figOf = (l, nr) => (l.figs || []).find(x => x.fig_number === nr);
  assert.equal(
    Number(figOf(figList, 'sw0001').total_quantity),
    2,
    'Die Figurenliste multipliziert nicht mit der Setmenge',
  );
  assert.equal(
    Number(figOf(figList, 'fig-m').total_quantity),
    2,
    'Die Figurenliste liest die manuelle Figur nicht aus den Erfassungen',
  );

  assert.equal(
    Number((await M.computeMinifigStats([haupt])).total_quantity),
    4,
    'Die Figuren-Kennzahl rechnet nicht mit',
  );
  // partStatsQuery DELIBERATELY counts only set parts — manually captured ones have
  // their own area in the UI (the filter stands in
  // src/parts/summary.ts and in the fallback below it). So 12, not 17. This
  // number is no side finding here: if 17 stood here, the metric would count the …
  assert.equal(
    Number((await P.partStatsQuery([haupt])).total_parts),
    12,
    'Die Teile-Kennzahl zaehlt nur Set-Teile: 6 × 2 Exemplare = 12',
  );

  // ── The lists of the MANUAL positions ─────────────────────────────────
  const man = await P.manualPartsList([haupt], haupt, { page_size: 60 });
  const manRow = man.find(x => x.part_number === '3070b');
  assert.ok(manRow, 'Die manuelle Position fehlt in der Liste');
  assert.equal(Number(manRow.quantity), 5, `Manuelle Teileliste: 2 + 3 = 5, bekam ${manRow.quantity}`);
  const manFig = (await M.readManualMinifigs([haupt], haupt, { page_size: 60 })).find(x => x.fig_number === 'fig-m');
  assert.ok(manFig, 'Die manuelle Figur fehlt in der Liste');
  assert.equal(Number(manFig.quantity), 2, `Manuelle Figurenliste: 2, bekam ${manFig.quantity}`);

  // ── „Can I build this?" ───────────────────────────────────────────────
  //
  // ownedQuantitiesQuery separates TOTAL from LOOSE: a part that sits in a set
  // is present but not at hand. Exactly this separation needs
  // the case distinction at two places in ONE query.
  const besitz = await P.ownedQuantitiesQuery(
    [haupt],
    [
      { part_number: '3001', color_id: 4 },
      { part_number: '3070b', color_id: 0 },
    ],
  );
  assert.equal(besitz['3001|4']?.total, 12, 'Set-Teil: 6 × 2 Exemplare');
  assert.equal(besitz['3001|4']?.loose, 0, 'Ein Teil im Set ist nicht lose');
  assert.equal(besitz['3070b|0']?.total, 5, 'Manuelle Position: 2 + 3');
  assert.equal(besitz['3070b|0']?.loose, 5, 'Eine manuelle Position ist lose');

  // ── The dialog „which sets is it in?" ────────────────────────────
  //
  // Here the shared catalog number shows most clearly: two accounts,
  // one set, ONE number — namely the one PER COPY, without multiplication, because
  // the dialog shows the set, not the stock.
  const verw = await SH.usingSets([haupt, kind], 'parts', { part_number: '3001', color_id: 4 });
  assert.equal(verw.sets.length, 2, `Beide Konten halten das Set, erwartet zwei Zeilen, bekam ${verw.sets.length}`);
  for (const s of verw.sets) {
    assert.equal(Number(s.quantity), 6, `Jede Zeile muss die Katalogzahl 6 tragen, bekam ${s.quantity}`);
  }

  // ── Colors and summary ──────────────────────────────────────────
  const farben = await P.partColorsQuery([haupt]);
  assert.ok(
    Array.isArray(farben) && farben.length > 0,
    'Die Farbliste ist leer — sie zaehlt mit subsetFrom() und muesste zwei Farben haben',
  );

  // rebuildNow() and not rebuild(): the list calls above have already triggered
  // a BACKGROUND build via summaryFresh(), and that one holds
  // the lock pg_try_advisory_xact_lock. rebuild() called directly sees the
  // lock, returns silently („somebody else is building right now") and builds …
  const { rebuildNow } = _req('src/parts/summary.js');
  await rebuildNow(haupt);
  const zus = await db.get(`SELECT total_quantity FROM parts_summary WHERE user_id=$1 AND part_number='3001'`, [haupt]);
  assert.ok(zus, 'Die Zusammenfassung hat das Set-Teil nicht aufgenommen');
  assert.equal(Number(zus.total_quantity), 12, `Die vorberechnete Zahl ist 6 × 2 = 12, bekam ${zus.total_quantity}`);

  // valuation and CSV
  const B = _req('src/finances/calculation/valuation.js');
  const bewP = await B.valueParts(haupt, [haupt]);
  const bewRow = (bewP.parts || []).find(x => x.part_number === '3070b');
  assert.ok(bewRow, `Die Teile-Bewertung kennt die manuelle Position nicht: ${JSON.stringify(bewP).slice(0, 200)}`);
  assert.equal(Number(bewRow.quantity), 5, `Die Bewertung liest 2 + 3 = 5, bekam ${bewRow.quantity}`);
  assert.ok(
    !(bewP.parts || []).some(x => x.part_number === '3001'),
    'Das Set-Teil steht in der Teile-Bewertung — dann wird es zweimal bewertet, ' +
      'einmal hier und einmal ueber sein Set',
  );
  const bewM = await B.valueMinifigs(haupt, [haupt]);
  const bewFig = (bewM.figs || []).find(x => x.fig_number === 'fig-m');
  assert.ok(bewFig, `Die Figuren-Bewertung kennt die manuelle Figur nicht: ${JSON.stringify(bewM).slice(0, 200)}`);
  assert.equal(Number(bewFig.quantity), 2, `Die Figuren-Bewertung liest 2, bekam ${bewFig.quantity}`);

  const csvP = await _req('src/inventory/inventoryExport.js').partsCsv(haupt);
  assert.match(csvP, /3070b/, 'Der Teile-Export laesst die manuelle Position aus');
  const csvM = await _req('src/inventory/inventoryExport.js').minifigsCsv(haupt);
  assert.match(csvM, /fig-m/, 'Der Figuren-Export laesst die manuelle Figur aus');

  // ── COUNTER-CHECK 1: change the CATALOG NUMBER ────────────────────────────────
  //
  // The core of this case. Without it all numbers above could be right by chance
  // — say from another source that happens to say the same. Only when the
  // response FOLLOWS a change is it proven where it comes from. And it must
  // follow for BOTH accounts: the catalog is shared.
  await db.run(
    `UPDATE set_parts SET quantity = 9
                 WHERE set_number=$1 AND part_number='3001'`,
    [SN],
  );
  assert.equal(
    Number((await S.getStats([haupt])).total_parts),
    23,
    'Nach 6 → 9 muss ein Konto 9 × 2 + 5 = 23 zaehlen — dann liest die Kennzahl ' +
      'die Zahl nicht aus set_parts_catalog',
  );
  assert.equal(
    Number((await S.getStats([kind])).total_parts),
    9,
    'Das Kind muss der GEMEINSAMEN Katalogzahl ebenso folgen: 9 × 1 = 9',
  );
  assert.equal(
    Number(rowOf(await P.partsQuery([haupt], { page_size: 60 }), '3001').total_quantity),
    18,
    'Die Liste folgt der Katalogzahl nicht: 9 × 2 = 18',
  );

  // ── COUNTER-CHECK 2: change an ACQUISITION ─────────────────────────────────
  //
  // The same probe for the other branch. That both counter-checks are
  // needed is the whole reason why subsetFrom() is a CASE distinction
  // and not a single query.
  const eine = await db.get(
    `SELECT id FROM part_acquisitions WHERE user_id=$1 AND part_number='3070b'
      ORDER BY id ASC LIMIT 1`,
    [haupt],
  );
  await db.run(`UPDATE part_acquisitions SET quantity = 7 WHERE id=$1`, [eine.id]);
  assert.equal(
    Number(rowOf(await P.partsQuery([haupt], { page_size: 60 }), '3070b').total_quantity),
    10,
    'Nach 2 → 7 muss die manuelle Position 10 sein (7 + 3) — dann liest die Liste ' + 'sie nicht aus part_acquisitions',
  );

  // ── And without an acquisition the quantity is 0, not 1 ─────────────────────────
  //
  // A manual stock row without an acquisition should not exist
  // (migration 0035 fills one in for each), but it must not EMPTY
  // the list — hence LEFT JOIN in db/stockQuantity.ts. It then means
  // zero pieces, not one.
  await db.run(`DELETE FROM part_acquisitions WHERE user_id=$1 AND part_number='3070b'`, [haupt]);
  const leer = rowOf(await P.partsQuery([haupt], { page_size: 60 }), '3070b');
  assert.ok(
    leer,
    'Die Zeile ohne Erfassung ist aus der Liste verschwunden — ein ' +
      'INNER JOIN statt LEFT JOIN leert den Bestand, statt 0 zu zeigen',
  );
  assert.equal(
    Number(leer.total_quantity),
    0,
    `Ohne Erfassung sind es 0 Stueck, nicht ${leer.total_quantity} — der ` +
      'Rueckfallwert 1 gilt nur fuer den SET-Zweig (ein Set-Teil steckt mindestens einmal drin)',
  );
});
