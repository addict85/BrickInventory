import type { DbInterface, Treffer } from '../../db/database';
import type { HouseholdReadContract } from './lesevertrag';

const zahl = (v: number | string) => parseInt(String(v), 10);

export async function subAccounts(db: DbInterface, id: number): Promise<number[]> {
  const rows = await db.all<{ sub_user_id: number | string }>(
    'SELECT sub_user_id FROM account_links WHERE main_user_id = $1 ORDER BY sub_user_id',
    [id],
  );
  return rows.map(r => zahl(r.sub_user_id));
}

export async function elternkonten(db: DbInterface, id: number): Promise<number[]> {
  const rows = await db.all<{ main_user_id: number | string }>(
    'SELECT main_user_id FROM account_links WHERE sub_user_id = $1 ORDER BY main_user_id',
    [id],
  );
  return rows.map(r => zahl(r.main_user_id));
}

export async function isLinked(db: DbInterface, main: number, sub: number, d: DbInterface = db): Promise<boolean> {
  return !!(await d.get<Treffer>('SELECT 1 FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2', [
    main,
    sub,
  ]));
}

export interface KontoName {
  id: number;
  username: string;
}

export async function accountNames(
  db: DbInterface,
  l: HouseholdReadContract,
  ids: number[],
  ordnung: 'id' | 'username' = 'id',
): Promise<KontoName[]> {
  const rows = await db.all<{ id: number | string; username: string }>(
    `SELECT id, username FROM ${l.KONTEN} k WHERE id = ANY($1) ORDER BY ${ordnung === 'id' ? 'id' : 'username'}`,
    [ids],
  );
  return rows.map(r => ({ id: zahl(r.id), username: r.username }));
}

export async function accountName(db: DbInterface, l: HouseholdReadContract, id: number): Promise<string | null> {
  const r = await db.get<{ username: string }>(`SELECT username FROM ${l.KONTEN} k WHERE id = $1`, [id]);
  return r?.username ?? null;
}

export async function cleanInvitationsOn(db: DbInterface): Promise<void> {
  await db.run('DELETE FROM account_link_invites WHERE expires_at < NOW() OR used_at IS NOT NULL');
}

export async function putInvitationAn(db: DbInterface, tokenHash: string, main: number, bis: Date): Promise<void> {
  await db.run('INSERT INTO account_link_invites (token_hash, main_user_id, expires_at) VALUES ($1,$2,$3)', [
    tokenHash,
    main,
    bis,
  ]);
}

/** Eine gültige Einladung für `sub` belegen; liefert das einladende Konto oder null. */
export async function receiptsInvitation(db: DbInterface, tokenHash: string, sub: number): Promise<number | null> {
  const r = await db.get<{ main_user_id: number | string }>(
    `UPDATE account_link_invites SET used_at = NOW(), used_by = $2
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
      RETURNING main_user_id`,
    [tokenHash, sub],
  );
  return r ? zahl(r.main_user_id) : null;
}

export async function inviterToCode(db: DbInterface, tokenHash: string): Promise<number | null> {
  const r = await db.get<{ main_user_id: number | string }>(
    'SELECT main_user_id FROM account_link_invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()',
    [tokenHash],
  );
  return r ? zahl(r.main_user_id) : null;
}

export async function giveInvitationFree(db: DbInterface, tokenHash: string): Promise<void> {
  await db.run('UPDATE account_link_invites SET used_at = NULL, used_by = NULL WHERE token_hash = $1', [tokenHash]);
}

/** Verknüpfen und den Hinweis auf eine frühere Trennung derselben Kette löschen. */
export async function link(tx: DbInterface, main: number, sub: number): Promise<void> {
  await tx.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
    main,
    sub,
  ]);
  await tx.run('DELETE FROM household_former_links WHERE main_user_id = $1 AND sub_user_id = $2', [main, sub]);
}

/** Verknüpfungen lösen; ohne `main` alle Elternkonten von `sub`. @returns Anzahl */
export async function separate(db: DbInterface, main: number | null, sub: number): Promise<number> {
  const r =
    main === null
      ? await db.run('DELETE FROM account_links WHERE sub_user_id = $1', [sub])
      : await db.run('DELETE FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2', [main, sub]);
  return r.changes ?? 0;
}

/** Alle Hauptkonten von `sub` lösen und dessen offene Einladungen verwerfen. */
export async function resolveSubAccountAndInvitations(
  tx: DbInterface,
  sub: number,
): Promise<{ hauptkonten: number[]; einladungen: number }> {
  const weg = await tx.all<{ main_user_id: number | string }>(
    'DELETE FROM account_links WHERE sub_user_id = $1 RETURNING main_user_id',
    [sub],
  );
  const einl = await tx.run('DELETE FROM account_link_invites WHERE main_user_id = $1 AND used_at IS NULL', [sub]);
  return { hauptkonten: weg.map(z => zahl(z.main_user_id)), einladungen: einl.changes ?? 0 };
}

export async function deleteSeparatedHint(db: DbInterface, main: number, sub: number): Promise<number> {
  const r = await db.run('DELETE FROM household_former_links WHERE main_user_id = $1 AND sub_user_id = $2', [
    main,
    sub,
  ]);
  return r.changes ?? 0;
}

export async function openInvitations(db: DbInterface, main: number): Promise<number> {
  const r = await db.get<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM account_link_invites
      WHERE main_user_id = $1 AND used_at IS NULL AND expires_at > NOW()`,
    [main],
  );
  return r?.n ?? 0;
}

export interface SeparateChain {
  id: number;
  username: string;
  via: string | null;
}

export async function separateChains(
  db: DbInterface,
  l: HouseholdReadContract,
  main: number,
): Promise<SeparateChain[]> {
  const rows = await db.all<{ id: number | string; username: string; via: string | null }>(
    `SELECT f.sub_user_id AS id, u.username, v.username AS via
       FROM household_former_links f
       JOIN ${l.KONTEN} u ON u.id = f.sub_user_id
       LEFT JOIN ${l.KONTEN} v ON v.id = f.via_user_id
      WHERE f.main_user_id = $1 ORDER BY u.username`,
    [main],
  );
  return rows.map(g => ({ id: zahl(g.id), username: g.username, via: g.via ?? null }));
}

/** Feste Liste, damit nie ein Request-Wert in den Namen gerät. */
const ERFASSUNGEN = { set: 'setErfassungen', part: 'teilErfassungen', fig: 'figurErfassungen' } as const;
export type ErfassungsArt = keyof typeof ERFASSUNGEN;

/** Der Besitzer einer Erfassungszeile, oder null, wenn es sie nicht gibt. */
export async function ownerTheEntry(
  db: DbInterface,
  l: HouseholdReadContract,
  art: ErfassungsArt,
  id: number,
): Promise<number | null> {
  const r = await db.get<{ user_id: number | string }>(`SELECT user_id FROM ${l[ERFASSUNGEN[art]]()} e WHERE id = $1`, [
    id,
  ]);
  return r ? zahl(r.user_id) : null;
}

export function userNames(db: DbInterface, l: HouseholdReadContract, uids: number[]) {
  return db.all<{ id: number | string; username: string }>(
    `SELECT id, username FROM ${l.KONTEN} k WHERE id = ANY($1)`,
    [uids],
  );
}
