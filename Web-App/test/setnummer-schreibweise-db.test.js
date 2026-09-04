/**
 * Eine Set-Nummer wird ueberall gleich geschrieben.
 *
 * ── Der Fehler, den das verhindert ──────────────────────────────────────────
 * Die Zeile
 *
 *     setNumber.includes('-') ? setNumber : `${setNumber}-1`
 *
 * stand VIERUNDZWANZIGMAL im Baum, in zwoelf Dateien. Solange alle
 * Fundstellen sie gleich schreiben, faellt das nicht auf. Es reicht aber
 * eine, die es nicht tut — und dann suchen zwei Stellen unter verschiedenen
 * Namen nach derselben Sache.
 *
 * Genau das war der Fall bei der Frage „kennt BrickLink dafuer gar keinen
 * Preis?". Die Markierung schreibt clients/bricklink.ts unter der Nummer MIT
 * Anhang; die Vorpruefungen im Preis-Job und im Anfrageweg suchten unter der
 * ROHEN. NACHGEMESSEN, gleiche Markierung, gleiches Set:
 *
 *     Eingabe                Job                    Anfrageweg
 *     ohne Versionsanhang    error, 1 Abruf         wirft, 2 Abrufe
 *     mit  Versionsanhang    skipped_gear, 0        still,  0
 *
 * Drei BrickLink-Abrufe fuer ein Set, von dem im Katalog steht, dass es
 * keinen Preis hat — je Lauf, auf Kosten des Tageskontingents. Und der Job
 * zaehlte es als Fehler statt als uebersprungen.
 *
 * ── Warum das ein Verhaltenstest ist ────────────────────────────────────────
 * Die Aussage ist „beide Wege antworten gleich, egal wie der Aufrufer die
 * Nummer schreibt". Am Quelltext waere nur zu sehen, dass beide dieselbe
 * Funktion rufen — nicht, dass dabei dasselbe herauskommt.
 *
 * Gegenproben: siehe am jeweiligen Teilschritt.
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

// BrickLink vorgeben, BEVOR die Preiswege getPriceGuide herausziehen. Der
// echte Client wirft in genau dieser Lage — hier wird nur MITGEZAEHLT, wie
// oft ueberhaupt gefragt wird.
const blPfad = require.resolve(path.join(ROOT, 'dist', 'clients', 'bricklink.js'));
const echt = require(blPfad);
let abrufe = [];
require.cache[blPfad].exports = Object.assign({}, echt, {
  getPriceGuide: async (sn, cond) => {
    abrufe.push(`${sn}|${cond}`);
    throw new Error(`${sn} — kein BrickLink-Preis verfuegbar`);
  },
});

test('die Schreibweise einer Set-Nummer ist eine Regel', () => {
  const { mitVersion, ohneVersion, beideSchreibweisen } = _req('utils/setNummer.js');
  assert.equal(mitVersion('10179'), '10179-1');
  assert.equal(mitVersion('10179-1'), '10179-1');
  assert.equal(mitVersion('75192-2'), '75192-2');
  assert.equal(ohneVersion('10179'), '10179');
  assert.equal(ohneVersion('75192-2'), '75192');
  // Die beiden Kandidaten muessen VERSCHIEDEN sein, sonst fragt eine Abfrage
  // zweimal dasselbe — genau daran krankten drei Fundstellen.
  for (const eingabe of ['10179', '10179-1', '75192-2']) {
    const [a, b] = beideSchreibweisen(eingabe);
    assert.notEqual(a, b, `${eingabe}: zwei gleiche Kandidaten`);
    assert.equal(a, mitVersion(eingabe));
  }
});

test('der Katalog antwortet gleich, egal wie die Nummer geschrieben ist', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const BLANK = `g${process.pid}`;        // so fragt der Aufrufer
  const MITV  = `${BLANK}-1`;             // so legt clients/bricklink.ts es ab
  const aufraeumen = () =>
    db.run('DELETE FROM catalog_cache WHERE set_number = ANY($1)', [[BLANK, MITV]]).catch(() => {});
  await aufraeumen();

  try {
    // Die Markierung genau so schreiben, wie clients/bricklink.ts sie schreibt.
    await db.run(
      `INSERT INTO catalog_cache (set_number, name, bl_type, is_gear) VALUES ($1,$2,'NONE',1)
       ON CONFLICT (set_number) DO UPDATE SET bl_type='NONE', is_gear=1`, [MITV, `Set ${MITV}`]);

    const { fetchAndCachePrice } = _req('jobs/priceJob.js');
    const { fetchPrice } = _req('utils/financeCalc.js');

    // Gegenprobe: in utils/setNummer.ts das mitVersion() aus katalogEintrag()
    // entfernt -> die Zeile mit „ohne Versionsanhang" wird rot.
    for (const nummer of [BLANK, MITV]) {
      abrufe = [];
      const r = await fetchAndCachePrice(nummer, 'N', 'sold', 'EUR', 24);
      assert.equal(r, 'skipped_gear',
        `„${nummer}": Der Job fragt BrickLink, obwohl im Katalog steht, dass es ` +
        'keinen Preis gibt — und zaehlt das Ergebnis als Fehler statt als uebersprungen');
      assert.equal(abrufe.length, 0, `„${nummer}": ${abrufe.length} BrickLink-Abruf(e) umsonst`);

      abrufe = [];
      const p = await fetchPrice(nummer, 'N', 'sold', 'EUR', 24);
      assert.equal(p.no_price, true, `„${nummer}": Der Anfrageweg meldet keinen preislosen Eintrag`);
      assert.equal(abrufe.length, 0, `„${nummer}": ${abrufe.length} BrickLink-Abruf(e) umsonst`);
    }
  } finally {
    await aufraeumen();
    await db.pool.end();
  }
});

test('die Schreibweise wird nirgends noch einmal ausgerechnet', () => {
  // Gefunden, nicht aufgezaehlt.
  const dateien = [];
  const gehen = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'test', 'scripts'].includes(e.name) || e.name.startsWith('.')) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) gehen(abs);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) dateien.push(abs);
    }
  };
  gehen(ROOT);
  // Selbstnachweis: Faende die Suche nichts, waere die Regel leer wahr.
  assert.ok(dateien.length >= 40,
    `Nur ${dateien.length} Quelldateien gefunden — die Suche greift nicht mehr`);

  const eigene = [], vorpruefer = [];
  for (const f of dateien) {
    const code = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
    const rel = path.relative(ROOT, f);
    // ── Warum drei Muster ──────────────────────────────────────────────
    // Der erste Entwurf suchte NUR nach `.includes('-') ?`. Damit ging
    // utils/bricklinkLink.ts durch: Dort stand dieselbe Regel als
    // `/-\d+$/.test(n) ? n : `${n}-1``, also eine dritte Fassung — und die
    // Prueflung blieb gruen, obwohl die Regel weiter zweimal dastand.
    // Eine Suche, die nur EINE Schreibweise kennt, findet nur, was schon
    // gleich geschrieben ist.
    for (const m of [/\.includes\('-'\)\s*\?/,             // die haeufigste Fassung
                     /\/-\\d\+\$\/\.test\(/,                // bricklinkLink, setAdd, setService
                     /\?\s*[\w.]+\s*:\s*`\$\{[^}]+\}-1`/,     // die Ergaenzung selbst
                     /\.replace\(\/-(?:\\\\d|\[0-9\])\+\$\//])  // und das Abschneiden
      if (m.test(code)) { eigene.push(rel); break; }
    if (/SELECT is_gear, bl_type FROM catalog_cache/.test(code)) vorpruefer.push(rel);
  }
  // Zwei bewusste Ausnahmen, jede mit eigenem Grund und eigenem Test:
  // utils/setAdd.ts und utils/setService.ts tragen denselben Normalisierer
  // absichtlich doppelt — ein Import baute einen Kreis, und
  // set-add-exists-db.test.js fuehrt BEIDE Ruempfe isoliert aus, um sie zu
  // vergleichen. Ein Aufruf nach aussen waere dort nicht aufloesbar. Sie
  // schreiben seit der Vereinheitlichung dieselbe Regel wie setNummer.ts —
  // das prueft der Teilschritt darunter.
  assert.deepEqual(eigene, ['utils/setAdd.ts', 'utils/setNummer.ts', 'utils/setService.ts'],
    'Die Schreibweise wird woanders noch einmal ausgerechnet — genau so laufen ' +
    'zwei Stellen auseinander, die dasselbe meinen');

  // Und die beiden Ausnahmen sagen WORTGLEICH dasselbe wie die eine Stelle.
  // Vorher taten sie es nur beinahe: `!/-\d+$/.test(s)` hier gegen
  // `includes('-')` dort.
  const regel = /\/-\\d\+\$\/\.test\(/;
  for (const f of ['utils/setAdd.ts', 'utils/setService.ts', 'utils/setNummer.ts']) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
    assert.match(code, regel,
      `${f}: prueft nicht auf einen Versionsanhang — dann sagt der eine Weg ` +
      '"10179-a" und der andere "10179-a-1"');
  }
  assert.deepEqual(vorpruefer, ['utils/setNummer.ts'],
    'Der Katalog wird an mehr als einer Stelle gelesen');
});
