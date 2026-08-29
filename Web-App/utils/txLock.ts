/**
 * Serialisierung nebenläufiger Mutationen an derselben Bestandszeile.
 *
 * ── Wozu das da ist ─────────────────────────────────────────────────────────
 * Die Erfassungslogik (set_acquisitions / part_acquisitions) ist durchgehend
 * "lesen, rechnen, schreiben": Prüfen ob die Erfassung dem Nutzer gehört,
 * Summe aus allen Erfassungen bilden, löschen, Summe nach sets.quantity
 * zurückspiegeln. Das sind drei bis fünf getrennte Statements.
 *
 * Ohne Transaktion können sich zwei parallele Anfragen — Webapp und
 * Android-App reden gleichzeitig mit dem Server, und der läuft im Cluster mit
 * mehreren Prozessen — gegenseitig überholen: Beide lesen denselben alten
 * Stand, beide berechnen ihre Summe, die zweite schreibt die erste tot.
 * Danach passt sets.quantity nicht mehr zu set_acquisitions, und weil die
 * Spalte denormalisiert ist, fällt der Drift erst in der Finanzauswertung auf.
 *
 * ── Warum Advisory-Locks und keine Zeilensperre ─────────────────────────────
 * SELECT … FOR UPDATE auf sets würde nur helfen, wenn eine Zeile in sets
 * überhaupt existiert. Beim Anlegen der allerersten Erfassung tut sie das
 * nicht — genau dann bräuchte man die Sperre aber auch. Ein Advisory-Lock auf
 * dem Schlüssel (userId, setNumber) sperrt den logischen Vorgang statt einer
 * physischen Zeile und deckt beide Fälle ab.
 *
 * pg_advisory_xact_lock gibt den Lock beim COMMIT oder ROLLBACK automatisch
 * frei — auch wenn der Prozess dazwischen abstürzt. Es kann also kein Lock
 * hängenbleiben.
 */
import * as db from '../db/database';

/**
 * Führt fn in einer Transaktion aus, die exklusiven Zugriff auf den
 * angegebenen Bestandsschlüssel hat.
 *
 * Innerhalb von fn MUSS die übergebene Datenbank-Schnittstelle (tx) benutzt
 * werden. Wer dort das Modul `db` direkt anspricht, läuft auf einer anderen
 * Verbindung — ausserhalb der Transaktion und ausserhalb der Sperre.
 *
 * @template T
 * @param {number} userId
 * @param {string} scopeKey Bestandsschlüssel, z. B. die Set- oder Teilenummer
 * @param {(tx: any) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withInventoryLock(userId: number, scopeKey: string | number, fn: (tx: any) => any) {
  return db.transaction(async (tx: any) => {
    // hashtext() liefert int4 — zusammen mit der userId ergibt das den
    // zweiteiligen Lock-Schlüssel. Kollisionen zweier verschiedener Sets
    // desselben Nutzers sind theoretisch möglich und harmlos: Dann
    // serialisieren zwei Vorgänge, die es nicht müssten.
    await tx.run('SELECT pg_advisory_xact_lock($1, hashtext($2))', [userId, String(scopeKey)]);
    return fn(tx);
  });
}

export { withInventoryLock };
