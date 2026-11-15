import type { DbSchnittstelle, Treffer } from '../../../db/database';

/** Schreibwege auf Sets und ihre Käufe: Die Zeilen gehören dem Bestand (docs/architektur.md),
 * src/sets ruft sie über t.bestand.setZeilen. */

export function loescheSetErfassungNachId(dbh: DbSchnittstelle, id: number) {
  return dbh.run('DELETE FROM set_acquisitions WHERE id=$1', [id]);
}

export function kuerzeSetErfassung(dbh: DbSchnittstelle, menge: number, id: number) {
  return dbh.run('UPDATE set_acquisitions SET quantity = quantity - $1 WHERE id=$2', [menge, id]);
}

export function legeSetZeileAn(tx: DbSchnittstelle, userId: number, setNumber: string) {
  return tx.run('INSERT INTO sets (user_id,set_number) VALUES ($1,$2) ON CONFLICT (user_id,set_number) DO NOTHING', [
    userId,
    setNumber,
  ]);
}

/** Mit dem Datum des Absenders: Verschieben ändert nicht, seit wann das Set da ist. */
export async function legeSetAn(tx: DbSchnittstelle, uid: number, sn: string, addedAt: string): Promise<void> {
  await tx.run('INSERT INTO sets (user_id, set_number, added_at) VALUES ($1,$2,$3)', [uid, sn, addedAt]);
}

/** `feld` ist ein fester Spaltenname, keine Eingabe von aussen. */
export function schreibeInNeuesteSetErfassung(
  db: DbSchnittstelle,
  wert: number | string | null,
  ownerId: number,
  setNumber: string,
  feld: 'purchase_price' | 'condition',
) {
  return db.run(
    `UPDATE set_acquisitions SET ${feld} = $1
                 WHERE id = (SELECT id FROM set_acquisitions
                              WHERE user_id=$2 AND set_number=$3
                              ORDER BY created_at DESC, id DESC LIMIT 1)`,
    [wert, ownerId, setNumber],
  );
}

/** Gehörte das Set bisher nur einem anderen Konto, braucht das eigene eine Zeile. */
export function uebernimmSetZeile(tx: DbSchnittstelle, uid: number, leseFeld: number[], setNumber: string) {
  return tx.run(
    `INSERT INTO sets (user_id, set_number)
           SELECT $1, set_number
             FROM sets WHERE user_id = ANY($2) AND set_number = $3
            ORDER BY id ASC LIMIT 1
           ON CONFLICT DO NOTHING`,
    [uid, leseFeld, setNumber],
  );
}

export async function entferneSetZeilen(tx: DbSchnittstelle, uids: number[], setNumber: string): Promise<void> {
  await tx.run('DELETE FROM sets WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
  await tx.run('DELETE FROM set_acquisitions WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
}

/** Nur in den übergebenen Konten: Sonst verschöbe eine fremde Kennung den Kauf eines anderen. */
export async function loescheSetErfassung(tx: DbSchnittstelle, id: number, konten: number[]): Promise<void> {
  await tx.run('DELETE FROM set_acquisitions WHERE id=$1 AND user_id = ANY($2)', [id, konten]);
}

/** Das Set beim Absender nach dem Verschieben; manuelle Teile und Figuren bleiben. */
export async function entferneVerschobenesSet(tx: DbSchnittstelle, uid: number, sn: string): Promise<void> {
  await tx.run("DELETE FROM parts WHERE user_id=$1 AND set_number=$2 AND COALESCE(source,'set') <> 'manual'", [
    uid,
    sn,
  ]);
  await tx.run("DELETE FROM minifigs WHERE user_id=$1 AND set_number=$2 AND COALESCE(source,'set') <> 'manual'", [
    uid,
    sn,
  ]);
  await tx.run('DELETE FROM set_acquisitions WHERE user_id=$1 AND set_number=$2', [uid, sn]);
  await tx.run('DELETE FROM sets WHERE user_id=$1 AND set_number=$2', [uid, sn]);
}

export async function hatSetInhalt(
  tx: DbSchnittstelle,
  tabelle: 'parts' | 'minifigs',
  uid: number,
  sn: string,
): Promise<boolean> {
  const sql =
    tabelle === 'parts'
      ? 'SELECT 1 AS ok FROM parts WHERE user_id=$1 AND set_number=$2 LIMIT 1'
      : 'SELECT 1 AS ok FROM minifigs WHERE user_id=$1 AND set_number=$2 LIMIT 1';
  return !!(await tx.get<Treffer>(sql, [uid, sn]));
}
