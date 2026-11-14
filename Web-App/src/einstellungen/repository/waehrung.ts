/** Die Währung gilt je Haushalt; geschrieben wird sie für alle Konten darin. */
import type { DbSchnittstelle } from '../../../db/database';
import { auchFremdGeteilt, haushaltAbwaerts, istUnterkonto } from '../../../db/haushaltSicht';

export async function waehrungIn(tx: DbSchnittstelle, userId: number): Promise<string | null> {
  const r = await tx.get<{ value: string }>("SELECT value FROM user_settings WHERE user_id = $1 AND key = 'currency'", [
    userId,
  ]);
  return r?.value ?? null;
}

export async function eigenerHaushalt(tx: DbSchnittstelle, userId: number): Promise<number[]> {
  const rows = await tx.all<{ id: number }>(haushaltAbwaerts('$1'), [userId]);
  return rows.map(r => r.id);
}

/** Unterkonten in `ids`, die auch an einem Hauptkonto ausserhalb hängen, das eine andere Währung führt. */
export async function fremdGeteilt(tx: DbSchnittstelle, ids: number[], waehrung: string): Promise<number[]> {
  const rows = await tx.all<{ id: number }>(
    `SELECT DISTINCT g.id FROM (${auchFremdGeteilt('$1')}) g WHERE konto_waehrung(g.haupt) <> $2`,
    [ids, waehrung],
  );
  return rows.map(r => r.id);
}

export async function hatHauptkonto(tx: DbSchnittstelle, userId: number): Promise<boolean> {
  return !!(await tx.get(istUnterkonto('$1'), [userId]));
}

export async function setzeWaehrungFuer(tx: DbSchnittstelle, ids: number[], waehrung: string): Promise<void> {
  await tx.run(
    `INSERT INTO user_settings (user_id, key, value, updated_at)
     SELECT id, 'currency', $2, NOW() FROM unnest($1::int[]) AS id
     ON CONFLICT (user_id, key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [ids, waehrung],
  );
}
