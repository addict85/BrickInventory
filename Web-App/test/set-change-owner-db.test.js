/**
 * Kaufpreis und Zustand landen im Konto des Besitzers, die Menge bewusst im eigenen.
 * Konten, Haushalt und Erfassung legen die Dienste an (helpers/fabrik.js).
 *
 * Gegenproben: siehe am jeweiligen Teilschritt. Für „die Menge geht bewusst auf das
 * eigene Konto“ (14.11.2026): in setService.ts `const ziel = … ? uid :` durch
 * `ownerId` ersetzt → rot (die neue Erfassung landete beim Unterkonto).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (Migrationen fuer account_links).
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const factory = require('./helpers/fabrik');
const db = testData();

test('Kaufpreis und Zustand landen im Konto des Besitzers', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const MAIN = `besitz-haupt-${process.pid}`,
    SUB = `besitz-sub-${process.pid}`;
  const SET = `60445-1`;
  const aufraeumen = async () => {
    await db.run('DELETE FROM set_acquisitions WHERE set_number=$1', [SET]).catch(() => {});
    await db.run('DELETE FROM sets WHERE set_number=$1', [SET]).catch(() => {});
    await db.run('DELETE FROM users WHERE username IN ($1,$2)', [MAIN, SUB]).catch(() => {});
  };
  await aufraeumen();

  try {
    const mainId = await factory.konto(MAIN);
    const subId = await factory.konto(SUB);
    await factory.subAccount(mainId, subId);
    // Set UND Erfassung gehoeren dem UNTERKONTO.
    await factory.setRecorded(subId, SET, { preis: 10, zustand: 'N' });

    const { changeSet } = require('./helpers/sources').areaPage('sets');
    // Kaufpreis und Zustand stehen in der Erfassung, die Menge ist ihre Summe.
    const stand = async () => ({
      set: await db.get(
        `SELECT s.user_id,
                COALESCE((SELECT SUM(a.quantity) FROM set_acquisitions a
                           WHERE a.user_id = s.user_id
                             AND a.set_number = s.set_number), 0)::int AS quantity
           FROM sets s WHERE s.set_number=$1`,
        [SET],
      ),
      erf: await db.get(
        'SELECT user_id, condition, purchase_price::float AS p FROM set_acquisitions WHERE set_number=$1',
        [SET],
      ),
    });

    // 1. Der Preis — der Zweig, der schon vorher richtig lag.
    await changeSet(mainId, SET, { purchase_price: 99 });
    let s = await stand();
    assert.equal(s.erf.p, 99, 'Die Erfassung traegt den neuen Preis nicht');

    // 2. Der Zustand — genau hier verschwand die Aenderung.
    //    Gegenprobe: in writeInLastEntry ownerId durch den Aufrufer
    //    ersetzt -> dieser Teilschritt rot (durchgefuehrt).
    await changeSet(mainId, SET, { condition: 'U' });
    s = await stand();
    assert.equal(
      s.erf.condition,
      'U',
      'Die letzte Erfassung traegt den neuen Zustand nicht — die Aenderung hat ' +
        'keine Zeile getroffen und wurde trotzdem als Erfolg gemeldet',
    );
    assert.equal(s.erf.p, 99, 'Die Zustandsaenderung hat den Preis mitgenommen');

    // 3. Und beides steht weiterhin beim BESITZER, nicht beim Aufrufer.
    assert.equal(s.set.user_id, subId, 'Die Aenderung hat eine Zeile im falschen Konto angelegt');
    assert.equal(s.erf.user_id, subId);
    const fremde = await db.get('SELECT COUNT(*)::int n FROM sets WHERE set_number=$1 AND user_id=$2', [SET, mainId]);
    assert.equal(fremde.n, 0, 'Eine Preis- oder Zustandsaenderung hat eine eigene Zeile erzeugt');

    // 4. Die Menge dagegen geht bewusst auf das EIGENE Konto: Wer erhöht, bekommt
    //    einen eigenen Kaufpreis-Eintrag, statt den Bestand eines anderen Kontos zu ändern.
    await changeSet(mainId, SET, { quantity: 2 });
    const je = await db.all(
      'SELECT user_id, SUM(quantity)::int AS n FROM set_acquisitions WHERE set_number=$1 GROUP BY user_id ORDER BY user_id',
      [SET],
    );
    assert.deepEqual(
      je.map((/** @type {any} */ z) => [z.user_id, z.n]),
      [
        [mainId, 1],
        [subId, 1],
      ].sort((a, b) => a[0] - b[0]),
      'ohne Angabe eines Kontos landet die neue Menge beim Aufrufer',
    );
  } finally {
    await aufraeumen();
    await db.pool.end();
  }
});

// Der Name lautete „die Spiegelung auf Set und letzte Erfassung steht an einer
// Stelle". Gespiegelt wird seit Migration 0032 nichts mehr — geschrieben wird
// nur noch die letzte Erfassung. Die Regel selbst ist unveraendert richtig und
// sogar wichtiger geworden: Sie ist jetzt der EINZIGE Schreibweg.
test('die letzte Erfassung wird an genau einer Stelle beschrieben', () => {
  // Gefunden, nicht aufgezaehlt.
  const dateien = [];
  const gehen = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'test', 'scripts'].includes(e.name) || e.name.startsWith('.')) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) gehen(abs);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) dateien.push(abs);
    }
  };
  gehen(ROOT);
  assert.ok(dateien.length >= 40, `Nur ${dateien.length} Quelldateien gefunden — die Suche greift nicht mehr`);

  const stellen = [];
  for (const f of dateien) {
    const code = fs
      .readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '');
    // JEDE Fundstelle, nicht je Datei eine: Beim Gegenprobieren habe ich eine
    // zweite Abschrift in DERSELBEN Datei eingesetzt, und die Regel blieb
    // gruen — sie sammelte Dateinamen statt Vorkommen.
    for (const _ of code.matchAll(
      /UPDATE set_acquisitions SET[\s\S]{0,260}?ORDER BY created_at DESC, id DESC LIMIT 1/g,
    ))
      stellen.push(path.relative(ROOT, f));
  }
  assert.deepEqual(
    stellen,
    ['src/inventory/repository/purchases.ts'],
    'Die letzte Erfassung wird an mehr als einer Stelle beschrieben — genau so ' +
      'sind Preis und Zustand mit verschiedenen Konten auseinandergelaufen',
  );
});
