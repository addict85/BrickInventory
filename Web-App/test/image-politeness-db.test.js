/**
 * Schonender Umgang mit dem Bildserver.
 *
 * ── Marcos Vorgaben ─────────────────────────────────────────────────────────
 * „Throttling & Delays: Baue eine künstliche Verzögerung von mindestens 500 bis
 * 1000 ms zwischen den einzelnen Bild-Requests ein.
 *  Kein paralleler Download: Lade Bilder nacheinander herunter.
 *  Passender User-Agent: Nutze einen sauberen, eindeutigen User-Agent-Header.
 *  Nur 30 Requests pro Minute."
 *
 * ── Gemessen ────────────────────────────────────────────────────────────────
 *     Bilder im Durchgang       10
 *     gleichzeitige Downloads    1
 *     Abstände (ms)              754 … 1002
 *     Rate                       10 je 20 s = 30 je Minute
 *
 * ── Warum unbedingt und nicht erst ab 200 Bildern ───────────────────────────
 * Marco hatte die Vorgaben für Läufe über 200 Bildern gestellt. Zwei Verhalten
 * einzubauen hiesse, beide zu pflegen und zu prüfen — für den Gewinn, beim
 * Blättern drei Bilder eine Sekunde früher zu haben. Der Vorablauf ist ohnehin
 * nichts, worauf jemand wartet.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

// Zeitpunkte und Gleichzeitigkeit der Downloads mitschreiben.
const zeiten = [];
const thumbZeiten = [];
let gleichzeitig = 0, maxGleichzeitig = 0;
const echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = echtesRequire.apply(this, arguments);
  // Seit Nachtrag 125 liegt downloadSetImage in utils/setImages.ts statt im
  // Router — der Abfang muss dorthin zeigen, sonst greift er ins Leere und
  // der Test misst still den echten Download.
  if (typeof name === 'string' && /setImages(\.js)?$/.test(name) && m && m.downloadSetImage) {
    return new Proxy(m, { get: (t, k) => k === 'downloadSetImage'
      ? (async (_u, sn) => {
          zeiten.push(Date.now());
          gleichzeitig++; maxGleichzeitig = Math.max(maxGleichzeitig, gleichzeitig);
          await new Promise(r => setTimeout(r, 30));   // „Netzwerk"
          gleichzeitig--;
          return `/images/sets/${sn}.jpg`;
        }) : t[k] });
  }
  if (typeof name === 'string' && /thumbs(\.js)?$/.test(name) && m && m.generateThumb) {
    return new Proxy(m, { get: (t, k) => k === 'generateThumb'
      ? (async () => { thumbZeiten.push(Date.now()); return true; }) : t[k] });
  }
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('der Bildserver wird schonend abgefragt', { concurrency: 1 }, async (t) => {
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const P = `TK${process.pid}`;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  await db.run(`INSERT INTO image_wanted (url, set_number)
                SELECT 'https://cdn/'||$1||'_'||g||'.jpg', $1||'_'||g
                  FROM generate_series(1,10) g`, [P]);

  try {
    const n = (await _req('jobs/imageQueue.js')._arbeiteStapel()).gesamt;
    const abstaende = zeiten.slice(1).map((z, i) => z - zeiten[i]);

    await t.test('nacheinander, nie gleichzeitig', () => {
      assert.equal(maxGleichzeitig, 1,
        `${maxGleichzeitig} Downloads liefen gleichzeitig — gefordert ist ` +
        'sequenziell, gerade weil Parallelität einer Heuristik auffällt');
    });

    await t.test('mindestens eine halbe Sekunde Abstand', () => {
      assert.ok(abstaende.length >= 5, `nur ${abstaende.length} Abstände gemessen`);
      const kleinster = Math.min(...abstaende);
      assert.ok(kleinster >= 500,
        `kleinster Abstand ${kleinster} ms — gefordert sind mindestens 500`);
    });

    await t.test('die Abstände sind nicht alle gleich', () => {
      // Ein exakt gleicher Abstand ist selbst ein Muster: Eine Heuristik, die
      // nach Maschinen sucht, erkennt Gleichmass leichter als Unregelmässigkeit.
      const einzig = new Set(abstaende.map(a => Math.round(a / 50)));
      assert.ok(einzig.size > 1,
        'Alle Abstände sind gleich — die Verzögerung muss zufällig streuen');
    });

    await t.test('höchstens 30 Anfragen je Minute', () => {
      // Die Rate ergibt sich aus Stapelgrösse und Takt; beide stehen in der
      // Quelle, damit der Test keine Zahl wiederholt, die sich ändern darf.
      const src = fs.readFileSync(path.join(ROOT, 'jobs', 'imageQueue.ts'), 'utf8');
      const stapel = parseInt((src.match(/const STAPEL = (\d+)/) || [])[1]);
      const takt   = parseInt((src.match(/const TAKT_MS = ([\d_]+)/) || [])[1].replace(/_/g, ''));
      assert.ok(stapel > 0 && takt > 0, 'STAPEL oder TAKT_MS nicht auffindbar');
      const jeMinute = stapel * (60_000 / takt);
      assert.ok(jeMinute <= 30,
        `${jeMinute} Anfragen je Minute — höchstens 30 sind gewollt`);
      assert.equal(n, stapel, `${n} Bilder in einem Durchgang statt ${stapel}`);
    });
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
    // Weder den Pool schliessen noch das Abfangen zurücknehmen — der Test
    // darunter braucht BEIDES noch. Aufgeräumt wird im LETZTEN Test dieser
    // Datei, der mit der Datenbank arbeitet.
  }
});

test('auch reine Vorschau-Arbeit wird gebremst', { concurrency: 1 }, async (t) => {
  // ── Marcos Log (Nachtrag 116) ─────────────────────────────────────────────
  // Zeile um Zeile „[image-queue] N Bilder lokal abgelegt", dazwischen
  // `Connection terminated due to connection timeout` — bis hin zum
  // Sitzungsspeicher, der keine Verbindung mehr bekam.
  //
  // Die Pause hing an einem Zähler, der nur echte DOWNLOADS zählte. Lag ein
  // Bild bereits lokal, fehlte ihm aber die Vorschau, lief ein anderer Zweig:
  // Vorschau rechnen, weiter — ohne Pause. Nach dem Knopf „Katalogbilder holen"
  // ist genau das der Normalfall, denn tausende Bilder lagen schon.
  //
  // Eine Verkleinerung ist die TEUERSTE Einzelarbeit im Server. Dass die Pause
  // ausgerechnet den teuren Teil nicht betraf, war der Fehler.
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const { SET_IMAGES_DIR } = _req('utils/appPaths.js');
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const P = `NT${process.pid}`;
  const dateien = [];
  // Bilder liegen, Vorschauen fehlen — Marcos Lage.
  for (let i = 1; i <= 10; i++) {
    const f = path.join(SET_IMAGES_DIR, `${P}_${i}.jpg`);
    fs.writeFileSync(f, 'x'); dateien.push(f);
  }
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  await db.run(`INSERT INTO image_wanted (url, set_number)
                SELECT 'https://cdn/'||$1||'_'||g||'.jpg', $1||'_'||g
                  FROM generate_series(1,10) g`, [P]);
  thumbZeiten.length = 0;
  try {
    const n = (await _req('jobs/imageQueue.js')._arbeiteStapel()).gesamt;
    assert.equal(n, 10, `${n} Vorschauen statt 10 — Vorbedingung stimmt nicht`);
    const abst = thumbZeiten.slice(1).map((z, i) => z - thumbZeiten[i]);
    assert.ok(abst.length >= 5, `nur ${abst.length} Abstände`);
    const kleinster = Math.min(...abst);
    assert.ok(kleinster >= 500,
      `kleinster Abstand zwischen zwei Verkleinerungen: ${kleinster} ms. Ohne ` +
      'Pause rechnet der Job zehn davon am Stück — auf schwacher Hardware ist ' +
      'die CPU dann belegt, und Datenbankabfragen laufen in den Zeitfehler.');
  } finally {
    for (const f of dateien) fs.rmSync(f, { force: true });
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
    // Letzter Test mit Datenbank in dieser Datei — hier wird aufgeräumt.
    await db.pool.end().catch(() => {});
    Module.prototype.require = echtesRequire;
  }
});

test('der User-Agent nennt Ross und Reiter', () => {
  // Hier stand eine vorgetäuschte Chrome-Kennung. Das ist die schlechteste
  // aller Möglichkeiten: Sie sagt nicht, wer wir sind, und ein „Browser", der
  // tausende Bilder ohne die üblichen Begleitanfragen holt, fällt einer
  // Heuristik gerade dadurch auf.
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'setImages.ts'), 'utf8');
  const i = src.indexOf('function bildUserAgent()');
  assert.ok(i > 0, 'Keine eigene Funktion für den User-Agent');
  const fn = src.slice(i, src.indexOf('\n}', i));
  assert.match(fn, /BrickInventoryManager\//, 'Die Kennung nennt das Produkt nicht');

  // ── Und die Version muss die ECHTE sein (Nachtrag 114) ────────────────────
  //
  // Marcos Frage „Was wird neu als user_agent gesendet?" deckte auf, dass dort
  // „3.0" stand statt der Installationsversion. Grund war
  // `require('../package.json')`: Die Auflösung geht vom Ordner des MODULS aus,
  // nicht vom Projekt. Übersetzt liegt das Modul unter `dist/routes/`, sucht
  // also `dist/package.json` — die es nicht gibt. Der Fehler landete im
  // `catch`, übrig blieb ein Vorgabewert, der seit Jahren nicht stimmt.
  //
  // Geprüft wird deshalb am ÜBERSETZTEN Stand, nicht an der Quelle: Genau
  // zwischen beiden lag der Fehler.
  const dist = path.join(ROOT, 'dist', 'utils', 'setImages.js');
  assert.ok(fs.existsSync(dist), 'dist/utils/setImages.js fehlt — erst bauen');
  const dsrc = fs.readFileSync(dist, 'utf8');
  const di = dsrc.indexOf('function bildUserAgent()');
  const dfn = dsrc.slice(di, dsrc.indexOf('\n}', di) + 2);
  const Module2 = require('node:module');
  const modul = new Module2(dist);
  modul.filename = dist;
  modul.paths = Module2._nodeModulePaths(path.dirname(dist));
  const ua = new Function('require', 'process', '__dirname', dfn + '; return bildUserAgent();')(
    modul.require.bind(modul), { env: {} }, path.dirname(dist));
  const echteVersion = require(path.join(ROOT, 'package.json')).version;
  assert.ok(ua.includes(echteVersion),
    `User-Agent „${ua}" enthält die Version ${echteVersion} nicht — die ` +
    'Auflösung von package.json greift aus dist/ heraus nicht');
  // Umschaltbar, weil sich von hier aus nicht ausprobieren lässt, wie der echte
  // Bildserver auf die neue Kennung reagiert.
  assert.match(fn, /process\.env\.IMG_USER_AGENT/,
    'Ohne Umgebungsvariable liesse sich eine Fehlentscheidung nur durch einen ' +
    'neuen Build zurücknehmen');
  // Und die alte Tarnung darf nicht zurückkommen.
  const dl = src.slice(src.indexOf('async function downloadSetImage'));
  assert.doesNotMatch(dl.slice(0, 2000), /Mozilla\/5\.0 \(Windows NT/,
    'Die vorgetäuschte Chrome-Kennung ist zurück');
});
