/**
 * Adding: concurrently, and with nonsensical input.
 *
 * Hence here: real parallel calls against real Postgres connections.
 * Without a lock the checks fail immediately — proven by counter-check.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testContext } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const { holdsSet } = require('./helpers/inventory');

test('capturing under load', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    await db.pool.end().catch(() => {});
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

  // Loaded unbound: in the transaction the service gets its context `t`.
  const { addPurchaseAtTag } = require(path.join(__dirname, '..', 'dist', 'src', 'inventory', 'acquisitions.js'));
  const holding = testContext('inventory');

  await db.run("INSERT INTO users (username,password_hash) VALUES ('last','x')");
  const uid = (await db.get("SELECT id FROM users WHERE username='last'")).id;

  const state = async sn =>
    db.get(
      `SELECT COUNT(*)::int AS zeilen, COALESCE(SUM(quantity),0)::int AS quantity
       FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`,
      [uid, sn],
    );

  await t.test('ten concurrent acquisitions yield ONE daily row with quantity 10', async () => {
    await holdsSet(db, uid, '70001-1', 0);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        holding.transact(
          tt => addPurchaseAtTag(tt, 'set', uid, ['70001-1'], { quantity: 1, price: 10, condition: 'N' }),
          { locks: [{ account: uid, key: '70001-1' }] },
        ),
      ),
    );

    const s = await state('70001-1');
    assert.equal(s.quantity, 10, `Quantity ${s.quantity} instead of 10 — acquisitions got lost`);
    assert.equal(
      s.zeilen,
      1,
      `${s.zeilen} day rows instead of one — the rule „one purchase price per day“ is violated`,
    );
  });

  await t.test('the index does not even allow a second daily row', async () => {
    await holdsSet(db, uid, '70002-1', 0);
    // The net under the lock: a path that forgets the lock fails
    // at the database instead of silently creating a second row.
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition)
                  VALUES ($1,'70002-1',1,5,'N')`,
      [uid],
    );
    await assert.rejects(
      () =>
        db.run(
          `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition)
                    VALUES ($1,'70002-1',1,5,'N')`,
          [uid],
        ),
      /duplicate key|unique/i,
      'A second acquisition on the same day was possible — the index is missing',
    );
  });

  await t.test('the same for manual parts and minifigures', async () => {
    await db.run(
      `INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition)
                  VALUES ($1,'3001',4,1,0.5,'N')`,
      [uid],
    );
    await assert.rejects(
      () =>
        db.run(
          `INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition)
       VALUES ($1,'3001',4,1,0.5,'N')`,
          [uid],
        ),
      /duplicate key|unique/i,
    );

    await db.run(
      `INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition)
                  VALUES ($1,'sw0001',1,3,'N')`,
      [uid],
    );
    await assert.rejects(
      () =>
        db.run(
          `INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition)
       VALUES ($1,'sw0001',1,3,'N')`,
          [uid],
        ),
      /duplicate key|unique/i,
    );
  });

  await t.test('a different DAY stays a row of its own', async () => {
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
                  VALUES ($1,'70002-1',1,5,'N', NOW() - INTERVAL '2 days')`,
      [uid],
    );
    const s = await state('70002-1');
    assert.equal(s.zeilen, 2, 'The index may only prevent the SAME day');
  });

  await db.pool.end().catch(() => {});
});

test('quantities and prices are checked', () => {
  const V = _req('src/infra/validate.js');

  // Quantity: 1 to 10 000, everything else is caught.
  assert.equal(V.acquisitionQuantity(-5), 1, 'negative quantity got through');
  assert.equal(V.acquisitionQuantity(0), 1);
  assert.equal(V.acquisitionQuantity(999999999), 10000, 'implausible quantity got through');
  assert.equal(V.acquisitionQuantity('3'), 3);
  assert.equal(V.acquisitionQuantity(undefined), 1);

  // Price: empty means “no price", negative is rejected (src/infra/money.ts).
  const { moneyInput } = _req('src/infra/money.js');
  assert.equal(moneyInput('', 'Preis'), null);
  assert.equal(moneyInput(null, 'Preis'), null);
  assert.equal(moneyInput('49,90', 'Preis'), 49.9, 'comma as decimal separator');
  assert.equal(moneyInput(0, 'Preis'), 0, '0 is a valid price, not a missing one');
  assert.throws(
    () => moneyInput(-20, 'Preis'),
    /negativ/,
    'a negative purchase price silently lowers the total value of the collection',
  );
  assert.throws(() => moneyInput(5_000_000, 'Preis'), /unplausibel/);
  assert.throws(() => moneyInput('abc', 'Preis'), /Ungültiger Betrag/, 'Text is not a price, not even a missing one');
});

test('all capture paths use the same check', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ROOT, ohneKommentare } = require('./helpers/sources');

  // Manual entries validate in the service, sets in the contract (eingabe.stueckzahl and
  // eingabe.preis call the same validators) — one rule.
  for (const rel of ['src/parts/manualParts.ts', 'src/minifigs/manualMinifigs.ts']) {
    const src = ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.match(src, /acquisitionQuantity\(/, `${rel}: Menge ungeprüft`);
    assert.match(src, /moneyInput\(/, `${rel}: Preis ungeprüft`);
  }
  const vertrag = ohneKommentare(fs.readFileSync(path.join(ROOT, 'src/contract/sets.ts'), 'utf8'));
  assert.match(
    vertrag,
    /const NewSet = [^;]*quantity: input\.pieceCount\(\)[^;]*purchase_price: input\.money\(/,
    'Sets: Menge oder Preis ungeprüft',
  );

  // And the add path writes under the lock.
  const sets = ohneKommentare(require('./helpers/sources').setCoreSource());
  // Only the body of setErfassen(), the single path for adding: up to the next function.
  const start = sets.indexOf('async function acquireSet(');
  const nextOne = sets.slice(start + 10).search(/\n(?:export )?(?:async )?function [a-zA-Z_$]/);
  const kern = sets.slice(start, start + 10 + nextOne);
  const sperre = kern.indexOf('repo.addLockSet(');
  const placeList = [...kern.matchAll(/bookEntry\(/g)].map(m => m.index);
  assert.ok(placeList.length >= 2, `only ${placeList.length} acquisition write sites found`);
  assert.ok(sperre > 0 && placeList.every(i => i > sperre), 'not every write site runs under the lock');
});

test('a broken CSV entry does not topple the whole file', () => {
  const { csvReadIn, skippedHint } = _req('src/infra/csvExport.js');

  // Exactly the file that aborted the whole import on the running server:
  // line 3 has one column instead of three.
  const kaputt = 'set_number,quantity,purchase_price\n10280,1,20\nMÜLL;;;\n75192,2,30\n';
  const r = csvReadIn(kaputt);
  assert.equal(r.records.length, 3, 'usable rows got lost — previously the whole import aborted');
  assert.equal(r.records[0].set_number, '10280');
  assert.equal(r.records[2].set_number, '75192', 'the row AFTER the error is missing');

  // Semicolon files are still recognized.
  const semi = csvReadIn('set_number;quantity\n10280;2\n');
  assert.equal(semi.delimiter, ';');
  assert.equal(semi.records[0].quantity, '2');

  // Really empty lines count as skipped and are named.
  const leer = csvReadIn('set_number,quantity\n10280,1\n,\n');
  assert.equal(leer.records.length, 1);
  assert.deepEqual(leer.skipped, [3], 'Row number as in the editor, 1-based including the header row');
  assert.match(skippedHint(leer.skipped), /1 Zeile\(n\) übersprungen \(Zeile 3\)/);
  assert.equal(skippedHint([]), null, 'no hint without skipped rows');
});

test('all three import paths report skipped rows', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ROOT, ohneKommentare } = require('./helpers/sources');
  // ── Two paths to the same goal ───────────────────────────
  //
  // The set import reads itself and responds itself; parts and minifigures
  // go via csvRowsFromRequest() and csvImportReport() in
  // src/infra/csvExport.ts. Per path, route, service and job count together.
  for (const [rel, serviceFn] of [
    ['routes/api/setsImport.ts', 'src/sets/csvImport.ts'],
    ['routes/api/parts.ts', 'src/parts/manualParts.ts'],
    ['routes/api/minifigs.ts', 'src/minifigs/manualMinifigs.ts'],
  ]) {
    const src = ohneKommentare(
      fs.readFileSync(path.join(ROOT, rel), 'utf8') +
        '\n' +
        fs.readFileSync(path.join(ROOT, serviceFn), 'utf8') +
        '\n' +
        fs.readFileSync(path.join(ROOT, 'src/collection/importJobs.ts'), 'utf8'),
    );
    assert.match(src, /csvReadIn\(|csvRowsFromRequest\(/, `${rel}: liest noch selbst`);
    assert.match(src, /skipped_hint|csvImportReport\(/, `${rel}: sagt dem Nutzer nichts über übersprungene Zeilen`);
  }
  // And the shared version really does both — otherwise the mere name
  // above would suffice.
  const geteilt = ohneKommentare(fs.readFileSync(path.join(ROOT, 'src/infra/csvExport.ts'), 'utf8'));
  assert.match(
    geteilt,
    /function csvRowsFromRequest[\s\S]*?csvReadIn\(/,
    'csvRowsFromRequest() liest die Datei nicht mehr ein',
  );
  assert.match(
    geteilt,
    /function csvImportReport[\s\S]*?skipped_hint/,
    'csvImportReport() no longer reports the skipped rows',
  );
  // And the UI shows the hint too.
  // Sets in the gallery, parts/minifigures/wishlist/alerts via uploadCsv().
  for (const rel of ['public/js/set-csv-import.js', 'public/js/components.js']) {
    const src = ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.match(src, /skipped_hint/, `${rel}: the hint arrives but is not shown`);
  }
});

test('the parts list delivers what it reports', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ROOT, ohneKommentare } = require('./helpers/sources');
  const H = require('./helpers/sources').handlerModule(_req);

  // The parts list of ONE set may deliver more than a normal page
  assert.ok(H.SET_PARTS_MAX_PAGE_SIZE > H.MAX_PAGE_SIZE, 'A single set needs a higher limit than the general list');
  assert.ok(H.SET_PARTS_MAX_PAGE_SIZE >= 5000, 'Large sets have several thousand part rows');

  const src = ohneKommentare(require('./helpers/sources').handlerQuelle());
  // Both query paths (summary and live) must know the same limit
  // — that they were capped differently was already once a
  // bug (the same request returned 500 or 5000 depending on the cache state).
  assert.equal(
    (src.match(/SET_PARTS_MAX_PAGE_SIZE/g) || []).length >= 3,
    true,
    'The set limit does not apply on both query paths',
  );
  assert.equal(
    (src.match(/UNPAGED_LIMIT/g) || []).length >= 3,
    true,
    'The limit for calls without page_size does not apply on both paths',
  );

  // The response reports the ACTUAL page size, not the requested one.
  const v1 = ohneKommentare(fs.readFileSync(path.join(ROOT, 'routes/api/parts.ts'), 'utf8'));
  const response = v1.slice(
    v1.indexOf("router.endpoint('GET /api/v2/parts'"),
    v1.indexOf("router.endpoint('GET /api/v2/parts/brick-colors'"),
  );
  // What is checked is WHERE the number comes from, not how the line is written.
  //
  // A wording like `page_size: result.page_size` would be the wrong probe: it can
  // stand there without effect or be missing without the response changing.
  assert.match(
    response,
    /\.\.\.result/,
    'The response no longer takes over the result of partsQuery — then page_size is missing entirely',
  );
  assert.doesNotMatch(
    response,
    /page_size:\s*(parseInt\()?(String\()?req\.query/,
    'Die Antwort spiegelt wieder die Anfrage zurück statt zu sagen, was geliefert wurde',
  );

  // And the SET list stays unlimited
  const setsLesen = src.slice(src.indexOf('async function setList'));
  assert.match(
    setsLesen,
    /if \(f\.page\) \{/,
    'Die Set-Liste darf ohne page_size NICHT gedeckelt werden — Aufrufer ohne ' +
      'page_size (Skripte, ältere App-Stände) bekämen sonst stillschweigend weniger Sets',
  );
});
