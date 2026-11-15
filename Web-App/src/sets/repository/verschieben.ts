import type { DbSchnittstelle, Treffer } from '../../../db/database';

export async function hatAnleitungen(tx: DbSchnittstelle, uid: number, sn: string): Promise<boolean> {
  return !!(await tx.get<Treffer>('SELECT 1 AS ok FROM instructions WHERE user_id=$1 AND set_number=$2 LIMIT 1', [
    uid,
    sn,
  ]));
}

export async function entferneAnleitungen(tx: DbSchnittstelle, uid: number, sn: string): Promise<void> {
  await tx.run('DELETE FROM instructions WHERE user_id=$1 AND set_number=$2', [uid, sn]);
}

/** Teile und Figuren kopiert der Bestand (src/bestand/gemeinsam.ts). */
export async function kopiereAnleitungen(tx: DbSchnittstelle, sn: string, von: number, nach: number): Promise<number> {
  return (
    (
      await tx.run(
        `INSERT INTO instructions (user_id, set_number, url, description, local_path)
                   SELECT $1, set_number, url, description, local_path
                     FROM instructions WHERE user_id = $2 AND set_number = $3`,
        [nach, von, sn],
      )
    ).changes ?? 0
  );
}

/** Spalten ausgeschrieben: Ein Stern verliert still eine gelöschte Spalte. */
export function setZeile(tx: DbSchnittstelle, uid: number, sn: string) {
  return tx.get<{ id: number; added_at: string }>(
    'SELECT id, user_id, set_number, added_at, updated_at, storage_id FROM sets WHERE user_id=$1 AND set_number=$2',
    [uid, sn],
  );
}

export type SetErfassung = {
  id: number;
  quantity: number;
  purchase_price: number | null;
  condition: string;
  created_at: string;
  price_estimated: boolean;
  currency: string;
};

export function erfassungenZumVerschieben(tx: DbSchnittstelle, uid: number, sn: string): Promise<SetErfassung[]> {
  return tx.all(
    `SELECT id, quantity, purchase_price, COALESCE(condition,'N') AS condition, created_at, price_estimated, currency
       FROM set_acquisitions WHERE user_id=$1 AND set_number=$2
      ORDER BY created_at ASC, id ASC`,
    [uid, sn],
  );
}
