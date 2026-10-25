/**
 * Serialisierung nebenläufiger Mutationen an derselben Bestandszeile.
 * Ausführlich: docs/begruendungen/utils/txLock.ts.md#abschnitt
 */
import * as db from '../db/database';
import type { DbSchnittstelle } from '../db/database';

/**
 * Führt fn in einer Transaktion aus, die exklusiven Zugriff auf den
 * angegebenen Bestandsschlüssel hat.
 * Ausführlich: docs/begruendungen/utils/txLock.ts.md#withinventorylock
 * @template T
 * @param {number} userId
 * @param {string} scopeKey Bestandsschlüssel, z. B. die Set- oder Teilenummer
 * @param {(tx: any) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withInventoryLock(userId: number, scopeKey: string | number, fn: (tx: any) => any) {
  // tx: DbSchnittstelle statt any — der Typ steht seit Nachtrag 155 in
  // db/database. Mit `any` war jeder Aufruf hier drin ungeprueft.
  return db.transaction(async (tx: DbSchnittstelle) => {
    // hashtext() liefert int4 — zusammen mit der userId ergibt das den
    // zweiteiligen Lock-Schlüssel. Kollisionen zweier verschiedener Sets
    // desselben Nutzers sind theoretisch möglich und harmlos: Dann
    // serialisieren zwei Vorgänge, die es nicht müssten.
    await tx.run('SELECT pg_advisory_xact_lock($1, hashtext($2))', [userId, String(scopeKey)]);
    return fn(tx);
  });
}

export { withInventoryLock };
