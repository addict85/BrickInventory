/**
 * Welchen Zustand holt der Preislauf für einen Merkposten?
 * Ausführlich: docs/begruendungen/test/merkposten-zustand-preislauf-db.test.js.md#kopf
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

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { haeltSet } = require('./helpers/bestand');
const db = _req('db/database.js');
const { zustaendeJeSet, conditionsNeededFor } = _req('src/finanzen/preisLauf.js');

/** Sortiert vergleichen: die Reihenfolge in der Menge ist keine Aussage. */
const sortiert = (a) => [...a].sort();

test('Preislauf: der Zustand eines Merkpostens ist der des Nutzers', { concurrency: 1 }, async (t) => {
  if (!await dbOderSkip(t, _req, { migrieren: false })) return;

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

    // Bestand ohne Merkposten: der Zustand kommt aus der Erfassung
    // Ausführlich: docs/begruendungen/test/merkposten-zustand-preislauf-db.test.js.md#stelle
    await haeltSet(db, a, '75192-1', 0);  // Menge 0: die Erfassung dahinter traegt sie
    await db.run(`INSERT INTO set_acquisitions (user_id, set_number, quantity, condition) VALUES ($1,'75192-1',1,'U')`, [a]);
    assert.deepEqual((await zustaendeJeSet(a, ['75192-1'])).get('75192-1'), ['U'],
      'der Zustand der Erfassung eines eigenen Sets entscheidet');

    // ── Bestand UND Merkposten im anderen Zustand: beide ────────────────────────
    // Wer ein Set neu besitzt und ein gebrauchtes zweites sucht, wartet auf den
    // Gebraucht-Preis. Den Neu-Preis braucht die Bewertung trotzdem.
    await haeltSet(db, a, '42100-1', 0);  // Menge 0: die Erfassung dahinter traegt sie
    await db.run(`INSERT INTO set_acquisitions (user_id, set_number, quantity, condition) VALUES ($1,'42100-1',1,'N')`, [a]);
    await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,'42100-1','U')`, [a]);
    assert.deepEqual(sortiert((await zustaendeJeSet(a, ['42100-1'])).get('42100-1')), ['N','U'],
      'Bestand und Merkposten in verschiedenen Zuständen ergeben beide Abrufe');

    // ── Der Zustand kommt aus der Erfassung ─────────────────────────────────
    //
    // Vorher lautete dieser Teilschritt „die Erfassungen schlagen die
    // sets-Zeile": sets sagte 'N', die Erfassung 'U', Ergebnis 'U'. Mit
    // Migration 0032 kann es diesen Widerspruch nicht mehr geben — es gibt nur
    // die Erfassung. Die Aussage bleibt: Sie entscheidet.
    await haeltSet(db, a, '10276-1', 0);  // Menge 0: die Erfassung dahinter traegt sie
    await db.run(`INSERT INTO set_acquisitions (user_id, set_number, quantity, condition) VALUES ($1,'10276-1',1,'U')`, [a]);
    assert.deepEqual((await zustaendeJeSet(a, ['10276-1'])).get('10276-1'), ['U'],
      'die Erfassung entscheidet ueber den zu holenden Preis');

    // ── Und eine Set-Zeile OHNE Erfassung faellt auf 'N' zurueck ────────────
    //
    // Den Fall soll es nach Migration 0032 nicht mehr geben (sie hat
    // nachgetragen und geprueft); hier wird er von Hand hergestellt. Wichtig
    // ist, dass dann 'N' herauskommt und nicht eine LEERE Liste — sonst wuerde
    // fuer dieses Set gar kein Preis geholt, und das faellt niemandem auf.
    await haeltSet(db, a, '31203-1', 1);
    assert.deepEqual((await zustaendeJeSet(a, ['31203-1'])).get('31203-1'), ['N'],
      'ohne Erfassung bleibt es beim Neu-Preis — eine leere Liste hiesse, ' +
      'dass fuer dieses Set gar kein Preis geholt wird');

    // ── Ein Set, das dieser Nutzer nirgends führt ───────────────────────────
    assert.deepEqual((await zustaendeJeSet(b, ['75192-1'])).get('75192-1'), ['N'],
      'was dieser Nutzer weder besitzt noch wünscht, fällt auf "neu" zurück');

    // ── Gebündelt und einzeln sind DIESELBE Regel ───────────────────────────
    // Sie standen vorher als zwei Fassungen da, und nur eine kannte die
    // Merkliste. Diese Zusicherung hält sie zusammen.
    for (const sn of ['10305-1','21318-1','75192-1','42100-1','10276-1','31203-1']) {
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
