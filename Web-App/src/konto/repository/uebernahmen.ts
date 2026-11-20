import type { DbInterface } from '../../../db/database';

export type TakeoverKind = 'passwort' | 'zweiter_faktor' | 'deaktivieren' | 'rolle_entziehen' | 'loeschen';
export interface Uebernahme {
  target_id: number;
  type: TakeoverKind;
  initiated_by: number;
  password_hash: string | null;
}

export async function terminateAn(db: DbInterface, u: Uebernahme, hours: number, abortHash: string): Promise<Date> {
  const r = await db.get<{ effective_at: Date }>(
    `INSERT INTO admin_takeovers (target_id, type, initiated_by, password_hash, effective_at, cancel_hash)
     VALUES ($1, $2, $3, $4, NOW() + make_interval(hours => $5), $6)
     ON CONFLICT (target_id, type) DO UPDATE SET initiated_by = EXCLUDED.initiated_by, password_hash = EXCLUDED.password_hash,
       created_at = NOW(), effective_at = EXCLUDED.effective_at, cancel_hash = EXCLUDED.cancel_hash
     RETURNING effective_at`,
    [u.target_id, u.type, u.initiated_by, u.password_hash, hours, abortHash],
  );
  return r!.effective_at;
}

/** Wer die Rolle eben verlor, zählt noch als Verwalter: Sonst entzöge man sie erst und übernähme dann sofort. */
export async function adminOrJustBeen(db: DbInterface, ziel: number, hours: number): Promise<boolean> {
  const r = await db.get<{ ja: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND is_admin)
         OR EXISTS (SELECT 1 FROM admin_log WHERE target_id = $1 AND action = 'verwalter_entzogen'
                     AND occurred_at > NOW() - make_interval(hours => $2)) AS ja`,
    [ziel, hours],
  );
  return r?.ja === true;
}

/** Fällig und vom Verwalter, der sie ankündigte, noch getragen. Passwort und Faktor nicht, wenn das
 * Ziel seither deaktiviert wurde oder jetzt wird: Es könnte sich nicht mehr anmelden, um abzubrechen. */
export async function takeDue(db: DbInterface): Promise<{ gilt: Uebernahme[]; verworfen: number }> {
  const weg = await db.all<Uebernahme & { gilt: boolean }>(
    `WITH weg AS (DELETE FROM admin_takeovers WHERE effective_at <= NOW() RETURNING *)
     SELECT w.target_id, w.type, w.initiated_by, w.password_hash,
       EXISTS (SELECT 1 FROM users d WHERE d.id = w.initiated_by AND d.is_admin AND d.is_active)
       AND (w.type NOT IN ('passwort', 'zweiter_faktor') OR NOT (
         EXISTS (SELECT 1 FROM admin_log p WHERE p.target_id = w.target_id
                   AND p.action = 'konto_deaktiviert' AND p.occurred_at >= w.created_at)
         OR EXISTS (SELECT 1 FROM weg x WHERE x.target_id = w.target_id AND x.type = 'deaktivieren'))) AS gilt
       FROM weg w`,
  );
  return { gilt: weg.filter(z => z.gilt), verworfen: weg.filter(z => !z.gilt).length };
}

export async function abortTakeoversAb(db: DbInterface, ziel: number): Promise<TakeoverKind[]> {
  const r = await db.all<{ type: TakeoverKind }>('DELETE FROM admin_takeovers WHERE target_id = $1 RETURNING type', [
    ziel,
  ]);
  return r.map(z => z.type);
}

/** Das Ziel zum Link aus der Mail; der Link gilt einmal, weil der Abbruch die Zeilen löscht. */
export async function targetToAbort(db: DbInterface, abortHash: string): Promise<number | null> {
  const r = await db.get<{ target_id: number }>('SELECT target_id FROM admin_takeovers WHERE cancel_hash = $1', [
    abortHash,
  ]);
  return r?.target_id ?? null;
}

export function announced(db: DbInterface) {
  return db.all<{ target_id: number; type: TakeoverKind; effective_at: Date }>(
    'SELECT target_id, type, effective_at FROM admin_takeovers ORDER BY effective_at',
  );
}
