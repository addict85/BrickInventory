/**
 * Ein Rebrickable-Inventar wird ueberall nach denselben Kandidaten gesucht.
 *
 * ── Der Fehler, den das verhindert ──────────────────────────────────────────
 * `SELECT id FROM rb_inventories WHERE set_num=$1 OR set_num=$2 ORDER BY
 * version DESC LIMIT 1` stand an ACHT Stellen. Das SQL war ueberall gleich —
 * die beiden Kandidaten nicht. Fuer die Eingabe „9999" (Set-Nummer ohne
 * Versionsanhang) ergab sich:
 *
 *   jobs/catalogSync, jobs/partsCatalogEnrich,
 *   clients/rebrickable, routes/api_v1/sets (2x)   '9999-1' ODER '9999'
 *   utils/handlers/parts.ts                        '9999-1' ODER '9999-1'
 *   routes/api_v1/catalog.ts                       nur '9999-1'
 *
 * Die beiden Abweichler finden eine Zeile, die unter der blanken Nummer
 * abgelegt ist, also nicht — die anderen sechs schon. In parts.ts war der
 * zweite Kandidat sogar wortgleich mit dem ersten: Die Abfrage fragte zweimal
 * dasselbe. Und in catalog.ts stand ueber der einkandidatigen Fassung
 * „analog catalogSync", waehrend catalogSync zwei prueft.
 *
 * In parts.ts schlug dieselbe Fehlbildung noch ein zweites Mal durch: Die
 * Rebrickable-Ersatzquelle laeuft darunter ueber `for (const sn of [n, alt])`
 * und holte damit denselben Satz zweimal ueber die Leitung — ein Abruf des
 * dortigen Tageskontingents fuer nichts.
 *
 * ── Warum das ein Verhaltenstest ist ────────────────────────────────────────
 * Die Aussage ist „eine unter der blanken Nummer abgelegte Zeile wird
 * gefunden". Am Quelltext waere nur zu sehen, dass alle dieselbe Funktion
 * rufen — nicht, dass die das Richtige sucht.
 *
 * Gegenproben (durchgefuehrt): siehe unten am jeweiligen Teilschritt.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { neuestesInventar, inventarKandidaten } = _req('utils/rbInventar.js');

test('ein Inventar wird unter beiden Schreibweisen gefunden', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  // rb_inventories.id ist kein SERIAL — die Nummern kommen aus der CSV.
  const idBlank = 900000 + (process.pid % 10000) * 2;
  const idMitV  = idBlank + 1;
  const NR      = `${9000000 + (process.pid % 100000)}`;
  const aufraeumen = () =>
    db.run('DELETE FROM rb_inventories WHERE id = ANY($1)', [[idBlank, idMitV]]).catch(() => {});
  await aufraeumen();

  try {
    // 1. Nur unter der BLANKEN Nummer abgelegt — genau der Fall, den die
    //    beiden Abweichler verfehlten.
    //    Gegenprobe: den zweiten Kandidaten in inventarNachKandidaten auf den
    //    ersten gesetzt (die alte parts.ts-Bildung) → dieser Teilschritt rot.
    await db.run('INSERT INTO rb_inventories (id, set_num, version) VALUES ($1,$2,1)', [idBlank, NR]);
    assert.equal(await neuestesInventar(NR), idBlank,
      'Eine unter der blanken Nummer abgelegte Zeile wird nicht gefunden');
    assert.equal(await neuestesInventar(`${NR}-1`), idBlank,
      'Auch mit Versionsanhang in der Eingabe muss die blanke Zeile gefunden werden');

    // 2. Liegt beides vor, gewinnt die hoechste version — nicht die blanke.
    await db.run('INSERT INTO rb_inventories (id, set_num, version) VALUES ($1,$2,2)', [idMitV, `${NR}-1`]);
    assert.equal(await neuestesInventar(NR), idMitV);

    // 3. Die Kandidatenregel selbst: zwei VERSCHIEDENE Namen, sonst ist das
    //    `OR set_num=$2` sinnlos. Genau daran krankte parts.ts.
    //    Gegenprobe: Regel auf die alte parts.ts-Fassung zurueckgestellt
    //    → dieser Teilschritt rot ('9999-1' zweimal).
    assert.deepEqual(inventarKandidaten('9999'),   ['9999-1', '9999']);
    assert.deepEqual(inventarKandidaten('9999-1'), ['9999-1', '9999']);
    assert.deepEqual(inventarKandidaten('75192-2'), ['75192-2', '75192']);
    const [a, b] = inventarKandidaten('9999');
    assert.notEqual(a, b, 'Zwei gleiche Kandidaten fragen zweimal dasselbe');
  } finally {
    await aufraeumen();
    await db.pool.end();
  }
});

test('der Inventar-Nachschlag steht nur an einer Stelle', () => {
  // Gefunden, nicht aufgezaehlt.
  const dateien = [];
  const gehen = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'test'
          || e.name === 'scripts' || e.name.startsWith('.')) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) gehen(abs);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) dateien.push(abs);
    }
  };
  gehen(ROOT);
  // Selbstnachweis: Faende die Suche nichts, waere die Regel leer wahr.
  assert.ok(dateien.length >= 40,
    `Nur ${dateien.length} Quelldateien gefunden — die Suche greift nicht mehr`);

  const stellen = [];
  for (const f of dateien) {
    const code = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
    // Nur der Nachschlag EINER Zeile. Die Sammelabfrage in
    // partsCatalogEnrich (WHERE set_num = ANY(...), ohne LIMIT) beantwortet
    // eine andere Frage und bleibt, wo sie ist.
    for (const m of code.matchAll(/FROM rb_inventories[\s\S]{0,200}?LIMIT 1/g))
      stellen.push(path.relative(ROOT, f) + (m ? '' : ''));
  }
  // Gegenprobe: den alten SELECT in routes/api_v1/catalog.ts wieder
  // eingesetzt → rot.
  assert.deepEqual(stellen, ['utils/rbInventar.ts'],
    'Der Inventar-Nachschlag steht an mehr als einer Stelle — genau daran sind ' +
    'vier verschiedene Kandidatenregeln entstanden');
});
