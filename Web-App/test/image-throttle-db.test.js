/**
 * Eine Drosselung des CDN ist KEINE Fehlanzeige.
 *
 * ── Marcos Frage ────────────────────────────────────────────────────────────
 * „Wie schätzt du den CDN ein, können so viele Requests abgefragt werden oder
 * wird da Cloudflare die IP sperren?"
 *
 * Beim Nachsehen fiel ein Fehler auf, der ohne diese Frage unbemerkt geblieben
 * wäre: `downloadSetImage()` antwortet auf JEDEN Fehlschlag mit `null` — bei
 * 404 („dieses Bild gibt es nicht") ebenso wie bei 403 („du fragst zu
 * schnell"). Der Hintergrund-Job leitete daraus eine Fehlanzeige ab und
 * sperrte das Bild für sieben Tage.
 *
 * Bei einer Drosselung ist das genau falsch herum: Dann sind die Bilder
 * VORHANDEN, und ausgerechnet der Ansturm, der die Drosselung auslöst, hätte
 * hunderte davon dauerhaft ausgesperrt. Der Bild-Proxy unterscheidet die
 * beiden Fälle längst (nur 404 wird gemerkt) — dem Job fehlte die Auskunft.
 *
 * ── Was jetzt gilt ──────────────────────────────────────────────────────────
 *   404      → Fehlanzeige, nicht wieder versuchen
 *   403/429  → Pause, alle unbearbeiteten Notizen zurück in die Warteschlange
 *
 * Gemessen, zehn Notizen:
 *
 *     403:  0 abgearbeitet, 1 Versuch, 10 Notizen erhalten, 0 Fehlanzeigen
 *     404: 10 Versuche, 10 Fehlanzeigen
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

// Den Download abfangen und den Statuscode vorgeben.
let antwort = 403;
const thumbVersuche = { n: 0 };
let versuche = 0;
const echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = echtesRequire.apply(this, arguments);
  // Seit Nachtrag 125 liegt downloadSetImage in utils/setImages.ts statt im
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
const db = _req('db/database.js');

test('eine hoffnungslose Vorschau wird nur EINMAL versucht', { concurrency: 1 }, async (t) => {
  // ── Marcos Log (Nachtrag 117) ─────────────────────────────────────────────
  //     [thumb] Vorschau fehlgeschlagen für /images/sets/5007579-1.jpg:
  //             Mime type image/webp does not support decoding
  // — und dieselbe Zeile für 5007576-1, 5007623-1, immer wieder.
  //
  // Jimp kann webp nicht entpacken. In Nachtrag 104 habe ich das gemerkt, aber
  // nur im Bild-Proxy. Der JOB rief generateThumb() direkt auf und verschluckte
  // den Fehler. Also entstand keine Datei, beim nächsten Durchgang galt „Bild
  // da, Vorschau fehlt", und es wurde erneut versucht — nach jedem Klick auf
  // „Katalogbilder holen" wieder.
  //
  // Auf einem Raspberry Pi ist ein vergeblicher Jimp-Lauf, der die Datei erst
  // einliest und dann aufgibt, genau die Arbeit, die niemand haben will.
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const { SET_IMAGES_DIR } = _req('utils/appPaths.js');
  const fsm = require('node:fs');
  fsm.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const P = `WB${process.pid}`;
  const datei = path.join(SET_IMAGES_DIR, `${P}_1.jpg`);
  fsm.writeFileSync(datei, 'x');            // Bild liegt, Vorschau unmöglich
  const IM = _req('utils/imageMisses.js');
  const IQ = _req('jobs/imageQueue.js');
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
      const IQ = _req('jobs/imageQueue.js');
      const e = await IQ._arbeiteStapel();
      assert.equal(versuche, 1,
        `${versuche} Versuche — nach der ersten Drosselung muss der Stapel abbrechen`);

      // ── Zurückgelegt ist NICHT bearbeitet (Nachtrag 122) ─────────────────
      //
      // `erg.gesamt` stand auf `rows.length` — also auch dann auf zehn, wenn
      // der Stapel schon an der ERSTEN Zeile abbrach und alle zehn zurück in
      // die Warteschlange gingen. Im Log stand dann „10 bearbeitet: 0 geladen,
      // 0 Vorschau erzeugt, 0 bereits vorhanden": eine Zeile, die behauptet,
      // etwas getan zu haben, und keinen Hinweis gibt, was.
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
      const n = (await _req('jobs/imageQueue.js')._arbeiteStapel()).gesamt;
      assert.equal(n, 0);
      assert.equal(versuche, vorher,
        'Es wurde weiter gefragt — stures Weiterfragen ist genau das Verhalten, ' +
        'das eine Sperre verlängert');
    });

    await t.test('404 wird dagegen gemerkt', async () => {
      // Frisches Modul: Die Pause aus dem vorigen Teilschritt gilt sonst weiter.
      delete require.cache[require.resolve(path.join(ROOT, 'dist', 'jobs', 'imageQueue.js'))];
      const IQ = _req('jobs/imageQueue.js');
      antwort = 404; versuche = 0;
      await fuellen();
      await IQ._arbeiteStapel();
      await _req('utils/imageMisses.js')._schreibePuffer();
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
