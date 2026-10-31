/**
 * Datenzugriff des Haushalts: Verknüpfungen (account_links), Einladungen und
 * die Hinweise auf getrennte Ketten.
 */
import * as db from '../../db/database';
import type { DbSchnittstelle } from '../../db/database';

const zahl = (v: number | string) => parseInt(String(v));

/** Die direkten Unterkonten, aufsteigend. */
export async function unterkonten(id: number): Promise<number[]> {
  const rows = await db.all<{ sub_user_id: number | string }>(
    'SELECT sub_user_id FROM account_links WHERE main_user_id = $1 ORDER BY sub_user_id', [id]);
  return rows.map(r => zahl(r.sub_user_id));
}

/** Alle Elternkonten, aufsteigend. */
export async function elternkonten(id: number): Promise<number[]> {
  const rows = await db.all<{ main_user_id: number | string }>(
    'SELECT main_user_id FROM account_links WHERE sub_user_id = $1 ORDER BY main_user_id', [id]);
  return rows.map(r => zahl(r.main_user_id));
}

/** Ist `sub` ein direktes Unterkonto von `main`? */
export async function istVerknuepft(main: number, sub: number, d: DbSchnittstelle = db): Promise<boolean> {
  return !!(await d.get('SELECT 1 FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2', [main, sub]));
}

export interface KontoName { id: number; username: string }

/** Namen zu IDs; `ordnung` nach ID oder Benutzername. */
export async function kontoNamen(ids: number[], ordnung: 'id' | 'username' = 'id'): Promise<KontoName[]> {
  const rows = await db.all<{ id: number | string; username: string }>(
    `SELECT id, username FROM users WHERE id = ANY($1) ORDER BY ${ordnung === 'id' ? 'id' : 'username'}`, [ids]);
  return rows.map(r => ({ id: zahl(r.id), username: r.username }));
}

export async function kontoName(id: number): Promise<string | null> {
  const r = await db.get<{ username: string }>('SELECT username FROM users WHERE id = $1', [id]);
  return r?.username ?? null;
}

/** Abgelaufene und verbrauchte Einladungen entsorgen. */
export async function raeumeEinladungenAuf(): Promise<void> {
  await db.run('DELETE FROM account_link_invites WHERE expires_at < NOW() OR used_at IS NOT NULL');
}

export async function legeEinladungAn(tokenHash: string, main: number, bis: Date): Promise<void> {
  await db.run('INSERT INTO account_link_invites (token_hash, main_user_id, expires_at) VALUES ($1,$2,$3)',
    [tokenHash, main, bis]);
}

/** Eine gültige Einladung für `sub` belegen; liefert das einladende Konto oder null. */
export async function belegeEinladung(tokenHash: string, sub: number): Promise<number | null> {
  const r = await db.get<{ main_user_id: number | string }>(
    `UPDATE account_link_invites SET used_at = NOW(), used_by = $2
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
      RETURNING main_user_id`, [tokenHash, sub]);
  return r ? zahl(r.main_user_id) : null;
}

/** Eine belegte Einladung wieder freigeben. */
export async function gibEinladungFrei(tokenHash: string): Promise<void> {
  await db.run('UPDATE account_link_invites SET used_at = NULL, used_by = NULL WHERE token_hash = $1', [tokenHash]);
}

/** Verknüpfen und den Hinweis auf eine frühere Trennung derselben Kette löschen. */
export async function verknuepfe(tx: DbSchnittstelle, main: number, sub: number): Promise<void> {
  await tx.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [main, sub]);
  await tx.run('DELETE FROM household_former_links WHERE main_user_id = $1 AND sub_user_id = $2', [main, sub]);
}

/** Verknüpfungen lösen; ohne `main` alle Elternkonten von `sub`. @returns Anzahl */
export async function trenne(main: number | null, sub: number): Promise<number> {
  const r = main === null
    ? await db.run('DELETE FROM account_links WHERE sub_user_id = $1', [sub])
    : await db.run('DELETE FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2', [main, sub]);
  return r.changes ?? 0;
}

export async function verwerfeGetrennt(main: number, sub: number): Promise<number> {
  const r = await db.run('DELETE FROM household_former_links WHERE main_user_id = $1 AND sub_user_id = $2', [main, sub]);
  return r.changes ?? 0;
}

export async function offeneEinladungen(main: number): Promise<number> {
  const r = await db.get<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM account_link_invites
      WHERE main_user_id = $1 AND used_at IS NULL AND expires_at > NOW()`, [main]);
  return r?.n ?? 0;
}

export interface GetrennteKette { id: number; username: string; via: string | null }

export async function getrennteKetten(main: number): Promise<GetrennteKette[]> {
  const rows = await db.all<{ id: number | string; username: string; via: string | null }>(
    `SELECT f.sub_user_id AS id, u.username, v.username AS via
       FROM household_former_links f
       JOIN users u ON u.id = f.sub_user_id
       LEFT JOIN users v ON v.id = f.via_user_id
      WHERE f.main_user_id = $1 ORDER BY u.username`, [main]);
  return rows.map(g => ({ id: zahl(g.id), username: g.username, via: g.via ?? null }));
}

/** Erfassungstabellen je Art — feste Liste, damit nie ein Request-Wert in den Tabellennamen gerät. */
const ERFASSUNGEN = { set: 'set_acquisitions', part: 'part_acquisitions', fig: 'minifig_acquisitions' } as const;
export type ErfassungsArt = keyof typeof ERFASSUNGEN;

/** Der Besitzer einer Erfassungszeile, oder null, wenn es sie nicht gibt. */
export async function besitzerDerErfassung(art: ErfassungsArt, id: number): Promise<number | null> {
  const r = await db.get<{ user_id: number | string }>(`SELECT user_id FROM ${ERFASSUNGEN[art]} WHERE id = $1`, [id]);
  return r ? zahl(r.user_id) : null;
}
