/**
 * Liegt ein Set-Bild unter images/sets, trägt der Server es beim Set als
 * image_local ein; erst dann lädt die Oberfläche die Datei statt des Proxys.
 * Beide Wege: der Bild-Job nach dem Ablegen und der Proxy, wenn Bild und
 * Vorschau schon da sind.
 *
 * Gegenproben (07.11.2026):
 *   A  in src/katalog/bilder/bildbedarfLauf.ts den Aufruf setBildLokalEintragen() im Zweig
 *      „Datei schon da“ gestrichen → rot: „der Bild-Job trägt die Datei ein“
 *   B  in bildDurchreichen() den else-Zweig mit setBildLokalEintragen()
 *      gestrichen → rot: „der Proxy trägt vorhandene Dateien ein“
 * Gegenproben (10.11.2026, Katalog-Sets ausserhalb des Bestands):
 *   C  in setBildFehlt() setBildLokalEintragen(setNummer) ohne Quelle → rot:
 *      „der Proxy trägt … ein“ (image_url null)
 *   D  merkeSetBildLokal() wieder als UPDATE ohne INSERT … SELECT FROM rb_sets → rot:
 *      „der Proxy trägt … ein“ (fehlende set_catalog-Zeile bleibt fehlen)
 *   E  in katalogSuche.ts c.image_local aus SET_SPALTEN entfernt → rot: „… und die
 *      Katalogsuche nennt danach die lokale Adresse“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { katalogSet } = require('./helpers/bestand');
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
  for (const sn of [job, proxy]) {
    await katalogSet(db, sn, { name: 'Probe' });
    await db.run(`UPDATE set_catalog SET image_local = NULL, image_url = $2 WHERE set_number = $1`, [sn, cdn(sn)]);
  }
  t.after(async () => {
    for (const f of angelegt) fs.rmSync(f, { force: true });
    await db.run('DELETE FROM rb_sets WHERE set_num = ANY($1)', [[job, proxy]]).catch(() => {});
  });
  const lokal = async sn =>
    (await db.get('SELECT image_local FROM set_catalog WHERE set_number = $1', [sn]))?.image_local;

  await t.test('der Bild-Job trägt die Datei ein', async () => {
    await leereWarteschlange(db);
    lege(path.join(SET_IMAGES_DIR, `${job}.jpg`));
    lege(path.join(SET_IMAGES_DIR, `${job}_thumb.jpg`));
    const IQ = _req('src/katalog/bilder/bildbedarfLauf.js');
    IQ.merkeGebraucht(cdn(job), job);
    await IQ._schreibePuffer();
    await IQ._arbeiteStapel();
    assert.equal(await lokal(job), `/images/sets/${job}.jpg`);
  });

  await t.test('der Proxy trägt vorhandene Dateien samt Quelle ein, auch ohne set_catalog-Zeile', async () => {
    // Ein Katalog-Set ausserhalb jedes Bestands: rb_sets kennt es, set_catalog ausnahmsweise nicht.
    await db.run('DELETE FROM set_catalog WHERE set_number = $1', [proxy]);
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
    // Ohne Warten eingetragen: Die Auslieferung hängt nicht am Schreiben.
    let z;
    for (let i = 0; i < 50; i++) {
      z = await db.get('SELECT image_local, image_url FROM set_catalog WHERE set_number = $1', [proxy]);
      if (z?.image_local) break;
      await new Promise(w => setTimeout(w, 50));
    }
    assert.deepEqual(z, { image_local: `/images/sets/${proxy}.jpg`, image_url: cdn(proxy) });
    // Ein zweiter Abruf schreibt nichts neu.
    const vorher = (await db.get('SELECT updated_at FROM set_catalog WHERE set_number = $1', [proxy])).updated_at;
    await (await fetch(`http://127.0.0.1:${port}/p?url=${encodeURIComponent(cdn(proxy))}`)).arrayBuffer();
    await new Promise(w => setTimeout(w, 200));
    assert.deepEqual(
      (await db.get('SELECT updated_at FROM set_catalog WHERE set_number = $1', [proxy])).updated_at,
      vorher,
    );
  });

  await t.test('… und die Katalogsuche nennt danach die lokale Adresse', async () => {
    const { katalogSeite } = _req('src/katalog/dienst.js');
    const seite = await katalogSeite(1, { q: proxy, themeId: null }, 'num_asc', 1, 10);
    assert.deepEqual(
      seite.sets.map(x => [x.set_number, x.image_local]),
      [[proxy, `/images/sets/${proxy}_thumb.jpg`]],
    );
  });
});
