/**
 * @einzeln: in the parallel run the test runner itself twice broke off while
 * reading this file's output (“Unable to deserialize cloned data”);
 * alone never. Cause in Node unclear, hence sequentially.
 *
 * The pacing of the image background job — and who can see it from outside.
 *
 * ── Marco's log ──────────────────────────────────────────────
 *     [image-queue] 10 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 10 bereits vorhanden
 * five times in a row, with 1113 notes in the queue, and in the
 * tile next to it “Job noch nicht gelaufen".
 *
 * Two bugs in one picture:
 *
 *   1. The quota of thirty requests per minute (Marco's specification against
 *      a block by the CDN) was applied to NOTES instead of CDN
 *      requests. A note for which image and preview were long present thus cost
 *      the same as a download — 1113 finished images thus needed 37
 *      minutes of pure waiting.
 *
 *   2. The state of the last pass lay in the memory of the process
 *      that executes the job. The tile, however, is answered by any of the four
 *      worker processes — in three of four cases thus by one
 *      that knows nothing of it.
 *
 * Both are questions of behavior, not of source text. Hence this
 * test measures what the job DOES and reads the tile state from a SECOND PROCESS.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Intercept download and downscaling — what counts here is HOW OFTEN and WHEN they
// are called, not what they do.
const loadTimes = [];
/**
 * Switch for the intercepted download.
 */
let loadFailsFail = false;

const { buildAndRequire, testData, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
testImageWorker(null, {
  loadSetImage: async (_u, sn) => {
    // The failure also counts as a request: the round trip to the CDN has
    // taken place, and exactly that is what the quota is about.
    loadTimes.push(Date.now());
    return loadFailsFail ? null : `/images/sets/${sn}.jpg`;
  },
  createPreview: async () => true,
});
const { keineDb } = require('./helpers/db');
const { emptyQueue } = require('./helpers/image-queue');
const { portOf } = require('./helpers/server');
const db = testData();
const IQ = _req('src/images/imageDemandRun.js');
const { SET_IMAGES_DIR } = _req('src/infra/appPaths.js');

/** Batch size and cap from the module — the test repeats no number. */
const { BATCH: STAPEL, PASS_MAX_NOTES: DECKEL } = IQ;

const created = [];
/** Put image AND preview in place — the job has nothing to do for this note. */
function finishedImage(sn) {
  for (const f of [`${sn}.jpg`, `${sn}_thumb.jpg`]) {
    const p = path.join(SET_IMAGES_DIR, f);
    fs.writeFileSync(p, 'x');
    created.push(p);
  }
}
const open = async p =>
  (await db.get(`SELECT COUNT(*)::int c FROM image_wanted WHERE set_number LIKE $1`, [p + '%'])).c;
/**
 * Enqueue notes — with ASCENDING `requested_at`.
 *
 * The batch fetches `ORDER BY requested_at ASC`. If a single INSERT for
 * all rows enters the same NOW(), the order is arbitrary — and a test
 * that targets batch boundaries then measures chance.
 */
const einreihen = async (praefix, von, bis) => {
  await db.run(
    `INSERT INTO image_wanted (url, set_number, requested_at)
                  SELECT 'https://cdn/'||$1||'_'||g||'.jpg', $1||'_'||g,
                         NOW() - (($3::int - g) || ' seconds')::interval
                    FROM generate_series($2::int, $3::int) g`,
    [praefix, von, bis],
  );
};

test('a tick clears finished notes instead of ten every twenty seconds', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // The queue must be emptied BEFORE use, not only the own
  // prefix — otherwise the batch takes the rows of a predecessor. Rationale
  // and reproduction in helpers/image-queue.js.
  await emptyQueue(db);
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

  const P = `FE${process.pid}`;
  const COUNT = STAPEL * 4;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  for (let i = 1; i <= COUNT; i++) finishedImage(`${P}_${i}`);
  await einreihen(P, 1, COUNT);

  try {
    loadTimes.length = 0;
    const t0 = Date.now();
    const e = await IQ._tickPass();
    const duration = Date.now() - t0;

    assert.equal(
      await open(P),
      0,
      `Nach einem Takt liegen noch ${await open(P)} von ${COUNT} Notizen. ` +
        'Genau das war Marcos Lage: Der Job arbeitete ab, aber mit ' +
        `${STAPEL} je zwanzig Sekunden — für 1113 fertige Bilder gut 37 Minuten.`,
    );
    assert.equal(e.uebersprungen, COUNT, 'Nicht alle wurden als „vorhanden" gezählt');
    assert.equal(e.work, 0, 'Für ein Bild samt Vorschau darf kein Arbeitsschritt anfallen');
    assert.equal(loadTimes.length, 0, 'Es wurde beim CDN angefragt, obwohl alles dalag');
    // Without real work no politeness pause may occur either: it protects
    // the CDN, and that was not touched here.
    assert.ok(
      duration < 2000,
      `Der Takt brauchte ${duration} ms für reine Übersprünge — dann greift die ` +
        'Pause noch immer an der falschen Stelle',
    );
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('the quota applies to real work, not to notes', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // The queue must be emptied BEFORE use, not only the own
  // prefix — otherwise the batch takes the rows of a predecessor. Rationale
  // and reproduction in helpers/image-queue.js.
  await emptyQueue(db);

  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const P = `KO${process.pid}`;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  // ── Deliberately across BATCH BOUNDARIES ─────────────────────────────────
  //
  // Every third entry must be loaded, the rest lies there finished. The
  // ten requests thereby spread over several batches — only then does the
  // spacing test below measure a batch boundary at all. If all ten lay in the first
  // batch, the old, too narrow cut of the pause would go undetected.
  const COUNT = STAPEL * 4;
  const zuLaden = new Set();
  for (let i = 1; i <= COUNT; i++) {
    if (i % 3 === 0) zuLaden.add(i);
    else finishedImage(`${P}_${i}`);
  }
  assert.ok(zuLaden.size > STAPEL, 'Vorbedingung: mehr zu laden als das Kontingent');
  await einreihen(P, 1, COUNT);

  try {
    loadTimes.length = 0;
    const e = await IQ._tickPass();

    await t.test('at most STAPEL requests per tick', async () => {
      assert.equal(
        loadTimes.length,
        STAPEL,
        `${loadTimes.length} CDN-Anfragen in einem Takt — erlaubt sind ${STAPEL}. ` +
          'Die Rate am CDN ist Marcos Vorgabe und darf sich durch das Nachholen ' +
          'von Stapeln NICHT erhöhen.',
      );
      assert.equal(e.work, STAPEL);
      assert.ok((await open(P)) > 0, 'Der Rest muss liegenbleiben');
      // Precondition for the spacing test: the ten requests really lay in
      // more than one batch.
      assert.ok(
        e.total > STAPEL,
        `alle ${e.work} Anfragen lagen in einem einzigen Stapel — dann prüft ` +
          'der Abstandstest unten die Stapelgrenze gar nicht',
      );
    });

    await t.test('half a second lies between two requests', () => {
      const abst = loadTimes.slice(1).map((z, i) => z - loadTimes[i]);
      const smallest = Math.min(...abst);
      assert.ok(
        smallest >= 500,
        `kleinster Abstand ${smallest} ms. Die Pause hing vorher an einem Zähler ` +
          'INNERHALB eines Stapels — sobald ein Takt mehrere Stapel nachholt, ' +
          'liefen sonst zwei Anfragen unmittelbar hintereinander.',
      );
    });
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test("skips use no quota — Marco's mixed queue", { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // The queue must be emptied BEFORE use, not only the own
  // prefix — otherwise the batch takes the rows of a predecessor. Rationale
  // and reproduction in helpers/image-queue.js.
  await emptyQueue(db);
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

  // The normal case after the button “fetch catalog images": a few missing
  // images, scattered among hundreds that were long present.
  const P = `MX${process.pid}`;
  const DONE = STAPEL * 5,
    ZU_LADEN = 3;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  for (let i = 1; i <= DONE; i++) finishedImage(`${P}_${i}`);
  await einreihen(P, 1, DONE + ZU_LADEN);

  try {
    loadTimes.length = 0;
    const e = await IQ._tickPass();
    assert.equal(
      await open(P),
      0,
      'Ein Takt muss die ganze Strecke abräumen — die drei fehlenden Bilder ' +
        'liegen unter dem Kontingent, die fertigen kosten nichts',
    );
    assert.equal(e.geholt, ZU_LADEN);
    assert.equal(e.uebersprungen, DONE);
    assert.equal(loadTimes.length, ZU_LADEN, 'Es wurde mehr geladen als nötig');
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('a tick looks through at most DURCHGANG_MAX_NOTIZEN notes', { concurrency: 1 }, async t => {
  // The cap is necessary because `existsSync` is synchronous: without it a
  // queue of 25 000 finished images would run through in one go and hold up
  // the worker process's event loop in bursts.
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // The queue must be emptied BEFORE use, not only the own
  // prefix — otherwise the batch takes the rows of a predecessor. Rationale
  // and reproduction in helpers/image-queue.js.
  await emptyQueue(db);
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

  const P = `DK${process.pid}`;
  const COUNT = DECKEL + STAPEL * 2;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  for (let i = 1; i <= COUNT; i++) finishedImage(`${P}_${i}`);
  await einreihen(P, 1, COUNT);

  try {
    const e = await IQ._tickPass();
    assert.equal(e.total, DECKEL, `${e.total} Notizen in einem Takt — der Deckel liegt bei ${DECKEL}`);
    assert.equal(await open(P), COUNT - DECKEL, 'Der Rest muss auf den nächsten Takt warten');
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('expired notes are really deleted', { concurrency: 1 }, async t => {
  // What the comment claimed and the code did not do
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // The queue must be emptied BEFORE use, not only the own
  // prefix — otherwise the batch takes the rows of a predecessor. Rationale
  // and reproduction in helpers/image-queue.js.
  await emptyQueue(db);

  const P = `VF${process.pid}`;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  await db.run(
    `INSERT INTO image_wanted (url, set_number, requested_at)
                VALUES ($1, $2, NOW() - INTERVAL '30 days')`,
    [`https://cdn/${P}_alt.jpg`, `${P}_alt`],
  );
  await db.run(
    `INSERT INTO image_wanted (url, set_number, requested_at)
                VALUES ($1, $2, NOW())`,
    [`https://cdn/${P}_neu.jpg`, `${P}_neu`],
  );

  try {
    // Precondition: the batch does not even touch the old note — exactly
    // that is why it stayed.
    const e = await IQ._tickPass();
    assert.equal(e.total, 1, 'Die alte Notiz darf nicht abgearbeitet werden');
    assert.equal(await open(P), 1, 'Nur die alte Notiz sollte noch liegen');

    const weg = await IQ._deleteExpired();
    assert.ok(weg >= 1, 'Es wurde keine verfallene Notiz gelöscht');
    assert.equal(
      await open(P),
      0,
      'Die verfallene Notiz liegt weiterhin da — sie zählt dann für immer in ' +
        'der Kachel mit, ohne je bearbeitet zu werden',
    );
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('ANOTHER process sees that the job has run', { concurrency: 1 }, async t => {
  // ── Why as a separate process (lesson from an earlier round) ─────────────────────
  // A test that checks in the same process cannot see this bug: the
  // marker lies exactly there. The tile, however, is answered by ANY of the
  // four worker processes, and none of them executes the job.
  // Hence the job runs in the child process here and the parent asks.
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // The queue must be emptied BEFORE use, not only the own
  // prefix — otherwise the batch takes the rows of a predecessor. Rationale
  // and reproduction in helpers/image-queue.js.
  await emptyQueue(db);

  await db.run(`DELETE FROM run_state WHERE key='imgqueue_last_run'`);
  const vorher = await db.get(`SELECT value FROM run_state WHERE key='imgqueue_last_run'`);
  assert.equal(vorher, undefined, 'Vorbedingung: noch kein Laufstand abgelegt');

  // The child process knows NOTHING from this one — it does not build but uses
  // the already generated dist/ and only runs one tick.
  // The child does NOT set the address itself, it inherits it via the environment.
  execFileSync(
    process.execPath,
    [
      '-e',
      `
    const V = require(${JSON.stringify(path.join(ROOT, 'dist', 'startup', 'wiring.js'))});
    const { dbConfigFromEnvironment, createDb } = require(${JSON.stringify(path.join(ROOT, 'dist', 'db', 'database.js'))});
    const db = createDb(dbConfigFromEnvironment(), { firstStart: async () => {} });
    const contexts = {};
    V.buildServices(db, { contexts });
    const IQ = require(${JSON.stringify(path.join(ROOT, 'dist', 'src/images/imageDemandRun.js'))});
    (async () => {
      await db.initSchemaOnce();
      await IQ._tickPass(contexts.images);
      await db.pool.end();
    })().catch(e => { console.error(e); process.exit(1); });
  `,
    ],
    { env: process.env, stdio: 'pipe' },
  );

  const row = await db.get(`SELECT value FROM run_state WHERE key='imgqueue_last_run'`);
  assert.ok(
    row?.value,
    'Der Durchgang eines anderen Prozesses ist hier nicht sichtbar. Dann meldet ' +
      'die Kachel „Job noch nicht gelaufen", während im Log Durchgänge stehen — ' +
      'genau Marcos Befund.',
  );
  const state = JSON.parse(row.value);
  assert.ok(Date.now() - state.zeit < 60_000, 'Der abgelegte Zeitpunkt ist nicht plausibel');

  // And now up to the TILE
  const IQhier = _req('src/images/imageDemandRun.js');
  IQhier.lastRun.zeit = null;
  IQhier.lastRun.ergebnis = null;

  const NUTZER = `pace-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',true)`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    /** @type {any} */ (req).session = { userId: uid, isAdmin: 1 };
    /** @type {any} */ (req).apiUser = { user_id: uid, is_admin: 1 };
    next();
  });
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/index.js'));
  const srv = app.listen(0);
  try {
    const kachel = (await (await fetch(`http://localhost:${portOf(srv)}/api/v2/admin/jobs`)).json()).jobs?.imgDl;
    assert.ok(
      kachel?.queueLastRun,
      'Die Kachel kennt den Durchgang des anderen Prozesses nicht. Genau so kam ' +
        'Marcos „Job noch nicht gelaufen" zustande: Der Merker lag im ' +
        'Arbeitsspeicher des Prozesses, der den Job ausführt — die Anfrage ' +
        'beantwortet aber irgendeiner der vier.',
    );
  } finally {
    await new Promise(r => srv.close(r));
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
  }

  await db.run(`DELETE FROM run_state WHERE key='imgqueue_last_run'`).catch(() => {});
});

test('every exit of the loop has a counter', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // The queue must be emptied BEFORE use, not only the own
  // prefix — otherwise the batch takes the rows of a predecessor. Rationale
  // and reproduction in helpers/image-queue.js.
  await emptyQueue(db);
  const IM = _req('src/images/imageMisses.js');
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

  await t.test('note without a set number', async () => {
    const P = `ON${process.pid}`;
    await db.run(`DELETE FROM image_wanted WHERE url LIKE $1`, [`%${P}%`]);
    await db.run(`INSERT INTO image_wanted (url, set_number) VALUES ($1, NULL)`, [`https://cdn/${P}.jpg`]);
    const e = await IQ._workStack();
    assert.equal(
      e.withoutNumber,
      1,
      'Eine Notiz ohne Setnummer verschwindet spurlos — sie zählte als ' + '„bearbeitet", ohne irgendwo aufzutauchen',
    );
    assert.equal(e.geholt + e.preview + e.uebersprungen, 0);
    await db.run(`DELETE FROM image_wanted WHERE url LIKE $1`, [`%${P}%`]).catch(() => {});
  });

  await t.test('failed download', async () => {
    // The intercepted download delivers null for this substep — exactly its
    // behavior on HTTP 404, network error or too small a response.
    const P = `FD${process.pid}`;
    loadFailsFail = true;
    try {
      await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
      await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']);
      await einreihen(P, 1, 2);
      const e = await IQ._workStack();
      assert.equal(e.notLoaded, 2, 'Marcos Fall: zwei Notizen, kein Bild, und kein Zähler nannte den Grund');
      assert.equal(e.total, 2);
      assert.match(
        IQ.message(e),
        /2 Download fehlgeschlagen/,
        'Die Meldung nennt den Fehlschlag nicht — dann steht dort dreimal null ' + 'und die Frage bleibt offen',
      );
    } finally {
      loadFailsFail = false;
      await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
      await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
    }
  });

  await t.test('an image known to be missing costs neither quota nor waiting time', async () => {
    // rememberMissing('set:…') was written but never read in the job: a
    // note that arises anew via the proxy triggered on every pass
    // again a round trip to an image the CDN demonstrably does not
    // have — and used up a slot in the quota for it.
    const P = `BF${process.pid}`;
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']);
    const COUNT = STAPEL;
    for (let i = 1; i <= COUNT; i++) IM.rememberMissing(`set:${P}_${i}`);
    await IM._writeBuffer();
    await einreihen(P, 1, COUNT);
    try {
      loadTimes.length = 0;
      const t0 = Date.now();
      const e = await IQ._tickPass();
      const duration = Date.now() - t0;
      assert.equal(e.knownMissing, COUNT, 'Der Merker wird im Job nicht gelesen');
      assert.equal(
        loadTimes.length,
        0,
        `${loadTimes.length} CDN-Anfragen für Bilder, von denen feststeht, dass ` + 'es sie nicht gibt',
      );
      assert.equal(
        e.work,
        0,
        'Ein bekannt fehlendes Bild verbraucht einen Platz im Kontingent — ' +
          'dann bremsen ausgerechnet die aussichtslosen Notizen die aussichtsreichen',
      );
      assert.ok(
        duration < 2000,
        `${duration} ms für ${COUNT} bekannt fehlende Bilder — die Höflichkeitspause ` +
          'schützt den CDN, und der wurde hier gar nicht angefasst',
      );
    } finally {
      await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
      await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
    }
  });
});

test('clean up', { concurrency: 1 }, async () => {
  for (const f of created) fs.rmSync(f, { force: true });
  // Last test of this file — only here is the pool closed. (Lesson from
  // an earlier round: a pool closed earlier makes every following DB test
  // red, and the message does not name the reason.)
  await db.pool.end().catch(() => {});
});
