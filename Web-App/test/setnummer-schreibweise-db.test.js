/**
 * Eine Set-Nummer wird ueberall gleich geschrieben.
 * Ausführlich: docs/begruendungen/test/setnummer-schreibweise-db.test.js.md#kopf
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

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');

// BrickLink vorgeben, BEVOR die Preiswege getPriceGuide herausziehen. Der
// echte Client wirft in genau dieser Lage — hier wird nur MITGEZAEHLT, wie
// oft ueberhaupt gefragt wird.
const blPfad = require.resolve(path.join(ROOT, 'dist', 'src/katalog/bricklinkPreise.js'));
const echt = require(blPfad);
let abrufe = [];
require.cache[blPfad].exports = Object.assign({}, echt, {
  getPriceGuide: async (sn, cond) => {
    abrufe.push(`${sn}|${cond}`);
    throw new Error(`${sn} — kein BrickLink-Preis verfuegbar`);
  },
});

test('die Schreibweise einer Set-Nummer ist eine Regel', () => {
  const { mitVersion, ohneVersion } = _req('src/infra/setNummer.js');
  assert.equal(mitVersion('10179'), '10179-1');
  assert.equal(mitVersion('10179-1'), '10179-1');
  assert.equal(mitVersion('75192-2'), '75192-2');
  assert.equal(ohneVersion('10179'), '10179');
  assert.equal(ohneVersion('75192-2'), '75192');
});

test('der Katalog antwortet gleich, egal wie die Nummer geschrieben ist', { concurrency: 1 }, async (t) => {
  if (!await dbOderSkip(t, _req, { migrieren: false })) return;

  const BLANK = `g${process.pid}`;        // so fragt der Aufrufer
  const MITV  = `${BLANK}-1`;             // so legt clients/bricklink.ts es ab
  const aufraeumen = () =>
    db.run('DELETE FROM catalog_cache WHERE set_number = ANY($1)', [[BLANK, MITV]]).catch(() => {});
  await aufraeumen();

  try {
    // Die Markierung genau so schreiben, wie clients/bricklink.ts sie schreibt.
    await db.run(
      `INSERT INTO catalog_cache (set_number, name, bl_type, is_gear) VALUES ($1,$2,'NONE',true)
       ON CONFLICT (set_number) DO UPDATE SET bl_type='NONE', is_gear=true`, [MITV, `Set ${MITV}`]);

    const { fetchAndCachePrice } = _req('jobs/priceJob.js');
    const { fetchPrice } = _req('src/finanzen/financeCalc.js');

    // Gegenprobe: in src/infra/setNummer.ts das mitVersion() aus katalogEintrag()
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
    // Warum drei Muster
    // Ausführlich: docs/begruendungen/test/setnummer-schreibweise-db.test.js.md#for-stelle
    for (const m of [/\.includes\('-'\)\s*\?/,             // die haeufigste Fassung
                     /\/-\\d\+\$\/\.test\(/,                // bricklinkLink, setAdd, setService
                     /\?\s*[\w.]+\s*:\s*`\$\{[^}]+\}-1`/,     // die Ergaenzung selbst
                     /\.replace\(\/-(?:\\\\d|\[0-9\])\+\$\//])  // und das Abschneiden
      if (m.test(code)) { eigene.push(rel); break; }
    if (/SELECT is_gear, bl_type(?:, fetched_at)? FROM catalog_cache/.test(code)) vorpruefer.push(rel);
  }
  // KEINE Ausnahmen mehr. src/sets/setAdd.ts und src/sets/setService.ts trugen den
  // Normalisierer zuletzt noch absichtlich doppelt, mit zwei Begruendungen:
  // ein Import baue einen Kreis, und set-add-exists-db.test.js fuehre beide
  // Ruempfe ISOLIERT aus. Beides galt nicht mehr — der Kreis war zwischen …
  // Ausführlich: docs/begruendungen/test/setnummer-schreibweise-db.test.js.md#stelle
  assert.deepEqual(eigene, ['src/infra/setNummer.ts'],
    'Die Schreibweise wird woanders noch einmal ausgerechnet — genau so laufen ' +
    'zwei Stellen auseinander, die dasselbe meinen');
  assert.deepEqual(vorpruefer, ['src/katalog/repository/katalogCache.ts'],
    'Der Katalog wird an mehr als einer Stelle gelesen');
});
