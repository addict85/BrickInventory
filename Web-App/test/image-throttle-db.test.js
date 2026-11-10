/**
 * Eine Drosselung des CDN ist KEINE Fehlanzeige.
 * Ausführlich: docs/begruendungen/test/image-throttle-db.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Den Download abfangen und den Statuscode vorgeben.
let antwort = 403;
const thumbVersuche = { n: 0 };
let versuche = 0;
const echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = echtesRequire.apply(this, arguments);
  // Seit einer früheren Runde liegt downloadSetImage in src/katalog/bilder/setImages.ts statt im
  // Router — der Abfang muss dorthin zeigen, sonst greift er ins Leere und
  // der Test misst still den echten Download.
  if (typeof name === 'string' && /setImages(\.js)?$/.test(name) && m && m.downloadSetImage) {
    return new Proxy(m, { get: (t, k) => k === 'downloadSetImage'
      ? (async (_u, _sn, info) => { versuche++; if (info) info.status = antwort; return null; })
      : t[k] });
  }
  if (typeof name === 'string' && /thumbs(\.js)?$/.test(name) && m && m.generateThumb) {
    return new Proxy(m, { get: (t, k) => k === 'generateThumb'
      ? (async () => { thumbVersuche.n++; return null; }) : t[k] });
  }
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const { leereWarteschlange } = require('./helpers/bildwarteschlange');
const db = _req('db/database.js');

test('eine hoffnungslose Vorschau wird nur EINMAL versucht', { concurrency: 1 }, async (t) => {
  // Marcos Log
  // Ausführlich: docs/begruendungen/test/image-throttle-db.test.js.md#stelle
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  // Die Warteschlange gehoert VOR dem Benutzen geleert, nicht nur das eigene
  // Praefix — sonst nimmt der Stapel die Zeilen eines Vorgaengers. Begruendung
  // und Nachstellung in helpers/bildwarteschlange.js.
  await leereWarteschlange(db);
  const { SET_IMAGES_DIR } = _req('src/infra/appPaths.js');
  const fsm = require('node:fs');
  fsm.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const P = `WB${process.pid}`;
  const datei = path.join(SET_IMAGES_DIR, `${P}_1.jpg`);
  fsm.writeFileSync(datei, 'x');            // Bild liegt, Vorschau unmöglich
  const IM = _req('src/katalog/bilder/imageMisses.js');
  const IQ = _req('src/katalog/bilder/bildbedarfLauf.js');
  await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['thumb:%' + P + '%']);

  try {
    thumbVersuche.n = 0;
    for (let runde = 1; runde <= 3; runde++) {
      await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
      await db.run(`INSERT INTO image_wanted (url, set_number) VALUES ($1,$2)`,
                   [`https://cdn/${P}_1.jpg`, `${P}_1`]);
      await IQ._arbeiteStapel();
    }
    assert.equal(thumbVersuche.n, 1,
      `${thumbVersuche.n} Versuche in drei Durchgängen — eine Vorschau, die nicht ` +
      'gelingen kann, darf nur einmal Rechenzeit kosten');
    await IM._schreibePuffer();
    const gemerkt = (await db.get(
      `SELECT COUNT(*)::int c FROM image_misses WHERE cache_key LIKE $1`,
      ['thumb:%' + P + '%'])).c;
    assert.equal(gemerkt, 1, 'Der Fehlschlag wurde nicht dauerhaft gemerkt');
  } finally {
    fsm.rmSync(datei, { force: true });
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['thumb:%' + P + '%']).catch(() => {});
  }
});

test('Drosselung und fehlendes Bild werden unterschieden', { concurrency: 1 }, async (t) => {
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  // Die Warteschlange gehoert VOR dem Benutzen geleert, nicht nur das eigene
  // Praefix — sonst nimmt der Stapel die Zeilen eines Vorgaengers. Begruendung
  // und Nachstellung in helpers/bildwarteschlange.js.
  await leereWarteschlange(db);

  const P = `DR${process.pid}`;
  const fuellen = async () => {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
    await db.run(`INSERT INTO image_wanted (url, set_number)
                  SELECT 'https://cdn/'||$1||'_'||g||'.jpg', $1||'_'||g
                    FROM generate_series(1,10) g`, [P]);
  };
  const offen = async () => (await db.get(
    `SELECT COUNT(*)::int c FROM image_wanted WHERE set_number LIKE $1`, [P + '%'])).c;
  const gemerkt = async () => (await db.get(
    `SELECT COUNT(*)::int c FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%'])).c;

  await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']);

  try {
    await t.test('403 sperrt kein Bild aus und verliert keine Notiz', async () => {
      antwort = 403; versuche = 0;
      await fuellen();
      const IQ = _req('src/katalog/bilder/bildbedarfLauf.js');
      const e = await IQ._arbeiteStapel();
      assert.equal(versuche, 1,
        `${versuche} Versuche — nach der ersten Drosselung muss der Stapel abbrechen`);

      // Zurückgelegt ist NICHT bearbeitet
      // Ausführlich: docs/begruendungen/test/image-throttle-db.test.js.md#stelle-2
      assert.equal(e.gesamt, 0,
        `${e.gesamt} als bearbeitet gemeldet, obwohl der Stapel vor der ersten ` +
        'Zeile abbrach und alles zurückgelegt wurde');
      assert.equal(e.zurueckgelegt, 10,
        'Die zurückgelegten Notizen tauchen in keinem Zähler auf — dann ist ' +
        'aus der Meldung nicht zu erkennen, dass gedrosselt wurde');
      assert.match(IQ.meldung(e), /zurückgelegt/,
        'Die Meldung verschweigt die Drosselung');
      assert.equal(await offen(), 10,
        'Notizen sind verlorengegangen. Der Stapel wird mit DELETE … RETURNING ' +
        'geholt — beim Abbruch muss der GANZE Rest zurückgelegt werden.');
      assert.equal(await gemerkt(), 0,
        'Eine Drosselung wurde als „Bild fehlt" gemerkt — dann sperrt der Ansturm ' +
        'genau die Bilder aus, die es gibt');
    });

    await t.test('die Pause hält den nächsten Lauf zurück', async () => {
      const vorher = versuche;
      const n = (await _req('src/katalog/bilder/bildbedarfLauf.js')._arbeiteStapel()).gesamt;
      assert.equal(n, 0);
      assert.equal(versuche, vorher,
        'Es wurde weiter gefragt — stures Weiterfragen ist genau das Verhalten, ' +
        'das eine Sperre verlängert');
    });

    await t.test('404 wird dagegen gemerkt', async () => {
      // Die Pause aus dem vorigen Teilschritt steht in der Datenbank und gilt sonst weiter.
      await db.run(`DELETE FROM auftrag_pausen WHERE art = 'bildbedarf'`);
      const IQ = _req('src/katalog/bilder/bildbedarfLauf.js');
      antwort = 404; versuche = 0;
      await fuellen();
      await IQ._arbeiteStapel();
      await _req('src/katalog/bilder/imageMisses.js')._schreibePuffer();
      assert.equal(versuche, 10, `${versuche} Versuche — bei 404 läuft der Stapel durch`);
      assert.equal(await gemerkt(), 10,
        'Fehlende Bilder werden nicht gemerkt — dann fragt der Job sie ewig neu');
    });
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
    // Letzter DB-Test dieser Datei — nur hier wird aufgeräumt (Lehre aus 116).
    await db.pool.end().catch(() => {});
    Module.prototype.require = echtesRequire;
  }
});
