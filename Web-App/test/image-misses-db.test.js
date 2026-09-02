/**
 * Fehlende Bilder werden EINMAL geholt — nicht je Prozess und Besuch neu.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 * „Beim ersten Scrollen im Katalog funktioniert es einwandfrei, wenn ich dann
 * weiter scrolle zu 1958, ist es wieder das gleiche Problem." Dazu der Log:
 * seitenweise `[set-img] HTTP 404 vom Bildserver` für Sets aus den Fünfzigern
 * und Sechzigern — und `docker stats` mit 142 % CPU im Container.
 *
 * Für alte Sets hat Rebrickable meist gar kein Bild. Jede Kachel dort löste
 * einen Roundtrip zum CDN aus, der ins Leere ging.
 *
 * ── Warum die vorhandenen Merker nicht reichten ─────────────────────────────
 * Es GAB zwei: Der Bild-Proxy hielt 404er fünfzehn Minuten fest, der Katalog
 * merkte sich versuchte Sets. Beide lagen im Arbeitsspeicher EINES Prozesses —
 * und der Server läuft im Cluster mit mehreren Arbeitsprozessen (im Log:
 * 16, 22, 23, 24). Dasselbe fehlende Bild wurde deshalb einmal je Prozess
 * geholt, nach einem Neustart erneut, und nach fünfzehn Minuten wieder.
 *
 * Das ist die Klasse Fehler, die in dieser Reihe schon mehrfach vorkam: Ein
 * Schutz existiert, aber sein Geltungsbereich ist enger als das Problem.
 *
 * ── Gemessen ────────────────────────────────────────────────────────────────
 * Ein Jahrgang mit 60 bildlosen Sets:
 *
 *     1. Besuch                    60 Versuche
 *     2. Besuch                     0 weitere
 *     frischer Prozess              weiss Bescheid
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

// Den Bild-Download abfangen, BEVOR die Routen geladen werden: Sie holen ihn
// über ein spätes require(). null = das CDN hat kein Bild.
let versuche = 0;
const echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = echtesRequire.apply(this, arguments);
  // Seit Nachtrag 125 liegt downloadSetImage in utils/setImages.ts statt im
  // Router — der Abfang muss dorthin zeigen, sonst greift er ins Leere und
  // der Test misst still den echten Download.
  if (typeof name === 'string' && /setImages(\.js)?$/.test(name) && m && m.downloadSetImage) {
    return new Proxy(m, {
      get: (t, k) => k === 'downloadSetImage' ? (async () => { versuche++; return null; }) : t[k],
    });
  }
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('bildlose Sets werden nicht immer wieder beim CDN gesucht',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const NUTZER = `im-${process.pid}`;
  const PRAEFIX = `IM${process.pid}_`;
  await db.run(`CREATE TABLE IF NOT EXISTS rb_themes (id INT PRIMARY KEY, name TEXT, parent_id INT)`);
  await db.run(`INSERT INTO rb_themes (id,name,parent_id) VALUES (1,'T',NULL) ON CONFLICT DO NOTHING`);
  await db.run(`DELETE FROM rb_sets WHERE set_num LIKE $1`, [PRAEFIX + '%']);
  await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + PRAEFIX + '%']).catch(() => {});
  // Ein Jahrgang ohne Bilder — wie 1958 im echten Katalog.
  await db.run(`INSERT INTO rb_sets (set_num,name,year,theme_id,num_parts,set_img_url)
                SELECT $1||g, 'Alt', 1958, 1, 50, 'https://example.invalid/'||g||'.jpg'
                  FROM generate_series(1,60) g`, [PRAEFIX]);
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;

  const { base, srv } = testServer(_req, {
    sitzung: { userId: uid },
    apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });

  // Die Warteschlange arbeitet nebenläufig — nach dem Abruf kurz warten.
  const besuch = async () => {
    await (await fetch(`${base}/api/v1/catalog/sets?limit=60&page=1&q=${PRAEFIX}`)).json();
    await new Promise(r => setTimeout(r, 700));
  };

  try {
    // Die Liste löst seit Nachtrag 105 gar keine Bildarbeit mehr aus (sie lief
    // an allen Drosselungen vorbei). Der Weg führt jetzt über den Proxy und
    // jobs/imageQueue.ts — geprüft wird deshalb der MERKER selbst, nicht mehr
    // die Liste.
    await besuch();
    assert.equal(versuche, 0,
      `${versuche} Downloads aus der Liste — sie darf keine mehr auslösen`);

    await t.test('ein anderer Prozess weiss davon', async () => {
      // Der Kern der Sache: Der Server läuft im Cluster. Ein Merker im
      // Arbeitsspeicher hilft nur DEM Prozess, der ihn angelegt hat — bei vier
      // Arbeitsprozessen wird dasselbe Bild viermal geholt.
      //
      // Seit Nachtrag 103 ist das Lesen rein im Arbeitsspeicher (eine Abfrage
      // je Bild leerte den Verbindungspool). Das Wissen wandert im Takt in die
      // Tabelle und von dort in die anderen Prozesse; hier wird beides von Hand
      // angestossen, um den frischen Prozess nachzustellen.
      const IM = _req('utils/imageMisses.js');
      IM.merkeFehlend('set:' + PRAEFIX + '_probe');
      await IM._schreibePuffer();
      IM._leereVordergrund();
      assert.equal(IM.istBekanntFehlend('set:' + PRAEFIX + '_probe'), false,
        'Vorbedingung: der Arbeitsspeicher ist leer');
      await IM._auffrischen();
      assert.equal(IM.istBekanntFehlend('set:' + PRAEFIX + '_probe'), true,
        'Ohne die Tabelle ist das Wissen nach einem Neustart weg — dann sucht ' +
        'jeder Arbeitsprozess von vorn');
    });

    await t.test('ein Bild, das es gibt, wird nicht gemerkt', async () => {
      // Gegenrichtung: Sonst wäre der Test auch grün, wenn pauschal alles als
      // fehlend gälte — und kein Bild würde je geladen.
      const IM = _req('utils/imageMisses.js');
      IM._leereVordergrund();
      assert.equal(IM.istBekanntFehlend('set:gibt-es-nicht-in-der-tabelle'), false);
    });
  } finally {
    await db.run(`DELETE FROM rb_sets WHERE set_num LIKE $1`, [PRAEFIX + '%']).catch(() => {});
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + PRAEFIX + '%']).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
    Module.prototype.require = echtesRequire;
  }
});
