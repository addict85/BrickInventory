/**
 * The wanted list import via its real address.
 *
 * ── Counter-checks (performed, findings MEASURED) ───────────────────────────
 *
 *   a) preview no longer the default (always writes) → 2 AND 4 red
 *   b) <INVENTORY> check removed                    → 1 red
 *   c) BL number taken raw instead of mapped        → 4 red
 *   d) BL color taken instead of the mapped one     → 4 red
 *   e) (14.11.2026) in the wanted creator for sets `ifPresent: 'aufstocken'`
 *      omitted → 9 red (`aufgestockt` 0: the second time said “exists”)
 *
 * Two predictions were too narrow, and both say something about this test:
 *
 * For (a) I had only expected case 2. 4 turned red as well, and rightly so:
 * if the preview writes, parts are already there in the later write run, and
 * `angelegt` is no longer right. A chain effect — case 2 is the finding,
 * case 4 the consequence.
 *
 * For (c) I had expected 3 AND 4. Only 4 turned red. Case 3 counts the
 * LEVELS, and they are right even if the wrong number is taken over
 * — it does not check the mapping. Case 4 does, and only it.
 *
 * So a lot hangs on case 4: mapping of the number, mapping of the color,
 * quantity, and that the open item stays outside. That is deliberate — the
 * four statements belong to ONE operation (“what is in the holdings after
 * writing”), and checking them individually would mean running the same
 * import four times.
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
const { importWorker } = require('./helpers/jobs');
const { catalogSet } = require('./helpers/inventory');
const db = testData();
const { testServer } = require('./helpers/server');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

let MAIN = 0;

function item(kind, id, color, quantity = 1) {
  return (
    `<ITEM>\n<ITEMTYPE>${kind}</ITEMTYPE>\n<ITEMID>${id}</ITEMID>\n` +
    (color === null ? '' : `<COLOR>${color}</COLOR>\n`) +
    `<MAXPRICE>-1.0000</MAXPRICE>\n<MINQTY>${quantity}</MINQTY>\n` +
    `<CONDITION>X</CONDITION>\n<NOTIFY>N</NOTIFY>\n</ITEM>`
  );
}
const list = (...i) => `<?xml version="1.0" encoding="UTF-8"?>\n<INVENTORY>\n${i.join('\n')}\n</INVENTORY>\n`;

/** The test's file: two resolvable parts, one open. */
const XML = list(
  item('P', '3001', 5, 3), // bl_mapping: NULL registration → stage 2
  item('P', '4162', 1, 2), // bl_mapping: deviating number → stage 1
  item('P', '99999', 5, 1), // nothing → open
);

async function uploadIt(base, xml, query = '') {
  const fd = new FormData();
  fd.append('file', new Blob([xml], { type: 'text/xml' }), 'wanted.xml');
  const r = await fetch(`${base}/api/v2/wanted-list/import/xml${query}`, { method: 'POST', body: fd });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

/** The same address, but the response read LINE BY LINE (NDJSON). */
async function uploadStream(base, xml, query) {
  const fd = new FormData();
  fd.append('file', new Blob([xml], { type: 'text/xml' }), 'wanted.xml');
  const r = await fetch(`${base}/api/v2/wanted-list/import/xml${query}`, { method: 'POST', body: fd });
  const raw = await r.text();
  const lines = raw
    .split('\n')
    .filter(z => z.trim())
    .map(z => JSON.parse(z));
  return { status: r.status, kind: r.headers.get('content-type') || '', lines };
}

async function setup() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c);
  } finally {
    c.release();
  }
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x')`);
  MAIN = (await db.get(`SELECT id FROM users WHERE username='haupt'`)).id;
  await db.run(`INSERT INTO part_catalog (part_number, part_name)
                VALUES ('3001','Brick 2x4'), ('98765','Umgetauft')`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name)
                VALUES ('3001',4,'Rot'), ('98765',15,'Weiss')
                ON CONFLICT (part_number,color_id) DO NOTHING`);
  await db.run(`INSERT INTO bl_mapping (type, rb_id, bl_id)
                VALUES ('part','98765','4162'), ('part','3001', NULL)`);
  await db.run(`INSERT INTO rb_colors (id,name,bl_color_id) VALUES (4,'Red',5),(15,'White',1)`);
}

test('wanted list: preview and writing via the real address', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }
  await setup();

  importWorker(t, _req);
  const srv = testServer(_req, { session: { userId: MAIN }, t });

  await t.test('1. a file without <INVENTORY> is rejected beforehand', async () => {
    const { status, body } = await uploadIt(srv.base, '<?xml version="1.0"?>\n<FOO/>\n');
    assert.equal(status, 422, `expected 422, got ${status}`);
    assert.match(
      String(body.error || ''),
      /Wanted-Liste/,
      `Rejected with „${body.error}“ — the text should say THAT it is not a list. ` +
        '„0 Posten gelesen“ would be ambiguous: that can also be an empty list.',
    );
  });

  await t.test('2. the preview writes NOTHING', async () => {
    const { status, body } = await uploadIt(srv.base, XML);
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.preview, true, 'Without write=1 this is not a preview');
    assert.equal(body.parsed, 3, `${body.parsed} items read instead of 3`);
    assert.equal(body.created, 0, `${body.created} created — the preview does not write`);

    // Checked against the TABLE and not the response: a route that
    // reports "vorschau: true" and writes anyway would look right in the
    // response.
    assert.equal(
      (await db.get('SELECT COUNT(*)::int c FROM parts WHERE user_id=$1', [MAIN])).c,
      0,
      'The preview created parts',
    );
  });

  await t.test('3. the preview names the stages separately and the open items', async () => {
    const { body } = await uploadIt(srv.base, XML);
    assert.deepEqual(
      body.levels,
      { gleich_vermerkt: 1, zuordnung: 1 },
      `levels: ${JSON.stringify(body.levels)} — expected one each from bl_mapping`,
    );
    assert.equal(body.open.length, 1, `${body.open.length} open instead of 1`);
    assert.equal(
      body.open[0].blId,
      '99999',
      'The open item is not named with its BrickLink number — then ' + 'nobody can look it up',
    );
    // Rebrickable was NOT asked: without rebrickable=1 the import costs
    // no quota.
    assert.equal(body.rebrickable, undefined, 'Rebrickable was asked although rebrickable=1 was missing');
  });

  await t.test('4. with write=1 manual parts are created — with quantity and color', async () => {
    const { body } = await uploadIt(srv.base, XML, '?write=1');
    assert.equal(body.preview, false);
    assert.equal(body.created, 2, `${body.created} created instead of 2: ${JSON.stringify(body.items)}`);
    assert.equal(body.failed, 0, `${body.failed} errors: ${JSON.stringify(body.items)}`);

    // Stage 2: the number stays, the color is mapped (BL 5 → RB 4).
    const a = await db.get(
      `SELECT p.color_id, COALESCE(SUM(pa.quantity),0)::int AS quantity
         FROM parts p LEFT JOIN part_acquisitions pa
           ON pa.user_id=p.user_id AND pa.part_number=p.part_number AND pa.color_id=p.color_id
        WHERE p.user_id=$1 AND p.part_number='3001' GROUP BY p.color_id`,
      [MAIN],
    );
    assert.ok(a, '3001 was not created');
    assert.equal(Number(a.color_id), 4, `colour ${a.color_id} instead of 4 (BL 5 = Rebrickable 4)`);
    assert.equal(a.quantity, 3, `quantity ${a.quantity} instead of 3 — MINQTY was 3`);

    // Stage 1: the deviating number must be CONVERTED, not taken over.
    assert.ok(
      await db.get(`SELECT 1 FROM parts WHERE user_id=$1 AND part_number='98765'`, [MAIN]),
      'The BrickLink number 4162 was not mapped to 98765',
    );
    assert.equal(
      (await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND part_number='4162'`, [MAIN])).c,
      0,
      'The BrickLink number 4162 is stored raw in the stock — it is NOT a ' +
        'Rebrickable number, and a part under it finds no catalogue entry',
    );

    // The open item was NOT created.
    assert.equal(
      (await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND part_number='99999'`, [MAIN])).c,
      0,
      'An item without a known Rebrickable number was created anyway',
    );
  });

  await t.test('5. no purchase price from MAXPRICE', async () => {
    // MAXPRICE is a SEARCH LIMIT, not a price paid. Here it is -1, and
    // even a real value must not end up as purchase price — otherwise the
    // finance view would show an amount nobody spent.
    // The column is called `unit_price`, not `price` — looked up after my …
    const prices = await db.all('SELECT unit_price FROM part_acquisitions WHERE user_id=$1', [MAIN]);
    assert.ok(prices.length > 0, 'precondition: there are acquisitions');
    for (const p of prices) {
      assert.ok(
        p.unit_price === null || Number(p.unit_price) >= 0,
        `A purchase price of ${p.unit_price} came from MAXPRICE — MAXPRICE is ` + 'a search limit, not a price paid',
      );
    }
  });

  await t.test('6. foreign kinds are in the report', async () => {
    const withIt = list(item('P', '3001', 5), item('B', '5002', null), item('G', '6001', null));
    const { body } = await uploadIt(srv.base, withIt);
    assert.deepEqual(
      body.foreignTypes,
      { B: 1, G: 1 },
      `foreignTypes: ${JSON.stringify(body.foreignTypes)} — one book and one gear item`,
    );
  });

  // The progress

  await t.test('7. with stream=1 progress lines come, finally the report', async () => {
    const { status, kind, lines } = await uploadStream(srv.base, XML, '?write=1&stream=1');
    assert.equal(status, 200);
    assert.match(
      kind,
      /ndjson/,
      `Content-Type „${kind}" — a line-based response must not be served as application/json, ` +
        'otherwise the browser tries to read it as ONE document',
    );

    // The import runs as a job; the request reads its state at intervals,
    // so intermediate states can coincide. The last one always arrives.
    const notify = lines.filter(z => z.progress);
    assert.ok(notify.length >= 1, 'no progress line');
    const done = notify.map(z => z.progress.done);
    assert.deepEqual(
      done,
      [...done].sort((a, b) => a - b),
      'The count must ascend',
    );
    assert.equal(done.at(-1), 3, 'The last state names all items (otherwise the bar would stop before the end)');
    for (const z of notify) {
      assert.equal(z.progress.total, 3, 'The denominator is the number of items');
      assert.equal(z.progress.phase, 'write');
    }

    const last = lines[lines.length - 1];
    assert.equal(last.success, true, 'The last line is the report');
    assert.equal(last.preview, false, 'with write=1 it is not a dry run');
    assert.equal(last.parsed, 3);
    assert.ok(!last.progress, 'The report is not a progress line');
  });

  // The same bar as for the set import

  await t.test('9. an import leaves a completed job', async () => {
    await db.run('DELETE FROM import_status WHERE user_id = $1', [MAIN]);
    const { body } = await uploadIt(srv.base, XML, '?write=1');
    assert.equal(body.success, true);

    const job = await db.get('SELECT * FROM import_status WHERE user_id=$1', [MAIN]);
    assert.ok(
      job,
      'Without a job row neither the app nor a second ' + 'session shows anything — that is the whole point',
    );
    assert.equal(
      job.status,
      'done',
      `status „${job.status}“ — after the import the job must be CLOSED, otherwise ` +
        'the bar in the app shows „läuft“ until someone starts a new one',
    );
    assert.equal(Number(job.total), 3, 'The denominator is the number of items');
    assert.equal(Number(job.done), Number(job.total), 'At the end the bar must be full');
    assert.equal(job.current, null, 'What is „gerade dran" no longer exists');
    // buildJobStatus computes ok/warn/err from `results` — without the list the
    // bar would say "0 ok" after the end although two items were created.
    const results = Array.isArray(job.results) ? job.results : JSON.parse(job.results || '[]');
    assert.equal(
      results.filter(r => r.success).length,
      body.created + body.topped_up,
      `results counts ${results.length} entries, the report names ` +
        `${body.created} created and ${body.topped_up} topped up`,
    );

    // Every line NAMES its item (Marco's finding of 21.10.)
    assert.equal(results.length, 3, 'One row per item, also for the open one');
    for (const r of results) {
      assert.ok(
        r.set_number,
        `An entry without set_number: ${JSON.stringify(r)}. In the log that becomes ` + '„undefined – updated_at"',
      );
    }
    assert.deepEqual(
      results.map(r => r.set_number).sort(),
      ['3001', '4162', '99999'],
      'The BrickLink numbers from the file — those are the rows Marco ' +
        'uploaded. 4162 carries a DIFFERENT number at Rebrickable; the ' +
        'log shows the one from his file',
    );
    const created = results.filter(r => r.success);
    assert.ok(
      created.every(r => r.action === 'added' || r.action === 'updated'),
      `action must be 'added' or 'updated', otherwise the display writes ` +
        `„updated_at" for everything: ${JSON.stringify(created)}`,
    );
    const open = results.find(r => r.set_number === '99999');
    assert.equal(
      open.isWarning,
      true,
      'An open item is a remark, not an error — the same ' + 'grouping as for the numbers above',
    );
    assert.ok(open.error, 'Without a reason the row shows only the number');
  });

  await t.test('10. a PREVIEW creates no job', async () => {
    await db.run('DELETE FROM import_status WHERE user_id = $1', [MAIN]);
    const { body } = await uploadIt(srv.base, XML);
    assert.equal(body.preview, true, 'precondition: this is a preview');
    const job = await db.get('SELECT * FROM import_status WHERE user_id=$1', [MAIN]);
    assert.equal(
      job,
      undefined,
      'A preview changes nothing. A „Import läuft“ bar for it would be a ' + 'lie in three interfaces at once.',
    );
  });

  await t.test('11. a running CSV import is not displaced', async () => {
    // The CSV import of 380 sets is what someone is waiting for. Throwing it
    // out of the bar because a wanted list is being read alongside would be
    // the wrong trade — the wanted import runs anyway, just without a bar.
    await db.run(
      `INSERT INTO import_status (user_id, status, total, done, current, results, updated_at)
       VALUES ($1,'running',380,42,'10256-1','[]', NOW())
       ON CONFLICT (user_id) DO UPDATE SET status='running', total=380, done=42,
         current='10256-1', results='[]'`,
      [MAIN],
    );

    const { body } = await uploadIt(srv.base, XML, '?write=1');
    assert.equal(body.success, true, 'The import itself keeps running');

    const job = await db.get('SELECT * FROM import_status WHERE user_id=$1', [MAIN]);
    assert.equal(job.status, 'running', 'The foreign job must stay untouched');
    assert.equal(Number(job.total), 380, `total=${job.total} — the wanted import overwrote the CSV job`);
    assert.equal(Number(job.done), 42, 'the count belongs to the other import too');
    assert.equal(job.current, '10256-1');
    await db.run('DELETE FROM import_status WHERE user_id = $1', [MAIN]);
  });

  await t.test('8. without stream=1 the address responds unchanged as JSON', async () => {
    // The path of the Android app and all other checks. It must NOT have
    // changed because of the stream.
    const r = await (async () => {
      const fd = new FormData();
      fd.append('file', new Blob([XML], { type: 'text/xml' }), 'wanted.xml');
      return fetch(`${srv.base}/api/v2/wanted-list/import/xml`, { method: 'POST', body: fd });
    })();
    assert.match(r.headers.get('content-type') || '', /application\/json/);
    const raw = await r.text();
    assert.ok(!raw.includes('"progress"'), 'Without stream=1 no progress line may be in the response');
    const body = JSON.parse(raw);
    assert.equal(body.success, true);
    assert.equal(body.parsed, 3);
  });

  await t.test('9. a set goes through acquireSet: created, then topped up, with follow-up work', async () => {
    const SN = '76001-1';
    await catalogSet(db, SN, { name: 'Wanted-Set', minifigs: 0 });
    const file = list(item('S', SN, null, 2));
    const erst = (await uploadIt(srv.base, file, '?write=1')).body;
    assert.equal(erst.created, 1, JSON.stringify(erst));
    const then = (await uploadIt(srv.base, file, '?write=1')).body;
    assert.equal(then.topped_up, 1, JSON.stringify(then));
    const quantity = await db.get(
      'SELECT SUM(quantity)::int AS n FROM set_acquisitions WHERE user_id = $1 AND set_number = $2',
      [MAIN, SN],
    );
    assert.equal(quantity.n, 4);
    const rework = await db.all("SELECT 1 FROM jobs WHERE type = 'rework' AND payload->>'set_number' = $1", [SN]);
    assert.ok(rework.length >= 1, 'without follow-up work the set would stay without a catalogue');
  });
});
