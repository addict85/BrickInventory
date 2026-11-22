/**
 * @einzeln: writes data/<tabelle>.csv.tmp, which the other CSV import file
 * also uses; in parallel one cleared the file away from the other.
 *
 * The daily catalog import — checked by what other connections
 * see meanwhile.
 *
 * ── Why against real Postgres ───────────────────────────────────────────────
 * The core of the rebuild is a statement about visibility: a reader must
 * NEVER see an empty table during the import. That can only be checked with
 * two real connections — on the source text it would merely be the question whether
 * “BEGIN" stands somewhere.
 *
 * Counter-check (06.11.2026): createShadow again with INCLUDING ALL without
 * EXCLUDING CONSTRAINTS → red: “set numbers without version suffix get it
 * on swap” (rb_inventories_set_number_with_version in the shadow table).
 *
 * Counter-checks for “rb_sets reproduces the dump” (10.11.2026, in
 * syncSets(), src/catalog/repository/csvSwap.ts, each alone):
 *   E  `source='csv'` omitted in the upsert → red: “changed” (B stays 'api')
 *   F  the UPDATE to source='api' removed → red: “with reference” (C stays 'csv')
 *   G  the DELETE removed → red: “without reference” (D and F stay)
 *   H  the wishlist (wanted) removed from the reference → red: “with reference” (E missing)
 *   I  the final INSERT INTO set_catalog removed → red: “new” (G without row)
 *
 * Counter-check for “an error in the middle of the file leaves the old state” (22.11.2026):
 *   J  in importWithSwap() the target table cleared before db.transaction (the classic “clear,
 *      then fill”) → red: “der alte Bestand ist nach dem Abbruch verschwunden”
 *
 * Prerequisite: test DB (content is emptied!) via TEST_DATABASE_URL.
 * Without DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { ROOT, buildAndRequire, ohneKommentare, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

test('catalog import swaps instead of clearing', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    keineDb(t);
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // And the MIGRATIONS, not only the schema
  {
    const mc = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(mc);
    } finally {
      mc.release();
    }
  }

  // The CSV sync creates the import tables itself.
  await db.run(`CREATE TABLE IF NOT EXISTS rb_colors (
    id INTEGER PRIMARY KEY, name TEXT, rgb TEXT, is_trans TEXT, bl_color_id INTEGER)`);

  const DATA_DIR = _req('src/infra/appPaths.js').DATA_DIR;
  fs.mkdirSync(DATA_DIR, { recursive: true });

  /** Create a CSV file as the download leaves it unpacked. */
  function writeCsv(name, zeilen) {
    fs.writeFileSync(path.join(DATA_DIR, name), zeilen.join('\n') + '\n', 'utf8');
  }

  await t.test('during the import a second reader sees data throughout', async () => {
    await db.run('DELETE FROM rb_colors');
    await db.run(`INSERT INTO rb_colors (id, name, rgb, is_trans)
                  SELECT g, 'alt-' || g, 'FFFFFF', 'f' FROM generate_series(1, 300) g`);

    writeCsv(
      'colors.csv.tmp',
      ['id,name,rgb,is_trans'].concat(Array.from({ length: 300 }, (_, i) => `${i + 1},neu-${i + 1},C91A09,f`)),
    );

    // Second connection: counts continuously while the import runs.
    const reader = await db.pool.connect();
    let minimum = Infinity;
    let laeuft = true;
    const beobachten = (async () => {
      while (laeuft) {
        const { rows } = await reader.query('SELECT count(*)::int AS c FROM rb_colors');
        minimum = Math.min(minimum, rows[0].c);
        await new Promise(r => setTimeout(r, 5));
      }
    })();

    const worker = _req('jobs/csvImportWorker.js');
    const total = await worker.TASKS.colors();

    laeuft = false;
    await beobachten;
    reader.release();

    assert.equal(total, 300);
    assert.notEqual(
      minimum,
      0,
      'ein Leser hat die Tabelle LEER gesehen — genau das Fenster, das der Umbau schliessen sollte',
    );
    const jetzt = await db.get(`SELECT name FROM rb_colors WHERE id=1`);
    assert.equal(jetzt.name, 'neu-1', 'die neuen Daten sind nicht angekommen');
  });

  await t.test('an empty file does not replace the existing data', async () => {
    await db.run('DELETE FROM rb_colors');
    await db.run(`INSERT INTO rb_colors (id, name, rgb, is_trans) VALUES (1,'bestand','FFFFFF','f')`);
    writeCsv('colors.csv.tmp', ['id,name,rgb,is_trans']);

    const worker = _req('jobs/csvImportWorker.js');
    await assert.rejects(
      () => worker.TASKS.colors(),
      /0 Zeilen/,
      'ein abgebrochener Download hätte den Katalog gelöscht',
    );
    const remaining = await db.get('SELECT count(*)::int AS c FROM rb_colors');
    assert.equal(remaining.c, 1, 'der alte Bestand ist trotz Abbruch verschwunden');
  });

  await t.test('a faulty chunk aborts the import instead of losing rows', async () => {
    await db.run('DELETE FROM rb_colors');
    await db.run(`INSERT INTO rb_colors (id, name, rgb, is_trans) VALUES (1,'bestand','FFFFFF','f')`);
    // Force an error without bending the worker: a constraint
    // that the stock fulfills and the new row does not. It applies at the swap.
    await db.run(`ALTER TABLE rb_colors ADD CONSTRAINT rb_colors_name_kurz CHECK (length(name) < 10)`);
    writeCsv('colors.csv.tmp', ['id,name,rgb,is_trans', '1,viel-zu-langer-name,C91A09,f']);

    const worker = _req('jobs/csvImportWorker.js');
    await assert.rejects(
      () => worker.TASKS.colors(),
      'ein abgewiesener Block wurde verschluckt — der Import meldet Erfolg mit fehlenden Zeilen',
    );
    const remaining = await db.get('SELECT count(*)::int AS c FROM rb_colors');
    assert.equal(remaining.c, 1, 'der alte Bestand ist trotz Abbruch verschwunden');
    await db.run(`ALTER TABLE rb_colors DROP CONSTRAINT rb_colors_name_kurz`);
  });

  await t.test('an error in the middle of the file leaves the old state', async () => {
    await db.run('DELETE FROM rb_colors');
    await db.run(`INSERT INTO rb_colors (id, name, rgb, is_trans) VALUES (1,'bestand','FFFFFF','f')`);
    // Row 15000 does not fit INTEGER: the 150th chunk into the shadow fails, 149 are already in.
    const zeilen = Array.from({ length: 20000 }, (_, i) => `${i + 1},neu-${i + 1},C91A09,f`);
    zeilen[14999] = '99999999999,zu-gross,C91A09,f';
    writeCsv('colors.csv.tmp', ['id,name,rgb,is_trans'].concat(zeilen));
    const worker = _req('jobs/csvImportWorker.js');
    await assert.rejects(() => worker.TASKS.colors(), /out of range/);
    assert.deepEqual(
      await db.all('SELECT id, name FROM rb_colors'),
      [{ id: 1, name: 'bestand' }],
      'der alte Bestand ist nach dem Abbruch verschwunden',
    );
    // Lock and shadow ended with the transaction: the next run goes through.
    writeCsv('colors.csv.tmp', ['id,name,rgb,is_trans', '2,danach,C91A09,f']);
    assert.equal(await worker.TASKS.colors(), 1);
    assert.deepEqual(await db.all('SELECT id, name FROM rb_colors'), [{ id: 2, name: 'danach' }]);
  });

  await t.test('set numbers without a version suffix get it during the swap', async () => {
    writeCsv('inventories.csv.tmp', ['id,version,set_num', '1,1,75192-1', '2,1,llca8', '3,2,fig-000001']);
    const worker = _req('jobs/csvImportWorker.js');
    assert.equal(await worker.TASKS.inventories(), 3);
    const zeilen = await db.all('SELECT id, set_num FROM rb_inventories ORDER BY id');
    assert.deepEqual(
      zeilen.map(z => z.set_num),
      ['75192-1', 'llca8-1', 'fig-000001'],
    );
  });

  await t.test('doubled quotes stay one quote', async () => {
    await db.run('DELETE FROM rb_colors');
    writeCsv('colors.csv.tmp', ['id,name,rgb,is_trans', '7,"Trans ""Neon"" Grün",C91A09,f']);
    const worker = _req('jobs/csvImportWorker.js');
    await worker.TASKS.colors();
    const zeile = await db.get('SELECT name FROM rb_colors WHERE id=7');
    assert.equal(zeile.name, 'Trans "Neon" Grün');
  });

  await t.test('rb_sets mirrors the dump: new, changed, with reference, without reference', async () => {
    await db.run('DELETE FROM rb_sets');
    const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ('csv-abgleich','x') RETURNING id`))
      .id;
    await db.run(`INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts, source) VALUES
      ('1-1','A alt',2000,1,10,'csv'), ('2-1','Set 2-1',NULL,NULL,NULL,'api'), ('3-1','C',2001,1,10,'csv'),
      ('4-1','D',2002,1,10,'csv'), ('5-1','E',2003,1,10,'api'), ('6-1','F',2004,1,10,'api')`);
    await db.run(
      `INSERT INTO set_catalog (set_number, image_local) SELECT set_num, '/images/sets/' || set_num || '.jpg' FROM rb_sets`,
    );
    await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '3-1')`, [uid]);
    await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1, '5-1', 'N')`, [uid]);
    writeCsv('sets.csv.tmp', [
      'set_num,name,year,theme_id,num_parts,img_url',
      '1-1,A neu,2000,2,11,https://cdn/1.jpg',
      '2-1,B echt,2020,3,99,',
      '7-1,G,2024,1,7,',
    ]);
    const worker = _req('jobs/csvImportWorker.js');
    assert.equal(await worker.TASKS.sets(), 3);
    const zeilen = Object.fromEntries(
      (
        await db.all(
          `SELECT r.set_num, r.name, r.theme_id, r.num_parts, r.set_img_url, r.source, (c.set_number IS NOT NULL) AS katalog
         FROM rb_sets r LEFT JOIN set_catalog c ON c.set_number = r.set_num`,
        )
      ).map(z => [z.set_num, z]),
    );
    assert.deepEqual(
      zeilen['7-1'] && [zeilen['7-1'].source, zeilen['7-1'].katalog],
      ['csv', true],
      'neu: eingefügt, mit set_catalog',
    );
    assert.deepEqual(
      ['1-1', '2-1'].map(n => zeilen[n] && [zeilen[n].name, zeilen[n].theme_id, zeilen[n].num_parts, zeilen[n].source]),
      [
        ['A neu', 2, 11, 'csv'],
        ['B echt', 3, 99, 'csv'],
      ],
      'geändert: aktualisiert, eine api-Zeile wird csv',
    );
    assert.equal(zeilen['1-1'].set_img_url, 'https://cdn/1.jpg');
    assert.deepEqual(
      ['3-1', '5-1'].map(n => zeilen[n] && [zeilen[n].source, zeilen[n].katalog]),
      [
        ['api', true],
        ['api', true],
      ],
      'mit Bezug (Bestand, Merkliste): bleibt als api',
    );
    assert.deepEqual(
      ['4-1', '6-1'].filter(n => zeilen[n]),
      [],
      'ohne Bezug: entfernt',
    );
    assert.equal(
      (await db.get(`SELECT count(*)::int AS n FROM set_catalog WHERE set_number IN ('4-1','6-1')`)).n,
      0,
      'ohne Bezug: die set_catalog-Zeile geht mit',
    );
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
  });

  await t.test('after the run no shadow table remains', async () => {
    const rest = await db.all(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE '%\\_import'`,
    );
    assert.deepEqual(
      rest.map(r => r.tablename),
      [],
    );
  });

  await db.pool.end().catch(() => {});
});

// Counter-check (15.11.2026): in createImportAccess() `pool: { max: 2 }` deleted → red:
// statement_timeout '30s' instead of '0' (the requests' deadlines would hit the swap).
test("the import process builds its access via createDb, without the requests' deadlines", async t => {
  const zugang = _req('src/catalog/index.js').createImportAccess();
  t.after(() => zugang.pool.end());
  let zeile;
  try {
    zeile = (await zugang.systemPool.query('SHOW statement_timeout')).rows[0];
  } catch (e) {
    keineDb(t, e);
    return;
  }
  assert.notEqual(zugang.systemPool, zugang.pool, 'der Tausch braucht einen eigenen Pool');
  assert.equal(zeile.statement_timeout, '0');
});

test('the CSV download goes via abruf.ts, with deadline, cap and host list', () => {
  // Source text instead of behavior: deadline and cap themselves are checked by test/fetch-helper.test.js
  // on abruf.ts; here only that the download takes this path.
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'clients/rebrickableCsv.ts'), 'utf8'));
  const call = src.slice(src.indexOf('await openHttps('), src.indexOf('});', src.indexOf('await openHttps(')));
  for (const feld of ['hosts:', 'maxBytes:', 'zeitlimitMs:', 'signal'])
    assert.ok(call.includes(feld), `der Download ruft openHttps ohne ${feld}`);
  assert.doesNotMatch(
    ohneKommentare(fs.readFileSync(path.join(ROOT, 'src/catalog/csvSync.ts'), 'utf8')),
    /from 'https'/,
    'der Job lädt nicht mehr selbst',
  );
});
