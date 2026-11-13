/**
 * Set-Bilder über die Prozessgrenze wie in compose.yaml: Der Web-Prozess legt
 * das über /api/v1/img-proxy geholte Bild unter images/sets ab und notiert es,
 * der getrennte Job-Prozess erzeugt Vorschau und image_local. Das CDN ist ein
 * lokaler Server (helpers/cdn-umleitung.js), der wie das echte Abrufe ohne
 * Browser-Kennung mit 403 abweist.
 *
 * Gegenprobe (09.11.2026 gemessen): in bildDurchreichen()
 * (src/katalog/http/bildProxy.ts) `originalFehlt` fest auf false gesetzt →
 * rot: „nur die Vorschau im Cache: der Proxy holt das Original und legt es ab“
 * (keine Datei 71888-1.jpg) und „der Job-Prozess erzeugt …“; der Fall „frisch
 * vom CDN“ blieb grün.
 * Gegenprobe (09.11.2026 gemessen): vomCdn() ohne `ersatz` aufgerufen → rot:
 * „weist das CDN den neuen Abruf ab, kommt die Vorschau aus dem Cache“ (403).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
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
const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { katalogSet } = require('./helpers/bestand');
const { datenOderSkip } = require('./helpers/db');
const { warte } = require('./helpers/zeit');
const db = testDaten();
const sharp = require(path.join(ROOT, 'node_modules', 'sharp'));

const FRISCH = '11516-1';
const NUR_VORSCHAU = '71888-1';
/** Das CDN weist dieses Set für jede Kennung ab. */
const GESPERRT = '10294-1';
const bildAdresse = (/** @type {string} */ sn) => `https://cdn.rebrickable.com/media/sets/${sn}.jpg`;

function freierPort() {
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

test('Set-Bild über Web- und Job-Prozess', { concurrency: 1, timeout: 180_000 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;

  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'setbild-prozesse-'));
  fs.symlinkSync(path.join(ROOT, 'public'), path.join(wurzel, 'public'));
  const sets = path.join(wurzel, 'data', 'images', 'sets');
  const cache = path.join(wurzel, 'data', 'img_proxy_cache');

  const bild = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#c33' } })
    .jpeg()
    .toBuffer();
  /** @type {string[]} */
  const kennungen = [];
  const cdn = http
    .createServer((q, r) => {
      const ua = String(q.headers['user-agent'] || '');
      kennungen.push(ua);
      if (!ua.startsWith('Mozilla/') || q.url?.includes(GESPERRT)) {
        r.writeHead(403);
        r.end();
        return;
      }
      r.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': bild.length });
      r.end(bild);
    })
    .listen(0, '127.0.0.1');
  await new Promise(r => cdn.once('listening', r));
  const adr = cdn.address();
  const cdnPort = typeof adr === 'object' && adr ? adr.port : 0;

  /** @type {(import('node:child_process').ChildProcess & { log: string })[]} */
  const prozesse = [];
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
          ROLLE: rolle,
          NODE_ENV: 'production',
          DB_SUPERUSER_ERLAUBT: '1',
          APP_BASE_URL_FEHLT_OK: '1',
          CDN_UMLEITUNG_PORT: String(cdnPort),
          NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${path.join(__dirname, 'helpers', 'cdn-umleitung.js')}`,
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
    prozesse.push(p);
    return p;
  };

  const NAME = `setbild_${process.pid}`;
  const TOKEN = `setbild-token-${process.pid}-${Date.now()}`;
  t.after(async () => {
    for (const p of prozesse) if (p.exitCode === null && p.signalCode === null) p.kill('SIGTERM');
    for (let i = 0; i < 100 && prozesse.some(p => p.exitCode === null && p.signalCode === null); i++) await warte(100);
    for (const p of prozesse) if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
    cdn.close();
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    await db
      .run('DELETE FROM set_catalog WHERE set_number = ANY($1)', [[FRISCH, NUR_VORSCHAU, GESPERRT]])
      .catch(() => {});
    await db.pool.end().catch(() => {});
    fs.rmSync(wurzel, { recursive: true, force: true });
  });

  // Ohne heutige Stempel lädt der Job-Prozess den Rebrickable-Katalog herunter.
  for (const k of ['rb_csv_last_sync', 'rb_part_categories_last_sync', 'rb_catalog_extras_last_sync'])
    await db.run(
      `INSERT INTO laufzustand (schluessel, wert) VALUES ($1, to_char(NOW(), 'YYYY-MM-DD'))
                  ON CONFLICT (schluessel) DO UPDATE SET wert = EXCLUDED.wert`,
      [k],
    );
  for (const sn of [FRISCH, NUR_VORSCHAU]) {
    await katalogSet(db, sn, { name: 'Probe' });
    await db.run(`UPDATE set_catalog SET image_url = $2, image_local = NULL WHERE set_number = $1`, [
      sn,
      bildAdresse(sn),
    ]);
  }
  const nutzer = await db.get(
    `INSERT INTO users (username, password_hash, is_active, email_verified)
                               VALUES ($1, 'x', true, true) RETURNING id`,
    [NAME],
  );
  await db.run(`INSERT INTO api_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')`, [
    nutzer.id,
    crypto.createHash('sha256').update(TOKEN).digest('hex'),
  ]);

  // Nur die Vorschau im Proxy-Cache: So steht es nach der 30-Tage-Pflege, die das
  // unbenutzte Original löscht und die gelesene Vorschau stehen lässt.
  const { proxyCacheSchluessel } = _req('src/katalog/bilder/images.js');
  fs.mkdirSync(cache, { recursive: true });
  const vorschauImCache = await sharp(bild).resize(200, 200).jpeg().toBuffer();
  for (const sn of [NUR_VORSCHAU, GESPERRT])
    fs.writeFileSync(path.join(cache, `${proxyCacheSchluessel(bildAdresse(sn))}_thumb.jpg`), vorschauImCache);

  const webPort = await freierPort();
  const web = starte('web', webPort);
  assert.ok(await bis(() => /localhost:\d+/.test(web.log), 60_000), web.log.slice(-1500));
  const proxy = (/** @type {string} */ sn) =>
    hole(webPort, `/api/v1/img-proxy?url=${encodeURIComponent(bildAdresse(sn))}&thumb=1&gen=0`, TOKEN);
  const liegt = (/** @type {string} */ datei) => fs.existsSync(path.join(sets, datei));
  const notiert = async (/** @type {string} */ sn) =>
    !!(await db.get('SELECT 1 AS ja FROM image_wanted WHERE url = $1 AND set_number = $2', [bildAdresse(sn), sn]));

  await t.test('frisch vom CDN: der Web-Prozess legt das Bild ab und notiert es', async () => {
    const r = await proxy(FRISCH);
    assert.deepEqual([r.status, r.typ, r.bytes], [200, 'image/jpeg', bild.length]);
    assert.ok(await bis(() => liegt(`${FRISCH}.jpg`), 5_000), `${FRISCH}.jpg fehlt\n${web.log.slice(-1500)}`);
    // Der Puffer geht alle 10 s in die Datenbank.
    assert.ok(await bis(() => notiert(FRISCH), 15_000), `keine Notiz für ${FRISCH}\n${web.log.slice(-1500)}`);
  });

  await t.test('nur die Vorschau im Cache: der Proxy holt das Original und legt es ab', async () => {
    const r = await proxy(NUR_VORSCHAU);
    assert.equal(r.status, 200);
    assert.ok(
      await bis(() => liegt(`${NUR_VORSCHAU}.jpg`), 5_000),
      `${NUR_VORSCHAU}.jpg fehlt\n${web.log.slice(-1500)}`,
    );
    assert.ok(
      await bis(() => notiert(NUR_VORSCHAU), 15_000),
      `keine Notiz für ${NUR_VORSCHAU}\n${web.log.slice(-1500)}`,
    );
    assert.ok(
      kennungen.every(k => k.startsWith('Mozilla/')),
      'Der Web-Prozess fragt das CDN mit Browser-Kennung',
    );
  });

  await t.test('weist das CDN den neuen Abruf ab, kommt die Vorschau aus dem Cache', async () => {
    const r = await proxy(GESPERRT);
    assert.deepEqual([r.status, r.typ, r.bytes], [200, 'image/jpeg', vorschauImCache.length], web.log.slice(-1500));
    assert.equal(liegt(`${GESPERRT}.jpg`), false);
  });

  await t.test('der Job-Prozess erzeugt die Vorschau und trägt image_local ein', async () => {
    const jobs = starte('jobs', await freierPort());
    const fertig = async () => {
      const zeilen = await db.all('SELECT set_number, image_local FROM set_catalog WHERE set_number = ANY($1)', [
        [FRISCH, NUR_VORSCHAU],
      ]);
      return (
        zeilen.length === 2 &&
        zeilen.every(z => z.image_local === `/images/sets/${z.set_number}.jpg`) &&
        liegt(`${FRISCH}_thumb.jpg`) &&
        liegt(`${NUR_VORSCHAU}_thumb.jpg`)
      );
    };
    assert.ok(
      await bis(fertig, 60_000),
      `Dateien: ${fs.existsSync(sets) ? fs.readdirSync(sets).join(', ') : '(kein Ordner)'}\n${jobs.log.slice(-2000)}`,
    );
    const vorschau = await sharp(path.join(sets, `${NUR_VORSCHAU}_thumb.jpg`)).metadata();
    assert.deepEqual([vorschau.format, vorschau.width, vorschau.height], ['jpeg', 200, 200]);
  });
});
