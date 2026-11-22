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
const { keineDb } = require('./helpers/db');
const db = testData();
const { holdsSet } = require('./helpers/inventory');

test('capturing under load', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    await db.pool.end().catch(() => {});
    keineDb(t, e);
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
          { sperren: [{ konto: uid, schluessel: '70001-1' }] },
        ),
      ),
    );

    const s = await state('70001-1');
    assert.equal(s.quantity, 10, `Menge ${s.quantity} statt 10 — Erfassungen sind verloren gegangen`);
    assert.equal(s.zeilen, 1, `${s.zeilen} Tageszeilen statt einer — die Regel „ein Kaufpreis je Tag" ist verletzt`);
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
      'Eine zweite Erfassung desselben Tages war möglich — der Index fehlt',
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
    assert.equal(s.zeilen, 2, 'Der Index darf nur den GLEICHEN Tag verhindern');
  });

  await db.pool.end().catch(() => {});
});

test('quantities and prices are checked', () => {
  const V = _req('src/infra/validate.js');

  // Quantity: 1 to 10 000, everything else is caught.
  assert.equal(V.acquisitionQuantity(-5), 1, 'negative Menge kam durch');
  assert.equal(V.acquisitionQuantity(0), 1);
  assert.equal(V.acquisitionQuantity(999999999), 10000, 'unplausible Menge kam durch');
  assert.equal(V.acquisitionQuantity('3'), 3);
  assert.equal(V.acquisitionQuantity(undefined), 1);

  // Price: empty means “no price", negative is rejected (src/infra/money.ts).
  const { moneyInput } = _req('src/infra/money.js');
  assert.equal(moneyInput('', 'Preis'), null);
  assert.equal(moneyInput(null, 'Preis'), null);
  assert.equal(moneyInput('49,90', 'Preis'), 49.9, 'Komma als Dezimaltrenner');
  assert.equal(moneyInput(0, 'Preis'), 0, '0 ist ein gültiger Preis, kein fehlender');
  assert.throws(
    () => moneyInput(-20, 'Preis'),
    /negativ/,
    'ein negativer Kaufpreis senkt stillschweigend den Gesamtwert der Sammlung',
  );
  assert.throws(() => moneyInput(5_000_000, 'Preis'), /unplausibel/);
  assert.throws(() => moneyInput('abc', 'Preis'), /Ungültiger Betrag/, 'Text ist kein Preis, auch kein fehlender');
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
    /const NewSet = [^;]*quantity: input\.pieceCount\(\)[^;]*purchase_price: input\.geld\(/,
    'Sets: Menge oder Preis ungeprüft',
  );

  // And the add path writes under the lock.
  const sets = ohneKommentare(require('./helpers/sources').setCoreSource());
  // Only the body of setErfassen(), the single path for adding: up to the next function.
  const start = sets.indexOf('async function acquireSet(');
  const naechste = sets.slice(start + 10).search(/\n(?:export )?(?:async )?function [a-zA-Z_$]/);
  const kern = sets.slice(start, start + 10 + naechste);
  const sperre = kern.indexOf('repo.addLockSet(');
  const stellen = [...kern.matchAll(/bookEntry\(/g)].map(m => m.index);
  assert.ok(stellen.length >= 2, `nur ${stellen.length} Erfassungs-Schreibstellen gefunden`);
  assert.ok(sperre > 0 && stellen.every(i => i > sperre), 'nicht jede Schreibstelle läuft unter der Sperre');
});

test('a broken CSV entry does not topple the whole file', () => {
  const { csvReadIn, skippedHint } = _req('src/infra/csvExport.js');

  // Exactly the file that aborted the whole import on the running server:
  // line 3 has one column instead of three.
  const kaputt = 'set_number,quantity,purchase_price\n10280,1,20\nMÜLL;;;\n75192,2,30\n';
  const r = csvReadIn(kaputt);
  assert.equal(r.records.length, 3, 'brauchbare Zeilen gingen verloren — vorher brach der ganze Import ab');
  assert.equal(r.records[0].set_number, '10280');
  assert.equal(r.records[2].set_number, '75192', 'die Zeile NACH dem Fehler fehlt');

  // Semicolon files are still recognized.
  const semi = csvReadIn('set_number;quantity\n10280;2\n');
  assert.equal(semi.delimiter, ';');
  assert.equal(semi.records[0].quantity, '2');

  // Really empty lines count as skipped and are named.
  const leer = csvReadIn('set_number,quantity\n10280,1\n,\n');
  assert.equal(leer.records.length, 1);
  assert.deepEqual(leer.uebersprungen, [3], 'Zeilennummer wie im Editor, 1-basiert mit Kopfzeile');
  assert.match(skippedHint(leer.uebersprungen), /1 Zeile\(n\) übersprungen \(Zeile 3\)/);
  assert.equal(skippedHint([]), null, 'ohne Übersprungene kein Hinweis');
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
  for (const [rel, dienst] of [
    ['routes/api/setsImport.ts', 'src/sets/csvImport.ts'],
    ['routes/api/parts.ts', 'src/parts/manualParts.ts'],
    ['routes/api/minifigs.ts', 'src/minifigs/manualMinifigs.ts'],
  ]) {
    const src = ohneKommentare(
      fs.readFileSync(path.join(ROOT, rel), 'utf8') +
        '\n' +
        fs.readFileSync(path.join(ROOT, dienst), 'utf8') +
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
    'csvImportReport() meldet die übersprungenen Zeilen nicht mehr',
  );
  // And the UI shows the hint too.
  // Sets in the gallery, parts/minifigures/wishlist/alerts via uploadCsv().
  for (const rel of ['public/js/set-csv-import.js', 'public/js/components.js']) {
    const src = ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.match(src, /skipped_hint/, `${rel}: Hinweis kommt an, wird aber nicht gezeigt`);
  }
});

test('the parts list delivers what it reports', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ROOT, ohneKommentare } = require('./helpers/sources');
  const H = require('./helpers/sources').handlerModule(_req);

  // The parts list of ONE set may deliver more than a normal page
  assert.ok(
    H.SET_PARTS_MAX_PAGE_SIZE > H.MAX_PAGE_SIZE,
    'Ein einzelnes Set braucht eine höhere Grenze als die allgemeine Liste',
  );
  assert.ok(H.SET_PARTS_MAX_PAGE_SIZE >= 5000, 'Grosse Sets haben mehrere tausend Teilezeilen');

  const src = ohneKommentare(require('./helpers/sources').handlerQuelle());
  // Both query paths (summary and live) must know the same limit
  // — that they were capped differently was already once a
  // bug (the same request returned 500 or 5000 depending on the cache state).
  assert.equal(
    (src.match(/SET_PARTS_MAX_PAGE_SIZE/g) || []).length >= 3,
    true,
    'Die Set-Grenze gilt nicht auf beiden Abfragewegen',
  );
  assert.equal(
    (src.match(/UNPAGED_LIMIT/g) || []).length >= 3,
    true,
    'Die Grenze für Aufrufe ohne page_size gilt nicht auf beiden Wegen',
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
    'Die Antwort übernimmt das Ergebnis von partsQuery nicht mehr — dann fehlt page_size ganz',
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
    /if \(f\.seite\) \{/,
    'Die Set-Liste darf ohne page_size NICHT gedeckelt werden — Aufrufer ohne ' +
      'page_size (Skripte, ältere App-Stände) bekämen sonst stillschweigend weniger Sets',
  );
});
