/**
 * Der Papierkorb steht nur an SELBST hochgeladenen Anleitungen.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 * „Im Detail Dialog der Sets erscheint bei den Anleitungen ein Papierkorb. Der
 * Papierkorb soll nur bei den manuell hochgeladenen Anleitungen erscheinen.
 * Bei den Benutzer unabhängigen welche automatisch importiert wurden soll kein
 * Papierkorb angezeigt werden."
 *
 * ── Was der Server liefert und was daran fehlte ─────────────────────────────
 * getSet()/getSets() legen ZWEI Tabellen zu einer Liste zusammen:
 *
 *   shared_instructions — die automatische Suche (Rebrickable, Brickset, BDP,
 *                         BrickInstructions). Gilt fuer alle Konten.
 *   instructions        — was ein Konto selbst hochgeladen hat.
 *
 * Loeschen laesst sich nur die zweite: DELETE /api/v1/sets/:sn/instructions/:id
 * sucht ausschliesslich in `instructions` (routes/sets.ts).
 *
 * Die Android-App entschied ueber den Papierkorb an `id != null` — in der
 * Annahme, automatisch importierte Anleitungen haetten keine Kennung. Dieser
 * Test misst, dass die Annahme falsch war: BEIDE Zeilen bringen eine `id` mit,
 * und die Zaehler laufen unabhaengig voneinander. Ein Klick auf den Papierkorb
 * einer geteilten Anleitung konnte deshalb die gleichnamige EIGENE Anleitung
 * treffen.
 *
 * ── Was hier geprueft wird ──────────────────────────────────────────────────
 *  1. FUNKTIONAL: getSet() markiert jede Zeile mit `is_manual` — false fuer die
 *     geteilte, true fuer die hochgeladene. Dasselbe fuer getSets(), weil die
 *     Galerie-Kachel aus derselben Liste zaehlt.
 *  2. GEGENPROBE ZUR ALTEN REGEL: `id != null` trifft auf beide zu, taugt also
 *     nicht. Wird das gemessen und nicht behauptet, faellt der Test auf, falls
 *     jemand die alte Regel zurueckholt.
 *  3. AM QUELLTEXT: Beide Oberflaechen haengen den Knopf an `is_manual` und
 *     nicht mehr an einem eigenen Pfadvergleich. Die Regel soll an einer
 *     Stelle stehen — dem Server.
 *
 * Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
 * Ohne DB: skip. Ausfuehren: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, ohneKommentare } = require('./helpers/sources');
const _req = buildAndRequire();
const db = _req('db/database.js');
const { getSet, getSets } = _req('utils/handlers/sets.js');

test('Anleitungen: der Server sagt, welche selbst hochgeladen ist',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const USER = `anlh-${process.pid}`;
  // Endet auf "-<Ziffern>", damit mitVersion() nichts anhaengt: shared_
  // instructions wird unter der Nummer MIT Versionsanhang gelesen.
  const SN = `70999-${process.pid}`;

  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`DELETE FROM shared_instructions WHERE set_number=$1`, [SN]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;

  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity) VALUES ($1,$2,'Katzenburg',1)`,
    [uid, SN]);
  // Die automatische Suche: kein Konto, Datei unter /data/instructions/.
  await db.run(`INSERT INTO shared_instructions (set_number,url,description,local_path)
                VALUES ($1,$2,'Anleitung automatisch',$3)`,
    [SN, `https://example.invalid/${SN}.pdf`, `/data/instructions/${SN}_1.pdf`]);
  // Der eigene Upload: mit Konto, Datei unter /data/uploads/<id>/.
  await db.run(`INSERT INTO instructions (user_id,set_number,url,description,local_path)
                VALUES ($1,$2,$3,'Anleitung selbst',$3)`,
    [uid, SN, `/data/uploads/${uid}/${SN}_1.pdf`]);

  try {
    // ── 1. Detail: jede Zeile traegt ihre Herkunft ─────────────────────────
    const detail = await getSet(uid, SN);
    assert.ok(detail, 'Set nicht gefunden');
    assert.equal(detail.instructions.length, 2,
      'Es sollen beide Anleitungen ankommen — geteilt und selbst hochgeladen');

    const geteilt = detail.instructions.find(i => i.description === 'Anleitung automatisch');
    const eigene  = detail.instructions.find(i => i.description === 'Anleitung selbst');
    assert.ok(geteilt && eigene, 'Beide Anleitungen sollen in der Liste stehen');

    assert.equal(geteilt.is_manual, false,
      'Die automatisch importierte Anleitung ist NICHT selbst hochgeladen — kein Papierkorb');
    assert.equal(eigene.is_manual, true,
      'Die selbst hochgeladene Anleitung traegt is_manual=true — nur hier ein Papierkorb');

    // ── 2. Gegenprobe zur alten Regel: `id != null` trennt nichts ──────────
    //
    // Genau daran hing der Papierkorb bisher. Beide Zeilen haben eine Kennung,
    // und die Zaehler der beiden Tabellen sind voneinander unabhaengig — die
    // Nummern koennen sich also decken.
    assert.notEqual(geteilt.id, null,
      'Gemessen: auch die geteilte Anleitung bringt eine id mit — die alte Regel trennte nicht');
    assert.notEqual(eigene.id, null, 'Die eigene Anleitung bringt ebenfalls eine id mit');

    // ── 3. Liste: dieselbe Markierung, damit die Kachel gleich zaehlt ──────
    const { sets } = await getSets(uid, {});
    const inListe = sets.find(s => s.set_number === SN);
    assert.ok(inListe, 'Set fehlt in der Galerie');
    assert.deepEqual(
      inListe.instructions.map(i => i.is_manual).sort(),
      [false, true],
      'Auch die Galerie soll beide Herkuenfte unterscheiden');
  } finally {
    await db.run(`DELETE FROM shared_instructions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    // Ohne das bleibt der Verbindungspool offen und der Testlauf haengt bis
    // zur Zeitgrenze — so halten es alle DB-Tests hier.
    await db.pool.end().catch(() => {});
  }
});

test('Anleitungen: beide Oberflaechen haengen den Papierkorb an is_manual', () => {
  // ── Webapp ────────────────────────────────────────────────────────────────
  const galerie = ohneKommentare(
    fs.readFileSync(path.join(ROOT, 'public/js/02-gallery.js'), 'utf8'));

  assert.ok(/const isUpload = !!i\.is_manual;/.test(galerie),
    'Die Webapp soll die Herkunft vom Server nehmen, nicht selbst am Pfad ablesen');
  assert.ok(!/local_path\.startsWith\('\/data\/uploads\/'\)/.test(galerie),
    'Der Pfadvergleich war die zweite Fassung derselben Regel und soll weg sein');
  assert.ok(/\$\{isUpload \? `<button data-click="delInstr"/.test(galerie),
    'Der Loeschknopf der Webapp soll nur bei selbst hochgeladenen Anleitungen stehen');

  // ── Android-App ───────────────────────────────────────────────────────────
  const kt = path.join(ROOT, '..', 'Android-App/app/src/main/java/ch/brickinventoryapp');
  const abschnitte = fs.readFileSync(path.join(kt, 'ui/screens/SetDetailSections.kt'), 'utf8');
  const ohne = ohneKommentare(abschnitte);

  assert.ok(/if \(id != null && instr\.isManual\)/.test(ohne),
    'Der Papierkorb der App soll zusaetzlich isManual verlangen');
  // Der Knopf selbst muss innerhalb dieser Bedingung stehen — sonst waere die
  // Bedingung zwar da, der Knopf aber trotzdem an jeder Zeile.
  const abBedingung = ohne.slice(ohne.indexOf('if (id != null && instr.isManual)'));
  const bisLoeschen = abBedingung.indexOf('onAnleitungLoeschen');
  assert.ok(bisLoeschen > 0 && bisLoeschen < 400,
    'onAnleitungLoeschen soll unmittelbar in dieser Bedingung stehen');

  const modell = ohneKommentare(fs.readFileSync(path.join(kt, 'data/model/SetModels.kt'), 'utf8'));
  assert.ok(/@SerialName\("is_manual"\) val isManual: Boolean = false/.test(modell),
    'Instruction soll is_manual lesen und im Zweifel false annehmen (kein Papierkorb)');
});
