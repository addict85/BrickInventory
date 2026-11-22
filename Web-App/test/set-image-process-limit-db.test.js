/**
 * Set images across the process boundary as in compose.yaml: the web process stores
 * the image fetched via /api/v1/img-proxy under images/sets and notes it,
 * the separate job process creates preview and image_local. The CDN is a
 * local server (helpers/cdn-redirect.js) that, like the real one, rejects fetches without
 * a browser identifier with 403.
 *
 * Counter-check (measured 09.11.2026): in passThroughImage()
 * (src/images/http/imageProxy.ts) `originalMissing` fixed to false →
 * red: “only the preview in the cache: the proxy fetches the original and stores it”
 * (no file 71888-1.jpg) and “the job process creates …”; the case “fresh
 * from the CDN” stayed green.
 * Counter-check (measured 09.11.2026): fromCdn() called without `ersatz` → red:
 * “if the CDN rejects the new request, the preview comes from the cache” (403).
 *
 * Counter-check (measured 15.11.2026): in passThroughImage() `ablegen` without the question about
 * the scope (only `!!setNummer`) → red: “fresh from the CDN …” (60000-1.jpg lies in
 * images/sets although the account does not carry the set).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { catalogSet } = require('./helpers/inventory');
const { dataOrSkip } = require('./helpers/db');
const { warte } = require('./helpers/time');
const db = testData();
const sharp = require(path.join(ROOT, 'node_modules', 'sharp'));

const FRESH = '11516-1';
const ONLY_PREVIEW = '71888-1';
/** The CDN rejects this set for every identifier. */
const LOCKED = '10294-1';
/** In the catalog, but not in the account's scope. */
const FREMD = '60000-1';
const imageAddress = (/** @type {string} */ sn) => `https://cdn.rebrickable.com/media/sets/${sn}.jpg`;

function freePort() {
  return new Promise((auf, ab) => {
    const s = net
      .createServer()
      .listen(0, '127.0.0.1', () => {
        const adr = s.address();
        const port = typeof adr === 'object' && adr ? adr.port : 0;
        s.close(() => auf(port));
      })
      .on('error', ab);
  });
}

/** @returns {Promise<{ status: number, typ: string, bytes: number }>} */
function hole(/** @type {number} */ port, /** @type {string} */ weg, /** @type {string} */ token) {
  return new Promise((auf, ab) => {
    http
      .get({ host: '127.0.0.1', port, path: weg, agent: false, headers: { authorization: `Bearer ${token}` } }, res => {
        let n = 0;
        res.on('data', d => {
          n += d.length;
        });
        res.on('end', () => auf({ status: res.statusCode ?? 0, typ: String(res.headers['content-type']), bytes: n }));
      })
      .on('error', ab);
  });
}

/** @param {() => Promise<boolean> | boolean} bedingung */
async function bis(bedingung, ms) {
  for (const ende = Date.now() + ms; Date.now() < ende; await warte(250)) if (await bedingung()) return true;
  return bedingung();
}

test('set image via web and job process', { concurrency: 1, timeout: 180_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'setbild-prozesse-'));
  fs.symlinkSync(path.join(ROOT, 'public'), path.join(wurzel, 'public'));
  const sets = path.join(wurzel, 'data', 'images', 'sets');
  const cache = path.join(wurzel, 'data', 'img_proxy_cache');

  const image = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#c33' } })
    .jpeg()
    .toBuffer();
  /** @type {string[]} */
  const ids = [];
  const cdn = http
    .createServer((q, r) => {
      const ua = String(q.headers['user-agent'] || '');
      ids.push(ua);
      if (!ua.startsWith('Mozilla/') || q.url?.includes(LOCKED)) {
        r.writeHead(403);
        r.end();
        return;
      }
      r.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': image.length });
      r.end(image);
    })
    .listen(0, '127.0.0.1');
  await new Promise(r => cdn.once('listening', r));
  const adr = cdn.address();
  const cdnPort = typeof adr === 'object' && adr ? adr.port : 0;

  /** @type {(import('node:child_process').ChildProcess & { log: string })[]} */
  const processes = [];
  const starte = (/** @type {string} */ rolle, /** @type {number} */ port) => {
    const p = /** @type {import('node:child_process').ChildProcess & { log: string }} */ (
      spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          DATABASE_URL: URL_DB,
          APP_ROOT: wurzel,
          SESSION_SECRET: 'setbild-prozesse-geheimnis-lang-genug-1',
          PORT: String(port),
          ROLE: rolle,
          NODE_ENV: 'production',
          DB_SUPERUSER_ALLOWED: '1',
          APP_BASE_URL_MISSING_OK: '1',
          CDN_UMLEITUNG_PORT: String(cdnPort),
          NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${path.join(__dirname, 'helpers', 'cdn-redirect.js')}`,
        },
      })
    );
    p.log = '';
    p.stdout?.on('data', d => {
      p.log += d;
    });
    p.stderr?.on('data', d => {
      p.log += d;
    });
    processes.push(p);
    return p;
  };

  const NAME = `setbild_${process.pid}`;
  const TOKEN = `setbild-token-${process.pid}-${Date.now()}`;
  t.after(async () => {
    for (const p of processes) if (p.exitCode === null && p.signalCode === null) p.kill('SIGTERM');
    for (let i = 0; i < 100 && processes.some(p => p.exitCode === null && p.signalCode === null); i++) await warte(100);
    for (const p of processes) if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
    cdn.close();
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    await db
      .run('DELETE FROM set_catalog WHERE set_number = ANY($1)', [[FRESH, ONLY_PREVIEW, LOCKED, FREMD]])
      .catch(() => {});
    await db.pool.end().catch(() => {});
    fs.rmSync(wurzel, { recursive: true, force: true });
  });

  // Without today's stamps the job process downloads the Rebrickable catalog.
  for (const k of ['rb_csv_last_sync', 'rb_part_categories_last_sync', 'rb_catalog_extras_last_sync'])
    await db.run(
      `INSERT INTO run_state (key, value) VALUES ($1, to_char(NOW(), 'YYYY-MM-DD'))
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [k],
    );
  for (const sn of [FRESH, ONLY_PREVIEW, FREMD]) {
    await catalogSet(db, sn, { name: 'Probe' });
    await db.run(`UPDATE set_catalog SET image_url = $2, image_local = NULL WHERE set_number = $1`, [
      sn,
      imageAddress(sn),
    ]);
  }
  const nutzer = await db.get(
    `INSERT INTO users (username, password_hash, is_active, email_verified)
                               VALUES ($1, 'x', true, true) RETURNING id`,
    [NAME],
  );
  for (const sn of [FRESH, ONLY_PREVIEW, LOCKED])
    await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [nutzer.id, sn]);
  await db.run(`INSERT INTO api_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')`, [
    nutzer.id,
    crypto.createHash('sha256').update(TOKEN).digest('hex'),
  ]);

  // Only the preview in the proxy cache: that is how it stands after the 30-day maintenance, which
  // deletes the unused original and leaves the read preview standing.
  const { proxyCacheKey } = _req('src/images/images.js');
  fs.mkdirSync(cache, { recursive: true });
  const previewInCache = await sharp(image).resize(200, 200).jpeg().toBuffer();
  for (const sn of [ONLY_PREVIEW, LOCKED])
    fs.writeFileSync(path.join(cache, `${proxyCacheKey(imageAddress(sn))}_thumb.jpg`), previewInCache);

  const webPort = await freePort();
  const web = starte('web', webPort);
  assert.ok(await bis(() => /localhost:\d+/.test(web.log), 60_000), web.log.slice(-1500));
  const proxy = (/** @type {string} */ sn) =>
    hole(webPort, `/api/v1/img-proxy?url=${encodeURIComponent(imageAddress(sn))}&thumb=1&gen=0`, TOKEN);
  const liegt = (/** @type {string} */ datei) => fs.existsSync(path.join(sets, datei));
  const noted = async (/** @type {string} */ sn) =>
    !!(await db.get('SELECT 1 AS ja FROM image_wanted WHERE url = $1 AND set_number = $2', [imageAddress(sn), sn]));

  await t.test('fresh from the CDN: the web process stores the image and notes it', async () => {
    // A set outside the scope gets through, but lands neither in images/sets nor in the image demand.
    const fremd = await proxy(FREMD);
    assert.deepEqual([fremd.status, fremd.bytes], [200, image.length]);
    const r = await proxy(FRESH);
    assert.deepEqual([r.status, r.typ, r.bytes], [200, 'image/jpeg', image.length]);
    assert.ok(await bis(() => liegt(`${FRESH}.jpg`), 5_000), `${FRESH}.jpg fehlt\n${web.log.slice(-1500)}`);
    // The buffer goes into the database every 10 s.
    assert.ok(await bis(() => noted(FRESH), 15_000), `keine Notiz für ${FRESH}\n${web.log.slice(-1500)}`);
    assert.deepEqual([liegt(`${FREMD}.jpg`), await noted(FREMD)], [false, false]);
  });

  await t.test('only the preview in the cache: the proxy fetches the original and stores it', async () => {
    const r = await proxy(ONLY_PREVIEW);
    assert.equal(r.status, 200);
    assert.ok(
      await bis(() => liegt(`${ONLY_PREVIEW}.jpg`), 5_000),
      `${ONLY_PREVIEW}.jpg fehlt\n${web.log.slice(-1500)}`,
    );
    assert.ok(await bis(() => noted(ONLY_PREVIEW), 15_000), `keine Notiz für ${ONLY_PREVIEW}\n${web.log.slice(-1500)}`);
    assert.ok(
      ids.every(k => k.startsWith('Mozilla/')),
      'Der Web-Prozess fragt das CDN mit Browser-Kennung',
    );
  });

  await t.test('if the CDN rejects the new request, the preview comes from the cache', async () => {
    const r = await proxy(LOCKED);
    assert.deepEqual([r.status, r.typ, r.bytes], [200, 'image/jpeg', previewInCache.length], web.log.slice(-1500));
    assert.equal(liegt(`${LOCKED}.jpg`), false);
  });

  await t.test('the job process creates the preview and registers image_local', async () => {
    const jobs = starte('jobs', await freePort());
    const fertig = async () => {
      const zeilen = await db.all('SELECT set_number, image_local FROM set_catalog WHERE set_number = ANY($1)', [
        [FRESH, ONLY_PREVIEW],
      ]);
      return (
        zeilen.length === 2 &&
        zeilen.every(z => z.image_local === `/images/sets/${z.set_number}.jpg`) &&
        liegt(`${FRESH}_thumb.jpg`) &&
        liegt(`${ONLY_PREVIEW}_thumb.jpg`)
      );
    };
    assert.ok(
      await bis(fertig, 60_000),
      `Dateien: ${fs.existsSync(sets) ? fs.readdirSync(sets).join(', ') : '(kein Ordner)'}\n${jobs.log.slice(-2000)}`,
    );
    const preview = await sharp(path.join(sets, `${ONLY_PREVIEW}_thumb.jpg`)).metadata();
    // 400 × 300 fitted, not cropped (UX check 25, B1).
    assert.deepEqual([preview.format, preview.width, preview.height], ['jpeg', 200, 150]);
  });
});
