/**
 * A throttling of the CDN is NOT a miss marker.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Intercept the download and set the status code.
let antwort = 403;
const thumbAttempts = { n: 0 };
let versuche = 0;

const { buildAndRequire, testData, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
testImageWorker(null, {
  setBildLaden: async (_u, _sn, info) => {
    versuche++;
    if (info) info.status = antwort;
    return null;
  },
  createPreview: async () => {
    thumbAttempts.n++;
    return null;
  },
});
const { keineDb } = require('./helpers/db');
const { emptyQueue } = require('./helpers/image-queue');
const db = testData();

test('a hopeless preview is only attempted ONCE', { concurrency: 1 }, async t => {
  // Marco's log
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
  const { SET_IMAGES_DIR } = _req('src/infra/appPaths.js');
  const fsm = require('node:fs');
  fsm.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const P = `WB${process.pid}`;
  const datei = path.join(SET_IMAGES_DIR, `${P}_1.jpg`);
  fsm.writeFileSync(datei, 'x'); // image present, preview impossible
  const IM = _req('src/images/imageMisses.js');
  const IQ = _req('src/images/imageDemandRun.js');
  await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['thumb:%' + P + '%']);

  try {
    thumbAttempts.n = 0;
    for (let runde = 1; runde <= 3; runde++) {
      await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
      await db.run(`INSERT INTO image_wanted (url, set_number) VALUES ($1,$2)`, [`https://cdn/${P}_1.jpg`, `${P}_1`]);
      await IQ._workStack();
    }
    assert.equal(
      thumbAttempts.n,
      1,
      `${thumbAttempts.n} Versuche in drei Durchgängen — eine Vorschau, die nicht ` +
        'gelingen kann, darf nur einmal Rechenzeit kosten',
    );
    await IM._writeBuffer();
    const gemerkt = (
      await db.get(`SELECT COUNT(*)::int c FROM image_misses WHERE cache_key LIKE $1`, ['thumb:%' + P + '%'])
    ).c;
    assert.equal(gemerkt, 1, 'Der Fehlschlag wurde nicht dauerhaft gemerkt');
  } finally {
    fsm.rmSync(datei, { force: true });
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['thumb:%' + P + '%']).catch(() => {});
  }
});

test('throttling and a missing image are distinguished', { concurrency: 1 }, async t => {
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

  const P = `DR${process.pid}`;
  const fuellen = async () => {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
    await db.run(
      `INSERT INTO image_wanted (url, set_number)
                  SELECT 'https://cdn/'||$1||'_'||g||'.jpg', $1||'_'||g
                    FROM generate_series(1,10) g`,
      [P],
    );
  };
  const offen = async () =>
    (await db.get(`SELECT COUNT(*)::int c FROM image_wanted WHERE set_number LIKE $1`, [P + '%'])).c;
  const gemerkt = async () =>
    (await db.get(`SELECT COUNT(*)::int c FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%'])).c;

  await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']);

  try {
    await t.test('403 locks out no image and loses no note', async () => {
      antwort = 403;
      versuche = 0;
      await fuellen();
      const IQ = _req('src/images/imageDemandRun.js');
      const e = await IQ._workStack();
      assert.equal(versuche, 1, `${versuche} Versuche — nach der ersten Drosselung muss der Stapel abbrechen`);

      // Put back is NOT processed
      assert.equal(
        e.gesamt,
        0,
        `${e.gesamt} als bearbeitet gemeldet, obwohl der Stapel vor der ersten ` +
          'Zeile abbrach und alles zurückgelegt wurde',
      );
      assert.equal(
        e.setAside,
        10,
        'Die zurückgelegten Notizen tauchen in keinem Zähler auf — dann ist ' +
          'aus der Meldung nicht zu erkennen, dass gedrosselt wurde',
      );
      assert.match(IQ.meldung(e), /zurückgelegt/, 'Die Meldung verschweigt die Drosselung');
      assert.equal(
        await offen(),
        10,
        'Notizen sind verlorengegangen. Der Stapel wird mit DELETE … RETURNING ' +
          'geholt — beim Abbruch muss der GANZE Rest zurückgelegt werden.',
      );
      assert.equal(
        await gemerkt(),
        0,
        'Eine Drosselung wurde als „Bild fehlt" gemerkt — dann sperrt der Ansturm ' +
          'genau die Bilder aus, die es gibt',
      );
    });

    await t.test('the pause holds back the next run', async () => {
      const vorher = versuche;
      const n = (await _req('src/images/imageDemandRun.js')._workStack()).gesamt;
      assert.equal(n, 0);
      assert.equal(
        versuche,
        vorher,
        'Es wurde weiter gefragt — stures Weiterfragen ist genau das Verhalten, ' + 'das eine Sperre verlängert',
      );
    });

    await t.test('404 on the other hand is remembered', async () => {
      // The pause from the previous substep stands in the database and would otherwise keep applying.
      await db.run(`DELETE FROM job_pauses WHERE type = 'bildbedarf'`);
      const IQ = _req('src/images/imageDemandRun.js');
      antwort = 404;
      versuche = 0;
      await fuellen();
      await IQ._workStack();
      await _req('src/images/imageMisses.js')._writeBuffer();
      assert.equal(versuche, 10, `${versuche} Versuche — bei 404 läuft der Stapel durch`);
      assert.equal(await gemerkt(), 10, 'Fehlende Bilder werden nicht gemerkt — dann fragt der Job sie ewig neu');
    });
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
    // Last DB test of this file — cleanup only happens here (lesson from 116).
    await db.pool.end().catch(() => {});
  }
});
