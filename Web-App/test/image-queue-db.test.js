/**
 * Images are stored locally in the BACKGROUND — the request computes nothing.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Intercept download and downscaling — what counts here is WHEN they are called,
// not what they do.
let geladen = 0,
  verkleinert = 0;

const { buildAndRequire, testData, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
testImageWorker(null, {
  loadSetImage: async () => {
    geladen++;
    return '/images/sets/test.jpg';
  },
  createPreview: async () => {
    verkleinert++;
    return true;
  },
});
const { dataOrSkip, keineDb } = require('./helpers/db');
const { emptyQueue } = require('./helpers/image-queue');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const db = testData();

test('the request takes a note, the job stores', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;
  // The queue must be emptied BEFORE use, not only the own
  // prefix — otherwise the batch takes the rows of a predecessor. Rationale
  // and reproduction in helpers/image-queue.js.
  await emptyQueue(db);

  const IQ = _req('src/images/imageDemandRun.js');
  await IQ.setUpImageDemand();
  const PREFIX = `TQ${process.pid}`;
  const weg = async () => db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [PREFIX + '%']).catch(() => {});
  await weg();

  try {
    await t.test('duplicate notes count once', async () => {
      // When scrolling the same image comes by several times. Without deduplication
      // it would stand several times in the queue and be fetched several times.
      for (let i = 1; i <= 25; i++)
        IQ.rememberUsed(`https://cdn.rebrickable.com/media/sets/${PREFIX}_${i}.jpg`, `${PREFIX}_${i}`);
      IQ.rememberUsed(`https://cdn.rebrickable.com/media/sets/${PREFIX}_1.jpg`, `${PREFIX}_1`);
      // Since an earlier round it is BUFFERED: rememberUsed() no longer writes anything
      // itself — one INSERT per image request drained the connection pool. The
      // writing runs on a timer; triggered by hand here.
      await IQ._writeBuffer();
      const n = (await db.get(`SELECT COUNT(*)::int c FROM image_wanted WHERE set_number LIKE $1`, [PREFIX + '%'])).c;
      assert.equal(n, 25, `${n} Notizen statt 25`);
    });

    await t.test('the job works in batches, not everything at once', async () => {
      // The point of the matter: on weak hardware the whole backlog must not
      // be computed in one go.
      // The batch size stands in the source (: raised from 5 to 20
      // after the CPU causes were fixed). The test reads it …
      const stapel = IQ.BATCH;
      assert.ok(stapel > 0, 'STAPEL nicht auffindbar');
      const vorher = geladen;
      const n1 = (await IQ._workStack()).gesamt;
      assert.ok(
        n1 > 0 && n1 <= stapel,
        `${n1} Bilder in einem Durchgang bei STAPEL=${stapel} — die Begrenzung greift nicht`,
      );
      assert.ok(n1 < 25, 'Der ganze Rückstau wurde in einem Rutsch gerechnet');
      assert.equal(geladen - vorher, n1, 'es wurden mehr Bilder geholt als abgearbeitet');
      assert.equal(verkleinert, geladen, 'zu jedem geholten Bild gehört eine Vorschau');
    });

    await t.test('at the end no note remains', async () => {
      for (let i = 0; i < 5; i++) await IQ._workStack();
      const n = (await db.get(`SELECT COUNT(*)::int c FROM image_wanted WHERE set_number LIKE $1`, [PREFIX + '%'])).c;
      assert.equal(n, 0, `${n} Notizen übrig`);
    });
  } finally {
    await weg();
    // Do NOT close the pool here: the tile test further below still needs it.
    // It closes as the last DB test.
  }
});

test('the tile "image download (CDN)" shows the catalog queue', { concurrency: 1 }, async t => {
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

  const NUTZER = `ka-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',true)`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;

  await adminWithFactor(_req, uid);
  const { base, srv } = testServer(_req, { sitzung: { userId: uid, isAdmin: 1 }, t });
  const kachel = async () => (await (await fetch(`${base}/api/v1/admin/jobs`)).json()).jobs?.imgDl;

  try {
    await db.run(`DELETE FROM image_wanted`);
    const leer = await kachel();
    assert.ok(leer, 'Die Kachel fehlt in der Antwort');
    assert.equal(leer.queue, 0);
    assert.doesNotMatch(leer.sub, /Katalog/, 'Ohne Warteschlange soll die Kachel nicht von Katalogbildern reden');

    await db.run(`INSERT INTO image_wanted (url,set_number)
                  SELECT 'https://x/'||g||'.jpg', 'KA'||g FROM generate_series(1,137) g`);
    const voll = await kachel();
    assert.equal(voll.queue, 137, 'Die Warteschlange wird nicht gezählt');
    assert.match(voll.sub, /137 Katalog-Bilder in Warteschlange/, 'Die Zahl steht nicht im Text der Kachel');
    // “stock" must stand next to it — otherwise one does not know what the
    // OTHER number refers to.
    assert.match(voll.sub, /Bestand:/, 'Ohne diese Beschriftung sind die beiden Zahlen nicht auseinanderzuhalten');
    // “running" now means: has done something recently
    await db.run(`DELETE FROM run_state WHERE key='imgqueue_last_run'`);
    await db.run(`DELETE FROM run_state WHERE key='imgredl_status'`);
    await _req('src/management/tiles.js')
      .imgDlReset()
      .catch(() => {});
    _req('src/images/imageDemandRun.js').lastRun.zeit = null;
    const withoutRun = await kachel();
    assert.equal(withoutRun.status, 'idle', 'Ohne Durchgang darf die Kachel keinen Betrieb melden');
    assert.match(
      withoutRun.sub,
      /Job noch nicht gelaufen/,
      'Die Kachel verschweigt, dass der Job noch nicht gelaufen ist',
    );

    // And after a pass it reports operation. What is meant is the TICK —
    // there the state is stored for the other worker processes.
    await _req('src/images/imageDemandRun.js')._tickPass();
    const nachLauf = await kachel();
    assert.equal(nachLauf.status, 'running', 'Nach einem Durchgang muss die Kachel Betrieb melden');
    assert.ok(nachLauf.queueLastRun, 'Der Zeitpunkt des letzten Durchgangs fehlt');
    // And the bar must not stand at 100 % while something is still pending.
    assert.ok(voll.total >= 137, `total=${voll.total} enthält die Warteschlange nicht`);

    // A STUCK “running" is not operation
    await db.run(`DELETE FROM run_state WHERE key='imgqueue_last_run'`);
    _req('src/images/imageDemandRun.js').lastRun.zeit = null;
    await _req('src/management/tiles.js')
      .imgDlReset()
      .catch(() => {});
    assert.notEqual(
      (await kachel()).status,
      'running',
      'Vorbedingung verletzt: Ohne Nachlauf darf hier kein Betrieb stehen',
    );

    const redl = async at =>
      db.run(
        `INSERT INTO run_state (key, value) VALUES ('imgredl_status',$1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify({ running: true, phase: 'scanning', at })],
      );

    await redl(Date.now());
    const frisch = await kachel();
    assert.equal(frisch.status, 'running', 'Ein FRISCHER Nachlauf muss weiterhin als Betrieb gelten');

    await redl(Date.now() - 10 * 60_000);
    const alt = await kachel();
    assert.notEqual(
      alt.status,
      'running',
      'Ein zehn Minuten alter Stand gilt noch als Betrieb — dann bleibt die ' +
        'Kachel nach einem abgebrochenen Lauf für immer auf „läuft" stehen.',
    );
    await db.run(`DELETE FROM run_state WHERE key='imgredl_status'`);
  } finally {
    await db.run(`DELETE FROM image_wanted`).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    // Last test with database in this file.
    await db.pool.end().catch(() => {});
  }
});

test('the job also reports pure skips', () => {
  // Marco's finding
  const { message: meldung } = _req('src/images/imageDemandRun.js');
  const onlySkipped = {
    geholt: 0,
    vorschau: 0,
    uebersprungen: 10,
    gesamt: 10,
    notLoaded: 0,
    noPreview: 0,
    knownMissing: 0,
    ohneNummer: 0,
    setAside: 0,
    work: 0,
  };
  const text = meldung(onlySkipped);
  assert.match(text, /10 bearbeitet/, 'Ein Durchgang mit lauter Übersprüngen nennt seine Zahl nicht');
  assert.match(
    text,
    /10 bereits vorhanden/,
    'Die Meldung nennt die Übersprünge nicht — dann weiss man nicht, ob der ' + 'Job arbeitet oder nur leerläuft',
  );

  // And the tick must not conceal them: the condition before the output
  // must not depend on any number that is zero for pure skips.
  const q = fs.readFileSync(path.join(ROOT, 'src/images/imageDemandRun.ts'), 'utf8');
  const i = q.indexOf('async function processImageDemand');
  assert.ok(i > 0, 'Kein Takt');
  const fn = q.slice(i, q.indexOf('\n}\n', i)).replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(
    fn,
    /if \(e\.geholt/,
    'Gemeldet wird nur bei geladenen Bildern — ein Durchgang mit lauter ' + 'Übersprüngen bleibt unsichtbar',
  );
  assert.match(
    fn,
    /message\(e\)/,
    'Der Takt baut den Text selbst zusammen — dann laufen Meldung und Zähler ' +
      'auseinander, sobald ein Zähler dazukommt',
  );
});

test('the image tables come from a MIGRATION, not from initSchema', () => {
  // Marco's finding
  const mig = fs.readFileSync(path.join(ROOT, 'db/migrations/0009-bild-tabellen.sql'), 'utf8');
  assert.match(mig, /CREATE TABLE IF NOT EXISTS image_wanted/, 'image_wanted fehlt in der Migration');
  assert.match(mig, /CREATE TABLE IF NOT EXISTS image_misses/, 'image_misses fehlt in der Migration');

  // And NO longer elsewhere — two places that create the same thing drift
  // apart at some point.
  for (const datei of ['db/database.ts', 'src/images/imageMisses.ts', 'src/images/imageDemandRun.ts']) {
    const src = fs
      .readFileSync(path.join(ROOT, datei), 'utf8')
      .split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('--'))
      .join('\n');
    assert.doesNotMatch(
      src,
      /CREATE TABLE IF NOT EXISTS image_(wanted|misses)/,
      `${datei} legt die Tabelle ebenfalls an — das gehört nur in die Migration`,
    );
  }

  // The init functions run AFTER schema and migrations (otherwise the
  // table is missing when loading the stock) and in every worker process: they stand in
  // startup/database.ts behind initSchemaOnce(), which every process calls.
  const preparation = fs.readFileSync(path.join(ROOT, 'startup/database.ts'), 'utf8');
  const schema = preparation.indexOf('await db.initSchemaOnce()');
  assert.ok(
    schema > 0 && preparation.indexOf('await d.images.startNone()') > schema,
    'setUpImageGaps() läuft vor den Migrationen — dann fehlt die Tabelle noch',
  );
});

test('the buffer is written away in EVERY worker process', () => {
  // Marco's finding
  const q = fs.readFileSync(path.join(ROOT, 'src/images/imageDemand.ts'), 'utf8');
  const init = q.slice(
    q.indexOf('export async function setUpImageDemand'),
    q.indexOf('export async function deleteExpired'),
  );
  assert.match(
    init,
    /setInterval\([\s\S]{0,80}writeBuffer/,
    'Das Wegschreiben steht nicht in setUpImageDemand() — dann läuft es nur dort, ' +
      'wo start() aufgerufen wird, also nur im Primärprozess',
  );

  // And setUpImageDemand() must actually run everywhere.
  const dbInit = fs.readFileSync(path.join(ROOT, 'startup/database.ts'), 'utf8');
  // REWORDED in — for the same reason as twelve lines
  // further down at start(), only this neighboring assertion had kept the bug:
  // it required the notation `jobs/imageQueue').setUpImageDemand()`, i.e.
  // explicitly a require(). When that became a top-level import, …
  assert.match(
    dbInit,
    /\bd\.images\.startImageDemand\(\)/,
    'startImageDemand() wird nicht beim Aufbau der Datenbank aufgerufen',
  );

  // Processing only happens in the job process: test/web-and-jobs-db.test.js checks that on the real server.
});

test('the request no longer computes anything, it only takes notes', () => {
  // Checked on the source text because it is about the ORDER: in the
  // gen=0 case the proxy must not trigger a downscale but must leave
  // the note. A test via the route would not distinguish the two —
  // delivery is immediate either way.
  const px = require('./helpers/sources').kompakt(require('./helpers/sources').proxyThumbSource());
  assert.match(px, /const note = \(\) => \{/, 'Der Proxy hinterlässt keine Notiz');
  assert.match(
    px,
    /if \(createMay\) queueThumb\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?cacheFile, thumbFile\); else note\(\);/,
    'Im gen=0-Fall wird weiter sofort verkleinert statt notiert',
  );
  // And the note needs the set number — without it the job does not know where to.
  assert.match(px, /const setNumber = setNumberFromImageAddress\(/, 'Die Setnummer wird nicht aus der Adresse gelesen');
  assert.equal(
    _req('routes/imgProxy.js').setNumberFromImageAddress('https://cdn.rebrickable.com/media/sets/10294-1.jpg'),
    '10294-1',
    'Die Setnummer wird nicht aus der Adresse gelesen',
  );
});
