/** Values as the table holds them; decrypting, validating and defaults live in
 * src/settings/settings.ts. */
import type { DbSchnittstelle } from '../../../db/database';

export interface Entry {
  key: string;
  value: string;
}

export async function userValue(
  db: DbSchnittstelle,
  userId: number,
  key: string,
  d: DbSchnittstelle = db,
): Promise<string | null> {
  const r = await d.get<{ value: string }>('SELECT value FROM user_settings WHERE user_id = $1 AND key = $2', [
    userId,
    key,
  ]);
  return r?.value ?? null;
}

export async function globalValue(db: DbSchnittstelle, key: string): Promise<string | null> {
  const r = await db.get<{ value: string }>('SELECT value FROM global_settings WHERE key = $1', [key]);
  return r?.value ?? null;
}

export async function writeUserValue(db: DbSchnittstelle, userId: number, key: string, value: string): Promise<void> {
  await db.run(
    `INSERT INTO user_settings (user_id, key, value, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
    [userId, key, value],
  );
}

export async function deleteUserValue(db: DbSchnittstelle, userId: number, key: string): Promise<void> {
  await db.run('DELETE FROM user_settings WHERE user_id = $1 AND key = $2', [userId, key]);
}

/** A value from accounts `uids`; which account provides it is left open. */
export async function firstValueIn(db: DbSchnittstelle, uids: number[], key: string): Promise<string | null> {
  const r = await db.get<{ value: string }>('SELECT value FROM user_settings WHERE user_id = ANY($1) AND key = $2', [
    uids,
    key,
  ]);
  return r?.value ?? null;
}

export async function userValues(db: DbSchnittstelle, userId: number): Promise<Entry[]> {
  return db.all<Entry>('SELECT key, value FROM user_settings WHERE user_id = $1', [userId]);
}

export async function writeGlobalValue(db: DbSchnittstelle, key: string, value: string | null): Promise<void> {
  await db.run(
    `INSERT INTO global_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value],
  );
}

export async function deleteGlobalValueRows(db: DbSchnittstelle, keys: string[]): Promise<void> {
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [keys]);
}

export async function globalValues(db: DbSchnittstelle, keys?: readonly string[]): Promise<Entry[]> {
  return keys
    ? db.all<Entry>('SELECT key, value FROM global_settings WHERE key = ANY($1)', [[...keys]])
    : db.all<Entry>('SELECT key, value FROM global_settings');
}

/** Only while the old value is still there — otherwise another process has already written. */
export async function replaceGlobalValue(
  db: DbSchnittstelle,
  key: string,
  oldValue: string,
  newValue: string | null,
): Promise<boolean> {
  const r = await db.run('UPDATE global_settings SET value = $1, updated_at = NOW() WHERE key = $2 AND value = $3', [
    newValue,
    key,
    oldValue,
  ]);
  return (r.changes ?? 0) > 0;
}
