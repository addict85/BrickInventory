/**
 * What “missing" means — and how to take it back.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

/** Response of the intercepted download: null plus a status code as desired. */
let responseStatus = null;

const { buildAndRequire, testData, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
testImageWorker(null, {
  loadSetImage: async (_u, _sn, info) => {
    if (responseStatus && info) info.status = responseStatus;
    return null; // failure — the status code decides the rest
  },
});
const { keineDb } = require('./helpers/db');
const { emptyQueue } = require('./helpers/image-queue');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const db = testData();
const IQ = _req('src/images/imageDemandRun.js');
const IM = _req('src/images/imageMisses.js');

const einreihen = async sn => {
  await db.run(`DELETE FROM image_wanted WHERE set_number = $1`, [sn]);
  await db.run(`INSERT INTO image_wanted (url, set_number) VALUES ($1, $2)`, [`https://cdn/${sn}.jpg`, sn]);
};
const merker = async sn => db.get(`SELECT checked_at, reason FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);

test('only a 404 means "the image does not exist"', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
    await db.runMigrations?.();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // The queue must be emptied BEFORE use, not only the own
  // prefix — otherwise the batch takes the rows of a predecessor. Rationale
  // and reproduction in helpers/image-queue.js.
  await emptyQueue(db);
  const P = `MR${process.pid}`;

  await t.test('404 is remembered, with a reason', async () => {
    const sn = `${P}_404`;
    await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);
    IM._emptyForeground();
    responseStatus = 404;
    await einreihen(sn);
    const e = await IQ._workStack();
    await IM._writeBuffer();
    assert.equal(e.notLoaded, 1);
    const m = await merker(sn);
    assert.ok(
      m,
      'Ein 404 muss gemerkt werden — sonst wird jedes alte Set bei ' + 'jedem Blättern erneut beim CDN gesucht',
    );
    assert.match(m.reason || '', /404/, 'Der Grund fehlt — dann steht in image-diag wieder nur „gilt als fehlend"');
    await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);
  });

  await t.test('a batch of nothing but 404s reports as warn, not as error', async () => {
    // Marco's log
    const sn = `${P}_leise`;
    await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);
    IM._emptyForeground();
    responseStatus = 404;
    await einreihen(sn);

    const echtErr = console.error,
      echtWarn = console.warn;
    const alsError = [],
      alsWarn = [];
    console.error = (...a) => alsError.push(a.map(String).join(' '));
    console.warn = (...a) => alsWarn.push(a.map(String).join(' '));
    try {
      await IQ._workStack();
    } finally {
      console.error = echtErr;
      console.warn = echtWarn;
    }
    await IM._writeBuffer();

    const queueErr = alsError.filter(z => z.startsWith('[image-queue]'));
    const queueWarn = alsWarn.filter(z => z.startsWith('[image-queue]'));
    assert.deepEqual(queueErr, [], `Ein reiner 404-Stapel wurde als error gemeldet: ${queueErr.join(' | ')}`);
    assert.equal(
      queueWarn.length,
      1,
      `Erwartet GENAU eine warn-Zeile, bekam ${queueWarn.length}: ${queueWarn.join(' | ')}. ` +
        'Keine hiesse, der Stapel schweigt jetzt ganz — und dann faellt auch nicht ' +
        'mehr auf, WELCHE Sets kein Bild haben.',
    );
    assert.match(queueWarn[0], new RegExp(sn), 'Die Setnummer fehlt in der Meldung');
    await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);
  });

  await t.test('COUNTER-CHECK: a retryable error stays error', async () => {
    // Without this case the rule above would also be fulfilled if the
    // summary line ALWAYS went to warn — and then nothing stands out anymore.
    // No status code means “temporary, will be retried": exactly
    // what someone should see.
    const sn = `${P}_laut`;
    await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);
    IM._emptyForeground();
    responseStatus = null;
    await einreihen(sn);

    const echtErr = console.error,
      echtWarn = console.warn;
    const alsError = [],
      alsWarn = [];
    console.error = (...a) => alsError.push(a.map(String).join(' '));
    console.warn = (...a) => alsWarn.push(a.map(String).join(' '));
    try {
      await IQ._workStack();
    } finally {
      console.error = echtErr;
      console.warn = echtWarn;
    }

    const queueErr = alsError.filter(z => z.startsWith('[image-queue]'));
    assert.equal(
      queueErr.length,
      1,
      `Ein wiederholbarer Fehler muss als error gemeldet werden, bekam ` +
        `${queueErr.length} error- und ${alsWarn.filter(z => z.startsWith('[image-queue]')).length} warn-Zeilen`,
    );
    assert.match(
      queueErr[0],
      /wird erneut versucht/,
      'Die Meldung sagt nicht, dass es wiederholt wird — genau das unterscheidet ' + 'sie vom 404, der endgueltig ist',
    );
    await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);
  });

  await t.test('a timeout does NOT lock out for seven days', async () => {
    // No status code: exactly the picture of a network error. downloadSetImage
    // only sets info.status for a response ≠ 200 — if the connection
    // breaks off, the field stays empty.
    const sn = `${P}_timeout`;
    await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);
    IM._emptyForeground();
    responseStatus = null;
    await einreihen(sn);
    const e = await IQ._workStack();
    await IM._writeBuffer();
    assert.equal(e.notLoaded, 1, 'Der Fehlschlag muss trotzdem gezählt werden');
    assert.equal(
      await merker(sn),
      undefined,
      'Ein vorübergehender Fehler wurde als „Bild existiert nicht" vermerkt. ' +
        'Genau so verschwinden Bilder für sieben Tage, ohne dass je etwas ' +
        'daran war — und niemand sieht, dass es überhaupt einen Versuch gab.',
    );
    assert.match(IQ.message(e), /Download fehlgeschlagen/);
  });

  await t.test('the same standard as in the image proxy', () => {
    // The proxy has always only remembered 404 and explains that in the code. That
    // both components write into THE SAME table but interpret it differently
    // was the actual bug. The rule is held together here.
    const fs = require('node:fs');
    const { ohneKommentare } = require('./helpers/sources');
    const proxy = ohneKommentare(require('./helpers/sources').proxyThumbSource());
    const job = ohneKommentare(fs.readFileSync(path.join(ROOT, 'src/images/imageDemandRun.ts'), 'utf8'));
    assert.match(
      proxy,
      /status === 404[\s\S]{0,200}rememberMissing/,
      'Im Proxy hängt die Fehlanzeige nicht mehr am 404',
    );
    assert.match(
      job,
      /info\.status === 404/,
      'Der Job unterscheidet den 404 nicht — dann sperrt wieder jeder ' + 'Netzwerkfehler das Bild für sieben Tage aus',
    );
    assert.doesNotMatch(
      job,
      /\n\s*rememberMissing\(k, 'set:' \+ r\.set_number\);/,
      'Es gibt wieder einen unbedingten Vermerk für Sets',
    );
  });

  responseStatus = null;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
});

test('negative results can be withdrawn and are explainable', { concurrency: 1 }, async t => {
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

  const P = `VG${process.pid}`;
  const NUTZER = `vg-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',true)`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;

  await adminWithFactor(_req, uid);
  const { base, srv } = testServer(_req, { sitzung: { userId: uid, isAdmin: 1 }, t });

  try {
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']);
    IM._emptyForeground();
    IM.rememberMissing(`set:${P}_1`, 'HTTP 404 vom CDN');
    await IM._writeBuffer();

    await t.test('image-diag names the flag and the reason', async () => {
      const a = await (await fetch(`${base}/api/v1/admin/image-diag/${P}_1`)).json();
      assert.ok(a.merker, 'Ausgerechnet die Tabelle, die den Abruf verhindert, ' + 'kam in der Diagnose nicht vor');
      assert.match(a.merker.grund || '', /404/);
      assert.ok(
        a.hinweise.some(h => /als fehlend/.test(h)),
        'Der Klartext-Hinweis fehlt — dann muss man die Antwort erst deuten',
      );
    });

    await t.test('withdrawing works', async () => {
      const r = await (
        await fetch(`${base}/api/v1/admin/forget-image-misses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ set_numbers: [`${P}_1`] }),
        })
      ).json();
      assert.equal(r.entfernt, 1);
      assert.equal(await merker(`${P}_1`), undefined, 'Der Eintrag steht noch');
      assert.equal(
        IM.isKnownMissing(`set:${P}_1`),
        false,
        'Im Arbeitsspeicher gilt das Bild weiter als fehlend — dann ändert ' +
          'sich bis zum nächsten Auffrischen nichts',
      );
    });

    await t.test('preview notes stay untouched', async () => {
      IM.rememberMissing('thumb:/irgendwo/xyz_thumb.jpg', 'Vorschau konnte nicht erzeugt werden');
      await IM._writeBuffer();
      await (
        await fetch(`${base}/api/v1/admin/forget-image-misses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).json();
      const t2 = await db.get(`SELECT 1 FROM image_misses WHERE cache_key = $1`, ['thumb:/irgendwo/xyz_thumb.jpg']);
      assert.ok(
        t2,
        'Ein Lauf ohne Angabe hat die Vorschau-Vermerke mitgenommen — ' +
          'die haben einen anderen Zweck als „Bild gibt es nicht"',
      );
      await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['thumb:/irgendwo/xyz_thumb.jpg']);
    });
  } finally {
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
