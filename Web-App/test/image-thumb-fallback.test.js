/**
 * Fehlt die Vorschau, liefert die echte Bildroute (liefereBild) sofort das
 * Original und stösst die Vorschau an — vor dem Umweg über das CDN. Erst ohne
 * Original geht es zum Bild-Proxy, ohne bekannte CDN-Adresse bleibt es 404.
 * Teilebilder (images/parts) hängen an keinem Blickfeld; APP_ROOT ist ein
 * eigener Ordner.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, dist neu gebaut), in
 * src/katalog/http/bildAuslieferung.ts:
 *   A  `if (await originalStattVorschau(res, segmente)) return;` entfernt →
 *      rot: „fehlt die Vorschau …“ (302 zum CDN statt des Originals)
 *   B  den Aufruf hinter die CDN-Heilung gestellt → rot: ebenda
 *   C  in originalStattVorschau das setImmediate(generateThumb …) entfernt →
 *      rot: ebenda (keine Vorschau entsteht)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-bildroute-'));
process.env.APP_ROOT = wurzel;
const express = require('express');
const sharp = require('sharp');
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { bis } = require('./helpers/zeit');
const { liefereBild } = _req('src/katalog/http/bildAuslieferung.js');

const ordner = path.join(wurzel, 'data', 'images', 'parts');
const NR = `zz-vorschau-${process.pid}`;
const CDN = `https://cdn.rebrickable.com/media/parts/elements/${NR}.jpg`;

test.after(async () => {
  await _req('db/database.js').run('DELETE FROM part_color_catalog WHERE part_number = $1', [NR]).catch(() => {});
  await _req('db/database.js').pool?.end?.().catch(() => {});
  fs.rmSync(wurzel, { recursive: true, force: true });
});

test('fehlt die Vorschau, kommt das Original vor dem CDN', async (t) => {
  const db = await dbOderSkip(t, _req, { migrieren: false });
  if (!db) return;
  // Die CDN-Adresse ist bekannt: Ohne den Rückfall ginge die Anfrage zum Bild-Proxy.
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, image_url, image_local) VALUES ($1, 5, $2, $3)
    ON CONFLICT DO NOTHING`, [NR, CDN, `/images/parts/${NR}.jpg`]);
  fs.mkdirSync(ordner, { recursive: true });
  const original = path.join(ordner, `${NR}.jpg`), vorschau = path.join(ordner, `${NR}_thumb.jpg`);
  await sharp({ create: { width: 600, height: 400, channels: 3, background: '#c33' } }).jpeg().toFile(original);

  const app = express();
  app.use((req, _res, next) => { req.session = { userId: 1 }; next(); });
  app.get('/images/*pfad', liefereBild);
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const hole = async p => {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}${p}`, { redirect: 'manual' });
    return { status: r.status, n: (await r.arrayBuffer()).byteLength, ort: r.headers.get('location') };
  };

  const a = await hole(`/images/parts/${NR}_thumb.jpg`);
  assert.deepEqual([a.status, a.n], [200, fs.statSync(original).size], `geliefert: ${JSON.stringify(a)}`);
  assert.ok(await bis(() => fs.existsSync(vorschau)), 'die fehlende Vorschau entsteht nicht');

  const b = await hole(`/images/parts/${NR}_thumb.jpg`);
  assert.deepEqual([b.status, b.n], [200, fs.statSync(vorschau).size], 'jetzt gilt die Vorschau');

  fs.rmSync(original); fs.rmSync(vorschau);
  const c = await hole(`/images/parts/${NR}_thumb.jpg`);
  assert.equal(c.status, 302, 'ohne Original führt der Weg zum Bild-Proxy');
  assert.match(c.ort ?? '', /\/img-proxy\?url=.*zz-vorschau/);

  const d = await hole(`/images/parts/gibtsnicht-${process.pid}_thumb.jpg`);
  assert.equal(d.status, 404, 'ohne Original und CDN-Adresse bleibt es bei 404');
});
