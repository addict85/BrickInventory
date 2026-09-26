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
 *   e) zweiter LEFT JOIN auf `sets` entfernt → Schritt 5 rot (Bild und Besitz)
 *   f) `data-click="stopEvent"` am Feld entfernt → Schritt 6 rot
 *   g) `besitzt` aus data class Preisalarm entfernt → Schritt 7 rot
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
  await db.run(`INSERT INTO rb_sets (set_num, name, set_img_url)
                VALUES ('70002-1','Lennox Feuerwehr','https://cdn.example/70002-1.jpg')
                ON CONFLICT (set_num) DO UPDATE
                   SET name = EXCLUDED.name, set_img_url = EXCLUDED.set_img_url`);
  // Dasselbe Set liegt ZUSÄTZLICH in meiner Sammlung — nur dann gibt es einen
  // Detaildialog, und nur dann gibt es das heruntergeladene Bild.
  await db.run(`INSERT INTO sets (user_id, set_number, name, image_local, image_url)
                VALUES ($1,'70002-1','Lennox Feuerwehr','/uploads/70002-1_thumb.jpg','https://cdn.example/70002-1.jpg')
                ON CONFLICT (user_id, set_number) DO NOTHING`, [ich.id]);

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

  await t.test('5. Bild und Besitz kommen mit — für die Kachel und für den Klick', async () => {
    const a = await alleAlarme(ich.id);
    const meins = a.find(x => x.set_number === '70002-1');
    const fremdes = a.find(x => x.set_number === '99999-9');
    // Reihenfolge wie in den Finanzen: heruntergeladene Kopie zuerst. Ohne sie
    // zeigte dieselbe Nummer in der Übersicht ein anderes Bild als in der
    // Galerie daneben.
    assert.equal(meins.image_local, '/uploads/70002-1_thumb.jpg',
      'Das Bild der eigenen Sammlung fehlt — die Zeile bliebe ohne Kachel oder ' +
      'zeigte eine andere als die Galerie.');
    assert.equal(meins.set_img_url, 'https://cdn.example/70002-1.jpg',
      'Das Katalogbild fehlt — es ist der Rückfall für Sets, die man nicht besitzt.');
    assert.equal(meins.besitzt, true, 'Ein Set in der Sammlung gilt als nicht vorhanden.');
    // Der zweite LEFT JOIN darf keine Zeile vervielfachen: sets ist über
    // (user_id, set_number) eindeutig. Zwei Zeilen wären hier der Beweis.
    assert.equal(a.filter(x => x.set_number === '70002-1').length, 1,
      'Die Verbindung zur eigenen Sammlung hat die Zeile vervielfacht.');

    assert.equal(fremdes.besitzt, false,
      'Ein Alarm auf ein Set, das NICHT in der Sammlung liegt, gilt als vorhanden — ' +
      'die Zeile wäre anklickbar und der Klick endete in einer Fehlermeldung.');
    assert.equal(fremdes.image_local, null, 'Woher sollte das Bild kommen?');
  });

  await t.test('6. die Zeile öffnet den Detaildialog, das Zahlenfeld nicht', () => {
    const js = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/js/05-settings.js'), 'utf8'));
    assert.match(js, /data-click="openModal"/,
      'Die Zeile öffnet den Detaildialog nicht — genau das hat Marco verlangt.');
    // Der Verteiler in 11-actions.js nimmt das NÄCHSTGELEGENE Element mit
    // data-click. Ohne `stopEvent` am Eingabefeld öffnete jeder Klick ins Feld
    // den Dialog über dem Feld, in das man gerade tippen wollte.
    assert.match(js, /data-click="stopEvent"/,
      'Das Zahlenfeld hält den Klick nicht auf — Tippen öffnete den Dialog.');
    assert.match(js, /thumbUrl\(/,
      'Die Zeile zeigt kein Vorschaubild — analog den Finanzen war das der Auftrag.');
  });

  await t.test('7. jedes gelieferte Feld kommt in der App auch an', async () => {
    // ── Warum das nicht der Kotlin-Übersetzer erledigt (Nachtrag 137) ──────
    //
    // Er fängt den lauten Fall: Ein Feld, das die Oberfläche liest und das es
    // im Modell nicht gibt, übersetzt nicht. Genau das ist beim Einbau dieser
    // Zeile passiert — die vier neuen Felder landeten versehentlich in der
    // Nachbarklasse, und der Lauf war nach 88 Sekunden rot.
    //
    // Der STILLE Fall bleibt: Heisst das Feld hier `set_img_url` und im Modell
    // `@SerialName("set_image")`, übersetzt alles sauber, und die App bekommt
    // für immer `null`. Kein Fehler, kein Absturz — nur ein Bild, das nie
    // erscheint, und niemand weiss, warum.
    //
    // Deshalb werden die Namen VERGLICHEN, und zwar die tatsächlich
    // gelieferten aus der Antwort, nicht eine abgeschriebene Liste.
    const a = await alleAlarme(ich.id);
    const felder = Object.keys(a[0]);
    assert.ok(felder.length >= 10, `Nur ${felder.length} Felder — Abfrage kaputt?`);

    const kt = fs.readFileSync(path.join(ROOT, '..', 'Android-App', 'app', 'src', 'main',
      'java', 'ch', 'brickinventoryapp', 'data', 'model', 'SetModels.kt'), 'utf8');
    const klasse = kt.slice(kt.indexOf('data class Preisalarm('));
    const rumpf = klasse.slice(0, klasse.indexOf('\n)'));
    assert.ok(rumpf.includes('setNumber'), 'data class Preisalarm nicht gefunden — Muster veraltet?');

    const camel = k => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const fehlen = felder.filter(k =>
      !rumpf.includes(`@SerialName("${k}")`) &&
      !new RegExp(`\\bval ${camel(k)}\\b`).test(rumpf));
    assert.deepEqual(fehlen, [],
      'Diese Felder liefert /v1/alerts, und die App hat keinen Platz dafür:\n  ' +
      fehlen.join('\n  ') +
      '\nSie kämen dort als null an, ohne Fehler und ohne Hinweis.');
  });

  await t.test('8. Löschen wirkt', async () => {
    await loescheAlarm(ich.id, '99999-9', 'U');
    const a = await alleAlarme(ich.id);
    assert.equal(a.length, 1, 'Nach dem Löschen steht der Alarm noch in der Übersicht.');
  });
});
