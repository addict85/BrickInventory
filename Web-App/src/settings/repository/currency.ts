/** Currency applies per household; writing it touches every account in it. */
import type { DbSchnittstelle, Treffer } from '../../../db/database';
import type { SettingsReadContract } from '../readContract';

export async function currencyOf(tx: DbSchnittstelle, userId: number): Promise<string | null> {
  const r = await tx.get<{ value: string }>("SELECT value FROM user_settings WHERE user_id = $1 AND key = 'currency'", [
    userId,
  ]);
  return r?.value ?? null;
}

export async function ownHousehold(tx: DbSchnittstelle, l: SettingsReadContract, userId: number): Promise<number[]> {
  const rows = await tx.all<{ id: number }>(l.haushaltAbwaerts('$1'), [userId]);
  return rows.map(r => r.id);
}

/** Sub-accounts in `ids` that also hang off a main account outside, with a different currency. */
export async function sharedWithForeignMain(
  tx: DbSchnittstelle,
  l: SettingsReadContract,
  ids: number[],
  currency: string,
): Promise<number[]> {
  const rows = await tx.all<{ id: number }>(
    `SELECT DISTINCT g.id FROM (${l.auchFremdGeteilt('$1')}) g WHERE konto_waehrung(g.haupt) <> $2`,
    [ids, currency],
  );
  return rows.map(r => r.id);
}

export async function hasMainAccount(tx: DbSchnittstelle, l: SettingsReadContract, userId: number): Promise<boolean> {
  return !!(await tx.get<Treffer>(l.istUnterkonto('$1'), [userId]));
}

export async function setCurrencyFor(tx: DbSchnittstelle, ids: number[], currency: string): Promise<void> {
  await tx.run(
    `INSERT INTO user_settings (user_id, key, value, updated_at)
     SELECT id, 'currency', $2, NOW() FROM unnest($1::int[]) AS id
     ON CONFLICT (user_id, key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [ids, currency],
  );
}
