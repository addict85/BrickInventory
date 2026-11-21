/**
 * Since db/basis.sql the state BEFORE this migration no longer exists: the
 * cases on latch, addendum and intermediate state have been dropped. What is checked
 * is the final state and the read paths.
 *
 *      COUNTER-CHECK: if the mapping changes, the response follows.
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
const db = testData();
const { holdsMinifig, holdsPart } = require('./helpers/inventory');

// The same rationale as in test/set-quantity-from-entries-db.test.js: this
// file builds the database from scratch several times.
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
    console.error('[bricklink-zuordnung] Aufraeumen fehlgeschlagen:', e.message);
  }
  await db.pool.end().catch(() => {});
});

const columnsOf = async tabelle =>
  (await db.all(`SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [tabelle]))
    .map(r => r.column_name)
    .sort();

const tableDa = async name => !!(await db.get(`SELECT to_regclass($1) AS t`, [name]))?.t;

const dbDa = async t => {
  try {
    await db.run('SELECT 1');
    return true;
  } catch (e) {
    keineDb(t, e);
    return false;
  }
};

test('after the whole chain the numbers are only in bl_mapping', { concurrency: 1 }, async t => {
  if (!(await dbDa(t))) return;

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  // The pre-state before the migrations no longer exists: an empty
  // database gets db/basis.sql. What is checked is the final state.
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }

  // ── Afterwards: the copies are gone ─────────────────────────────────────
  assert.ok(
    !(await columnsOf('parts')).includes('bl_part_number'),
    'parts.bl_part_number ist nach allen Migrationen noch da',
  );
  assert.ok(
    !(await columnsOf('set_parts_catalog')).includes('bl_part_number'),
    'set_parts_catalog.bl_part_number ist nach allen Migrationen noch da',
  );
  assert.ok(
    !(await columnsOf('minifigs')).includes('bl_fig_number'),
    'minifigs.bl_fig_number ist nach allen Migrationen noch da',
  );
  assert.ok(
    !(await tableDa('rb_bl_mapping')),
    'rb_bl_mapping gibt es noch — ihr Inhalt steht als Art part in bl_mapping',
  );

  // ── And the mapping stands ──────────────────────────────────────────────
  const z = await columnsOf('bl_mapping');
  assert.deepEqual(
    z,
    ['bl_id', 'fetched_at', 'rb_id', 'type'],
    `bl_mapping hat nicht die vorgesehenen Spalten: ${z.join(', ')}`,
  );

  // The kind is constrained — a typo should not pass as a fourth kind
  // and silently create invisible rows there.
  await assert.rejects(
    () => db.run(`INSERT INTO bl_mapping (type, rb_id) VALUES ('teil','x')`),
    /bl_zuordnung_art|check constraint/,
    'Eine erfundene Art wird angenommen — dann liegen Zeilen da, die keine ' + 'Leseabfrage je findet',
  );
  for (const type of ['part', 'fig', 'set']) {
    await db.run(`INSERT INTO bl_mapping (type, rb_id) VALUES ($1,'x') ` + `ON CONFLICT DO NOTHING`, [type]);
  }
  assert.equal(
    (await db.get(`SELECT COUNT(*)::int AS c FROM bl_mapping WHERE rb_id='x'`)).c,
    3,
    'Nicht alle drei Arten sind erlaubt — Marcos Vorgabe nennt Minifiguren, ' + 'Parts UND Sets',
  );
  await db.run(`DELETE FROM bl_mapping WHERE rb_id='x'`);

  // The index for the uniqueness check of the latch.
  const idx = (await db.all(`SELECT indexname FROM pg_indexes WHERE tablename='bl_mapping'`)).map(r => r.indexname);
  assert.ok(idx.includes('idx_bl_zuordnung_bl'), `idx_bl_zuordnung_bl fehlt — gefunden: ${idx.join(', ')}`);
});

test('the read paths deliver the BrickLink number from the mapping', { concurrency: 1 }, async t => {
  if (!(await dbDa(t))) return;

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c0 = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c0);
  } finally {
    c0.release();
  }

  const u = await db.get(`INSERT INTO users (username,password_hash) VALUES ('blleser','x') RETURNING id`);
  const uid = u.id;

  // A manual part and a manual minifigure, both with a DEVIATING
  // BrickLink number in the mapping.
  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ('3070b','Tile 1x1')
                ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name)
                VALUES ('3070b',0,'Schwarz') ON CONFLICT (part_number,color_id) DO NOTHING`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name) VALUES ('fig-9','Testfigur')
                ON CONFLICT (fig_number) DO NOTHING`);
  // Stock row AND entry in one — since migration 0038 the item count
  // is only there.
  await holdsPart(db, uid, '3070b', { menge: 5, colorId: 0, preis: 1.0 });
  await holdsMinifig(db, uid, 'fig-9', { menge: 2, preis: 5.0 });
  await db.run(`INSERT INTO bl_mapping (type,rb_id,bl_id) VALUES
                ('part','3070b','3070'), ('fig','fig-9','sw9999')`);

  const H = _req('src/parts/queries.js');
  const M = _req('src/minifigs/queries.js');

  const teile = await H.manualPartsList([uid], uid);
  const teil = (Array.isArray(teile) ? teile : teile.parts || []).find(p => p.part_number === '3070b');
  assert.ok(teil, `Das Teil fehlt in der Antwort: ${JSON.stringify(teile).slice(0, 300)}`);
  assert.equal(
    teil.bl_part_number,
    '3070',
    `bl_part_number kam als ${teil.bl_part_number} statt 3070 — die Liste liest die ` + 'Nummer nicht aus bl_mapping',
  );

  const figs = await M.readManualMinifigs([uid], uid);
  const fig = (Array.isArray(figs) ? figs : figs.minifigs || []).find(f => f.fig_number === 'fig-9');
  assert.ok(fig, `Die Figur fehlt in der Antwort: ${JSON.stringify(figs).slice(0, 300)}`);
  assert.equal(fig.bl_fig_number, 'sw9999', `bl_fig_number kam als ${fig.bl_fig_number} statt sw9999`);

  // ── COUNTER-CHECK: change the mapping ────────────────────────────────────
  //
  // The core of this test. Without it the values above could be right by chance —
  // say from another source that happens to say the same. Only when the
  // response FOLLOWS a change is it proven where it comes from.
  await db.run(`UPDATE bl_mapping SET bl_id='3070neu' WHERE type='part' AND rb_id='3070b'`);
  await db.run(`UPDATE bl_mapping SET bl_id='sw0000'  WHERE type='fig'  AND rb_id='fig-9'`);

  const teile2 = await H.manualPartsList([uid], uid);
  const teil2 = (Array.isArray(teile2) ? teile2 : teile2.parts || []).find(p => p.part_number === '3070b');
  assert.equal(
    teil2.bl_part_number,
    '3070neu',
    `Die Teileliste folgt der Zuordnung nicht: ${teil2.bl_part_number} statt 3070neu`,
  );

  const figs2 = await M.readManualMinifigs([uid], uid);
  const fig2 = (Array.isArray(figs2) ? figs2 : figs2.minifigs || []).find(f => f.fig_number === 'fig-9');
  assert.equal(
    fig2.bl_fig_number,
    'sw0000',
    `Die Figurenliste folgt der Zuordnung nicht: ${fig2.bl_fig_number} statt sw0000`,
  );

  // ── And WITHOUT a mapping the Rebrickable number applies ─────────────────
  //
  // The mapping only records the DEVIATION. No entry means “is called the
  // same there" — and not “empty": as a grouping key a NULL value
  // would fall into its own group, and every part without a mapping would stand
  // individually in the list.
  await db.run(`DELETE FROM bl_mapping WHERE type='part' AND rb_id='3070b'`);
  const teile3 = await H.manualPartsList([uid], uid);
  const teil3 = (Array.isArray(teile3) ? teile3 : teile3.parts || []).find(p => p.part_number === '3070b');
  assert.equal(
    teil3.bl_part_number,
    '3070b',
    `Ohne Zuordnung muss die Rebrickable-Nummer herauskommen, nicht ${teil3.bl_part_number}`,
  );
});

test('nobody writes a BrickLink number to an inventory row any more', () => {
  // Only the SOURCE TEXT, and only the WRITE side. The read side is checked by the
  // database: after migration 0037 the columns do not exist, every remaining
  // read site is a hard error — and that is exactly why the read paths
  // above run against a migrated database.
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
  assert.ok(dateien.length > 100, `Nur ${dateien.length} Quelldateien gefunden`);

  const codeRows = txt =>
    txt.split('\n').filter(z => {
      const t = z.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('--'));
    });

  // The three copies, and the old table. parts_summary.bl_part_number
  // is excluded: this table is a cache, it holds the
  // group key as a finished column (src/parts/summary.ts).
  /** @type {[string, RegExp][]} */
  const muster = [
    ['setzt parts.bl_part_number', /UPDATE\s+parts\s+SET\s+[^;`']*\bbl_part_number\s*=/i],
    ['setzt minifigs.bl_fig_number', /UPDATE\s+minifigs\s+SET\s+[^;`']*\bbl_fig_number\s*=/i],
    ['setzt den Set-Teile-Katalog', /UPDATE\s+set_parts_catalog\s+SET\s+[^;`']*\bbl_part_number\s*=/i],
    [
      'legt die Spalte wieder an',
      /ALTER\s+TABLE\s+(?:parts|minifigs|set_parts_catalog)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?bl_(?:part|fig)_number/i,
    ],
    ['benutzt rb_bl_mapping', /\brb_bl_mapping\b/i],
  ];

  const stellen = [];
  for (const datei of dateien) {
    const rel = path.relative(ROOT, datei);
    // Migrations (.sql) are not included: 0037 must keep reading the old columns and
    // the old table.
    for (const z of codeRows(fs.readFileSync(datei, 'utf8'))) {
      for (const [was, m] of muster) if (m.test(z)) stellen.push(`${rel} (${was}): ${z.trim().slice(0, 80)}`);
    }
  }
  assert.deepEqual(
    stellen,
    [],
    'Diese Stellen schreiben eine BrickLink-Nummer an eine Bestandszeile oder ' +
      'benutzen die alte Tabelle:\n  ' +
      stellen.join('\n  ') +
      '\nSie steht seit Migration 0037 in bl_mapping, einmal je Gegenstand.',
  );

  // ── Selbstbeweis ─────────────────────────────────────────────────────────
  //
  // The patterns find nothing now — that is the point, but alone it does not yet
  // say that they COULD find something. So proven on invented lines,
  // in exactly the form that stood in the tree before (the first three
  // stood like this in the parts import and in the minifigure routes before migration 0037).
  const proben = [
    'UPDATE parts SET bl_part_number = m.bl_part_num FROM x',
    'UPDATE minifigs SET bl_fig_number=$1 WHERE id=$2',
    'UPDATE set_parts_catalog SET bl_part_number = m.bl_part_num FROM x',
    'ALTER TABLE parts ADD COLUMN IF NOT EXISTS bl_part_number TEXT',
    'SELECT bl_part_num FROM rb_bl_mapping WHERE part_num=$1',
  ];
  for (const zeile of proben) {
    assert.ok(
      muster.some(([, m]) => m.test(zeile)),
      `Kein Muster greift auf seine eigene Probe: ${zeile.slice(0, 60)}`,
    );
  }
  // And the opposite direction: what is allowed must NOT match.
  for (const zeile of [
    'INSERT INTO bl_mapping (type, rb_id, bl_id) VALUES ($1,$2,NULLIF($3,$2))',
    'INSERT INTO parts_summary (user_id, part_key, bl_part_number) SELECT 1,2,3',
    'UPDATE rb_colors SET bl_color_id = $1 WHERE id = $2',
  ]) {
    for (const [was, m] of muster) {
      assert.ok(!m.test(zeile), `Das Muster „${was}" meldet eine erlaubte Zeile: ${zeile.slice(0, 70)}`);
    }
  }
});
