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

    // Der Fall, fuer den effectiveCondition() gebaut wurde: Die einzige
    // Erfassung sagt 'U', und die Vorgabe des Nutzers (DEFAULT_PRICE_CONDITION)
    // sagt 'N'. Bis Migration 0032 stand das 'N' zusaetzlich in
    // sets.condition — die Spalte ist weg, die Verwechslungsmoeglichkeit
    // zwischen Vorgabe und Erfassung bleibt.
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity)
                  VALUES ($1,$2,'Probe',1)`, [uid, SET]);
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
    // Gegenprobe: in priceForNewAcquisition den Zustand auf
    // DEFAULT_PRICE_CONDITION festnageln -> hier steht 'N' und 100.
    assert.equal(erf[1].condition, 'U',
      'Das neue Exemplar traegt die Vorgabe statt den Zustand der Erfassungen');
    assert.equal(erf[1].p, 20,
      'Das neue Exemplar hat den Neupreis bekommen, obwohl das Set gebraucht ist — ' +
      'das geht in Bestandswert und G&V ein');
  } finally {
    await aufraeumen();
    await db.pool.end();
  }
});

/**
 * ── Warum diese Regel umgeschrieben wurde ──────────────────────────────────
 *
 * Sie lautete: „Wer sets.condition liest, muss im selben Atemzug die
 * ERFASSUNGEN beruecksichtigen" — mit einem Selbstnachweis, der mindestens
 * drei Lesestellen verlangte. Nach Migration 0032 gibt es NULL, und der
 * Selbstnachweis haette gemeldet, dass die Suche nicht mehr greift. Er hatte
 * recht: Die Regel war fuer eine Spalte geschrieben, die es nicht mehr gibt.
 *
 * Die Nachfolgeregel ist strenger und braucht keinen Umkreis mehr: Die beiden
 * Spalten DUERFEN in Abfragen auf `sets` gar nicht mehr vorkommen.
 *
 * Dass sie auf einer fertig migrierten Datenbank auch wirklich fehlen, prueft
 * test/sets-ohne-kaufpreisspalte-db.test.js — und zwar gegen eine von null
 * aufgebaute Datenbank, denn nur dort ist die Aussage ueberhaupt pruefbar:
 * db/schema.sql legt die Spalten weiterhin an (Migration 0007 braucht sie),
 * und auf der gemeinsamen Test-Datenbank ruft jede Testdatei initSchema() auf.
 */
test('kein Quelltext liest Kaufpreis oder Zustand aus sets', () => {
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

  // Gesucht werden die Formen, in denen die zwei Spalten in diesem Baum
  // tatsaechlich vorkamen — GEFUNDEN, nicht erdacht (git log von Migration
  // 0032 nennt jede Stelle):
  //
  //   s.purchase_price / s.condition      die Finanzabfragen, mit Alias s
  //   sets.purchase_price=                die zwei Spiegel-Anweisungen
  //   SELECT condition FROM sets          priceForNewAcquisition
  //   SELECT purchase_price, condition FROM sets   adjustAcquisitionsToQuantity
  //   COALESCE(condition,'N') AS c … FROM sets     der Preisjob
  //   INSERT INTO sets (… purchase_price …)        die drei Schreibwege
  const verboten = [
    /\bs\.purchase_price\b/i,
    /\bs\.condition\b/i,
    /UPDATE sets SET (purchase_price|condition)\b/i,
    /SELECT\s+condition\s+FROM sets\b/i,
    /SELECT\s+purchase_price,\s*condition\s+FROM sets\b/i,
    /COALESCE\(condition,'N'\) AS c\s*\n?\s*FROM sets\b/i,
    /INSERT INTO sets \([^)]*\b(purchase_price|condition)\b/i,
  ];
  const treffer = [];
  let geprueft = 0;
  for (const f of dateien) {
    const code = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
    geprueft++;
    for (const r of verboten) {
      const m = code.match(r);
      if (m) treffer.push(`${path.relative(ROOT, f)}: ${m[0].replace(/\s+/g, ' ')}`);
    }
  }
  // Selbstnachweis mit GEMESSENER Zahl: Die Muster muessen auf einem Text, der
  // sie enthaelt, auch wirklich anschlagen — sonst waere die Regel leer wahr.
  const probe = `SELECT s.condition, s.purchase_price FROM sets s
    INSERT INTO sets (user_id,purchase_price) VALUES ($1,$2)`;
  const angeschlagen = verboten.filter(r => r.test(probe)).length;
  assert.equal(angeschlagen, 3,
    `Von den Mustern schlugen ${angeschlagen} auf der Probe an, erwartet 3 ` +
    '(s.condition, s.purchase_price, INSERT INTO sets mit purchase_price)');
  assert.ok(geprueft >= 40, `Nur ${geprueft} Dateien geprueft — die Suche greift nicht mehr`);
  assert.deepEqual(treffer, [],
    'Diese Stellen lesen oder schreiben Kaufpreis/Zustand auf der sets-Zeile. ' +
    'Beides steht seit Migration 0032 nur in set_acquisitions; genau aus dem ' +
    'Nebeneinander sind in diesem Baum achtmal dieselben Fehler entstanden.');
});
