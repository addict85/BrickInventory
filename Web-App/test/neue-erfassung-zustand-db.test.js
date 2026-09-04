/**
 * Ein neues Exemplar bekommt den Zustand, den das Set WIRKLICH hat.
 *
 * ── Der Fehler, den das verhindert ──────────────────────────────────────────
 * utils/setService.ts → priceForNewAcquisition() las
 *
 *     SELECT condition FROM sets WHERE user_id=$1 AND set_number=$2
 *
 * also nur den GESPEICHERTEN Wert. jobs/priceJob.ts → conditionsNeededFor()
 * fragt an derselben Stelle zuerst die ERFASSUNGEN und nimmt den
 * gespeicherten Wert nur, wenn es keine gibt. Zwei Antworten auf dieselbe
 * Frage.
 *
 * Weicht der gespeicherte Wert von den Erfassungen ab — genau der Fall, fuer
 * den effectiveCondition() gebaut wurde ("etwa weil ein Set nachtraeglich auf
 * Neu korrigiert wurde") —, bekam das neue Exemplar den falschen Marktpreis.
 *
 * NACHGEMESSEN, sets.condition='N', einzige Erfassung 'U',
 * Marktpreis U=20 / N=100, danach Menge von 1 auf 2:
 *
 *     vorher   [{U, 10}]
 *     nachher  [{U, 10}, {N, 100}]   <- Neupreis fuer ein gebrauchtes Set
 *     jetzt    [{U, 10}, {U,  20}]
 *
 * Das ist Geld, nicht nur eine Plakette: Der Kaufpreis der neuen Erfassung
 * geht in Bestandswert und G&V ein.
 *
 * Dieselbe Verwechslung — gespeicherter Wert gegen das, was die Erfassungen
 * sagen — ist in diesem Baum jetzt zum achten Mal aufgetreten. Deshalb geht
 * sie hier durch resolveSetCondition(), die eine Stelle, an der die Regel
 * steht.
 *
 * ── Warum das ein Verhaltenstest ist ────────────────────────────────────────
 * Die Aussage ist "das neue Exemplar traegt den Zustand des Sets und den dazu
 * passenden Preis". Am Quelltext waere nur zu sehen, dass dieselbe Funktion
 * gerufen wird — nicht, was dabei herauskommt.
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

test('ein neues Exemplar folgt den Erfassungen, nicht dem gespeicherten Wert', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const U = `neuzust-${process.pid}`, SET = '60445-1';
  const aufraeumen = async () => {
    await db.run('DELETE FROM set_acquisitions WHERE set_number=$1', [SET]).catch(() => {});
    await db.run('DELETE FROM sets WHERE set_number=$1', [SET]).catch(() => {});
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SET]).catch(() => {});
    await db.run('DELETE FROM users WHERE username=$1', [U]).catch(() => {});
  };
  await aufraeumen();

  try {
    await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [U]);
    const uid = (await db.get('SELECT id FROM users WHERE username=$1', [U])).id;

    // Der Fall, fuer den effectiveCondition() gebaut wurde: Die sets-Zeile
    // sagt 'N', die einzige Erfassung sagt 'U'.
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,condition)
                  VALUES ($1,$2,'Probe',1,'N')`, [uid, SET]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
                  VALUES ($1,$2,1,10,'U', NOW() - INTERVAL '2 days')`, [uid, SET]);
    // Preise fuer BEIDE Zustaende — sonst waere der Unterschied unsichtbar.
    for (const [c, p] of [['N', 100], ['U', 20]])
      await db.run(`INSERT INTO price_cache (set_number,condition,currency_code,min_price,avg_price,max_price,qty_avg_price,total_quantity,fetched_at)
                    VALUES ($1,$2,'EUR',$3,$3,$3,$3,5,NOW())
                    ON CONFLICT (set_number,condition,currency_code) DO UPDATE SET avg_price=$3`, [SET, c, p]);

    const { updateSet } = _req('utils/setService.js');
    await updateSet(uid, SET, { quantity: 2 });

    const erf = await db.all(
      `SELECT condition, purchase_price::float AS p FROM set_acquisitions
        WHERE user_id=$1 AND set_number=$2 ORDER BY created_at ASC, id ASC`, [uid, SET]);
    assert.equal(erf.length, 2, 'Die Mengenerhoehung hat keine neue Erfassung angelegt');
    // Gegenprobe: in priceForNewAcquisition wieder `SELECT condition FROM
    // sets` -> hier steht 'N' und 100.
    assert.equal(erf[1].condition, 'U',
      'Das neue Exemplar traegt den gespeicherten Zustand statt den der Erfassungen');
    assert.equal(erf[1].p, 20,
      'Das neue Exemplar hat den Neupreis bekommen, obwohl das Set gebraucht ist — ' +
      'das geht in Bestandswert und G&V ein');
  } finally {
    await aufraeumen();
    await db.pool.end();
  }
});

test('der Zustand eines Sets wird nirgends mehr direkt aus sets gelesen', () => {
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

  // Die Regel ist NICHT "wer darf sets.condition lesen" (das waere eine
  // Aufzaehlung), sondern: Wer ihn liest, muss im selben Atemzug die
  // ERFASSUNGEN beruecksichtigen. Der gespeicherte Wert ist der Rueckfall,
  // nicht die Antwort.
  const ohneErfassungen = [];
  let gelesen = 0;
  for (const f of dateien) {
    const code = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
    // Zwei Formen: die einzeilige `SELECT condition FROM sets` und die
    // mehrzeilige in financeCalc (`SELECT s.condition, COUNT(...) …`).
    for (const m of code.matchAll(/SELECT\s+condition\s+FROM sets\b|SELECT\s+s\.condition,/gi)) {
      gelesen++;
      // Der Umkreis: 40 Zeilen davor und danach. Kommt darin keine der
      // Erfassungs-Regeln vor, steht der gespeicherte Wert allein da.
      const zeilen = code.slice(0, m.index).split('\n').length;
      const alle = code.split('\n');
      const umkreis = alle.slice(Math.max(0, zeilen - 40), zeilen + 40).join('\n');
      if (!/set_acquisitions|getSetConditionAggregate|effectiveCondition|acq_count/.test(umkreis))
        ohneErfassungen.push(`${path.relative(ROOT, f)}:${zeilen}`);
    }
  }
  // Selbstnachweis: Faende die Suche keine einzige Lesestelle, waere die
  // Regel leer wahr.
  assert.ok(gelesen >= 3,
    `Nur ${gelesen} Lesestellen gefunden — die Suche greift nicht mehr`);
  assert.deepEqual(ohneErfassungen, [],
    'Hier steht der gespeicherte Zustand ALLEIN — genau daraus ist in diesem ' +
    'Baum achtmal derselbe Fehler entstanden');
});
