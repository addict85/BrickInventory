/**
 * Alle Preisalarme an EINEM Ort — und dort änderbar und löschbar.
 *
 * ── Marcos Frage vom 25.09. ─────────────────────────────────────────────────
 *
 *   „Wie finde ich alle Preisalarme?"
 *
 * Gar nicht, war die Antwort: Es gab nur die Route zu EINEM Set. Man sah einen
 * Alarm also nur, wenn man das Set schon gefunden hatte. Wer fünfzig setzt, hat
 * keinen Ort, an dem sie zusammen stehen, und keinen, an dem er sieht, welche
 * noch scharf sind. Ein Alarm, den man nicht wiederfindet, lässt sich weder
 * prüfen noch abstellen.
 *
 * Marcos Auftrag: „Baue die Übersicht in beiden Apps in den Einstellungen als
 * Rubrik. Ich möchte dort den Alarm direkt löschen können oder den Wert
 * anpassen können."
 *
 * ── Warum dieser Test die Datenbank anfasst ─────────────────────────────────
 *
 * Die Aussage, auf die es ankommt, ist nicht „es gibt eine Route", sondern
 * „sie liefert MEINE Alarme, alle, mit Namen — und keine fremden". Das ist
 * eine Frage an die Abfrage, nicht an den Quelltext: Ein vergessenes
 * `user_id = $1` sieht im Text harmlos aus und ist der ganze Fehler.
 *
 * Voraussetzung: Test-DB. Ohne DB: skip (mit REQUIRE_DB=1: Fehler).
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) `WHERE a.user_id = $1` entfernt     → Schritt 2 rot (fremder Alarm dabei)
 *   b) LEFT JOIN → INNER JOIN              → Schritt 3 rot (unbekanntes Set weg)
 *   c) Rubrik aus index.html entfernt      → Schritt 4 rot
 *   d) ladeAlarmUebersicht nicht aufgerufen → Schritt 4 rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const { buildAndRequire, ohneKommentare } = require('./helpers/sources');
const _req = buildAndRequire();
const db = _req('db/database.js');

test('Preisalarm-Übersicht: eigene Alarme, mit Namen, änderbar, löschbar',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  const { alleAlarme, setzeAlarm, loescheAlarm } = _req('utils/preisalarm.js');

  for (const n of ['alarm_ich', 'alarm_fremd']) await db.run('DELETE FROM users WHERE username = $1', [n]);
  const ich = await db.get(
    "INSERT INTO users (username,password_hash,is_admin,email_verified) VALUES ($1,'x',0,1) RETURNING id", ['alarm_ich']);
  const fremd = await db.get(
    "INSERT INTO users (username,password_hash,is_admin,email_verified) VALUES ($1,'x',0,1) RETURNING id", ['alarm_fremd']);
  t.after(async () => {
    for (const id of [ich.id, fremd.id]) await db.run('DELETE FROM users WHERE id = $1', [id]).catch(() => {});
    await db.run("DELETE FROM rb_sets WHERE set_num = '70002-1'").catch(() => {});
    await db.pool.end().catch(() => {});
  });

  // Ein Set, das der Katalog kennt — und eines, das er NICHT kennt.
  await db.run(`INSERT INTO rb_sets (set_num, name) VALUES ('70002-1','Lennox Feuerwehr')
                ON CONFLICT (set_num) DO UPDATE SET name = EXCLUDED.name`);

  // Signatur GELESEN, nicht geraten: (userId, setNumber, waehrung, eingabe).
  // Der erste Entwurf dieses Tests hatte sie sich zurechtgelegt und lief
  // sofort in „Die Richtung muss unter oder ueber sein" — die Werte landeten
  // an den falschen Stellen.
  await setzeAlarm(ich.id, '70002-1', 'CHF', { richtung: 'unter', schwelle: 30, condition: 'N' });
  await setzeAlarm(ich.id, '99999-9', 'CHF', { richtung: 'ueber', schwelle: 500, condition: 'U' }); // Set unbekannt
  await setzeAlarm(fremd.id, '70002-1', 'CHF', { richtung: 'unter', schwelle: 10, condition: 'N' }); // fremd

  await t.test('1. alle eigenen Alarme kommen', async () => {
    const a = await alleAlarme(ich.id);
    assert.equal(a.length, 2, `Erwartet 2 eigene Alarme, bekommen: ${a.length}`);
    // numeric kommt als Zeichenkette aus dem Treiber — die Übersicht rechnet
    // damit (Feld, Vergleich), also muss hier eine ZAHL ankommen.
    assert.equal(typeof a[0].schwelle, 'number', 'Die Schwelle kommt nicht als Zahl an.');
  });

  await t.test('2. und KEIN fremder', async () => {
    const a = await alleAlarme(ich.id);
    assert.ok(!a.some(x => Number(x.schwelle) === 10),
      'Der Alarm des anderen Kontos steht in meiner Übersicht — das fehlende ' +
      'user_id-Kriterium sieht im Quelltext harmlos aus und ist der ganze Fehler.');
    assert.equal((await alleAlarme(fremd.id)).length, 1, 'Das andere Konto sieht plötzlich mehr.');
  });

  await t.test('3. mit Setname — und ein unbekanntes Set fällt nicht heraus', async () => {
    const a = await alleAlarme(ich.id);
    const bekannt = a.find(x => x.set_number === '70002-1');
    const unbekannt = a.find(x => x.set_number === '99999-9');
    assert.equal(bekannt.name, 'Lennox Feuerwehr',
      'Ohne Namen ist die Liste eine Liste von Nummern — die liest niemand.');
    assert.ok(unbekannt, 'Ein Alarm auf ein Set, das der Katalog nicht kennt, ist verschwunden. ' +
      'Genau die Zeile sucht man aber, weil sie sich merkwürdig verhält (INNER statt LEFT JOIN).');
    assert.equal(unbekannt.name, null, 'Unbekannt heisst null, nicht leer geraten.');
  });

  await t.test('4. die Rubrik steht in der Webapp und wird geladen', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
    assert.match(html, /id="alerts-list"/, 'Die Rubrik fehlt im Markup.');
    assert.match(html, /data-i18n="alerts\.group"/, 'Die Rubrik hat keine Überschrift.');
    const galerie = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/js/02-gallery.js'), 'utf8'));
    assert.match(galerie, /ladeAlarmUebersicht\(\)/,
      'Beim Öffnen der Einstellungen wird die Übersicht nicht geladen — die Rubrik bliebe leer.');
    const js = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/js/05-settings.js'), 'utf8'));
    // Ändern und Löschen gehen über die BESTEHENDE Route zum Set: zwei
    // Schreibwege zum selben Zustand wären zwei Stellen, an denen die Regeln
    // auseinanderlaufen.
    assert.match(js, /'PUT', `\/v1\/sets\/\$\{encodeURIComponent\(setNumber\)\}\/alert`/,
      'Der Wert lässt sich nicht ändern — genau das hat Marco verlangt.');
    assert.match(js, /'DELETE', `\/v1\/sets\//,
      'Der Alarm lässt sich nicht löschen — genau das hat Marco verlangt.');
  });

  await t.test('5. Löschen wirkt', async () => {
    await loescheAlarm(ich.id, '99999-9', 'U');
    const a = await alleAlarme(ich.id);
    assert.equal(a.length, 1, 'Nach dem Löschen steht der Alarm noch in der Übersicht.');
  });
});
