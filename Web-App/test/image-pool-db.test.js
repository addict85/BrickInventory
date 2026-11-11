/**
 * Bildanfragen belegen KEINE Datenbankverbindung.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');

test('eine Kachelwand kostet keine einzige Abfrage', { concurrency: 1 }, async (t) => {
  if (!await dbOderSkip(t, _req, { migrieren: false })) return;

  const IM = _req('src/katalog/bilder/imageMisses.js');
  const IQ = _req('src/katalog/bilder/bildbedarfLauf.js');
  await IM.initImageMisses();
  await IQ.initImageQueue();
  const PRAEFIX = `PL${process.pid}`;
  const weg = async () => {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [PRAEFIX + '%']).catch(() => {});
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, [PRAEFIX + '%']).catch(() => {});
  };
  await weg();

  // Abfragen mitzählen — das ist die Grösse, um die es geht.
  let abfragen = 0;
  const echteQuery = db.pool.query.bind(db.pool);
  db.pool.query = (...a) => { abfragen++; return echteQuery(...a); };

  try {
    await t.test('60 Kacheln lösen 0 Abfragen aus', async () => {
      const vorher = abfragen;
      for (let i = 1; i <= 60; i++) {
        IM.istBekanntFehlend(`${PRAEFIX}_k${i}`);
        IQ.merkeGebraucht(`https://cdn.rebrickable.com/media/sets/${PRAEFIX}_${i}.jpg`, `${PRAEFIX}_${i}`);
      }
      assert.equal(abfragen - vorher, 0,
        `${abfragen - vorher} Abfragen für 60 Kacheln. Bildanfragen sind der ` +
        'häufigste Vorgang der Anwendung — eine Abfrage je Bild leert den ' +
        'Verbindungspool, und ANDERE Routen laufen in den Zeitfehler.');
    });

    await t.test('das Wegschreiben bündelt', async () => {
      const vorher = abfragen;
      await IQ._schreibePuffer();
      // Eine Anweisung für alle Notizen; dazu der Abarbeiter-Auftrag und sein NOTIFY.
      assert.ok(abfragen - vorher <= 3,
        `${abfragen - vorher} Abfragen zum Wegschreiben von 60 Notizen — das muss ` +
        'ein Statement sein, sonst ist nur die Stelle verschoben');
      const n = (await db.get(
        `SELECT COUNT(*)::int c FROM image_wanted WHERE set_number LIKE $1`, [PRAEFIX + '%'])).c;
      assert.equal(n, 60, `${n} Notizen statt 60 — gebündelt heisst nicht: weniger`);
    });

    await t.test('Fehlanzeigen ebenso', async () => {
      for (let i = 1; i <= 40; i++) IM.merkeFehlend(`${PRAEFIX}_m${i}`);
      const vorher = abfragen;
      await IM._schreibePuffer();
      assert.ok(abfragen - vorher <= 2, `${abfragen - vorher} Abfragen für 40 Fehlanzeigen`);
    });

    await t.test('nach einem Neustart ist das Wissen noch da', async () => {
      // Der Grund, warum es überhaupt in die Datenbank gehört:
      // Der Speicher eines Prozesses hilft den anderen nicht.
      IM._leereVordergrund();
      assert.equal(IM.istBekanntFehlend(`${PRAEFIX}_m7`), false,
        'Vorbedingung: der Speicher ist leer');
      await IM._auffrischen();
      assert.equal(IM.istBekanntFehlend(`${PRAEFIX}_m7`), true,
        'Nach dem Nachladen aus der Tabelle muss die Fehlanzeige wieder bekannt sein');
    });
  } finally {
    db.pool.query = echteQuery;
    await weg();
    // Den Pool NICHT hier schliessen: Der Sperr-Test weiter unten braucht ihn
    // noch. Er schliesst als letzter DB-Test.
  }
});

test('eine gescheiterte Verkleinerung wird nicht endlos wiederholt', () => {
  // Marcos Log, immer wieder dieselbe Zeile
  const px = require('./helpers/sources').proxyThumbQuelle();
  const q = px.slice(px.indexOf('function queueThumb('), px.indexOf('function drainThumbQueue'));
  assert.match(q, /istBekanntFehlend\('thumb:' \+ thumbFile\)/,
    'queueThumb() fragt nicht, ob die Verkleinerung schon einmal gescheitert ist');
  // Und der Fehlschlag muss festgehalten werden — an BEIDEN Stellen, an denen
  // er auftreten kann: beim Entpacken selbst und bei der Vorprüfung.
  assert.equal((px.match(/merkeFehlend\('thumb:' \+ thumbFile\)/g) || []).length, 2,
    'Der Fehlschlag wird nicht an beiden Stellen gemerkt (Vorprüfung und catch)');
});

test('ein 404 darf der Browser sich merken', () => {
  // Marcos Konsole
  const px = require('./helpers/sources').proxyThumbQuelle();
  // Der Weg heisst jetzt sendePlatzhalter
  assert.match(px, /function sendePlatzhalter\(res(: \w+)?\)/,
    'Kein gemeinsamer Weg für ein fehlendes Bild');
  assert.match(px, /sendePlatzhalter[\s\S]{0,600}Cache-Control', 'private, max-age=3600/,
    'Die Antwort trägt keinen Cache-Hinweis — der Browser fragt jedes Mal neu');
  // Beide Wege müssen ihn benutzen: der Treffer im Merker und die Absage vom CDN.
  assert.match(px, /istBekanntFehlend\(cacheKey\)\) return sendePlatzhalter\(res\)/,
    'Der Merker-Treffer antwortet ohne Cache-Hinweis');
  assert.match(px, /r\.status === 404 \? sendePlatzhalter\(res\)/,
    'Die Absage vom CDN antwortet ohne Cache-Hinweis');
  // 403 (Drosselung) darf NICHT zwischengespeichert werden — dasselbe Argument
  // wie beim serverseitigen Merker.
  assert.doesNotMatch(px, /403[\s\S]{0,80}sendePlatzhalter/,
    'Ein 403 ist eine Drosselung, kein fehlendes Bild');
});

test('die Vorschau-Sperre belegt KEINE Pool-Verbindung', { concurrency: 1 }, async (t) => {
  // Marcos Log
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const vorher = db.getPoolStats();
  const c = await db.eigeneVerbindung();
  try {
    const r = await c.query('SELECT pg_try_advisory_lock(918273645) AS ok');
    assert.equal(r.rows[0].ok, true, 'Die Sperre liess sich nicht nehmen');
    const waehrend = db.getPoolStats();
    assert.equal(waehrend.active, vorher.active,
      `Der Pool hat ${waehrend.active} statt ${vorher.active} aktive Verbindungen — ` +
      'eine über Sekunden gehaltene Sperre darf keine davon belegen');
    await c.query('SELECT pg_advisory_unlock(918273645)');
  } finally {
    await c.end();
    // Letzter Test mit Datenbank in dieser Datei.
    await db.pool.end().catch(() => {});
  }
});

test('die Warteschlange hat einen Index auf dem Alter', () => {
  // Der Job sucht alle 20 Sekunden die ÄLTESTEN Einträge. Mit ein paar Dutzend
  // Zeilen gleichgültig — mit 25 000 (nach „Katalogbilder holen") bedeutet jeder
  // Lauf sonst einen vollständigen Durchgang samt Sortierung.
  const mig = fs.readFileSync(
    path.join(ROOT, 'db/migrations/0010-image-wanted-index.sql'), 'utf8');
  assert.match(mig, /CREATE INDEX IF NOT EXISTS idx_image_wanted_alter ON image_wanted \(requested_at\)/,
    'Der Index auf requested_at fehlt');
});

test('die Sitzungssperre wird auf derselben Verbindung freigegeben', () => {
  // Eine Sitzungssperre gehört der VERBINDUNG, die sie genommen hat. Wird sie
  // über eine andere freigegeben, tut das nichts — die Sperre bliebe für immer
  // bestehen, und es entstünde nie wieder ein Vorschaubild. Das ist mir in
  //  passiert.
  const px = require('./helpers/sources').proxyThumbQuelle();
  const i = px.indexOf('async function mitVorschauSperre');
  assert.ok(i > 0, 'mitVorschauSperre fehlt');
  // Die Funktion steht seit einer früheren Runde auf Modulebene statt in einer Closure —
  // eine Einrückungsebene weniger, also endet sie auf '\n}\n'.
  const fn = px.slice(i, px.indexOf('\n}\n', i));
  assert.match(fn, /db\.eigeneVerbindung\(\)/,
    'Die Sperre nimmt wieder eine Pool-Verbindung');
  assert.doesNotMatch(fn, /db\.pool\.connect\(\)/, 'Pool-Verbindung ist zurück');
  // Nehmen und Freigeben stehen im Repository und bekommen DIESE Verbindung.
  assert.match(fn, /sperre\.versucheSperre\(client,/, 'Nehmen nicht auf dem Client');
  assert.match(fn, /sperre\.gibSperreFrei\(client,/, 'Freigeben nicht auf dem Client');
});
