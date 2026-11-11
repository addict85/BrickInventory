/** Werte so, wie sie in der Tabelle stehen; Entschlüsseln, Prüfen und Vorgaben
 * macht src/einstellungen/settings.ts. */
import * as db from '../../db/database';
import type { DbSchnittstelle } from '../../db/database';

export interface Eintrag { key: string; value: string }

export async function nutzerWert(userId: number, key: string, d: DbSchnittstelle = db): Promise<string | null> {
  const r = await d.get<{ value: string }>('SELECT value FROM user_settings WHERE user_id = $1 AND key = $2', [userId, key]);
  return r?.value ?? null;
}

export async function globalerWert(key: string): Promise<string | null> {
  const r = await db.get<{ value: string }>('SELECT value FROM global_settings WHERE key = $1', [key]);
  return r?.value ?? null;
}

export async function schreibeNutzerWert(userId: number, key: string, value: string): Promise<void> {
  await db.run(
    `INSERT INTO user_settings (user_id, key, value, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, key) DO UPDATE SET value = $3, updated_at = NOW()`, [userId, key, value]);
}

export async function loescheNutzerWert(userId: number, key: string): Promise<void> {
  await db.run('DELETE FROM user_settings WHERE user_id = $1 AND key = $2', [userId, key]);
}

export async function nutzerWerte(userId: number): Promise<Eintrag[]> {
  return db.all<Eintrag>('SELECT key, value FROM user_settings WHERE user_id = $1', [userId]);
}

export async function schreibeGlobalenWert(key: string, value: string | null): Promise<void> {
  await db.run(
    `INSERT INTO global_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`, [key, value]);
}

export async function loescheGlobaleWerte(keys: string[]): Promise<void> {
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [keys]);
}

export async function globaleWerte(keys?: readonly string[]): Promise<Eintrag[]> {
  return keys
    ? db.all<Eintrag>('SELECT key, value FROM global_settings WHERE key = ANY($1)', [[...keys]])
    : db.all<Eintrag>('SELECT key, value FROM global_settings');
}

/** Nur, wenn noch der alte Wert dasteht — sonst hat ein anderer Prozess geschrieben. */
export async function ersetzeGlobalenWert(key: string, alt: string, neu: string | null): Promise<boolean> {
  const r = await db.run('UPDATE global_settings SET value = $1, updated_at = NOW() WHERE key = $2 AND value = $3',
    [neu, key, alt]);
  return (r.changes ?? 0) > 0;
}

/** Eine Transaktion über alles, was der Rückruf schreibt; auch Repositories anderer
 * Bereiche laufen darin mit (db/database.ts, laufendeTx). */
export function alsEinheit<T>(arbeit: () => Promise<T>): Promise<T> {
  return db.transaction(() => arbeit());
}
