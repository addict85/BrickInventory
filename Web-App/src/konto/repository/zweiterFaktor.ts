import type { DbSchnittstelle } from '../../../db/database';

/** Das Geheimnis liegt verschlüsselt. */

export async function ersetzeCodes(tx: DbSchnittstelle, uid: number, hashes: string[]): Promise<void> {
  await tx.run('DELETE FROM zweiter_faktor_codes WHERE user_id = $1', [uid]);
  for (const h of hashes)
    await tx.run('INSERT INTO zweiter_faktor_codes (user_id, code_hash) VALUES ($1, $2)', [uid, h]);
}

export async function aktiv(db: DbSchnittstelle, uid: number): Promise<boolean> {
  const r = await db.get<{ aktiv: boolean }>('SELECT aktiv FROM zweiter_faktor WHERE user_id = $1', [uid]);
  return r?.aktiv === true;
}

export async function faktorStand(db: DbSchnittstelle, uid: number): Promise<{ aktiv: boolean; uebrig: number }> {
  const r = await db.get<{ aktiv: boolean; uebrig: number }>(
    `SELECT COALESCE((SELECT aktiv FROM zweiter_faktor WHERE user_id = $1), FALSE) AS aktiv,
            (SELECT COUNT(*)::int FROM zweiter_faktor_codes WHERE user_id = $1 AND verbraucht_am IS NULL) AS uebrig`,
    [uid],
  );
  return { aktiv: r?.aktiv === true, uebrig: Number(r?.uebrig ?? 0) };
}

/** Ein aktiver Faktor wird nicht überschrieben. */
export async function legeGeheimnisAn(
  db: DbSchnittstelle,
  uid: number,
  verschluesselt: string | null,
): Promise<boolean> {
  const r = await db.run(
    `INSERT INTO zweiter_faktor (user_id, geheimnis) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET geheimnis = EXCLUDED.geheimnis, letzter_schritt = 0, eingerichtet_am = NOW()
       WHERE zweiter_faktor.aktiv = FALSE`,
    [uid, verschluesselt],
  );
  return (r.changes ?? 0) > 0;
}

export function unbestaetigtesGeheimnisSperren(tx: DbSchnittstelle, uid: number) {
  return tx.get<{ geheimnis: string }>(
    'SELECT geheimnis FROM zweiter_faktor WHERE user_id = $1 AND aktiv = FALSE FOR UPDATE',
    [uid],
  );
}

export async function aktiviere(tx: DbSchnittstelle, uid: number, schritt: number): Promise<void> {
  await tx.run('UPDATE zweiter_faktor SET aktiv = TRUE, letzter_schritt = $2 WHERE user_id = $1', [uid, schritt]);
}

export function aktivesGeheimnis(db: DbSchnittstelle, uid: number) {
  return db.get<{ geheimnis: string }>('SELECT geheimnis FROM zweiter_faktor WHERE user_id = $1 AND aktiv', [uid]);
}

/** Die Bedingung steht im UPDATE: Zwei gleichzeitige Anmeldungen kommen nicht beide durch. */
export async function verbraucheSchritt(db: DbSchnittstelle, uid: number, schritt: number): Promise<boolean> {
  const r = await db.run(
    'UPDATE zweiter_faktor SET letzter_schritt = $2 WHERE user_id = $1 AND aktiv AND letzter_schritt < $2',
    [uid, schritt],
  );
  return (r.changes ?? 0) > 0;
}

export async function verbraucheCode(db: DbSchnittstelle, uid: number, hash: string): Promise<boolean> {
  const r = await db.run(
    `UPDATE zweiter_faktor_codes SET verbraucht_am = NOW()
      WHERE user_id = $1 AND code_hash = $2 AND verbraucht_am IS NULL
        AND EXISTS (SELECT 1 FROM zweiter_faktor WHERE user_id = $1 AND aktiv)`,
    [uid, hash],
  );
  return (r.changes ?? 0) > 0;
}

/** Codes und Faktor zusammen: in der Transaktion des Aufrufers (src/konto/zweiterFaktor.ts, schalteAb). */
export async function entferne(tx: DbSchnittstelle, uid: number): Promise<void> {
  await tx.run('DELETE FROM zweiter_faktor_codes WHERE user_id = $1', [uid]);
  await tx.run('DELETE FROM zweiter_faktor WHERE user_id = $1', [uid]);
}
