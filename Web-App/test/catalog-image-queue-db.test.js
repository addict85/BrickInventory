/**
 * Der Katalog stösst nicht mehr Bilder an, als jemand ansieht.
 *
 * ── Marcos Meldung ──────────────────────────────────────────────────────────
 * „Die App scheint den Server seit der vorletzten Version sehr stark
 * auszulasten. Die CPU ist praktisch non-Stop auf 100 % Auslastung."
 *
 * ── Die Ursache, und warum sie erst jetzt auftrat ───────────────────────────
 * Die Katalogliste bereitet Bilder vor: Zu jedem Set ohne lokale Datei wird ein
 * Download eingereiht, und zu jedem Download gehört das Erzeugen eines
 * Vorschaubildes — das ist die teure Arbeit.
 *
 * Bis zum Umbau der Liste holte die Webapp die Seiten EINE nach der anderen;
 * wer zehn Seiten weit scrollte, stiess zehn Seiten Bilder an. Seit dem
 * Fensterladen (Nachtrag 90) kann ein einziger Scroll-Vorgang viele Seiten
 * anfordern. Bei rund 25 000 Katalog-Sets lief der Server damit lange nach dem
 * Scrollen weiter auf Anschlag.
 *
 * Begrenzt war die PARALLELITÄT (zwei gleichzeitig), nicht die WARTESCHLANGE.
 * Zwei gleichzeitige Downloads bei 25 000 Einträgen sind keine Schonung,
 * sondern nur eine lange Warteschlange.
 *
 * ── Gemessen ────────────────────────────────────────────────────────────────
 * Zehn Seiten in schneller Folge (600 Sets), Downloader abgefangen:
 *
 *     ohne Deckel   600 Aufträge
 *     mit Deckel    104 Aufträge
 *
 * Dieser Test misst dasselbe — an der ECHTEN Route, nicht an der Hilfsfunktion:
 * Genau dazwischen sass der Fehler, denn die Route reiht je Seite bis zu 60
 * Sets ein, und niemand begrenzte die Summe.
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
// über ein spätes require(), das dieser Wrapper mitbekommt.
let angestossen = 0;
const echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = echtesRequire.apply(this, arguments);
  // Seit Nachtrag 125 liegt downloadSetImage in utils/setImages.ts statt im
  // Router — der Abfang muss dorthin zeigen, sonst greift er ins Leere und
  // der Test misst still den echten Download.
  if (typeof name === 'string' && /setImages(\.js)?$/.test(name) && m && m.downloadSetImage) {
    return new Proxy(m, {
      get: (t, k) => k === 'downloadSetImage'
        ? (async () => { angestossen++; await new Promise(r => setTimeout(r, 2)); return null; })
        : t[k],
    });
  }
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('die Katalogliste löst gar keine Bildarbeit aus', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const NUTZER = `bq-${process.pid}`;
  await db.run(`CREATE TABLE IF NOT EXISTS rb_themes (id INT PRIMARY KEY, name TEXT, parent_id INT)`);
  await db.run(`INSERT INTO rb_themes (id,name,parent_id) VALUES (1,'T',NULL) ON CONFLICT DO NOTHING`);
  await db.run(`DELETE FROM rb_sets WHERE set_num LIKE 'BQ%'`);
  await db.run(`INSERT INTO rb_sets (set_num,name,year,theme_id,num_parts,set_img_url)
                SELECT 'BQ'||g, 'S'||g, 2020, 1, 100, 'https://example.invalid/'||g||'.jpg'
                  FROM generate_series(1,600) g`);
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: uid };
    req.apiUser = { user_id: uid, is_admin: 0 };
    next();
  });
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;

  try {
    // Zehn Seiten in schneller Folge — so wie beim Durchscrollen.
    for (let seite = 1; seite <= 10; seite++)
      await (await fetch(`${base}/api/v1/catalog/sets?limit=60&page=${seite}&sort=year_desc`)).json();
    // Warten, bis die Warteschlange durchgelaufen wäre.
    await new Promise(r => setTimeout(r, 2500));

    // ── Aus dem Deckel wurde eine Null (Nachtrag 105) ─────────────────────
    //
    // Der Deckel aus Nachtrag 95 begrenzte die Bildarbeit der Liste. Marcos
    // Zuordnung — „die CPU ist seit der Umstellung des Katalogs mit dem
    // Scrolling so stark ausgelastet" — führte dann auf den eigentlichen
    // Befund: Diese Warteschlange rief `generateThumb()` DIREKT auf, vorbei an
    // THUMB_MAX_PARALLEL und der Sitzungssperre im Bild-Proxy.
    //
    // Sie ist ersatzlos entfallen. Der lokale Cache baut sich weiterhin auf,
    // nur über den anderen Weg: Bildanfrage über den Proxy → Notiz →
    // jobs/imageQueue.ts. EIN Erzeuger statt zweier, und dieser ist gedrosselt.
    assert.equal(angestossen, 0,
      `${angestossen} Bild-Aufträge aus der LISTE. Sie darf gar keine mehr ` +
      'auslösen — jeder Aufruf von hier läuft an allen Drosselungen vorbei.');
  } finally {
    await db.run(`DELETE FROM rb_sets WHERE set_num LIKE 'BQ%'`).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
    Module.prototype.require = echtesRequire;
  }
});
