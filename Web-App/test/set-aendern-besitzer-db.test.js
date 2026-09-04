/**
 * Kaufpreis und Zustand landen im selben Konto.
 *
 * ── Der Fehler, den das verhindert ──────────────────────────────────────────
 * updateSet() macht fuer beide dieselbe Bewegung: erst die sets-Zeile, dann
 * die Erfassung, die der Detail-Dialog bearbeitet (die neueste). Es waren
 * zwei Abschriften — und die zweite hatte ein anderes Konto eingesetzt: der
 * Preis-Zweig `ownerId`, der Zustands-Zweig `uid`.
 *
 * NACHGEMESSEN, bevor etwas geaendert wurde. Set UND Erfassung gehoeren dem
 * UNTERKONTO, geaendert wird vom Hauptkonto:
 *
 *     vorher                       sets: N/10   erfassung: N/10
 *     nach Preis 99 (Hauptkonto)   sets: N/99   erfassung: N/99
 *     nach Zustand U (Hauptkonto)  sets: N/99   erfassung: N/99   <- unveraendert
 *
 * Der Preis kam an, der Zustand verschwand STILL: `WHERE user_id =
 * <Aufrufer>` trifft keine Zeile. Kein Fehler, kein Hinweis — updateSet
 * meldete Erfolg.
 *
 * Das bleibt nicht bei der Plakette: effectiveCondition() (utils/financeCalc)
 * entscheidet, zu welchem Zustand der Marktpreis geholt wird. Ein Set, das
 * der Haushalt als gebraucht fuehrt, wurde weiter als neu bewertet.
 *
 * Die Regel stand schon da — in updateSet ueber der Stelle („ab hier zaehlt
 * der BESITZER der Zeile") und im Kopf von acquisition-scope-db.test.js. Sie
 * war nur an einem von zwei Zweigen angewandt. Deshalb steht sie jetzt in
 * EINER Funktion.
 *
 * ── Warum das ein Verhaltenstest ist ────────────────────────────────────────
 * Die Aussage ist „beide Aenderungen kommen an demselben Ort an". Am
 * Quelltext waere nur zu sehen, dass beide dieselbe Funktion rufen — und
 * nicht, ob dabei die richtige Zeile getroffen wird.
 *
 * Der Mengen-Zweig weicht BEWUSST ab (Marcos Vorgabe: „Die Anzahl soll immer
 * von allen angezeigt werden. Wenn ich diese erhoehe, soll es fuer meinen
 * Account einen neuen Kaufpreis-Eintrag erstellen"). Der letzte Teilschritt
 * haelt das ausdruecklich fest, damit es niemand „mit vereinheitlicht".
 *
 * Gegenproben: siehe am jeweiligen Teilschritt.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (Migrationen fuer account_links).
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

test('Kaufpreis und Zustand landen im Konto des Besitzers', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const HAUPT = `besitz-haupt-${process.pid}`, SUB = `besitz-sub-${process.pid}`;
  const SET = `60445-1`;
  const aufraeumen = async () => {
    await db.run('DELETE FROM set_acquisitions WHERE set_number=$1', [SET]).catch(() => {});
    await db.run('DELETE FROM sets WHERE set_number=$1', [SET]).catch(() => {});
    await db.run('DELETE FROM users WHERE username IN ($1,$2)', [HAUPT, SUB]).catch(() => {});
  };
  await aufraeumen();

  try {
    await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [HAUPT, SUB]);
    const hauptId = (await db.get('SELECT id FROM users WHERE username=$1', [HAUPT])).id;
    const subId   = (await db.get('SELECT id FROM users WHERE username=$1', [SUB])).id;
    await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [hauptId, subId]);

    // Set UND Erfassung gehoeren dem UNTERKONTO — wie im gemeldeten Fall.
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,condition,purchase_price)
                  VALUES ($1,$2,'Probe',1,'N',10)`, [subId, SET]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition)
                  VALUES ($1,$2,1,10,'N')`, [subId, SET]);

    const { updateSet } = _req('utils/setService.js');
    const stand = async () => ({
      set: await db.get('SELECT user_id, condition, purchase_price::float AS p FROM sets WHERE set_number=$1', [SET]),
      erf: await db.get('SELECT user_id, condition, purchase_price::float AS p FROM set_acquisitions WHERE set_number=$1', [SET]),
    });

    // 1. Der Preis — der Zweig, der schon vorher richtig lag.
    await updateSet(hauptId, SET, { purchase_price: 99 });
    let s = await stand();
    assert.equal(s.set.p, 99);
    assert.equal(s.erf.p, 99);

    // 2. Der Zustand — genau hier verschwand die Aenderung.
    //    Gegenprobe: in spiegleAufSetUndLetzteErfassung ownerId durch den
    //    Aufrufer ersetzt -> dieser Teilschritt rot.
    await updateSet(hauptId, SET, { condition: 'U' });
    s = await stand();
    assert.equal(s.set.condition, 'U',
      'Der Zustand des Sets bleibt auf N — die Aenderung hat keine Zeile getroffen ' +
      'und wurde trotzdem als Erfolg gemeldet');
    assert.equal(s.erf.condition, 'U', 'Die letzte Erfassung traegt den neuen Zustand nicht');

    // 3. Und beides steht weiterhin beim BESITZER, nicht beim Aufrufer.
    assert.equal(s.set.user_id, subId, 'Die Aenderung hat eine Zeile im falschen Konto angelegt');
    assert.equal(s.erf.user_id, subId);
    const fremde = await db.get(
      'SELECT COUNT(*)::int n FROM sets WHERE set_number=$1 AND user_id=$2', [SET, hauptId]);
    assert.equal(fremde.n, 0, 'Eine Preis- oder Zustandsaenderung hat eine eigene Zeile erzeugt');
  } finally {
    await aufraeumen();
    await db.pool.end();
  }
});

test('die Menge geht bewusst auf das eigene Konto', () => {
  // Marcos Vorgabe: „Die Anzahl soll immer von allen angezeigt werden. Wenn
  // ich diese erhoehe, soll es fuer meinen Account einen neuen Kaufpreis-
  // Eintrag erstellen." Der Mengen-Zweig weicht deshalb ABSICHTLICH vom
  // Besitzer ab. Das steht hier, damit es niemand „mit vereinheitlicht".
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'setService.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
  assert.match(code, /adjustAcquisitionsToQuantity\(uid, sn/,
    'Die Mengenanpassung laeuft nicht mehr auf das eigene Konto — dann erhoeht ' +
    'ein „+" den Bestand eines fremden Kontos');
  // Und Preis/Zustand gehen NICHT ueber den Aufrufer.
  assert.doesNotMatch(code, /UPDATE sets SET (?:purchase_price|condition)[^;]*\[\s*\w+,\s*uid,/,
    'Preis oder Zustand werden wieder mit der Aufrufer-ID geschrieben');
});

test('die Spiegelung auf Set und letzte Erfassung steht an einer Stelle', () => {
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
  assert.ok(dateien.length >= 40,
    `Nur ${dateien.length} Quelldateien gefunden — die Suche greift nicht mehr`);

  const stellen = [];
  for (const f of dateien) {
    const code = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
    // JEDE Fundstelle, nicht je Datei eine: Beim Gegenprobieren habe ich eine
    // zweite Abschrift in DERSELBEN Datei eingesetzt, und die Regel blieb
    // gruen — sie sammelte Dateinamen statt Vorkommen.
    for (const _ of code.matchAll(
      /UPDATE set_acquisitions SET[\s\S]{0,260}?ORDER BY created_at DESC, id DESC LIMIT 1/g))
      stellen.push(path.relative(ROOT, f));
  }
  assert.deepEqual(stellen, ['utils/setService.ts'],
    'Die letzte Erfassung wird an mehr als einer Stelle beschrieben — genau so ' +
    'sind Preis und Zustand mit verschiedenen Konten auseinandergelaufen');
});
