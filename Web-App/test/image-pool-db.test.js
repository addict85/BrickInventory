/**
 * Image requests occupy NO database connection.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip, keineDb } = require('./helpers/db');
const db = testData();

test('a tile wall costs not a single query', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;

  const IM = _req('src/images/imageMisses.js');
  const IQ = _req('src/images/imageDemandRun.js');
  await IM.setUpImageGaps();
  await IQ.setUpImageDemand();
  const PREFIX = `PL${process.pid}`;
  const weg = async () => {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [PREFIX + '%']).catch(() => {});
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, [PREFIX + '%']).catch(() => {});
  };
  await weg();

  // Count queries along — that is the quantity that matters.
  let abfragen = 0;
  const realQuery = db.pool.query.bind(db.pool);
  db.pool.query = (...a) => {
    abfragen++;
    return realQuery(...a);
  };

  try {
    await t.test('60 tiles trigger 0 queries', async () => {
      const vorher = abfragen;
      for (let i = 1; i <= 60; i++) {
        IM.isKnownMissing(`${PREFIX}_k${i}`);
        IQ.rememberUsed(`https://cdn.rebrickable.com/media/sets/${PREFIX}_${i}.jpg`, `${PREFIX}_${i}`);
      }
      assert.equal(
        abfragen - vorher,
        0,
        `${abfragen - vorher} Abfragen für 60 Kacheln. Bildanfragen sind der ` +
          'häufigste Vorgang der Anwendung — eine Abfrage je Bild leert den ' +
          'Verbindungspool, und ANDERE Routen laufen in den Zeitfehler.',
      );
    });

    await t.test('writing away is batched', async () => {
      const vorher = abfragen;
      await IQ._writeBuffer();
      // One statement for all notes; plus the processor job and its NOTIFY.
      assert.ok(
        abfragen - vorher <= 3,
        `${abfragen - vorher} Abfragen zum Wegschreiben von 60 Notizen — das muss ` +
          'ein Statement sein, sonst ist nur die Stelle verschoben',
      );
      const n = (await db.get(`SELECT COUNT(*)::int c FROM image_wanted WHERE set_number LIKE $1`, [PREFIX + '%'])).c;
      assert.equal(n, 60, `${n} Notizen statt 60 — gebündelt heisst nicht: weniger`);
    });

    await t.test('negative results likewise', async () => {
      for (let i = 1; i <= 40; i++) IM.rememberMissing(`${PREFIX}_m${i}`);
      const vorher = abfragen;
      await IM._writeBuffer();
      assert.ok(abfragen - vorher <= 2, `${abfragen - vorher} Abfragen für 40 Fehlanzeigen`);
    });

    await t.test('after a restart the knowledge is still there', async () => {
      // The reason why it belongs in the database at all:
      // the memory of one process does not help the others.
      IM._emptyForeground();
      assert.equal(IM.isKnownMissing(`${PREFIX}_m7`), false, 'Vorbedingung: der Speicher ist leer');
      await IM._refresh();
      assert.equal(
        IM.isKnownMissing(`${PREFIX}_m7`),
        true,
        'Nach dem Nachladen aus der Tabelle muss die Fehlanzeige wieder bekannt sein',
      );
    });
  } finally {
    db.pool.query = realQuery;
    await weg();
    // Do NOT close the pool here: the lock test further below still needs it.
    // It closes as the last DB test.
  }
});

test('a failed resize is not repeated endlessly', () => {
  // Marco's log, the same line again and again
  const px = require('./helpers/sources').proxyThumbSource();
  const q = px.slice(px.indexOf('function queueThumb('), px.indexOf('function drainThumbQueue'));
  assert.match(
    q,
    /isKnownMissing\(k, 'thumb:' \+ thumbFile\)/,
    'queueThumb() fragt nicht, ob die Verkleinerung schon einmal gescheitert ist',
  );
  // And the failure must be recorded — in BOTH places where
  // it can occur: when unpacking itself and in the pre-check.
  assert.equal(
    (px.match(/rememberMissing\(k, 'thumb:' \+ thumbFile\)/g) || []).length,
    2,
    'Der Fehlschlag wird nicht an beiden Stellen gemerkt (Vorprüfung und catch)',
  );
});

test('the browser may remember a 404', () => {
  const px = require('./helpers/sources').proxyThumbSource();
  // The path is now called sendPlaceholder
  assert.match(px, /function sendPlaceholder\(res(: \w+)?\)/, 'Kein gemeinsamer Weg für ein fehlendes Bild');
  assert.match(
    px,
    /sendPlaceholder[\s\S]{0,600}Cache-Control', 'private, max-age=3600/,
    'Die Antwort trägt keinen Cache-Hinweis — der Browser fragt jedes Mal neu',
  );
  // Both paths must use it: the hit in the marker and the refusal from the CDN.
  assert.match(
    px,
    /isKnownMissing\(cacheKey\)\) return sendPlaceholder\(res\)/,
    'Der Merker-Treffer antwortet ohne Cache-Hinweis',
  );
  assert.match(px, /r\.status === 404 \? sendPlaceholder\(res\)/, 'Die Absage vom CDN antwortet ohne Cache-Hinweis');
  // 403 (throttling) must NOT be cached — the same argument
  // as for the server-side marker.
  assert.doesNotMatch(px, /403[\s\S]{0,80}sendPlaceholder/, 'Ein 403 ist eine Drosselung, kein fehlendes Bild');
});

test('the preview lock occupies NO pool connection', { concurrency: 1 }, async t => {
  // Marco's log
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  const vorher = db.getPoolStats();
  const c = await db.ownConnection();
  try {
    const r = await c.query('SELECT pg_try_advisory_lock(918273645) AS ok');
    assert.equal(r.rows[0].ok, true, 'Die Sperre liess sich nicht nehmen');
    const waehrend = db.getPoolStats();
    assert.equal(
      waehrend.active,
      vorher.active,
      `Der Pool hat ${waehrend.active} statt ${vorher.active} aktive Verbindungen — ` +
        'eine über Sekunden gehaltene Sperre darf keine davon belegen',
    );
    await c.query('SELECT pg_advisory_unlock(918273645)');
  } finally {
    await c.end();
    // Last test with database in this file.
    await db.pool.end().catch(() => {});
  }
});

test('the queue has an index on the age', () => {
  // Every 20 seconds the job looks for the OLDEST entries. With a few dozen
  // rows that does not matter — with 25 000 (after “fetch catalog images") every
  // run would otherwise mean a complete pass including sorting.
  const mig = fs.readFileSync(path.join(ROOT, 'db/migrations/0010-image-wanted-index.sql'), 'utf8');
  assert.match(
    mig,
    /CREATE INDEX IF NOT EXISTS idx_image_wanted_alter ON image_wanted \(requested_at\)/,
    'Der Index auf requested_at fehlt',
  );
});

test('the session lock is released on the same connection', () => {
  // A session lock belongs to the CONNECTION that took it. If it is
  // released via another one, that does nothing — the lock would persist
  // forever, and no preview image would ever be created again. That actually
  //  happened to me.
  const px = require('./helpers/sources').proxyThumbSource();
  const i = px.indexOf('async function withPreviewLock');
  assert.ok(i > 0, 'withPreviewLock fehlt');
  // Since an earlier round the function stands at module level instead of in a closure —
  // one indentation level less, so it ends at '\n}\n'.
  const fn = px.slice(i, px.indexOf('\n}\n', i));
  assert.match(fn, /db\.ownConnection\(\)/, 'Die Sperre nimmt wieder eine Pool-Verbindung');
  assert.doesNotMatch(fn, /db\.pool\.connect\(\)/, 'Pool-Verbindung ist zurück');
  // Taking and releasing stand in the repository and get THIS connection.
  assert.match(fn, /sperre\.attemptsLock\(client,/, 'Nehmen nicht auf dem Client');
  assert.match(fn, /sperre\.giveLockFree\(client,/, 'Freigeben nicht auf dem Client');
});
