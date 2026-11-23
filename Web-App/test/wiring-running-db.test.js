/**
 * Five wirings that were previously only asserted as text patterns.
 *
 * Counter-check: PASSWORD_MIN_CHARS in src/infra/passwordRule.ts set to 8 → red “3. a too short password is rejected”.
 */
const test = require('node:test');
const { environment, testData } = require('./helpers/sources');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const { testServer } = require('./helpers/server');
const { holdsSet, catalogSet } = require('./helpers/inventory');
const { mailFake, enterMailServer } = require('./helpers/mail-fake');
mailFake();

test.after(async () => {
  await db.pool.end().catch(() => {});
});

let MAIN = 0,
  KIND = 0;
const SN = '75192-1';

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
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('kind','x')`);
  const id = async n => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  MAIN = await id('haupt');
  KIND = await id('kind');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [MAIN, KIND]);
  await catalogSet(db, SN, { name: 'Falcon' });
  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ('3001','Brick')
                ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name)
                VALUES ('3001',4,'Rot') ON CONFLICT (part_number,color_id) DO NOTHING`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name) VALUES ('sw0001','Han')
                ON CONFLICT (fig_number) DO NOTHING`);
}

test('the five wirings via their real addresses', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }
  await setup();

  // Without a session and without a token the app sees exactly what it sees for a
  // request without a valid sign-in. The first case is about that.
  const ohne = testServer(_req, { sitzung: {}, t });
  const mit = testServer(_req, { sitzung: { userId: MAIN }, t });

  await t.test('1. the PDF download does not respond with the file without a token', async () => {
    const r = await fetch(`${ohne.base}/api/v2/sets/partslist-pdf/download/irgendwas`);
    assert.ok(
      r.status === 401 || r.status === 403,
      `Expected 401 or 403, got ${r.status}. Without requireToken this ` +
        'address served a finished parts list to anyone who guesses the job number.',
    );
    assert.notEqual(r.headers.get('content-type'), 'application/pdf', 'A PDF came back anyway');
  });

  await t.test('2. the image proxy fetches nothing from a foreign host', async () => {
    const fremd = encodeURIComponent('https://angreifer.example/x.jpg');
    const r = await fetch(`${mit.base}/api/v1/img-proxy?url=${fremd}`);
    assert.equal(
      r.status,
      403,
      `Expected 403, got ${r.status}. Without the host check the server fetches any ` +
        'address someone slips it — including ones in the own network.',
    );

    // The opposite direction: an ALLOWED host must not fail at the filter.
    // Nothing is fetched here (no network in the test) — it is only checked that the
    // response is something OTHER than 403. Without this case the rule would also be
    // satisfied if the proxy rejected everything.
    const erlaubt = encodeURIComponent('https://cdn.rebrickable.com/media/sets/75192-1.jpg');
    const r2 = await fetch(`${mit.base}/api/v1/img-proxy?url=${erlaubt}`);
    assert.notEqual(
      r2.status,
      403,
      'An allowed host was rejected with 403 too — then the proxy does not check ' +
        'the host but refuses in principle',
    );
  });

  await t.test('3. a too short password is rejected', async () => {
    // passwordToShort() lives in src/account/loginCheck.ts and applies to registration,
    // creation by the admin and changing. Asserted so far was only that
    // the routes NAME the function.
    await db.run(`INSERT INTO global_settings (key,value) VALUES ('registration_enabled','1')
                  ON CONFLICT (key) DO UPDATE SET value='1'`);
    await enterMailServer(db);
    const baseBefore = process.env.APP_BASE_URL;
    environment({ APP_BASE_URL: 'http://localhost' });
    t.after(() => {
      if (baseBefore === undefined) environment({ APP_BASE_URL: undefined });
      else environment({ APP_BASE_URL: baseBefore });
    });
    const r = await fetch(`${mit.base}/api/v2/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'neuling', email: 'n@example.org', password: '12345678901', language: 'de' }),
    });
    const b = await r.json().catch(() => ({}));
    assert.equal(r.status, 400, `expected 400, got ${r.status}: ${JSON.stringify(b)}`);
    // The response carries the translated SENTENCE, not the key — the
    // error language is central (src/infra/errorTexts.ts). So the sentence
    // is checked; it names the number that matters.
    assert.match(
      String(b.error || ''),
      /mindestens 12 Zeichen/,
      `Rejected with „${b.error}" — expected the password length. Another ` +
        'reason would mean the length was not checked at all.',
    );
    assert.equal(
      (await db.get(`SELECT COUNT(*)::int c FROM users WHERE username='neuling'`)).c,
      0,
      'The account was created despite the rejection',
    );

    // Opposite direction: twelve characters pass. Without it the rule would also be
    // satisfied if EVERY registration failed.
    const r2 = await fetch(`${mit.base}/api/v2/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'neuling2', email: 'n2@example.org', password: 'zwoelf12Zchn', language: 'de' }),
    });
    assert.notEqual(r2.status, 400, 'Twelve characters were rejected with 400 too — then the limit is not twelve');
  });

  await t.test('4. a date on which a purchase already exists is rejected', async () => {
    // purchaseAtSameTag() sits in the CHANGE path: whoever moves the date of an
    // acquisition to a day on which the same position already has
    // one gets 409. Without the check it would run into the unique
    // index (since 0047 idx_set_acq_tag_merkmale) and come back as 500. …
    const todayDate = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await holdsSet(db, MAIN, SN, 1, { preis: 100, am: yesterday });
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
                  VALUES ($1,$2,1,100,'N',$3::timestamptz)`,
      [MAIN, SN, todayDate],
    );
    const zeilen = await db.all(
      `SELECT id, created_at FROM set_acquisitions WHERE user_id=$1 AND set_number=$2
        ORDER BY created_at`,
      [MAIN, SN],
    );
    assert.equal(zeilen.length, 2, 'precondition: two acquisitions on two days');

    // Move the OLDER one to the day of the younger one.
    const r = await fetch(`${mit.base}/api/v2/sets/${SN}/acquisitions/${zeilen[0].id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: todayDate }),
    });
    const b = await r.json().catch(() => ({}));
    assert.equal(
      r.status,
      409,
      `Expected 409, got ${r.status}: ${JSON.stringify(b)}. Without the per-day check ` +
        'this ends up in the unique index and comes back as 500 — a server error ' +
        'instead of information.',
    );
    assert.equal(
      (await db.get(`SELECT COUNT(*)::int c FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [MAIN, SN])).c,
      2,
      'Despite the rejection the number of acquisitions changed',
    );

    // Opposite direction: a FREE day passes. Without it the rule would also be
    // satisfied if every date change were rejected.
    const dayBeforeYesterday = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
    const r2 = await fetch(`${mit.base}/api/v2/sets/${SN}/acquisitions/${zeilen[0].id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: dayBeforeYesterday }),
    });
    assert.ok(
      r2.status < 400,
      `A free day was rejected with ${r2.status} — then the route does not check ` +
        'the day but rejects every date change',
    );
  });

  await t.test('5. moving a set without acquisition_ids is rejected', async () => {
    const r = await fetch(`${mit.base}/api/v2/sets/${SN}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to_user_id: KIND }),
    });
    const b = await r.json().catch(() => ({}));
    assert.equal(r.status, 400, `expected 400, got ${r.status}: ${JSON.stringify(b)}`);
    // As with the password length: the response carries the translated sentence,
    // not the key. `acquisition_ids` is literally in it — exactly
    // the field that is missing.
    assert.match(
      String(b.error || ''),
      /acquisition_ids/,
      `Rejected with „${b.error}". Moving goes via the PURCHASE PRICE: three ` +
        'acquisitions are three purchases that can belong to different children in the household ' +
        '— whoever wants to move everything selects all rows.',
    );
    // And nothing has moved.
    assert.equal(
      (await db.get(`SELECT COUNT(*)::int c FROM sets WHERE user_id=$1 AND set_number=$2`, [KIND, SN])).c,
      0,
      'Despite the rejection the child got the set',
    );
  });
});
