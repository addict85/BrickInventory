/** Die Währung gilt je Haushalt; geschrieben wird sie für alle Konten darin. */
import type { DbSchnittstelle } from '../../../db/database';

export async function waehrungIn(tx: DbSchnittstelle, userId: number): Promise<string | null> {
  const r = await tx.get<{ value: string }>("SELECT value FROM user_settings WHERE user_id = $1 AND key = 'currency'", [userId]);
  return r?.value ?? null;
}

/** Nur abwärts (Haupt- → Unterkonto): Über ein geteiltes Unterkonto hinauf
 * erreichte man sonst fremde Hauptkonten. */
export async function eigenerHaushalt(tx: DbSchnittstelle, userId: number): Promise<number[]> {
  const rows = await tx.all<{ id: number }>(`
    WITH RECURSIVE baum(id) AS (
      SELECT $1::int
      UNION
      SELECT l.sub_user_id FROM account_links l JOIN baum b ON l.main_user_id = b.id)
    SELECT id FROM baum`, [userId]);
  return rows.map(r => r.id);
}

/** Unterkonten in `ids`, die auch an einem Hauptkonto ausserhalb hängen, das eine andere Währung führt. */
export async function fremdGeteilt(tx: DbSchnittstelle, ids: number[], waehrung: string): Promise<number[]> {
  const rows = await tx.all<{ id: number }>(`
    SELECT DISTINCT l.sub_user_id AS id FROM account_links l
     WHERE l.sub_user_id = ANY($1::int[]) AND NOT l.main_user_id = ANY($1::int[])
       AND konto_waehrung(l.main_user_id) <> $2`, [ids, waehrung]);
  return rows.map(r => r.id);
}

export async function hatHauptkonto(tx: DbSchnittstelle, userId: number): Promise<boolean> {
  return !!await tx.get('SELECT 1 FROM account_links WHERE sub_user_id = $1 LIMIT 1', [userId]);
}

export async function setzeWaehrungFuer(tx: DbSchnittstelle, ids: number[], waehrung: string): Promise<void> {
  await tx.run(
    `INSERT INTO user_settings (user_id, key, value, updated_at)
     SELECT id, 'currency', $2, NOW() FROM unnest($1::int[]) AS id
     ON CONFLICT (user_id, key) DO UPDATE SET value = $2, updated_at = NOW()`, [ids, waehrung]);
}
