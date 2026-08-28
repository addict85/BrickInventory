/**
 * Was „fehlend" heisst — und wie man es zurücknimmt.
 *
 * ── Marcos Log (Nachtrag 123) ───────────────────────────────────────────────
 *     [image-queue] 2 bearbeitet: 0 geladen, 0 Vorschau erzeugt,
 *                   0 bereits vorhanden, 2 als fehlend bekannt
 *
 * Der Zähler aus Nachtrag 122 nannte endlich den Ausgang. Offen blieb, wie die
 * beiden Bilder in `image_misses` gekommen waren — und das ist die Frage, die
 * zählt.
 *
 * Der Job merkte sich JEDEN Fehlschlag ausser 403/429 als „dieses Bild gibt es
 * nicht": Zeitüberschreitung, DNS-Aussetzer, abgebrochene Verbindung, „Antwort
 * zu klein", zu viele Weiterleitungen, zu grosses Bild — und über den
 * umgebenden catch sogar einen Schreibfehler auf der eigenen Platte. Alles
 * davon sperrte das Bild sieben Tage aus.
 *
 * Der Bild-Proxy macht es seit jeher richtig und begründet es im Code: dort
 * wird NUR bei 404 gemerkt. Zwei Bauteile, dieselbe Tabelle, zwei Auslegungen.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

/** Antwort des abgefangenen Downloads: null plus ein Statuscode nach Wunsch. */
let antwortStatus = null;
let versuche = 0;
const echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = echtesRequire.apply(this, arguments);
  // Seit Nachtrag 125 liegt downloadSetImage in utils/setImages.ts statt im
  // Router — der Abfang muss dorthin zeigen, sonst greift er ins Leere und
  // der Test misst still den echten Download.
  if (typeof name === 'string' && /setImages(\.js)?$/.test(name) && m && m.downloadSetImage) {
    return new Proxy(m, { get: (t, k) => k === 'downloadSetImage'
      ? (async (_u, _sn, info) => {
          versuche++;
          if (antwortStatus && info) info.status = antwortStatus;
          return null;   // Fehlschlag — der Statuscode entscheidet über den Rest
        }) : t[k] });
  }
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const IQ = _req('jobs/imageQueue.js');
const IM = _req('utils/imageMisses.js');

const einreihen = async (sn) => {
  await db.run(`DELETE FROM image_wanted WHERE set_number = $1`, [sn]);
  await db.run(`INSERT INTO image_wanted (url, set_number) VALUES ($1, $2)`,
               [`https://cdn/${sn}.jpg`, sn]);
};
const merker = async (sn) => db.get(
  `SELECT checked_at, reason FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);

test('nur ein 404 heisst „das Bild gibt es nicht"', { concurrency: 1 }, async (t) => {
  try { await db.initSchemaOnce(); await db.runMigrations?.(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const P = `MR${process.pid}`;

  await t.test('404 wird gemerkt, mit Grund', async () => {
    const sn = `${P}_404`;
    await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);
    IM._leereVordergrund();
    antwortStatus = 404;
    await einreihen(sn);
    const e = await IQ._arbeiteStapel();
    await IM._schreibePuffer();
    assert.equal(e.nichtGeladen, 1);
    const m = await merker(sn);
    assert.ok(m, 'Ein 404 muss gemerkt werden — sonst wird jedes alte Set bei ' +
                 'jedem Blättern erneut beim CDN gesucht');
    assert.match(m.reason || '', /404/,
      'Der Grund fehlt — dann steht in image-diag wieder nur „gilt als fehlend"');
    await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);
  });

  await t.test('eine Zeitüberschreitung sperrt NICHT sieben Tage aus', async () => {
    // Kein Statuscode: genau das Bild eines Netzwerkfehlers. downloadSetImage
    // setzt info.status ausschliesslich bei einer Antwort ≠ 200 — bricht die
    // Verbindung ab, bleibt das Feld leer.
    const sn = `${P}_timeout`;
    await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);
    IM._leereVordergrund();
    antwortStatus = null;
    await einreihen(sn);
    const e = await IQ._arbeiteStapel();
    await IM._schreibePuffer();
    assert.equal(e.nichtGeladen, 1, 'Der Fehlschlag muss trotzdem gezählt werden');
    assert.equal(await merker(sn), undefined,
      'Ein vorübergehender Fehler wurde als „Bild existiert nicht" vermerkt. ' +
      'Genau so verschwinden Bilder für sieben Tage, ohne dass je etwas ' +
      'daran war — und niemand sieht, dass es überhaupt einen Versuch gab.');
    assert.match(IQ.meldung(e), /Download fehlgeschlagen/);
  });

  await t.test('derselbe Massstab wie im Bild-Proxy', () => {
    // Der Proxy merkt sich seit jeher nur 404 und begründet das im Code. Dass
    // beide Bauteile in DIESELBE Tabelle schreiben, aber verschieden auslegen,
    // war der eigentliche Fehler. Die Regel wird hier zusammengehalten.
    const fs = require('node:fs');
    const { ohneKommentare } = require('./helpers/sources');
    const proxy = ohneKommentare(require('./helpers/sources').proxyThumbQuelle());
    const job   = ohneKommentare(fs.readFileSync(path.join(ROOT, 'jobs', 'imageQueue.ts'), 'utf8'));
    assert.match(proxy, /statusCode === 404[\s\S]{0,200}merkeFehlend/,
      'Im Proxy hängt die Fehlanzeige nicht mehr am 404');
    assert.match(job, /info\.status === 404/,
      'Der Job unterscheidet den 404 nicht — dann sperrt wieder jeder ' +
      'Netzwerkfehler das Bild für sieben Tage aus');
    assert.doesNotMatch(job, /\n\s*merkeFehlend\('set:' \+ r\.set_number\);/,
      'Es gibt wieder einen unbedingten Vermerk für Sets');
  });

  antwortStatus = null;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
});

test('Fehlanzeigen lassen sich zurücknehmen und sind erklärbar',
  { concurrency: 1 }, async (t) => {
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const P = `VG${process.pid}`;
  const NUTZER = `vg-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',1)`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: uid, isAdmin: 1 };
    req.apiUser = { user_id: uid, is_admin: 1 };
    next();
  });
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;

  try {
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']);
    IM._leereVordergrund();
    IM.merkeFehlend(`set:${P}_1`, 'HTTP 404 vom CDN');
    await IM._schreibePuffer();

    await t.test('image-diag nennt den Merker und den Grund', async () => {
      const a = await (await fetch(`${base}/api/v1/admin/image-diag/${P}_1`)).json();
      assert.ok(a.merker, 'Ausgerechnet die Tabelle, die den Abruf verhindert, ' +
                          'kam in der Diagnose nicht vor');
      assert.match(a.merker.grund || '', /404/);
      assert.ok(a.hinweise.some(h => /als fehlend/.test(h)),
        'Der Klartext-Hinweis fehlt — dann muss man die Antwort erst deuten');
    });

    await t.test('zurücknehmen wirkt', async () => {
      const r = await (await fetch(`${base}/api/v1/admin/forget-image-misses`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ set_numbers: [`${P}_1`] }),
      })).json();
      assert.equal(r.entfernt, 1);
      assert.equal(await merker(`${P}_1`), undefined, 'Der Eintrag steht noch');
      assert.equal(IM.istBekanntFehlend(`set:${P}_1`), false,
        'Im Arbeitsspeicher gilt das Bild weiter als fehlend — dann ändert ' +
        'sich bis zum nächsten Auffrischen nichts');
    });

    await t.test('Vorschau-Vermerke bleiben unangetastet', async () => {
      IM.merkeFehlend('thumb:/irgendwo/xyz_thumb.jpg', 'Vorschau konnte nicht erzeugt werden');
      await IM._schreibePuffer();
      await (await fetch(`${base}/api/v1/admin/forget-image-misses`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })).json();
      const t2 = await db.get(`SELECT 1 FROM image_misses WHERE cache_key = $1`,
                              ['thumb:/irgendwo/xyz_thumb.jpg']);
      assert.ok(t2, 'Ein Lauf ohne Angabe hat die Vorschau-Vermerke mitgenommen — ' +
                    'die haben einen anderen Zweck als „Bild gibt es nicht"');
      await db.run(`DELETE FROM image_misses WHERE cache_key = $1`,
                   ['thumb:/irgendwo/xyz_thumb.jpg']);
    });
  } finally {
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    Module.prototype.require = echtesRequire;
    await db.pool.end().catch(() => {});
  }
});
