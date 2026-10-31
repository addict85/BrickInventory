/**
 * Serialisierung nebenläufiger Mutationen an derselben Bestandszeile.
 * Ausführlich: docs/begruendungen/db/txLock.ts.md#abschnitt
 */
import * as db from './database';
import type { DbSchnittstelle } from './database';
import { LOCKS } from '../src/infra/lockNamespaces';

/**
 * Führt fn in einer Transaktion aus, die exklusiven Zugriff auf den
 * angegebenen Bestandsschlüssel hat.
 * Ausführlich: docs/begruendungen/db/txLock.ts.md#withinventorylock
 * @template T
 * @param {number} userId
 * @param {string} scopeKey Bestandsschlüssel, z. B. die Set- oder Teilenummer
 * @param {(tx: any) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withInventoryLock(userId: number, scopeKey: string | number, fn: (tx: any) => any) {
  // tx: DbSchnittstelle statt any — der Typ steht in
  // db/database. Mit `any` war jeder Aufruf hier drin ungeprueft.
  return db.transaction(async (tx: DbSchnittstelle) => {
    // Eine eigene Klasse statt der user_id als erstem Wert: Sonst sperrte
    // Konto 42 beim Verschieben eines Sets den Bild-Download desselben Sets
    // (LOCKS.BILD_DOWNLOAD = 42, hashtext(Setnummer)). Gleiche Streuwerte
    // verschiedener Schlüssel serialisieren nur, was es nicht müsste.
    await tx.run('SELECT pg_advisory_xact_lock($1, hashtext($2))', [LOCKS.INVENTAR, `${userId}|${scopeKey}`]);
    return fn(tx);
  });
}

/**
 * Der Sperrschlüssel eines Bestands — für alle Wege derselbe, sonst warten
 * zwei Änderungen am selben Teil nicht aufeinander. Gesperrt wird immer auf
 * dem BESITZER, nicht auf dem Handelnden.
 */
function bestandsSchluessel(kind: 'set' | 'part' | 'fig', keys: unknown[]): string {
  return kind === 'set' ? String(keys[0]) : `${kind}:${keys.join(':')}`;
}

/** Sperre für Haushaltswährung und Verknüpfung: Beide prüfen bzw. ändern dieselbe Regel. */
async function sperreHaushaltswaehrung(tx: DbSchnittstelle): Promise<void> {
  await tx.run("SELECT pg_advisory_xact_lock(hashtext('haushalt-waehrung'))");
}

/**
 * Eine Sitzungssperre auf eigener Verbindung (Advisory-Locks hängen an der
 * Sitzung); ist sie belegt, entscheidet `belegt`, was geschieht.
 */
async function mitSitzungsSperre<T>(schluessel: number, lauf: () => Promise<T>, belegt: () => never): Promise<T> {
  const client = await db.pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1, 0) AS ok', [schluessel]);
    if (!rows[0]?.ok) belegt();
    try { return await lauf(); }
    finally { await client.query('SELECT pg_advisory_unlock($1, 0)', [schluessel]); }
  } finally { client.release(); }
}

/**
 * Eine Sitzungssperre für eine ganze Laufzeit belegen.
 * @returns Freigabe, oder null wenn ein anderer Prozess sie hält
 */
async function belegeSitzungsSperre(schluessel: number): Promise<(() => Promise<void>) | null> {
  const client = await db.pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1, 0) AS ok', [schluessel]);
    if (!rows[0]?.ok) { client.release(); return null; }
  } catch (e) { client.release(); throw e; }
  return async () => {
    try { await client.query('SELECT pg_advisory_unlock($1, 0)', [schluessel]); }
    finally { client.release(); }
  };
}

export { withInventoryLock, bestandsSchluessel, sperreHaushaltswaehrung, mitSitzungsSperre, belegeSitzungsSperre };
