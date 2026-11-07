/**
 * Liegt ein Set-Bild unter images/sets, trägt der Server es beim Set als
 * image_local ein; erst dann lädt die Oberfläche die Datei statt des Proxys.
 * Beide Wege: der Bild-Job nach dem Ablegen und der Proxy, wenn Bild und
 * Vorschau schon da sind.
 *
 * Gegenproben (07.11.2026):
 *   A  in jobs/imageQueue.ts den Aufruf setBildLokalEintragen() im Zweig
 *      „Datei schon da“ gestrichen → rot: „der Bild-Job trägt die Datei ein“
 *   B  in bildDurchreichen() den else-Zweig mit setBildLokalEintragen()
 *      gestrichen → rot: „der Proxy trägt vorhandene Dateien ein“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { leereWarteschlange } = require('./helpers/bildwarteschlange');
const db = _req('db/database.js');

test('Set-Bilder in images/sets werden eingetragen', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  t.after(() => db.pool.end().catch(() => {}));
  const { SET_IMAGES_DIR, DATA_DIR } = _req('src/infra/appPaths.js');
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const angelegt = [];
  const lege = (datei, inhalt = Buffer.alloc(300, 1)) => {
    fs.writeFileSync(datei, inhalt);
    angelegt.push(datei);
  };
  const job = `7${process.pid}-1`,
    proxy = `6${process.pid}-1`;
  const cdn = sn => `https://cdn.rebrickable.com/media/sets/${sn}.jpg`;
  for (const sn of [job, proxy])
    await db.run(
      `INSERT INTO set_catalog (set_number, name, image_url) VALUES ($1, 'Probe', $2)
       ON CONFLICT (set_number) DO UPDATE SET image_local = NULL, image_url = EXCLUDED.image_url`,
      [sn, cdn(sn)],
    );
  t.after(async () => {
    for (const f of angelegt) fs.rmSync(f, { force: true });
    await db.run('DELETE FROM set_catalog WHERE set_number = ANY($1)', [[job, proxy]]).catch(() => {});
  });
  const lokal = async sn =>
    (await db.get('SELECT image_local FROM set_catalog WHERE set_number = $1', [sn])).image_local;

  await t.test('der Bild-Job trägt die Datei ein', async () => {
    await leereWarteschlange(db);
    lege(path.join(SET_IMAGES_DIR, `${job}.jpg`));
    lege(path.join(SET_IMAGES_DIR, `${job}_thumb.jpg`));
    const IQ = _req('jobs/imageQueue.js');
    IQ.merkeGebraucht(cdn(job), job);
    await IQ._schreibePuffer();
    await IQ._arbeiteStapel();
    assert.equal(await lokal(job), `/images/sets/${job}.jpg`);
  });

  await t.test('der Proxy trägt vorhandene Dateien ein', async () => {
    const express = require('express');
    const { bildDurchreichen } = _req('src/katalog/http/bildProxy.js');
    const { proxyAdresse, proxyCacheSchluessel } = _req('src/katalog/bilder/images.js');
    lege(path.join(SET_IMAGES_DIR, `${proxy}.jpg`));
    lege(path.join(SET_IMAGES_DIR, `${proxy}_thumb.jpg`));
    // Ein Cache-Treffer: Der Proxy fragt das CDN dann nicht.
    const cacheDir = path.join(DATA_DIR, 'img_proxy_cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const f = path.join(cacheDir, proxyCacheSchluessel(proxyAdresse(cdn(proxy)) ?? cdn(proxy)));
    lege(f);
    lege(`${f}.ct`, Buffer.from('image/jpeg'));
    const app = express();
    app.get('/p', (req, res) => {
      Object.assign(req, { session: { userId: 1 } });
      return bildDurchreichen(req, res);
    });
    const server = app.listen(0);
    t.after(() => server.close());
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
    const r = await fetch(`http://127.0.0.1:${port}/p?url=${encodeURIComponent(cdn(proxy))}`);
    await r.arrayBuffer();
    assert.equal(r.status, 200);
    assert.equal(await lokal(proxy), `/images/sets/${proxy}.jpg`);
  });
});
