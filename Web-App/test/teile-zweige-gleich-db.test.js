/**
 * Die Teileliste hat ZWEI Wege — sie müssen dieselben Typen liefern.
 *
 * ── Was im Betrieb passiert ist ─────────────────────────────────────────────
 *
 * Marcos Android-App zeigte „Keine Teile", dazu die Meldung:
 *
 *     Expected valid boolean literal prefix, but had '0'
 *     at path: $.parts[0].is_spare      →    "is_spare":0
 *
 * Das Kotlin-Modell führt `is_spare` als Boolean. Ein einziger Zahlenwert
 * lässt die Verarbeitung der GANZEN Seite scheitern — deshalb blieb die Liste
 * leer statt lückenhaft.
 *
 * ── Warum es auf keiner Testinstallation zu sehen war ───────────────────────
 *
 * getParts() bedient sich aus zwei Quellen:
 *
 *   Live-Abfrage      → `is_spare: istErsatzteil(p.is_spare)`  → true/false
 *   Zusammenfassung   → Spalte roh aus parts_summary (INTEGER) → 0/1
 *
 * Welcher Weg antwortet, hängt allein davon ab, ob die Zusammenfassung frisch
 * ist. Ein NEUES Konto bekommt die Live-Abfrage und korrektes JSON; ein
 * gewachsenes bekommt die Zusammenfassung. Der Fehler entsteht also erst,
 * wenn der Hintergrundaufbau einmal durchgelaufen ist — und genau deshalb war
 * er weder lokal noch in der CI zu sehen, wo Konten immer frisch sind.
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Nicht nur `is_spare`. Geprüft wird die REGEL: Für dieselben Daten müssen
 * beide Wege für JEDES Feld denselben JSON-Typ liefern. Die Regel stand schon
 * im Baum, angewandt auf ein einzelnes Feld — der Kommentar an getParts sagt
 * „Der JSON-Typ von total_quantity darf nicht vom Zweig abhängen". Er gilt für
 * jedes Feld; für eines war es vergessen worden.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip.
 * Ausführen: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

let db, H, PS, skip = null;
try {
  const _req = require('./helpers/sources').buildAndRequire();
  process.env.DATABASE_URL = DB_URL;
  process.env.SESSION_SECRET = 'test';
  db = _req('db/database.js');
  H  = require('./helpers/sources').handlerModul(_req);
  PS = _req('utils/partsSummary.js');
} catch (e) { skip = e.message; }

const U = 990601;

test('beide Wege der Teileliste liefern dieselben Typen', async (t) => {
  if (skip) return t.skip(skip);
  try { await db.get('SELECT 1'); } catch { return t.skip('keine Test-Datenbank erreichbar'); }

  const aufraeumen = async () => {
    for (const tab of ['parts', 'sets', 'parts_summary', 'parts_summary_state'])
      await db.run(`DELETE FROM ${tab} WHERE user_id=$1`, [U]).catch(() => {});
  };

  try {
    await aufraeumen();
    await db.run("INSERT INTO users (id,username,password_hash) VALUES ($1,'zweige','x') ON CONFLICT (id) DO NOTHING", [U]);
    await db.run("INSERT INTO sets (user_id,set_number,quantity) VALUES ($1,'Z-1',1)", [U]);
    // Ein Ersatzteil UND ein gewöhnliches: Wäre nur eines dabei, könnte ein
    // Zweig zufällig richtig liegen, ohne die Umwandlung zu machen.
    await db.run(`INSERT INTO parts (user_id,set_number,part_number,color_id,color_name,part_name,quantity,source,is_spare)
                  VALUES ($1,'Z-1','3001',5,'Rot','Brick',3,'set','0'),
                         ($1,'Z-1','3002',1,'Blau','Plate',1,'set','1')`, [U]);

    const abfrage = { exclude_manual: '1', page: 1, page_size: 50 };

    // ── Weg 1: die Live-Abfrage (noch keine Zusammenfassung) ───────────────
    const live = await H.getParts(U, abfrage);
    assert.equal(live.source, 'db', 'ohne Zusammenfassung muss die Live-Abfrage antworten');

    // ── Weg 2: die Zusammenfassung ─────────────────────────────────────────
    await PS.rebuildNow(U);
    const zsf = await H.getParts(U, abfrage);
    assert.equal(zsf.source, 'summary', 'nach dem Aufbau muss die Zusammenfassung antworten');

    // ── Die Regel: gleiche Felder, gleiche Typen ───────────────────────────
    const typ = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
    const nach = liste => new Map(liste.map(p => [`${p.part_number}|${p.color_id}`, p]));
    const a = nach(live.parts), b = nach(zsf.parts);

    assert.ok(a.size > 0, 'die Live-Abfrage lieferte keine Teile — dann prüft der Vergleich nichts');
    assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(),
      'beide Wege müssen dieselben Teile liefern');

    const abweichungen = [];
    for (const [schluessel, links] of a) {
      const rechts = b.get(schluessel);
      for (const feld of Object.keys(links)) {
        if (!(feld in rechts)) continue;              // nur Felder, die BEIDE führen
        // null auf einer Seite ist kein Typkonflikt: Ein Feld darf leer sein.
        if (links[feld] === null || rechts[feld] === null) continue;
        if (typ(links[feld]) !== typ(rechts[feld]))
          abweichungen.push(`${schluessel} ${feld}: live=${typ(links[feld])} (${JSON.stringify(links[feld])}), `
            + `Zusammenfassung=${typ(rechts[feld])} (${JSON.stringify(rechts[feld])})`);
      }
    }
    assert.deepEqual(abweichungen, [],
      'Der JSON-Typ eines Feldes darf nicht davon abhängen, welcher Zweig antwortet — '
      + 'ein Client, der den einen Typ erwartet, scheitert sonst genau dann, wenn die '
      + 'Zusammenfassung zum ersten Mal frisch ist:\n  ' + abweichungen.join('\n  '));

    // ── Und is_spare im Besonderen ─────────────────────────────────────────
    // Die Regel oben wäre auch erfüllt, wenn BEIDE Wege eine Zahl lieferten —
    // die Android-App bräuchte dann trotzdem einen Boolean.
    for (const [name, liste] of [['Live-Abfrage', live.parts], ['Zusammenfassung', zsf.parts]])
      for (const p of liste)
        assert.equal(typeof p.is_spare, 'boolean',
          `${name}: is_spare ist ${typeof p.is_spare} (${JSON.stringify(p.is_spare)}) statt boolean — `
          + 'genau daran ist die Teileliste der App gescheitert');

    // Und der Wert stimmt auch: 3002 ist das Ersatzteil.
    assert.equal(b.get('3002|1').is_spare, true,  'das Ersatzteil muss als true herauskommen');
    assert.equal(b.get('3001|5').is_spare, false, 'das gewöhnliche Teil muss als false herauskommen');
  } finally {
    await aufraeumen();
    await db.run('DELETE FROM users WHERE id=$1', [U]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
