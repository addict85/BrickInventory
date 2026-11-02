/** Werte so, wie sie in der Tabelle stehen; Entschlüsseln, Prüfen und Vorgaben
 * macht src/konto/settings.ts. */
import * as db from '../../../db/database';
import type { DbSchnittstelle } from '../../../db/database';

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
