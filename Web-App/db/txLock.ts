/**
 * Serialisierung nebenläufiger Mutationen an derselben Bestandszeile.
 */
import * as db from './database';
import type { DbSchnittstelle } from './database';
import { LOCKS } from '../src/infra/lockNamespaces';
import { meldeFehler } from '../src/infra/fehler';

/** Eine Transaktionssperre auf (Klasse, hashtext(schluessel)); sie endet mit COMMIT oder ROLLBACK. */
async function sperreBisZumEnde(tx: DbSchnittstelle, klasse: number, schluessel: string): Promise<void> {
  await tx.run('SELECT pg_advisory_xact_lock($1, hashtext($2))', [klasse, schluessel]);
}

/** Führt fn in einer Transaktion aus, die exklusiven Zugriff auf den
 * angegebenen Bestandsschlüssel hat.
 * @param scopeKey Bestandsschlüssel, z. B. die Set- oder Teilenummer */
async function withInventoryLock<T>(userId: number, scopeKey: string | number, fn: (tx: DbSchnittstelle) => Promise<T>,
                                    o: db.TxOptionen = {}): Promise<T> {
  return mitInventarSperre(db, userId, scopeKey, fn, o);
}

/** Dasselbe für mehrere Konten (etwas wandert zwischen ihnen); aufsteigend
 * gesperrt, damit zwei Gegenrichtungen nicht verklemmen. */
async function withInventoryLocks<T>(userIds: number[], scopeKey: string, fn: (tx: DbSchnittstelle) => Promise<T>,
                                     o: db.TxOptionen = {}): Promise<T> {
  return db.transaction(async (tx) => {
    for (const u of [...new Set(userIds)].sort((a, b) => a - b)) await sperreBisZumEnde(tx, LOCKS.INVENTAR, `${u}|${scopeKey}`);
    return fn(tx);
  }, o);
}

/** Dasselbe über einen übergebenen Zugang (Bereiche mit Fabrik, src/sets/bereich.ts). */
async function mitInventarSperre<T>(zugang: Pick<db.Db, 'transaction'>, userId: number, scopeKey: string | number,
                                    fn: (tx: DbSchnittstelle) => Promise<T>, o: db.TxOptionen = {}): Promise<T> {
  return zugang.transaction(async (tx) => {
    // Eine eigene Klasse statt der user_id als erstem Wert: Sonst sperrte
    // Konto 42 beim Verschieben eines Sets den Bild-Download desselben Sets
    // (LOCKS.BILD_DOWNLOAD = 42, hashtext(Setnummer)). Gleiche Streuwerte
    // verschiedener Schlüssel serialisieren nur, was es nicht müsste.
    await sperreBisZumEnde(tx, LOCKS.INVENTAR, `${userId}|${scopeKey}`);
    return fn(tx);
  }, o);
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
  await tx.run('SELECT pg_advisory_xact_lock($1, 0)', [LOCKS.HAUSHALT_WAEHRUNG]);
}

/**
 * Eine Sitzungssperre auf eigener Verbindung (Advisory-Locks hängen an der
 * Sitzung); ist sie belegt, entscheidet `belegt`, was geschieht.
 */
async function mitSitzungsSperre<T>(schluessel: number, lauf: () => Promise<T>, belegt: () => never): Promise<T> {
  const client = await db.pool.connect();
  // Schlägt das Freigeben fehl, darf die Verbindung nicht mit gehaltener Sperre in den
  // Pool zurück; sie wird verworfen (die Sperre endet mit der Sitzung).
  let defekt: Error | undefined;
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1, 0) AS ok', [schluessel]);
    if (!rows[0]?.ok) belegt();
    try { return await lauf(); }
    finally {
      await client.query('SELECT pg_advisory_unlock($1, 0)', [schluessel])
        .catch((e: unknown) => { defekt = e instanceof Error ? e : new Error(String(e)); meldeFehler('txLock:freigabe', e); });
    }
  } finally { client.release(defekt); }
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
    let defekt: Error | undefined;
    await client.query('SELECT pg_advisory_unlock($1, 0)', [schluessel])
      .catch((e: unknown) => { defekt = e instanceof Error ? e : new Error(String(e)); meldeFehler('txLock:freigabe', e); });
    client.release(defekt);
  };
}

type Abfrager = Pick<import('pg').ClientBase, 'query'>;

/** Sitzungssperre ohne Warten; der zweite Wert ist hashtext(schluessel). */
async function versucheSchluesselSperre(c: Abfrager, namensraum: number, schluessel: string): Promise<boolean> {
  const { rows } = await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1, hashtext($2)) AS ok', [namensraum, schluessel]);
  return !!rows[0]?.ok;
}

async function gibSchluesselSperreFrei(c: Abfrager, namensraum: number, schluessel: string): Promise<void> {
  await c.query('SELECT pg_advisory_unlock($1, hashtext($2))', [namensraum, schluessel]);
}

export { withInventoryLock, withInventoryLocks, mitInventarSperre, bestandsSchluessel, sperreHaushaltswaehrung, mitSitzungsSperre, belegeSitzungsSperre,
  versucheSchluesselSperre, gibSchluesselSperreFrei, sperreBisZumEnde };
