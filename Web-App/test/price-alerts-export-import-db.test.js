/**
 * Price alerts go out as CSV and come back as price alerts.
 *
 * ── Counter-checks (carried out, findings MEASURED) ────────────────────────────
 *
 *   a) preisalarme.csv removed from the ZIP      → 1, 2, 3, 4 red
 *   b) currency from the FILE instead of settings → 5 red
 *   c) `triggered` exported too                 → 3 red
 *   d) setAlert replaced by a raw INSERT      → 6 and 6b red
 *   e) `WHERE user_id` removed from the export   → 2 and 4 red
 *
 * Three things about it did not turn out the way I had written them down
 * beforehand, and all three stand here because they say something about the test:
 *
 * (d) turned NOTHING AT ALL red on the FIRST attempt. Case 6 claimed it checked
 * that the route uses setAlert() — it did not: the table has its own
 * CHECK conditions on `direction` and `threshold` (measured), they caught
 * the raw INSERT just the same. Case 6 now carries the condition „X", for which there is
 * NO CHECK, and 6b the resetting of `triggered`, which the table does not
 * enforce either. Only with that does the test separate the two versions.
 *
 * (e) uncovered a gap while THINKING IT THROUGH, before it ran: the setup had
 * only one account, and without a second one an export over ALL accounts looks
 * just like the right one. Since then there is `FOREIGN_ALARM` — and that was
 * no cosmetic flaw but a leak: an alert triggers a MAIL to
 * the address of its account.
 *
 * Then 2 AND 4 were measured red, I had only predicted 2. Also right:
 * if the foreign alert stands in the file, the import creates it in the own account,
 * and the number is no longer right. The prediction was too narrow, not the finding
 * wrong.
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
const { catalogSet } = require('./helpers/inventory');
const { importWorker } = require('./helpers/jobs');
const db = testData();
const { testServer } = require('./helpers/server');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

let MAIN = 0,
  FREMD = 0;

/**
 * The alert of a FOREIGN account. It stands here because an export without
 * `WHERE user_id` would otherwise not stand out: with only one account in the setup
 * a query over ALL accounts looks just like the right one. That came up while
 * thinking through the counter-checks — the case „user_id left out" would have …
 */
const FOREIGN_ALARM = { sn: '31203-1', c: 'N', r: 'below', s: 77, w: 'CHF' };

/**
 * Four alerts. The third sits on a set that the account does NOT own —
 * exactly the case that would have fallen out as a column on sets.csv.
 */
const ALERTS = [
  { sn: '75192-1', c: 'N', r: 'below', s: 600, w: 'CHF', owns: true },
  { sn: '75192-1', c: 'U', r: 'above', s: 420.5, w: 'CHF', owns: true },
  { sn: '10179-1', c: 'N', r: 'below', s: 1200, w: 'CHF', owns: false },
  { sn: '21309-1', c: 'U', r: 'above', s: 24.9, w: 'CHF', owns: false },
];

async function setup(accountCurrency = 'CHF') {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c);
  } finally {
    c.release();
  }
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('fremd','x')`);
  MAIN = (await db.get(`SELECT id FROM users WHERE username='haupt'`)).id;
  FREMD = (await db.get(`SELECT id FROM users WHERE username='fremd'`)).id;
  // NO account link: 'fremd' is not a sub-account. Even with one
  // it would be wrong — an alert knows no scope.
  await catalogSet(db, FOREIGN_ALARM.sn, { name: FOREIGN_ALARM.sn });
  await db.run(
    `INSERT INTO price_alerts (user_id,set_number,condition,direction,threshold,currency_code)
                VALUES ($1,$2,$3,$4,$5,$6)`,
    [FREMD, FOREIGN_ALARM.sn, FOREIGN_ALARM.c, FOREIGN_ALARM.r, FOREIGN_ALARM.s, FOREIGN_ALARM.w],
  );
  await db.run(
    `INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency',$2)
                ON CONFLICT (user_id,key) DO UPDATE SET value=$2`,
    [MAIN, accountCurrency],
  );
  // The stock belongs per SET, the alert per (set, condition): 75192-1 carries
  // both conditions. Two acquisitions for the same set on the same DAY violate
  // idx_set_acq_tag_zustand (migration 0008) — exactly on that the first run of this
  // test failed. Hence the stock row only once per number.
  const placed = new Set();
  for (const a of ALERTS) {
    await catalogSet(db, a.sn, { name: a.sn });
    if (a.owns && !placed.has(a.sn)) {
      placed.add(a.sn);
      await db.run(
        `INSERT INTO sets (user_id,set_number) VALUES ($1,$2)
                    ON CONFLICT (user_id,set_number) DO NOTHING`,
        [MAIN, a.sn],
      );
      await db.run(
        `INSERT INTO set_acquisitions (user_id,set_number,quantity,condition)
                    VALUES ($1,$2,1,'N')`,
        [MAIN, a.sn],
      );
    }
    await db.run(
      `INSERT INTO price_alerts (user_id,set_number,condition,direction,threshold,currency_code)
                  VALUES ($1,$2,$3,$4,$5,$6)`,
      [MAIN, a.sn, a.c, a.r, a.s, a.w],
    );
  }
}

/** Fetch a file from the ZIP — as in wanted-export-import-db.test.js. */
function fromZip(buf, name) {
  const zlib = require('node:zlib');
  for (let i = 0; i + 30 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue;
    const method = buf.readUInt16LE(i + 8);
    const namLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    if (buf.slice(i + 30, i + 30 + namLen).toString('utf-8') !== name) continue;
    const raw = buf.slice(i + 30 + namLen + extraLen);
    if (method === 0) return raw.toString('utf-8');
    return zlib.inflateRawSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf-8');
  }
  return null;
}

function csvRows(text) {
  const [head, ...rest] = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  const columns = head.split(',').map(s => s.replace(/^"|"$/g, ''));
  return rest
    .filter(z => z.trim())
    .map(z => {
      const values = z.split(',').map(s => s.replace(/^"|"$/g, ''));
      return Object.fromEntries(columns.map((s, i) => [s, values[i] ?? '']));
    });
}

/** The same CSV built from ALERTS — independent of the export (lesson from piece 1). */
function csvFromAlerts(currency) {
  return (
    'set_number,condition,richtung,schwelle,currency_code\n' +
    ALERTS.map(a => `${a.sn},${a.c},${a.r},${a.s},${currency ?? a.w}`).join('\n') +
    '\n'
  );
}

async function uploadIt(base, text, name = 'preisalarme.csv') {
  const fd = new FormData();
  fd.append('file', new Blob([text], { type: 'text/csv' }), name);
  const r = await fetch(`${base}/api/v2/alerts/import/csv`, { method: 'POST', body: fd });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

test('price alerts: round trip over the real addresses', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }
  await setup('CHF');

  importWorker(t, _req);
  const srv = testServer(_req, { session: { userId: MAIN }, t });

  let csvText = '';

  await t.test('1. preisalarme.csv is in the ZIP, next to the four others', async () => {
    const r = await fetch(`${srv.base}/api/v2/settings/export/data`);
    assert.equal(r.status, 200, `The export answered with ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    csvText = fromZip(buf, 'preisalarme.csv');
    assert.ok(
      csvText !== null,
      '„preisalarme.csv“ is NOT in the archive. Marco asked for „in allen bestehenden Exporten“ ' +
        '— and the ZIP is the export of the stock data.',
    );
    for (const n of ['sets.csv', 'teile.csv', 'minifiguren.csv', 'merkliste.csv']) {
      assert.ok(fromZip(buf, n) !== null, `${n} has disappeared from the archive`);
    }
  });

  await t.test('2. the alert on a set NOT owned is in there too', () => {
    const lines = csvRows(csvText);
    assert.equal(lines.length, ALERTS.length, `${lines.length} rows instead of ${ALERTS.length}`);
    for (const a of ALERTS) {
      const z = lines.find(x => x.set_number === a.sn && x.condition === a.c);
      assert.ok(z, `(${a.sn}, ${a.c}) is missing in the export`);
      assert.equal(z.direction, a.r, `direction of (${a.sn}, ${a.c}) is „${z.direction}"`);
      assert.equal(
        Number(z.threshold),
        a.s,
        `threshold of (${a.sn}, ${a.c}) came out as „${z.threshold}", expected ${a.s}`,
      );
      assert.equal(z.currency_code, a.w);
    }
    // The core: two of the four alerts sit on sets without a stock row. As
    // columns on sets.csv they would have silently fallen out — and exactly
    // that is the common case (threshold on a set one WANTS to buy).
    // And NOTHING from the foreign account. Without this case an export without
    // `WHERE user_id` would not be noticeable.
    assert.ok(
      !lines.some(x => x.set_number === FOREIGN_ALARM.sn),
      `The foreign account's alert (${FOREIGN_ALARM.sn}) is in the own export. ` +
        'An alert belongs to exactly ONE account because it triggers a mail to that address ' +
        '— on re-import it would land in the own account.',
    );

    const withoutInventory = ALERTS.filter(a => !a.owns);
    assert.equal(withoutInventory.length, 2, 'precondition: two alerts without a stock row');
    for (const a of withoutInventory) {
      assert.ok(
        lines.some(x => x.set_number === a.sn),
        `The alert on ${a.sn} is missing — the account does not own the set, and exactly ` +
          'that is why it lives in a SEPARATE file and not as a column of sets.csv',
      );
    }
  });

  await t.test('3. runtime state is NOT in the file', () => {
    const head = csvText.replace(/^﻿/, '').split(/\r?\n/)[0];
    for (const column of ['triggered', 'last_triggered_at', 'last_price']) {
      assert.ok(
        !head.includes(column),
        `„${column}" is in the export. That is runtime state of the job, not an entry ` +
          'of the user: a triggered=true from the file would suppress the first message ' +
          'after restoring, and an old last_price would show in the ' +
          'overview as the current state.',
      );
    }
  });

  await t.test('4. the same file restores the emptied table', async () => {
    await db.run('DELETE FROM price_alerts WHERE user_id=$1', [MAIN]);
    assert.equal(
      (await db.get('SELECT COUNT(*)::int c FROM price_alerts WHERE user_id=$1', [MAIN])).c,
      0,
      'precondition: no own alerts',
    );

    const { status, body } = await uploadIt(srv.base, csvText);
    assert.equal(status, 200, `The import answered with ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.added, ALERTS.length, `${body.added} created instead of ${ALERTS.length}`);
    assert.equal(body.errors, 0, `${body.errors} errors: ${JSON.stringify(body.results)}`);
    assert.equal(body.currency_note, undefined, 'A currency hint came although file and account both carry CHF');

    for (const a of ALERTS) {
      const z = await db.get(
        `SELECT direction, threshold, currency_code, triggered FROM price_alerts
          WHERE user_id=$1 AND set_number=$2 AND condition=$3`,
        [MAIN, a.sn, a.c],
      );
      assert.ok(z, `(${a.sn}, ${a.c}) did not come back`);
      assert.equal(z.direction, a.r);
      assert.equal(Number(z.threshold), a.s, `threshold of (${a.sn}, ${a.c}) is ${z.threshold}, expected ${a.s}`);
      assert.equal(z.currency_code, 'CHF');
      assert.equal(z.triggered, false, 'The marker is set to true — a freshly set alert has not reported anything yet');
    }
  });

  await t.test('5. a file in a foreign currency: the ACCOUNT wins, and it is said', async () => {
    // The rule of the tree (PUT /sets/:setNumber/alert): the currency comes from
    // the settings, not from the request. A file is a request.
    await db.run('DELETE FROM price_alerts WHERE user_id=$1', [MAIN]);
    const { body } = await uploadIt(srv.base, csvFromAlerts('EUR'));

    assert.equal(body.added, ALERTS.length, `${body.added} created instead of ${ALERTS.length}`);
    const z = await db.get(
      `SELECT currency_code, threshold FROM price_alerts
        WHERE user_id=$1 AND set_number=$2 AND condition='N'`,
      [MAIN, '75192-1'],
    );
    assert.equal(
      z.currency_code,
      'CHF',
      `The currency became „${z.currency_code}" — taken from the FILE. That makes ` +
        'two sources for the same value, and on the next change they drift ' +
        'apart (the rule is at PUT /sets/:setNumber/alert).',
    );
    assert.equal(
      Number(z.threshold),
      600,
      'The threshold was changed — there is NO conversion, that would need a rate',
    );

    // And the decisive point: it is NOT concealed.
    assert.ok(
      body.currency_note,
      'No hint in the response. The numbers now mean something different from the ' +
        'file („unter 600“ in CHF instead of EUR) — silently taking the number AND ' +
        'changing the currency is the one thing nobody would notice here.',
    );
    assert.match(
      String(body.currency_note),
      /CHF/,
      `The hint does not name the target currency: „${body.currency_note}"`,
    );
    const marked = (body.results || []).filter(x => x.currency_adjusted);
    assert.equal(marked.length, ALERTS.length, `${marked.length} of ${ALERTS.length} rows are marked as adjusted`);
  });

  await t.test('6. an unusable row is counted, not swallowed', async () => {
    // What this case REALLY distinguishes (learned while counter-checking)
    await db.run('DELETE FROM price_alerts WHERE user_id=$1', [MAIN]);
    const broken =
      'set_number,condition,richtung,schwelle,currency_code\n' +
      '75192-1,N,seitwaerts,600,CHF\n' + // direction does not exist
      '10179-1,N,unter,0,CHF\n' + // threshold must be > 0
      '31203-1,X,unter,50,CHF\n' + // condition does not exist — only the check catches that
      '21309-1,U,ueber,24.9,CHF\n'; // the good row
    const { body } = await uploadIt(srv.base, broken);
    assert.equal(body.errors, 3, `${body.errors} errors reported instead of 3: ${JSON.stringify(body.results)}`);
    assert.equal(body.added, 1, `${body.added} created instead of 1`);
    // The condition „X" must NOT stand in the table. The database would have
    // taken it; only checkInput() in src/finances/priceAlert.ts rejects it.
    assert.equal(
      (await db.get(`SELECT COUNT(*)::int c FROM price_alerts WHERE user_id=$1 AND condition NOT IN ('N','U')`, [MAIN]))
        .c,
      0,
      'An alert with a condition other than N or U landed in the table. ' +
        'The table has NO CHECK for it — only the check in ' +
        'src/finances/priceAlert.ts catches that, and you only get it via setAlert().',
    );
    assert.equal(
      (await db.get('SELECT COUNT(*)::int c FROM price_alerts WHERE user_id=$1', [MAIN])).c,
      1,
      'An unusable row landed in the table anyway',
    );
    // And the foreign alert stands there untouched — an import writes only in the
    // own account.
    assert.equal(
      (await db.get('SELECT COUNT(*)::int c FROM price_alerts WHERE user_id=$1', [FREMD])).c,
      1,
      'The import touched the foreign account',
    );
    // Opposite direction: the good row MUST go through. Without it the rule would
    // also be fulfilled if the import rejected everything in principle.
    assert.ok(
      await db.get(`SELECT 1 FROM price_alerts WHERE set_number='21309-1' AND condition='U'`),
      'The valid row was rejected as well',
    );
  });

  await t.test('6b. a repeated import resets the flag', async () => {
    // setAlert() promises: „The marker triggered is RESET when
    // changing: a new threshold is a new question, and it should
    // be answered, even if the old one has already reported once."
    await db.run('DELETE FROM price_alerts WHERE user_id=$1', [MAIN]);
    await db.run(
      `INSERT INTO price_alerts
                    (user_id,set_number,condition,direction,threshold,currency_code,triggered)
                  VALUES ($1,'75192-1','N','below',600,'CHF',TRUE)`,
      [MAIN],
    );
    assert.equal(
      (await db.get(`SELECT triggered FROM price_alerts WHERE user_id=$1 AND set_number='75192-1'`, [MAIN])).triggered,
      true,
      'precondition: the marker is set',
    );

    await uploadIt(srv.base, csvFromAlerts());
    assert.equal(
      (
        await db.get(
          `SELECT triggered FROM price_alerts WHERE user_id=$1 AND set_number='75192-1'
        AND condition='N'`,
          [MAIN],
        )
      ).triggered,
      false,
      'The marker is still true. Then the restored alert never reports ' + 'again — it counts as already answered.',
    );
  });

  await t.test('7. the Rebrickable export stays untouched', async () => {
    // Recorded so that the decision is not later read as an omission:
    // this file goes to the importer of a FOREIGN company and
    // carries exactly two columns. A third one makes it unusable there.
    const r = await fetch(`${srv.base}/api/v2/sets/export/rebrickable`);
    assert.equal(r.status, 200, `The Rebrickable export answered with ${r.status}`);
    const head = (await r.text()).replace(/^﻿/, '').split(/\r?\n/)[0];
    assert.equal(
      head.replace(/"/g, ''),
      'Set Number,Quantity',
      `The header reads ${head}. Rebrickable reads „Set Number,Quantity“ — an ` +
        'extra column (such as an alert threshold) makes the file unusable there.',
    );
  });
});
