/**
 * Die Lagerort-VORGABE gegen eine echte Datenbank.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 * „Weiter möchte ich ein Lagerort in den Einstellungen als Default setzen
 *  können. Der soll dann bei einer Neuerfassung bereits vorausgewählt sein.
 *  Ich stelle mir das mit einem Sternicon vor."
 *
 * ── Warum mit DB und nicht am Quelltext ─────────────────────────────────────
 *
 * Die Vorgabe steht als ID in `user_settings`, der Ort in
 * `storage_locations`. Die beiden Aussagen, auf die es ankommt, sind
 * Aussagen über ZEILEN in zwei Tabellen und über das, was beim Umbenennen und
 * Löschen mit ihnen passiert:
 *
 *   umbenennen → die Vorgabe bleibt und heisst neu
 *   löschen    → die Vorgabe ist weg, nicht kaputt
 *
 * Genau das ist der Grund, aus dem die ID gespeichert wird und nicht der Name
 * (begründet in utils/lagerort.ts). Mit dem Namen bräuchte es an zwei weiteren
 * Stellen Code, der mitzieht — und übersähe man eine, zeigte die Vorgabe auf
 * einen Ort, den die Auswahlliste nicht kennt. Diese Datei ist der Nachweis,
 * dass es dafür keinen Code braucht.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

const U = {};

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); }
  finally { client.release(); }

  for (const name of ['ich', 'kind']) {
    await db.run(`INSERT INTO users (username, password_hash) VALUES ($1,'x')`, [name]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)',
    [U.ich, U.kind]);
  await db.run(`INSERT INTO sets (user_id, set_number, quantity) VALUES ($1,$2,1)`,
    [U.ich, '10179-1']);
}

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

test('Lagerort-Vorgabe gegen echte Datenbank', async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    }
    t.skip('Test-DB nicht erreichbar — Suite übersprungen');
    return;
  }
  await seed();
  const L = _req('utils/lagerort.js');

  const estrich = (await L.legeOrtAn(U.ich, 'Estrich')).ort;
  const keller  = (await L.legeOrtAn(U.ich, 'Keller')).ort;
  const fremd   = (await L.legeOrtAn(U.kind, 'Kinderzimmer')).ort;

  await t.test('ohne Stern gibt es keine Vorgabe', async () => {
    // Der Ausgangszustand, und er ist eine eigene Aussage: Eine Oberflaeche,
    // die hier einen Ort bekaeme, wuerde beim ersten Erfassen etwas
    // vorauswaehlen, das niemand gesetzt hat.
    assert.equal(await L.vorgabeVon(U.ich), null);
  });

  await t.test('der Stern setzt die Vorgabe und sie liest sich zurueck', async () => {
    const gesetzt = await L.setzeVorgabe(U.ich, estrich.id);
    assert.equal(gesetzt.name, 'Estrich');
    const gelesen = await L.vorgabeVon(U.ich);
    assert.equal(gelesen?.id, estrich.id);
    assert.equal(gelesen?.name, 'Estrich');
  });

  await t.test('ein zweiter Stern ersetzt den ersten', async () => {
    // Eine Vorgabe mit genau einem Wert: Zwei gleichzeitig waeren beim
    // Erfassen eine Frage ohne Antwort. Dass das ohne Zutun gilt, ist der
    // Gewinn aus der Ablage in user_settings (ein Schluessel, ein Wert).
    await L.setzeVorgabe(U.ich, keller.id);
    assert.equal((await L.vorgabeVon(U.ich))?.name, 'Keller');
    const n = (await db.get(
      `SELECT COUNT(*)::int c FROM user_settings WHERE user_id=$1 AND key=$2`,
      [U.ich, L.VORGABE_SCHLUESSEL])).c;
    assert.equal(n, 1, `${n} Zeilen fuer die Vorgabe — es darf genau eine geben`);
    await L.setzeVorgabe(U.ich, estrich.id);
  });

  await t.test('ein fremder Ort wird abgelehnt', async () => {
    // Das Kinderzimmer des Kindes ist nicht mein Regal (Migration 0020). Ohne
    // diese Grenze stuende mein Stern an einem Ort in einer anderen Wohnung.
    // Geprueft wird `e.code` und nicht der Text: Der erste Entwurf suchte
    // „lagerort_unbekannt" in der MELDUNG, und die lautet auf Deutsch
    // („Diesen Lagerort gibt es nicht (mehr)"). Die Zusicherung war damit
    // rot, obwohl die Absage kam — dieselbe Form wie in
    // lagerort-vorrat-db.test.js, deshalb jetzt auch dieselbe Schreibweise.
    await assert.rejects(() => L.setzeVorgabe(U.ich, fremd.id),
      e => String(e.code) === 'lagerort_unbekannt',
      'Ein fremder Ort liess sich als eigene Vorgabe setzen');
    assert.equal((await L.vorgabeVon(U.ich))?.name, 'Estrich',
      'Die abgelehnte Zuweisung hat die bestehende Vorgabe veraendert');
  });

  await t.test('UMBENENNEN: die Vorgabe bleibt und heisst neu', async () => {
    // Die Aussage, fuer die es diese Datei gibt. Es steht KEINE Zeile in
    // benenneOrtUm, die die Vorgabe nachzieht — es braucht sie nicht, weil
    // die ID gespeichert ist. Mit dem Namen waere das hier rot.
    await L.benenneOrtUm(U.ich, estrich.id, 'Dachboden');
    const v = await L.vorgabeVon(U.ich);
    assert.equal(v?.id, estrich.id, 'Die Vorgabe zeigt nach dem Umbenennen ins Leere');
    assert.equal(v?.name, 'Dachboden',
      'Die Vorgabe traegt noch den alten Namen — dann steht beim Erfassen ein ' +
      'Ort, den die Auswahlliste nicht mehr kennt');
    await L.benenneOrtUm(U.ich, estrich.id, 'Estrich');
  });

  await t.test('LOESCHEN: die Vorgabe ist weg, nicht kaputt', async () => {
    // Die zweite Aussage. Ein Ort laesst sich nur loeschen, wenn nichts darin
    // liegt (loescheOrt) — deshalb ein eigener, leerer Ort fuer diese Probe.
    const kiste = (await L.legeOrtAn(U.ich, 'Kiste 7')).ort;
    await L.setzeVorgabe(U.ich, kiste.id);
    assert.equal((await L.vorgabeVon(U.ich))?.name, 'Kiste 7');
    await L.loescheOrt(U.ich, kiste.id);
    assert.equal(await L.vorgabeVon(U.ich), null,
      'Nach dem Loeschen des Ortes meldet die Vorgabe noch etwas — sie heilt ' +
      'sich also nicht selbst, und die Oberflaeche waehlt einen Ort vor, den ' +
      'es nicht gibt');
    // Die verwaiste Zeile in user_settings darf bleiben: Sie ist stumm (der
    // JOIN findet nichts) und wird beim naechsten Stern ueberschrieben. Sie
    // aufzuraeumen waere genau der Code, den dieser Entwurf einspart.
    const rest = (await db.get(
      `SELECT value FROM user_settings WHERE user_id=$1 AND key=$2`,
      [U.ich, L.VORGABE_SCHLUESSEL]))?.value;
    assert.equal(rest, String(kiste.id),
      'Erwartet war die stumme, verwaiste Zeile — steht dort etwas anderes, ' +
      'stimmt die Begruendung in utils/lagerort.ts nicht mehr');
  });

  await t.test('der Stern laesst sich wieder abschalten', async () => {
    await L.setzeVorgabe(U.ich, keller.id);
    assert.equal((await L.vorgabeVon(U.ich))?.name, 'Keller');
    assert.equal(await L.setzeVorgabe(U.ich, null), null);
    assert.equal(await L.vorgabeVon(U.ich), null, 'Der Stern liess sich nicht loeschen');
    const n = (await db.get(
      `SELECT COUNT(*)::int c FROM user_settings WHERE user_id=$1 AND key=$2`,
      [U.ich, L.VORGABE_SCHLUESSEL])).c;
    assert.equal(n, 0, 'Die Einstellung steht noch da');
  });

  await db.pool.end().catch(() => {});
});
