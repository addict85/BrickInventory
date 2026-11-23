/**
 * The wishlist goes out as CSV and comes back as a wishlist.
 *
 * ── Counter-checks (carried out, findings MEASURED) ────────────────────────────
 *
 *   a) archive.append for merkliste.csv removed → 1, 2, 3 red; 4, 5, 6 green
 *   b) created_at left out in the import        → 3 red (date becomes today)
 *   c) writeTargetOrNull removed in the import  → 5 red
 *   d) condition left out in the export         → 2 AND 3 red
 *
 * Two things about it did not turn out the way I had written them down
 * beforehand, and both stand here because they say something about the test:
 *
 * With (a) five cases turned red on the FIRST attempt instead of three. 4 and 5 kept reading
 * `csvText` from case 1, and 4 additionally relied on the table filled by case 3
 * — so they fell along without having found anything themselves.
 * A message that points at the import while the error lies in the export
 * is worse than none. Since then 4, 5 and 6 build their file themselves
 * (csvFromItem) and 4 establishes its precondition itself. Case 3 keeps the
 * coupling — it exactly IS the round trip.
 *
 * With (d) I had only expected case 2. 3 turned red too, and that is right:
 * without the condition column the import creates (75192-1, U) as (75192-1, N), and
 * with that the list is not restored. The prediction was too narrow, not
 * the finding wrong.
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
  KIND = 0,
  FREMD = 0;

/** The three wishlist items of the setup — two sets, one in both conditions. */
const ITEM = [
  { sn: '75192-1', c: 'N', am: '2024-03-01' },
  { sn: '75192-1', c: 'U', am: '2024-05-17' },
  { sn: '10179-1', c: 'N', am: '2025-01-09' },
];

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
  await db.run(`INSERT INTO users (username,password_hash)
                VALUES ('haupt','x'),('kind','x'),('fremd','x')`);
  const id = async n => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  MAIN = await id('haupt');
  KIND = await id('kind');
  FREMD = await id('fremd');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [MAIN, KIND]);
  for (const p of ITEM) {
    await catalogSet(db, p.sn, { name: p.sn });
    await db.run(
      `INSERT INTO wanted (user_id,set_number,condition,created_at)
                  VALUES ($1,$2,$3,$4::timestamptz)`,
      [MAIN, p.sn, p.c, p.am],
    );
  }
}

/** Get one file out of the ZIP — without an unzip library. */
function fromZip(buf, name) {
  const zlib = require('node:zlib');
  // Walk the local file header signatures (PK\003\004). That suffices
  // here: the archive is unencrypted, without Zip64 and without spanning, and
  // archiver writes exactly one such header per file.
  for (let i = 0; i + 30 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue;
    const method = buf.readUInt16LE(i + 8);
    const namLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const fileName = buf.slice(i + 30, i + 30 + namLen).toString('utf-8');
    if (fileName !== name) continue;
    const start = i + 30 + namLen + extraLen;
    // The compressed size is in the header only if no data descriptor is used
    // (bit 3 of the flags field). archiver streams and sets the bit —
    // then the size is 0 and the rest of the buffer is inflated until
    // zlib detects the end of the stream. inflateRawSync can do that.
    const raw = buf.slice(start);
    if (method === 0) return raw.toString('utf-8');
    return zlib.inflateRawSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf-8');
  }
  return null;
}

/**
 * The same CSV, built from ITEM instead of fetched from the export: cases 4 and 5 ask about
 * the import alone and should not turn red when the export breaks. Case 3 stays
 * coupled, it is the round trip.
 */
function csvFromItem() {
  return 'set_number,condition,created_at\n' + ITEM.map(p => `${p.sn},${p.c},${p.am}`).join('\n') + '\n';
}

/** Rows of a CSV as objects — the header row determines the keys. */
function csvRows(text) {
  const withoutBom = text.replace(/^﻿/, '');
  const [head, ...rest] = withoutBom.trim().split(/\r?\n/);
  const columns = head.split(',').map(s => s.replace(/^"|"$/g, ''));
  return rest
    .filter(z => z.trim())
    .map(z => {
      const values = z.split(',').map(s => s.replace(/^"|"$/g, ''));
      return Object.fromEntries(columns.map((s, i) => [s, values[i] ?? '']));
    });
}

test('wishlist: round trip over the real addresses', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }
  await setup();

  importWorker(t, _req);
  const srv = testServer(_req, { session: { userId: MAIN }, t });

  let csvText = '';

  await t.test('1. merkliste.csv is in the ZIP of the data export', async () => {
    const r = await fetch(`${srv.base}/api/v2/settings/export/data`);
    assert.equal(r.status, 200, `The export answered with ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.slice(0, 2).toString(), 'PK', 'That is not a ZIP archive');

    csvText = fromZip(buf, 'merkliste.csv');
    assert.ok(
      csvText !== null,
      '„merkliste.csv“ is NOT in the archive. Marco asked for „analog den anderen Seiten“ ' +
        '— the three others are there, this one must be too.',
    );
    // And the three existing ones are still there: an export that brings the new
    // file along and loses an old one is no progress.
    for (const n of ['sets.csv', 'teile.csv', 'minifiguren.csv']) {
      assert.ok(fromZip(buf, n) !== null, `${n} has disappeared from the archive`);
    }
  });

  await t.test('2. the file carries number, condition and date of every wishlist item', () => {
    const lines = csvRows(csvText);
    assert.equal(
      lines.length,
      ITEM.length,
      `${lines.length} rows instead of ${ITEM.length} — the whole list is exported`,
    );
    for (const p of ITEM) {
      const z = lines.find(x => x.set_number === p.sn && x.condition === p.c);
      assert.ok(
        z,
        `(${p.sn}, ${p.c}) is missing in the export. Without the condition in the file ` +
          '„neu“ and „gebraucht“ of the same set collapse into one row.',
      );
      assert.equal(
        z.created_at,
        p.am,
        `The date added of (${p.sn}, ${p.c}) came out as „${z.created_at}", ` + `expected ${p.am}`,
      );
    }
  });

  await t.test('3. the same file restores the emptied list — including date', async () => {
    await db.run('DELETE FROM wanted');
    assert.equal((await db.get('SELECT COUNT(*)::int c FROM wanted')).c, 0, 'precondition: the list is empty');

    const fd = new FormData();
    fd.append('file', new Blob([csvText], { type: 'text/csv' }), 'merkliste.csv');
    const r = await fetch(`${srv.base}/api/v2/wanted/import/csv`, { method: 'POST', body: fd });
    const b = await r.json();
    assert.equal(r.status, 200, `The import answered with ${r.status}: ${JSON.stringify(b)}`);
    assert.equal(b.added, ITEM.length, `${b.added} created instead of ${ITEM.length}`);
    assert.equal(b.errors, 0, `${b.errors} errors: ${JSON.stringify(b.results)}`);

    const again = await db.all(
      `SELECT set_number, condition,
              TO_CHAR(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS am
         FROM wanted WHERE user_id=$1 ORDER BY set_number, condition`,
      [MAIN],
    );
    assert.equal(again.length, ITEM.length, 'Not all wanted items are back');
    for (const p of ITEM) {
      const z = again.find(x => x.set_number === p.sn && x.condition === p.c);
      assert.ok(z, `(${p.sn}, ${p.c}) did not come back`);
      // The core of point 3: the date is the OLD one, not today. „Auf der
      // Liste seit" is the only statement a wishlist item makes about
      // itself — an import that sets it to today loses it for
      // the whole list at once.
      assert.equal(
        z.am,
        p.am,
        `(${p.sn}, ${p.c}) is now at „${z.am}" instead of ${p.am} — the ` + 'date added was overwritten on import',
      );
    }
  });

  await t.test('4. a second import duplicates nothing and shifts no date', async () => {
    // The opposite direction to case 3: the import must also be applicable to a
    // FILLED list. Without this case an import that only works on the empty table
    // would count as "correct".
    const readIn = async () => {
      const fd = new FormData();
      fd.append('file', new Blob([csvFromItem()], { type: 'text/csv' }), 'merkliste.csv');
      const r = await fetch(`${srv.base}/api/v2/wanted/import/csv`, { method: 'POST', body: fd });
      return r.json();
    };
    await db.run('DELETE FROM wanted');
    const erst = await readIn();
    assert.equal(erst.added, ITEM.length, `precondition: the first import creates ${ITEM.length}, got ${erst.added}`);

    const b = await readIn();
    assert.equal(b.added, 0, `${b.added} newly created — all items already existed`);
    assert.equal(b.updated, ITEM.length, `${b.updated} reported as existing instead of ${ITEM.length}`);
    assert.equal(
      (await db.get('SELECT COUNT(*)::int c FROM wanted')).c,
      ITEM.length,
      'The list doubled — ON CONFLICT does not apply',
    );
  });

  await t.test('5. nothing can be imported into a FOREIGN account', async () => {
    // writeTargetOrNull checks the DIRECTION, not merely the membership.
    // 'fremd' is not a sub-account of 'haupt' — without this check an uploaded
    // file would write into every account of the installation.
    const fd = new FormData();
    fd.append('file', new Blob([csvFromItem()], { type: 'text/csv' }), 'merkliste.csv');
    fd.append('owner_user_id', String(FREMD));
    const r = await fetch(`${srv.base}/api/v2/wanted/import/csv`, { method: 'POST', body: fd });
    assert.equal(r.status, 403, `expected 403, got ${r.status}`);
    assert.equal(
      (await db.get('SELECT COUNT(*)::int c FROM wanted WHERE user_id=$1', [FREMD])).c,
      0,
      'The foreign account got wanted items despite the rejection',
    );

    // Opposite direction: importing into one's own SUB-account is allowed. Without
    // this case the rule would also be satisfied if EVERY owner_user_id
    // were rejected.
    const fd2 = new FormData();
    fd2.append('file', new Blob([csvFromItem()], { type: 'text/csv' }), 'merkliste.csv');
    fd2.append('owner_user_id', String(KIND));
    const r2 = await fetch(`${srv.base}/api/v2/wanted/import/csv`, { method: 'POST', body: fd2 });
    assert.equal(r2.status, 200, `The import for the sub-account answered with ${r2.status}`);
    assert.equal(
      (await db.get('SELECT COUNT(*)::int c FROM wanted WHERE user_id=$1', [KIND])).c,
      ITEM.length,
      'The sub-account did not get the list',
    );
  });

  await t.test('6. a file without a condition column takes the account default', async () => {
    // It is not this route that decides the default condition, but
    // conditionOrDefault() in src/wanted/wanted.ts — i.e. the account's setting.
    // What is checked is that the route does NOT set it itself: set to 'U',
    // a row without a condition must end up as 'U'.
    await db.run(
      `INSERT INTO user_settings (user_id, key, value) VALUES ($1,'user_default_condition','U')
                  ON CONFLICT (user_id, key) DO UPDATE SET value='U'`,
      [MAIN],
    );
    await db.run('DELETE FROM wanted WHERE user_id=$1', [MAIN]);

    const fd = new FormData();
    fd.append('file', new Blob(['set_number\n21309-1\n'], { type: 'text/csv' }), 'ohne.csv');
    const r = await fetch(`${srv.base}/api/v2/wanted/import/csv`, { method: 'POST', body: fd });
    const b = await r.json();
    assert.equal(b.added, 1, `${b.added} created instead of 1: ${JSON.stringify(b.results)}`);
    const z = await db.get('SELECT condition FROM wanted WHERE user_id=$1 AND set_number=$2', [MAIN, '21309-1']);
    assert.equal(
      z?.condition,
      'U',
      `The condition became „${z?.condition}" instead of „U". Then the route sets its own ` +
        'default instead of the account setting — a second truth about the same value.',
    );
  });
});
