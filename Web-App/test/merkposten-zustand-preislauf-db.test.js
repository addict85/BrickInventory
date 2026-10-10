/**
 * Welchen Zustand holt der Preislauf für einen Merkposten?
 *
 * ── Woher die Frage kommt ───────────────────────────────────────────────────
 * Marco: „Die Preise für die Merkliste sollen auch hier benutzerabhängig
 * sein." Die Währung war es schon (runPriceRefresh liest sie je Nutzer), der
 * ZUSTAND nicht: Die Schleife bestimmte ihn aus set_acquisitions und der
 * sets-Zeile — beides hat ein Merkposten nicht. Er fiel damit auf
 * DEFAULT_PRICE_CONDITION durch, und das ist 'U' (utils/finance/preise.ts).
 * Gemessen hiess das: Jeder Merkposten wurde als GEBRAUCHT geholt, auch der auf
 * ein neues Set — und der Verlauf im Merkposten-Detail füllte sich für den
 * falschen Zustand.
 *
 * ── Warum gegen eine echte Datenbank ────────────────────────────────────────
 * Die Regel liest aus DREI Tabellen mit einer Vorrangregel zwischen ihnen
 * (set_acquisitions → sets → wanted). Genau das Zusammenspiel ist die
 * Aussage; mit erfundenen Zeilen wäre davon nichts geprüft.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) Die wanted-Abfrage in zustaendeJeSet() entfernt → rot in Zeile 68,
 *      „der Merkposten desselben Sets bei einem anderen Nutzer als gebraucht".
 *      NICHT in der Zeile davor: Ohne Merkliste fällt die Funktion hier auf
 *      'N' zurück, und der erste Merkposten ist zufällig auch 'N'. Deshalb steht
 *      derselbe Merkposten zweimal da, einmal je Zustand — die Aussage
 *      „benutzerabhängig" ist erst mit beiden Nutzern geprüft.
 *   b) `for (const c of gewuenscht...)` nur im else-Zweig → „Bestand und
 *      Merkposten in verschiedenen Zuständen ergeben beide" wird rot.
 *   c) Die Erfassungen hinter den Bestand gestellt → „die Erfassungen schlagen
 *      die sets-Zeile" wird rot.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { zustaendeJeSet, conditionsNeededFor } = _req('jobs/priceJob.js');

/** Sortiert vergleichen: die Reihenfolge in der Menge ist keine Aussage. */
const sortiert = (a) => [...a].sort();

test('Preislauf: der Zustand eines Merkpostens ist der des Nutzers', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  // Eigene Nutzer je Prozess — der Test läuft neben anderen auf derselben DB.
  const anlegen = async (suffix) => (await db.get(
    `INSERT INTO users (username, password_hash) VALUES ($1,'x')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
     RETURNING id`, [`wzp_${process.pid}_${suffix}`])).id;
  const a = await anlegen('a');
  const b = await anlegen('b');

  try {
    // ── Zwei Nutzer, DASSELBE Set, verschiedene Merkposten ─────────────────────
    // Das ist die Frage in einer Zeile: Der Preislauf holt für a den Neupreis
    // und für b den Gebrauchtpreis — nicht für beide denselben.
    await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,'10305-1','N')`, [a]);
    await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,'10305-1','U')`, [b]);

    assert.deepEqual((await zustaendeJeSet(a, ['10305-1'])).get('10305-1'), ['N'],
      'ein Merkposten auf ein NEUES Set muss als neu geholt werden — vorher ergab die ' +
      'Vorgabe DEFAULT_PRICE_CONDITION hier still ein "U"');
    assert.deepEqual((await zustaendeJeSet(b, ['10305-1'])).get('10305-1'), ['U'],
      'und der Merkposten desselben Sets bei einem anderen Nutzer als gebraucht');

    // ── Beide Zustände gewünscht: beide Preise werden gebraucht ─────────────
    await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,'21318-1','N'),($1,'21318-1','U')`, [a]);
    assert.deepEqual(sortiert((await zustaendeJeSet(a, ['21318-1'])).get('21318-1')), ['N','U'],
      'neu und gebraucht sind zwei Merkposten — für beide braucht das Detail einen Preis');

    // ── Bestand ohne Merkposten: der Zustand kommt aus der Erfassung ────────
    //
    // Hier stand `INSERT INTO sets (… condition) VALUES (…,'U')` und die
    // Zusage „der gespeicherte Zustand eines eigenen Sets entscheidet
    // weiterhin". Die Spalte ist mit Migration 0032 weg; entschieden wird
    // ueber die Erfassung, und die Aussage bleibt dieselbe: Ein gebraucht
    // gehaltenes Set braucht den Gebraucht-Preis.
    await db.run(`INSERT INTO sets (user_id, set_number, quantity) VALUES ($1,'75192-1',1)`, [a]);
    await db.run(`INSERT INTO set_acquisitions (user_id, set_number, quantity, condition) VALUES ($1,'75192-1',1,'U')`, [a]);
    assert.deepEqual((await zustaendeJeSet(a, ['75192-1'])).get('75192-1'), ['U'],
      'der Zustand der Erfassung eines eigenen Sets entscheidet');

    // ── Bestand UND Merkposten im anderen Zustand: beide ────────────────────────
    // Wer ein Set neu besitzt und ein gebrauchtes zweites sucht, wartet auf den
    // Gebraucht-Preis. Den Neu-Preis braucht die Bewertung trotzdem.
    await db.run(`INSERT INTO sets (user_id, set_number, quantity) VALUES ($1,'42100-1',1)`, [a]);
    await db.run(`INSERT INTO set_acquisitions (user_id, set_number, quantity, condition) VALUES ($1,'42100-1',1,'N')`, [a]);
    await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,'42100-1','U')`, [a]);
    assert.deepEqual(sortiert((await zustaendeJeSet(a, ['42100-1'])).get('42100-1')), ['N','U'],
      'Bestand und Merkposten in verschiedenen Zuständen ergeben beide Abrufe');

    // ── Eine Set-Zeile ohne Erfassung liefert keinen Zustand mehr ───────────
    //
    // Vorher lautete dieser Teilschritt „die Erfassungen schlagen die
    // sets-Zeile": sets sagte 'N', die Erfassung 'U', Ergebnis 'U'. Mit
    // Migration 0032 kann es den Widerspruch nicht mehr geben. Geprueft wird
    // jetzt die Kehrseite — eine Set-Zeile ohne Erfassung (die es laut
    // Migration nicht geben soll, hier von Hand hergestellt) faellt auf 'N'
    // zurueck und holt nicht etwa gar keinen Preis.
    await db.run(`INSERT INTO sets (user_id, set_number, quantity) VALUES ($1,'10276-1',1)`, [a]);
    assert.deepEqual((await zustaendeJeSet(a, ['10276-1'])).get('10276-1'), ['N'],
      'ohne Erfassung bleibt es beim Neu-Preis — eine leere Liste hiesse, ' +
      'dass fuer dieses Set gar kein Preis geholt wird');

    // ── Ein Set, das dieser Nutzer nirgends führt ───────────────────────────
    assert.deepEqual((await zustaendeJeSet(b, ['75192-1'])).get('75192-1'), ['N'],
      'was dieser Nutzer weder besitzt noch wünscht, fällt auf "neu" zurück');

    // ── Gebündelt und einzeln sind DIESELBE Regel ───────────────────────────
    // Sie standen vorher als zwei Fassungen da, und nur eine kannte die
    // Merkliste. Diese Zusicherung hält sie zusammen.
    for (const sn of ['10305-1','21318-1','75192-1','42100-1','10276-1']) {
      assert.deepEqual(sortiert(await conditionsNeededFor(sn, a)),
                       sortiert((await zustaendeJeSet(a, [sn])).get(sn)),
        `conditionsNeededFor(${sn}) muss dasselbe sagen wie der Lauf`);
    }

    // ── Der Hinweis (Erfassung, die es noch nicht gibt) ─────────────────────
    assert.deepEqual(sortiert(await conditionsNeededFor('99999-1', a, 'U')), ['U'],
      'ohne Bestand entscheidet der Hinweis — sonst bekäme ein als gebraucht ' +
      'erfasstes Set den Neupreis als Kaufpreis');
    assert.deepEqual(sortiert(await conditionsNeededFor('10276-1', a, 'N')), ['N','U'],
      'der Hinweis tritt neben die vorhandenen Erfassungen, er ersetzt sie nicht');

    // ── Eine leere Liste fragt nicht nach ───────────────────────────────────
    assert.equal((await zustaendeJeSet(a, [])).size, 0,
      'ohne Sets darf keine Abfrage laufen — der Lauf ruft das für jeden Nutzer auf');
  } finally {
    for (const uid of [a, b]) {
      await db.run(`DELETE FROM wanted WHERE user_id=$1`, [uid]).catch(() => {});
      await db.run(`DELETE FROM set_acquisitions WHERE user_id=$1`, [uid]).catch(() => {});
      await db.run(`DELETE FROM sets WHERE user_id=$1`, [uid]).catch(() => {});
      await db.run(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {});
    }
    // Ohne das endet der Prozess nie: Der Pool hält offene Verbindungen, und
    // node:test wartet darauf.
    await db.pool.end().catch(() => {});
  }
});
