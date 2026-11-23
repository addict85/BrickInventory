/**
 * The CSV export gives one line per entry — and needs ONE query for it.
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 *
 * Counter-check: the sets CSV query (src/sets/repository/sets.ts) ordered by created_at DESC → red “sets export: one row per acquisition, without an acquisition the set row”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsMinifig, holdsSet, holdsPart } = require('./helpers/inventory');
const db = testData();

// Without closing the connection pool the test process never ends: the pool
// holds open connections, and node waits for them. The same line stands for
// the same reason in the other -db tests.
test.after(async () => {
  await db.pool.end().catch(() => {});
});

/** CSV text → lines as objects (the header determines the names). */
function zeilen(csv) {
  const [kopf, ...rest] = csv
    .trim()
    .split('\n')
    .map(z => z.replace(/\r$/, ''));
  const namen = kopf.split(',');
  return rest.filter(Boolean).map(z => {
    const values = z.split(',');
    return Object.fromEntries(namen.map((n, i) => [n, (values[i] ?? '').replace(/^"|"$/g, '')]));
  });
}

test('sets export: one row per acquisition, without an acquisition the set row', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const nutzer = `csvexp-${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [nutzer]).catch(() => {});
  const u = await db.get('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id', [nutzer, 'x']);
  const uid = u.id;

  try {
    // Four cases, each with its own statement
    for (const sn of ['0001-1', '0002-1', '0003-1', '0004-1']) {
      await holdsSet(db, uid, sn, 0);
    }
    await db.run(
      `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, created_at)
       VALUES ($1,'0002-1',1,10.00,'N', NOW() - INTERVAL '2 days'),
              ($1,'0002-1',4,20.00,'U', NOW() - INTERVAL '1 day'),
              ($1,'0003-1',1,NULL,'N', NOW())`,
      [uid],
    );

    const csv = await require('./helpers/sources').areaPage('sets').setsAsCsv(uid);
    const r = zeilen(csv);
    const je = sn => r.filter(x => x.set_number === sn);

    assert.equal(r.length, 5, `5 rows expected (1+2+1+1), got ${r.length}:\n${csv}`);

    // Without an entry: one line with quantity 0, without price, without date, condition 'N';
    // quantity and price only come from entries.
    assert.deepEqual(je('0001-1'), [
      { set_number: '0001-1', quantity: '0', purchase_price: '', condition: 'N', acquired_at: '' },
    ]);

    // Two entries, oldest first — the order carries the meaning.
    const zwei = je('0002-1');
    assert.equal(zwei.length, 2, 'two acquisitions result in two rows');
    assert.equal(zwei[0].quantity, '1', 'the older acquisition comes first');
    assert.equal(zwei[1].quantity, '4');
    assert.equal(zwei[0].condition, 'N');
    assert.equal(zwei[1].condition, 'U');
    assert.match(zwei[0].acquired_at, /^\d{4}-\d{2}-\d{2}$/, 'acquisitions carry their date');

    // Entry present but without price → empty field. The confusion with
    // the set price, against which this check was written, can no longer exist since
    // migration 0032; the statement about the output stays.
    const withoutPrice = je('0003-1');
    assert.equal(withoutPrice.length, 1);
    assert.equal(withoutPrice[0].purchase_price, '', 'an acquisition without a price must result in an empty field');
    assert.equal(withoutPrice[0].condition, 'N', 'a missing condition becomes N');

    // Set without an entry: quantity 0, condition 'N', price empty.
    assert.deepEqual(je('0004-1'), [
      { set_number: '0004-1', quantity: '0', purchase_price: '', condition: 'N', acquired_at: '' },
    ]);
  } finally {
    await db.run('DELETE FROM set_acquisitions WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM sets WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
  }
});

test('sets export needs ONE query, independent of the number of sets', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;

  // ── Why counting and not timing ───────────────────────────────────────────
  // A timing would be the worse check here: it fluctuates with the
  // load of the machine and needs a threshold that is either too loose
  // or erratically red. The COUNT of queries, by contrast, is the quantity
  // that matters — it must not grow with the stock.
  const nutzer = `csvcnt-${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [nutzer]).catch(() => {});
  const u = await db.get('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id', [nutzer, 'x']);
  const uid = u.id;

  // Counted at pool.query, NOT at db.all
  const realQuery = db.pool.query.bind(db.pool);
  try {
    for (let i = 1; i <= 25; i++) {
      const sn = `9${String(i).padStart(3, '0')}-1`;
      await holdsSet(db, uid, sn, 0); // Quantity 0: the entry behind it carries it
      await db.run(
        `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition)
         VALUES ($1,$2,1,5.00,'N')`,
        [uid, sn],
      );
    }

    let queryList = 0;
    db.pool.query = (...args) => {
      queryList++;
      return realQuery(...args);
    };
    const csv = await require('./helpers/sources').areaPage('sets').setsAsCsv(uid);
    db.pool.query = realQuery;

    assert.equal(zeilen(csv).length, 25, 'all 25 sets are in the export');
    // Lower bound: if the patch counted nothing at all, the upper bound below would be
    // trivially fulfilled — exactly the state this test was in at first.
    assert.ok(queryList >= 1, 'the counter recorded nothing — the patch no longer works');
    assert.ok(
      queryList <= 2,
      `${queryList} queries for 25 sets. The export used to fetch the acquisitions ` +
        `per set individually — for 700 sets that was 701 round trips. The LEFT JOIN ` +
        `in SETS_CSV_SQL turns that into one; 2 are allowed because the fallback path ` +
        `(missing migration) costs a second query.`,
    );
  } finally {
    db.pool.query = realQuery;
    await db.run('DELETE FROM set_acquisitions WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM sets WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
  }
});

test('minifigures export: the same rule, the same single query', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;

  const nutzer = `figexp-${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [nutzer]).catch(() => {});
  const u = await db.get('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id', [nutzer, 'x']);
  const uid = u.id;

  const realQuery = db.pool.query.bind(db.pool);
  try {
    // fig-a  without entry         → minifigure line
    // fig-b  entry without price   → empty field
    for (const [nr, name] of [
      ['fig-a', 'Aaa', 2],
      ['fig-b', 'Bbb', 1],
    ]) {
      // Since migration 0034 the name is in the catalog — and it is not
      // incidental here: the export sorts by it.
      await db.run(
        `INSERT INTO minifigs_catalog (fig_number, fig_name) VALUES ($1,$2)
         ON CONFLICT (fig_number) DO NOTHING`,
        [nr, name],
      );
      // fig-a gets NO entry — that is the case the export
      // must distinguish. The test below creates the entry for fig-b.
      // Quantity 0: fig-b gets its entry below, fig-a deliberately none.
      await holdsMinifig(db, uid, nr, { quantity: 0 });
    }
    await db.run(
      `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition)
       VALUES ($1,'fig-b',1,NULL,'U')`,
      [uid],
    );

    let queryList = 0;
    db.pool.query = (...args) => {
      queryList++;
      return realQuery(...args);
    };
    const csv = await _req('src/inventory/inventoryExport.js').minifigsCsv(uid);
    db.pool.query = realQuery;

    const r = zeilen(csv);
    assert.equal(r.length, 2, `2 rows expected, got ${r.length}:\n${csv}`);

    const a = r.find(x => x.fig_number === 'fig-a');
    // For a MANUAL item the item count is the sum of the entries,
    // so 0 without an entry. The line still stays in the export (it is in the
    // stock) — exactly this distinction is what the case records, as in the set export.
    assert.equal(a.quantity, '0', 'without an acquisition the piece count is 0 — but the row stays');
    assert.equal(a.acquired_at, '', 'no date without an acquisition');

    const b = r.find(x => x.fig_number === 'fig-b');
    assert.equal(b.unit_price, '', 'an acquisition without a price must export empty — not as 0');
    // Since migration 0047 the condition is mandatory; what is checked is that it gets through.
    assert.equal(b.condition, 'U');

    assert.ok(queryList >= 1, 'the counter recorded nothing — the patch no longer works');
    assert.ok(
      queryList <= 2,
      `${queryList} queries for 2 minifigs. Previously one query ran PER MINIFIG; ` +
        `FIGS_CSV_SQL turns that into one.`,
    );
  } finally {
    db.pool.query = realQuery;
    await db.run('DELETE FROM minifig_acquisitions WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM minifigs WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
  }
});

test('parts export: the same rule, the same single query', { concurrency: 1 }, async t => {
  // Why this case came later
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;

  const nutzer = `teilexp-${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [nutzer]).catch(() => {});
  const u = await db.get('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id', [nutzer, 'x']);
  const uid = u.id;

  const realQuery = db.pool.query.bind(db.pool);
  try {
    // 3001 / color 4   two entries           → two lines, oldest first
    // 3001 / color 1   NO entry              → parts line, not the one of color 4
    // 3002 / color 0   entry without price   → empty field
    for (const [nr, farbe, farbname] of [
      ['3001', 4, 'Rot'],
      ['3001', 1, 'Blau'],
      ['3002', 0, ''],
    ]) {
      // Name and color label into the catalogs (migration 0034). Both
      // appear in the export column color_name or in the sorting.
      await db.run(
        `INSERT INTO part_catalog (part_number, part_name) VALUES ($1,$2)
         ON CONFLICT (part_number) DO NOTHING`,
        [nr, `Teil ${nr}`],
      );
      await db.run(
        `INSERT INTO part_color_catalog (part_number, color_id, color_name) VALUES ($1,$2,$3)
         ON CONFLICT (part_number, color_id) DO NOTHING`,
        [nr, farbe, farbname],
      );
      // Quantity 0: the test creates the entries below deliberately so that the
      // cases “with" and “without price" stay distinguishable.
      await holdsPart(db, uid, nr, { quantity: 0, colorId: farbe });
    }
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, created_at)
       VALUES ($1,'3001',4,2,0.50,'N', NOW() - INTERVAL '2 days'),
              ($1,'3001',4,3,1.50,'U', NOW() - INTERVAL '1 day'),
              ($1,'3002',0,1,NULL,'U', NOW())`,
      [uid],
    );

    let queryList = 0;
    db.pool.query = (...args) => {
      queryList++;
      return realQuery(...args);
    };
    const csv = await _req('src/inventory/inventoryExport.js').partsCsv(uid);
    db.pool.query = realQuery;

    const r = zeilen(csv);
    assert.equal(r.length, 4, `4 rows expected (2+1+1), got ${r.length}:\n${csv}`);

    // The case only parts have: same number, different color.
    const rot = r.filter(x => x.part_number === '3001' && x.color_id === '4');
    const blau = r.filter(x => x.part_number === '3001' && x.color_id === '1');
    assert.equal(rot.length, 2, 'the red row has two acquisitions');
    assert.equal(blau.length, 1, 'the blue row has NO acquisition — it must not inherit those of the red one');
    // As with fig-a above: without an entry the item count is 0, but the line
    // stays in the export.
    assert.equal(blau[0].quantity, '0', 'without an acquisition the piece count is 0');
    assert.equal(blau[0].acquired_at, '', 'no date without an acquisition');

    assert.equal(rot[0].quantity, '2', 'the older acquisition comes first');
    assert.equal(rot[1].quantity, '3');
    assert.equal(rot[0].condition, 'N');
    assert.equal(rot[1].condition, 'U');
    assert.match(rot[0].acquired_at, /^\d{4}-\d{2}-\d{2}$/, 'acquisitions carry their date');

    const withoutPrice = r.find(x => x.part_number === '3002');
    assert.equal(withoutPrice.unit_price, '', 'an acquisition without a price must export empty — not as 0');
    assert.equal(withoutPrice.condition, 'U');

    assert.ok(queryList >= 1, 'the counter recorded nothing — the patch no longer works');
    assert.ok(
      queryList <= 2,
      `${queryList} queries for 3 parts. Previously one query ran PER PART; ` + `PARTS_CSV_SQL turns that into one.`,
    );
  } finally {
    db.pool.query = realQuery;
    await db.run('DELETE FROM part_acquisitions WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM parts WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
  }
});
