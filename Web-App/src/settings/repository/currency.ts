/** Currency applies per household; writing it touches every account in it. */
import type { DbInterface, Hit } from '../../../db/database';
import type { SettingsReadContract } from '../readContract';

export async function storedCurrencyOf(tx: DbInterface, userId: number): Promise<string | null> {
  const r = await tx.get<{ value: string }>("SELECT value FROM user_settings WHERE user_id = $1 AND key = 'currency'", [
    userId,
  ]);
  return r?.value ?? null;
}

export async function ownHousehold(tx: DbInterface, l: SettingsReadContract, userId: number): Promise<number[]> {
  const rows = await tx.all<{ id: number }>(l.householdDown('$1'), [userId]);
  return rows.map(r => r.id);
}

/** Sub-accounts in `ids` that also hang off a main account outside, with a different currency. */
export async function sharedWithForeignMain(
  tx: DbInterface,
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

export async function hasMainAccount(tx: DbInterface, l: SettingsReadContract, userId: number): Promise<boolean> {
  return !!(await tx.get<Hit>(l.isSubAccount('$1'), [userId]));
}

export async function setCurrencyFor(tx: DbInterface, ids: number[], currency: string): Promise<void> {
  await tx.run(
    `INSERT INTO user_settings (user_id, key, value, updated_at)
     SELECT id, 'currency', $2, NOW() FROM unnest($1::int[]) AS id
     ON CONFLICT (user_id, key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [ids, currency],
  );
}
