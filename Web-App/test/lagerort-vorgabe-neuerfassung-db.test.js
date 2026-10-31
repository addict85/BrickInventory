/**
 * Marcos Stern gilt auch dort, wo kein Formular steht.
 *
 * ── Marcos Befund vom 20.10. ────────────────────────────────────────────────
 *
 *   „Der Default Lagerort wird nicht gesetzt."
 *
 * GEMESSEN, bevor etwas geaendert wurde: Vorgabe auf „Kiste 7" gesetzt
 * (vorgabeVon lieferte sie), dann ein Teil und eine Figur so angelegt, wie es
 * der Wanted-Listen-Import tut — also ohne `storage`:
 *
 *     Vorgabe steht auf: {"id":1,"user_id":2,"name":"Kiste 7"}
 *     Teil   — Lagerort: null
 *     Figur  — Lagerort: null
 *
 * Der Stern wurde bis dahin ALLEIN im Browser eingelöst: ladeLagerortVorgabe()
 * in public/js/02-gallery.js befuellt die Felder der fuenf
 * Erfassungsformulare vor. Wer kein Formular benutzt — der Wanted-Import, der
 * CSV-Import, die API mit Token —, bekam nichts. Marcos Wunsch lautete aber
 * „bei einer Neuerfassung", nicht „in einem Formular".
 *
 * ── Die Unterscheidung, um die es hier eigentlich geht ──────────────────────
 *
 * Fehlt `storage` GANZ, hat niemand etwas gesagt → die Vorgabe gilt.
 * Kommt es LEER herein, hat jemand sie weggeraeumt → sie gilt nicht. Diese
 * zweite Haelfte ist die wichtigere: Eine Vorgabe, die sich in ein
 * ausdrueckliches „keiner" zurueckdraengt, waere ein Ort, den niemand
 * wegbekommt. Der Browser kann das jetzt sagen, weil selectedStorage() fuer
 * ein leeres Feld `''` liefert statt `undefined` (vorher fiel der Schluessel
 * aus dem Rumpf und ein geleertes Feld sah aus wie ein Import).
 *
 * Die drei PUT-Wege …/storage bleiben unberuehrt — dort heisst leer
 * „loeschen". Der letzte Fall unten prueft genau das.
 *
 * ── Was hier NICHT geprueft wird ────────────────────────────────────────────
 *
 * addSet(): Die Huelle holt den Ort auf demselben Weg (utils/setService.ts),
 * aber der Rumpf braucht Rebrickable, und in dieser Umgebung ist
 * rebrickable.com nicht erreichbar (ENOTFOUND). Geprueft ist deshalb
 * ortFuerNeuerfassung() selbst, mit genau den Werten, die addSet
 * durchreicht — nicht der Weg durch addSet hindurch.
 *
 * ── Gegenproben (am 20.10. GEMESSEN, Zahlen abgeschrieben) ──────────────────
 *
 * Ausgangslage: `# pass 8 / # fail 0` (sieben Faelle und ihre Huelle).
 *
 *   A  die drei Anlegehuellen auf normalisiereLagerort() zurueckgestellt
 *      (also der Stand von Marcos Befund)
 *      → `pass 5 / fail 3`. Rot sind ZWEI Faelle: „ein Teil ohne Ortangabe
 *        bekommt die Vorgabe" (`null statt 'Kiste 7'` — Marcos Befund in
 *        Zahlen) und „eine Figur ohne Ortangabe bekommt sie auch".
 *
 *        „Ein Set wuerde sie ebenfalls bekommen" bleibt dabei GRUEN, und das
 *        ist keine Nachlaessigkeit, sondern die Grenze dieses Falls: Er prueft
 *        ortFuerNeuerfassung() direkt, weil der Weg durch addSet() hier kein
 *        Rebrickable hat. Er sagt also etwas ueber den Wert, nicht darueber,
 *        dass addSet ihn holt. Wer die Huelle dort aendert, merkt es an dieser
 *        Pruefung NICHT — nachgewiesen eben hier.
 *   B  in ortFuerNeuerfassung() die Zeile `if (mitgegeben !== undefined …)`
 *      entfernt (also ein leeres Feld wieder wie Schweigen behandelt)
 *      → `pass 6 / fail 2`. Rot: „ein ausdruecklich geleertes Feld bleibt
 *        leer". Das ist die Haelfte, die den Stern erst brauchbar macht.
 *   C  `vorgabeVon` durch eine Fassung ohne den JOIN auf storage_locations
 *      ersetzt (nur die Zahl aus den Einstellungen)
 *      → `pass 6 / fail 2`. Rot: „eine Vorgabe, deren Ort geloescht wurde,
 *        gilt nicht". Die Heilung steckt im JOIN, nicht hier.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const db   = _req('db/database.js');

// Rebrickable vorgeben: Ohne Namen im Rumpf fragt addManualPart/addManualFig
// den Katalog und danach notfalls Rebrickable. Hier geht es um den Lagerort,
// nicht um den Namen — der Abruf soll nicht ueber das Netz greifen.
const rbPfad = require.resolve(path.join(ROOT, 'dist', 'clients/rebrickable.js'));
// Erst laden, dann ersetzen: Vor dem require gibt es den Eintrag im
// Zwischenspeicher nicht, und `require.cache[…].exports = …` lief auf
// `undefined` (als Zuweisungsziel wird die linke Seite zuerst aufgeloest).
const echtRb = require(rbPfad);
require.cache[rbPfad].exports = Object.assign({}, echtRb, {
  lookupPart:     async () => null,
  getMinifigInfo: async () => null,
});

test.after(async () => { await db.pool.end().catch(() => {}); });

test('die Lagerort-Vorgabe gilt bei jeder Neuerfassung', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  {
    const c = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  }

  const UID = (await db.get(
    `INSERT INTO users (username,password_hash) VALUES ('marco','x') RETURNING id`)).id;
  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES
                  ('3001','Brick 2 x 4'), ('3002','Brick 2 x 2'), ('3003','Brick 2 x 3'),
                  ('3004','Brick 1 x 2')`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,image_url) VALUES
                  ('3001',4,'https://cdn.example/a.jpg'), ('3002',4,'https://cdn.example/b.jpg'),
                  ('3003',4,'https://cdn.example/c.jpg'), ('3004',4,'https://cdn.example/d.jpg')`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name,image_url) VALUES
                  ('fig-000123','Chewbacca','https://cdn.example/e.jpg')`);
  await db.run(`INSERT INTO storage_locations (user_id,name) VALUES ($1,'Kiste 7'), ($1,'Kiste 3')`,
               [UID]);
  const ortId = async (name) =>
    (await db.get('SELECT id FROM storage_locations WHERE user_id=$1 AND name=$2', [UID, name])).id;

  const { setzeVorgabe, ortFuerNeuerfassung } = _req('utils/lagerort.js');
  const { addManualPart } = _req('utils/manuelleTeile.js');
  const { addManualFig }  = _req('utils/manuelleFiguren.js');

  await setzeVorgabe(UID, await ortId('Kiste 7'));

  const ortVonTeil = async (nr) => (await db.get(
    `SELECT l.name FROM parts p LEFT JOIN storage_locations l ON l.id = p.storage_id
      WHERE p.user_id=$1 AND p.part_number=$2`, [UID, nr]))?.name ?? null;

  await t.test('ein Teil ohne Ortangabe bekommt die Vorgabe', async () => {
    // Genau so ruft der Wanted-Import an (routes/api_v1/wanted.ts, `anleger`):
    // Nummer, Farbe, Menge, Zustand — kein storage.
    await addManualPart(UID, { part_number: '3001', color_id: 4, quantity: 1 });
    assert.equal(await ortVonTeil('3001'), 'Kiste 7');
  });

  await t.test('eine Figur ohne Ortangabe bekommt sie auch', async () => {
    await addManualFig(UID, { fig_number: 'fig-000123', quantity: 1 });
    const z = await db.get(
      `SELECT l.name FROM minifigs m LEFT JOIN storage_locations l ON l.id = m.storage_id
        WHERE m.user_id=$1 AND m.fig_number='fig-000123'`, [UID]);
    assert.equal(z?.name ?? null, 'Kiste 7');
  });

  await t.test('ein Set wuerde sie ebenfalls bekommen', async () => {
    // Nicht durch addSet hindurch — siehe den Kopf. Geprueft ist der Wert, den
    // die Huelle in utils/setService.ts aus demselben Aufruf erhaelt.
    assert.equal(await ortFuerNeuerfassung(UID, undefined), 'Kiste 7');
    assert.equal(await ortFuerNeuerfassung(UID, null), 'Kiste 7',
      'null kommt aus einem fehlenden Vorgabewert der Signatur und heisst ' +
      'dasselbe wie undefined: niemand hat etwas gesagt');
  });

  await t.test('ein mitgegebener Ort gewinnt gegen die Vorgabe', async () => {
    await addManualPart(UID, { part_number: '3002', color_id: 4, quantity: 1, storage: 'Kiste 3' });
    assert.equal(await ortVonTeil('3002'), 'Kiste 3');
  });

  await t.test('ein ausdruecklich geleertes Feld bleibt leer', async () => {
    await addManualPart(UID, { part_number: '3003', color_id: 4, quantity: 1, storage: '' });
    assert.equal(await ortVonTeil('3003'), null,
      'Das sendet ein Formular, in dem die vorbefuellte Vorgabe weggeraeumt ' +
      'wurde (selectedStorage in 02-gallery.js). Sie wieder einzusetzen waere ' +
      'ein Ort, den niemand wegbekommt');
  });

  await t.test('eine Vorgabe, deren Ort geloescht wurde, gilt nicht', async () => {
    await db.run('DELETE FROM storage_locations WHERE user_id=$1 AND name=$2', [UID, 'Kiste 7']);
    assert.equal(await ortFuerNeuerfassung(UID, undefined), null,
      'vorgabeVon() liest ueber einen JOIN auf den Vorrat — die Vorgabe heilt sich selbst');
    await addManualPart(UID, { part_number: '3004', color_id: 4, quantity: 1 });
    assert.equal(await ortVonTeil('3004'), null);
  });

  await t.test('ohne jede Vorgabe bleibt es beim alten Verhalten', async () => {
    await setzeVorgabe(UID, null);
    assert.equal(await ortFuerNeuerfassung(UID, undefined), null);
    assert.equal(await ortFuerNeuerfassung(UID, 'Kiste 3'), 'Kiste 3');
  });
});
