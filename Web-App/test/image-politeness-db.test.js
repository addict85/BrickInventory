/**
 * Schonender Umgang mit dem Bildserver.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { leereWarteschlange } = require('./helpers/bildwarteschlange');
const fs = require('node:fs');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Zeitpunkte und Gleichzeitigkeit der Downloads mitschreiben.
const zeiten = [];
const thumbZeiten = [];
let gleichzeitig = 0,
  maxGleichzeitig = 0;
const echtesRequire = Module.prototype.require;
Module.prototype.require = function (name, ...rest) {
  const m = echtesRequire.call(this, name, ...rest);
  // Seit einer früheren Runde liegt downloadSetImage in src/katalog/bilder/setImages.ts statt im
  // Router — der Abfang muss dorthin zeigen, sonst greift er ins Leere und
  // der Test misst still den echten Download.
  if (typeof name === 'string' && /setImages(\.js)?$/.test(name) && m?.downloadSetImage) {
    return new Proxy(m, {
      get: (t, k) =>
        k === 'downloadSetImage'
          ? async (_u, sn) => {
              zeiten.push(Date.now());
              gleichzeitig++;
              maxGleichzeitig = Math.max(maxGleichzeitig, gleichzeitig);
              await new Promise(r => setTimeout(r, 30)); // „Netzwerk"
              gleichzeitig--;
              return `/images/sets/${sn}.jpg`;
            }
          : t[k],
    });
  }
  if (typeof name === 'string' && /thumbs(\.js)?$/.test(name) && m?.generateThumb) {
    return new Proxy(m, {
      get: (t, k) =>
        k === 'generateThumb'
          ? async () => {
              thumbZeiten.push(Date.now());
              return true;
            }
          : t[k],
    });
  }
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = _req('db/database.js');

test('der Bildserver wird schonend abgefragt', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // Die Warteschlange gehoert VOR dem Benutzen geleert, nicht nur das eigene
  // Praefix — sonst nimmt der Stapel die Zeilen eines Vorgaengers. Begruendung
  // und Nachstellung in helpers/bildwarteschlange.js.
  await leereWarteschlange(db);

  const P = `TK${process.pid}`;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  await db.run(
    `INSERT INTO image_wanted (url, set_number)
                SELECT 'https://cdn/'||$1||'_'||g||'.jpg', $1||'_'||g
                  FROM generate_series(1,10) g`,
    [P],
  );

  try {
    const n = (await _req('src/katalog/bilder/bildbedarfLauf.js')._arbeiteStapel()).gesamt;
    const abstaende = zeiten.slice(1).map((z, i) => z - zeiten[i]);

    await t.test('nacheinander, nie gleichzeitig', () => {
      assert.equal(
        maxGleichzeitig,
        1,
        `${maxGleichzeitig} Downloads liefen gleichzeitig — gefordert ist ` +
          'sequenziell, gerade weil Parallelität einer Heuristik auffällt',
      );
    });

    await t.test('mindestens eine halbe Sekunde Abstand', () => {
      assert.ok(abstaende.length >= 5, `nur ${abstaende.length} Abstände gemessen`);
      const kleinster = Math.min(...abstaende);
      assert.ok(kleinster >= 500, `kleinster Abstand ${kleinster} ms — gefordert sind mindestens 500`);
    });

    await t.test('die Abstände sind nicht alle gleich', () => {
      // Ein exakt gleicher Abstand ist selbst ein Muster: Eine Heuristik, die
      // nach Maschinen sucht, erkennt Gleichmass leichter als Unregelmässigkeit.
      const einzig = new Set(abstaende.map(a => Math.round(a / 50)));
      assert.ok(einzig.size > 1, 'Alle Abstände sind gleich — die Verzögerung muss zufällig streuen');
    });

    await t.test('höchstens 30 Anfragen je Minute', () => {
      // Die Rate ergibt sich aus Stapelgrösse und Takt; beide kommen aus dem
      // Modul, damit der Test keine Zahl wiederholt, die sich ändern darf.
      const { STAPEL: stapel, TAKT_MS: takt } = _req('src/katalog/bilder/bildbedarfLauf.js');
      assert.ok(stapel > 0 && takt > 0, 'STAPEL oder TAKT_MS nicht auffindbar');
      const jeMinute = stapel * (60_000 / takt);
      assert.ok(jeMinute <= 30, `${jeMinute} Anfragen je Minute — höchstens 30 sind gewollt`);
      assert.equal(n, stapel, `${n} Bilder in einem Durchgang statt ${stapel}`);
    });
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
    // Weder den Pool schliessen noch das Abfangen zurücknehmen — der Test
    // darunter braucht BEIDES noch. Aufgeräumt wird im LETZTEN Test dieser
    // Datei, der mit der Datenbank arbeitet.
  }
});

test('auch reine Vorschau-Arbeit wird gebremst', { concurrency: 1 }, async t => {
  // Marcos Log
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // Die Warteschlange gehoert VOR dem Benutzen geleert, nicht nur das eigene
  // Praefix — sonst nimmt der Stapel die Zeilen eines Vorgaengers. Begruendung
  // und Nachstellung in helpers/bildwarteschlange.js.
  await leereWarteschlange(db);
  const { SET_IMAGES_DIR } = _req('src/infra/appPaths.js');
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const P = `NT${process.pid}`;
  const dateien = [];
  // Bilder liegen, Vorschauen fehlen — Marcos Lage.
  for (let i = 1; i <= 10; i++) {
    const f = path.join(SET_IMAGES_DIR, `${P}_${i}.jpg`);
    fs.writeFileSync(f, 'x');
    dateien.push(f);
  }
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  await db.run(
    `INSERT INTO image_wanted (url, set_number)
                SELECT 'https://cdn/'||$1||'_'||g||'.jpg', $1||'_'||g
                  FROM generate_series(1,10) g`,
    [P],
  );
  thumbZeiten.length = 0;
  try {
    const n = (await _req('src/katalog/bilder/bildbedarfLauf.js')._arbeiteStapel()).gesamt;
    assert.equal(n, 10, `${n} Vorschauen statt 10 — Vorbedingung stimmt nicht`);
    const abst = thumbZeiten.slice(1).map((z, i) => z - thumbZeiten[i]);
    assert.ok(abst.length >= 5, `nur ${abst.length} Abstände`);
    const kleinster = Math.min(...abst);
    assert.ok(
      kleinster >= 500,
      `kleinster Abstand zwischen zwei Verkleinerungen: ${kleinster} ms. Ohne ` +
        'Pause rechnet der Job zehn davon am Stück — auf schwacher Hardware ist ' +
        'die CPU dann belegt, und Datenbankabfragen laufen in den Zeitfehler.',
    );
  } finally {
    for (const f of dateien) fs.rmSync(f, { force: true });
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
    // Letzter Test mit Datenbank in dieser Datei — hier wird aufgeräumt.
    await db.pool.end().catch(() => {});
    Module.prototype.require = echtesRequire;
  }
});

// Gegenprobe (09.11.2026): bildUserAgent() wieder auf `BrickInventoryManager/…` → rot
// „der Bild-Auftrag holt mit der Browser-Kennung des Proxys“.
test('der Bild-Auftrag holt mit der Browser-Kennung des Proxys', () => {
  const dist = path.join(ROOT, 'dist', 'src/katalog/bilder/setImages.js');
  assert.ok(fs.existsSync(dist), 'dist/src/katalog/bilder/setImages.js fehlt — erst bauen');
  const { BILD_KOPFZEILEN } = require(path.join(ROOT, 'dist', 'clients/bildCdn.js'));
  const ua = require(dist).bildUserAgent();
  assert.equal(ua, BILD_KOPFZEILEN['User-Agent'], 'der Bild-Auftrag holt mit der Browser-Kennung des Proxys');
  assert.match(ua, /^Mozilla\/5\.0 /);
});
