/**
 * Since db/basis.sql the state BEFORE this migration no longer exists: the
 * cases on bolt, addendum and intermediate state are dropped. What is checked is
 * the final state and the read paths.
 *
 *      COUNTER-CHECK: if an acquisition changes, the response follows.
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

// The same reasoning as in test/parts-prices-only-entries-db.test.js:
// this file builds the database from zero several times. Whoever runs afterwards
// must find it complete.
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
    console.error('[setmenge-aus-erfassungen] Aufraeumen fehlgeschlagen:', e.message);
  }
  await db.pool.end().catch(() => {});
});

const columnsOf = async tabelle =>
  (await db.all(`SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [tabelle]))
    .map(r => r.column_name)
    .sort();

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

test('after the whole chain sets carries no quantity anymore', { concurrency: 1 }, async t => {
  if (!(await dbDa(t))) return;

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  // The state before the migrations no longer exists: an empty
  // database gets db/basis.sql. What is checked is the final state.
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }

  const nachher = await columnsOf('sets');
  assert.ok(
    !nachher.includes('quantity'),
    'sets.quantity ist nach allen Migrationen noch da — Migration 0036 hat nicht ' +
      'geloescht, oder etwas legt die Spalte danach wieder an.',
  );

  // And what `sets` still is: THIS account holds THIS set, since THEN, at THAT
  // place. Marco's list.
  for (const sp of ['id', 'user_id', 'set_number', 'storage_id', 'added_at', 'updated_at']) {
    assert.ok(nachher.includes(sp), `sets.${sp} fehlt — die Spalte gehoert zum Bestand`);
  }

  // Not disappeared but moved.
  const erf = await columnsOf('set_acquisitions');
  for (const sp of ['user_id', 'set_number', 'quantity', 'purchase_price', 'condition', 'created_at']) {
    assert.ok(erf.includes(sp), `set_acquisitions.${sp} fehlt — dann gibt es die Stueckzahl nirgends mehr`);
  }
});

test('nobody writes the item count of a set anymore', () => {
  // Only the SOURCE TEXT, and only the WRITE side. The read side is not checked by
  // this test but by the database: after migration 0036 the column does not
  // exist, every remaining read place is a hard error — and exactly
  // for that reason the read paths below run against a migrated database.
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

  /** Lines without comments — an explanatory text that QUOTES a statement is
   *  not a write access. Exactly this trap has already made a rule in this tree
   *  report its own reasoning text. */
  const codeRows = txt =>
    txt.split('\n').filter(z => {
      const t = z.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('--'));
    });

  // Only the sets table: the acquisition tables of course keep writing their own
  // quantity — they are the truth, not the copy.
  // MEASURED with the first draft of this rule in its broader version: it
  // reported `UPDATE part_acquisitions SET quantity=quantity-$1` as a violation,
  // and that is exactly the path on which an acquisition becomes smaller.
  const setzt = /UPDATE\s+sets\s+SET\s+[^;`']*\bquantity\s*=/i;
  const fortschreiben = /UPDATE\s+sets\s+SET\s+quantity\s*=\s*(?:sets\.)?quantity\s*[+-]/i;
  const onConflict = /INSERT\s+INTO\s+sets\b[^;]*DO\s+UPDATE\s+SET\s+[^;]*\bquantity\s*=/i;
  // And the column must not be created again either — an
  // `ADD COLUMN quantity` on sets would bring the copy back without violating a
  // single one of the rules above.
  const legtAn = /ALTER\s+TABLE\s+sets\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?quantity/i;

  const stellen = [];
  for (const datei of dateien) {
    const rel = path.relative(ROOT, datei);
    const txt = fs.readFileSync(datei, 'utf8');
    for (const z of codeRows(txt)) {
      for (const [was, muster] of /** @type {[string, RegExp][]} */ ([
        ['setzt', setzt],
        ['schreibt fort', fortschreiben],
        ['bei Konflikt', onConflict],
        ['legt an', legtAn],
      ])) {
        if (muster.test(z)) stellen.push(`${rel} (${was}): ${z.trim().slice(0, 90)}`);
      }
    }
  }

  assert.deepEqual(
    stellen,
    [],
    'Diese Stellen schreiben die Stückzahl eines Sets:\n  ' +
      stellen.join('\n  ') +
      '\nSie steht seit Migration 0036 ausschliesslich in set_acquisitions. Genau die ' +
      'zweite Schreibrichtung ist auseinandergelaufen: sets.quantity = 10 bei drei ' +
      'Erfassungen mit Summe 7.',
  );

  // ── Selbstbeweis ─────────────────────────────────────────────────────────
  //
  // The patterns above now find nothing — that is the point, but alone it does not
  // say yet that they COULD find anything at all. So proven once on
  // invented lines, in exactly the form that stood in the tree before
  // (the examples stand like this in src/sets/service.ts, version before 0036).
  const proben = [
    ['UPDATE sets SET quantity = $1 WHERE user_id=$2', setzt],
    ['UPDATE sets SET quantity = quantity + $1 WHERE id=$2', fortschreiben],
    [
      `INSERT INTO sets (user_id,set_number,quantity) VALUES ($1,$2,$3)
        ON CONFLICT (user_id,set_number) DO UPDATE SET quantity = sets.quantity + 1`,
      onConflict,
    ],
    ['ALTER TABLE sets ADD COLUMN IF NOT EXISTS quantity INTEGER', legtAn],
  ];
  for (const [zeile, muster] of /** @type {[string, RegExp][]} */ (proben)) {
    assert.ok(muster.test(zeile), `Das Muster greift nicht mehr auf seine eigene Probe: ${zeile.slice(0, 60)}`);
  }
  // And the opposite direction: what is allowed must NOT trigger.
  for (const zeile of [
    'UPDATE set_acquisitions SET quantity = quantity - $1 WHERE id=$2',
    'UPDATE parts SET quantity = COALESCE((SELECT SUM(a.quantity) FROM part_acquisitions a), 0)',
  ]) {
    for (const [was, muster] of /** @type {[string, RegExp][]} */ ([
      ['setzt', setzt],
      ['schreibt fort', fortschreiben],
      ['bei Konflikt', onConflict],
      ['legt an', legtAn],
    ])) {
      assert.ok(!muster.test(zeile), `Das Muster „${was}" meldet eine erlaubte Zeile: ${zeile.slice(0, 70)}`);
    }
  }
});

test('the read paths deliver the item count from the entries', { concurrency: 1 }, async t => {
  if (!(await dbDa(t))) return;

  await fullChain();

  const haupt = await db.get(`INSERT INTO users (username,password_hash) VALUES ('mengeleser','x') RETURNING id`);
  const kind = await db.get(`INSERT INTO users (username,password_hash) VALUES ('mengeleser_kind','x') RETURNING id`);
  const SN = '10290-1';

  await catalogSet(db, SN, { name: 'Pickup Truck', year: 2022, pieces: 1677 });
  // Two accounts hold the same set — the household branch of setsLesen() merges
  // them into ONE tile and must add the quantities.
  await db.run(`INSERT INTO sets (user_id,set_number) VALUES ($1,$2),($3,$2)`, [haupt.id, SN, kind.id]);
  // Three acquisitions: two at the main account (2+1), one at the child (3).
  //
  // Different DAYS, and that is no cosmetics: idx_set_acq_tag_zustand (migration
  // 0004) allows exactly one acquisition per account, set and day. With the same
  // date the INSERT aborted — measured, „duplicate key value violates
  // unique constraint idx_set_acq_tag_zustand".
  await db.run(
    `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
                VALUES ($1,$2,2,100,'N', NOW() - INTERVAL '3 days'),
                       ($1,$2,1, 80,'U', NOW() - INTERVAL '1 day'),
                       ($3,$2,3, 90,'N', NOW() - INTERVAL '2 days')`,
    [haupt.id, SN, kind.id],
  );

  const H = require('./helpers/sources').areaPage('sets');

  // ── One account ────────────────────────────────────────────────────────────
  const eins = await H.readSets([haupt.id], { page_size: 60 });
  const kachel = eins.sets.find(s => s.set_number === SN);
  assert.ok(kachel, `Das Set fehlt in der Antwort: ${JSON.stringify(eins.sets).slice(0, 300)}`);
  assert.equal(Number(kachel.quantity), 3, `Ein Konto, Erfassungen 2+1: erwartet 3, bekam ${kachel.quantity}`);
  // The driver delivers BIGINT as a STRING. Without the ::int cast in
  // db/stockQuantity.ts the JSON type depends on which branch answered
  // — exactly this error already surfaced in src/parts/queries.ts.
  assert.equal(
    typeof kachel.quantity,
    'number',
    `quantity muss eine Zahl sein, war ${typeof kachel.quantity} (${kachel.quantity})`,
  );

  // ── Household ─────────────────────────────────────────────────────────────
  const beide = await H.readSets([haupt.id, kind.id], { page_size: 60 });
  const zusammen = beide.sets.find(s => s.set_number === SN);
  assert.ok(zusammen, 'Das Set fehlt in der Haushaltsantwort');
  assert.equal(Number(zusammen.quantity), 6, `Haushalt, Erfassungen 2+1+3: erwartet 6, bekam ${zusammen.quantity}`);
  assert.deepEqual(
    [...(zusammen.owner_ids || [])].map(Number).sort((a, b) => a - b),
    [haupt.id, kind.id].sort((a, b) => a - b),
    'Beide Konten halten Exemplare und müssen beide als Besitzer erscheinen',
  );

  // ── Detail ───────────────────────────────────────────────────────────────
  const detail = await H.readSet(haupt.id, SN);
  assert.ok(detail, 'Das Set-Detail antwortet nicht');
  assert.equal(Number(detail.quantity), 3, `Detail eines Kontos: erwartet 3, bekam ${detail.quantity}`);

  // ── COUNTER-CHECK: change an acquisition ────────────────────────────────────
  //
  // The core of this test. Without it the numbers above could be right by chance —
  // say from another source that happens to say the same. Only when the
  // response FOLLOWS a change is it proven that it comes from the
  // acquisitions.
  const eine = await db.get(
    `SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2
      ORDER BY id ASC LIMIT 1`,
    [haupt.id, SN],
  );
  await db.run('UPDATE set_acquisitions SET quantity = 7 WHERE id=$1', [eine.id]);

  const nachher = await H.readSets([haupt.id], { page_size: 60 });
  const neu = nachher.sets.find(s => s.set_number === SN);
  assert.equal(
    Number(neu.quantity),
    8,
    `Nach 2 → 7 muss die Summe 8 sein (7+1), bekam ${neu.quantity}. Dann liest die ` +
      'Liste die Menge nicht aus set_acquisitions.',
  );

  const detail2 = await H.readSet(haupt.id, SN);
  assert.equal(Number(detail2.quantity), 8, `Das Detail folgt der Änderung nicht: ${detail2.quantity} statt 8`);

  // ── And without an acquisition the quantity is 0, not 1 ──────────────────────────
  //
  // An inventory row without an acquisition should not exist (step 1 of the
  // migration fills one in for each), but it must not EMPTY the list
  // — hence LEFT JOIN in db/stockQuantity.ts. It then means
  // zero pieces.
  await db.run('DELETE FROM set_acquisitions WHERE user_id=$1 AND set_number=$2', [haupt.id, SN]);
  const leer = await H.readSets([haupt.id], { page_size: 60 });
  const nullStueck = leer.sets.find(s => s.set_number === SN);
  assert.ok(
    nullStueck,
    'Ohne Erfassung ist das Set aus der Liste gefallen — der JOIN muss ein LEFT JOIN ' +
      'sein, sonst verschwinden genau die Zeilen, denen etwas fehlt',
  );
  assert.equal(Number(nullStueck.quantity), 0, `Ohne Erfassung muss die Menge 0 sein, nicht ${nullStueck.quantity}`);
});
