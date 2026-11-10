/**
 * Die Bilder der Tabellen stehen auch ohne Netz.
 * Ausführlich: docs/begruendungen/test/bilder-offline.test.js.md#kopf
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, zurückgenommen):
 *   A  in liefereBild() `private, max-age=0` → `private, no-cache` → rot: „… duerfen offline …“
 *   B  dasselbe → `max-age=0` (ohne private) → rot: „… duerfen offline …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

test('die Bilder der Tabellen duerfen offline aus dem Zwischenspeicher kommen', { concurrency: 1 }, async (t) => {
  const db = await dbOderSkip(t, _req);
  if (!db) return;
  const NAME = `offline_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1,'x',true,true) RETURNING id`, [NAME])).id;
  // Teilebilder sind Katalog: Jedes angemeldete Konto bekommt sie.
  const datei = path.join(__dirname, '..', 'data', 'images', 'parts', `OFF${process.pid}_0.png`);
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  fs.writeFileSync(datei, 'Bild');
  t.after(async () => {
    fs.rmSync(datei, { force: true });
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { sitzung: { userId: uid }, routen: { '/': 'routes/seiten.js' }, t });
  const r = await fetch(`${base}/images/parts/${path.basename(datei)}`);
  assert.equal([r.status, await r.text()].join(' '), '200 Bild');
  const kopf = String(r.headers.get('cache-control'));
  // no-cache, must-revalidate und no-store verbieten die alte Kopie, von der der Offline-Rückfall der App lebt.
  assert.doesNotMatch(kopf, /no-cache|must-revalidate|no-store/, kopf);
  // max-age=0: online wird trotzdem jedes Mal nachgefragt, ein ersetztes Bild gilt sofort.
  assert.match(kopf, /max-age=0/, kopf);
  // private: Ein Reverse-Proxy darf Bilder hinter einer Anmeldung nicht zwischenspeichern.
  assert.match(kopf, /private/, kopf);
});

test('die App hat einen Offline-Rueckfall, der davon Gebrauch macht', () => {
  // Ohne ihn nuetzt die Kopfzeile nichts: Die Kopie liegt da, aber niemand
  // holt sie, wenn die Anfrage scheitert.
  const modul = fs.readFileSync(path.join(__dirname, '..', '..', 'Android-App', 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'di', 'NetzModule.kt'), 'utf8');
  assert.match(modul, /FORCE_CACHE/,
    'Der Offline-Rückfall der App ist weg — dann bleibt die Kopie ungenutzt.');
  assert.match(modul, /catch \(e: java\.io\.IOException\)/,
    'Der Rückfall hängt nicht mehr am Fehler. Am Verbindungsstatus des Geräts ' +
    'festzumachen war schon einmal falsch: Ein Gerät kann im WLAN sein, ohne ' +
    'dass der Heimserver antwortet.');
  assert.match(modul, /image_http_cache/,
    'Der HTTP-Zwischenspeicher für Bilder fehlt — ohne ihn gibt es offline ' +
    'nichts auszuliefern.');
});
