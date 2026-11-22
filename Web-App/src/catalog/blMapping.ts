// BrickLink numbers live only in bl_mapping.

import type { BlArt } from '../../db/blMappingSql';
import { writeBlNumbers } from './repository/blMapping';
import type { CatalogContext } from './context';

/** The kind is INSERTED into SQL snippets (no value can be bound there);
 * the type prevents anything else from ever ending up there. */
export type { BlArt };
/** In db/ so that repositories can insert them. */

/** Only for verified sources (Rebrickable, BrickLink); the same number means
 * "no differing one". What an account enters goes to rememberOwnBlNumber. */
export function rememberBlNumber(k: CatalogContext, art: BlArt, rbId: string, blId: string): Promise<void> {
  return k.blMapping.writeBlNumber(art, rbId, blId);
}

/** Applies only to this account, in all read paths before the shared mapping. */
export function rememberOwnBlNumber(
  k: CatalogContext,
  uid: number,
  art: BlArt,
  rbId: string,
  blId: string,
): Promise<void> {
  return k.blMapping.writeBlNumberOwn(uid, art, rbId, blId || rbId);
}

const konten = (k: number | number[] | null | undefined): number[] => (k == null ? [] : Array.isArray(k) ? k : [k]);

/** The last entry per number. */
export async function rememberBlNumbers(
  k: CatalogContext,
  art: BlArt,
  pairs: { rbId: string; blId: string }[],
  dbh?: { run: (sql: string, p?: unknown[]) => Promise<unknown> },
) {
  const unique = [...new Map(pairs.filter(p => p.rbId && p.blId).map(p => [p.rbId, p])).values()];
  if (!unique.length) return;
  await writeBlNumbers(
    dbh ?? k.db,
    art,
    unique.map(p => p.rbId),
    unique.map(p => p.blId),
  );
}

/** So that the same part is not queried again and again; a mapping
 * once found stays. */
export function rememberBlNumberUnchanged(k: CatalogContext, art: BlArt, rbId: string): Promise<void> {
  return k.blMapping.noteLookedUp(art, rbId);
}

/** null for "no differing one known" — no row and row without value
 * together. Whoever must tell them apart asks blFetchNumber. */
export function blNumberOf(
  k: CatalogContext,
  art: BlArt,
  rbId: string,
  konto?: number | number[] | null,
): Promise<string | null> {
  return k.blMapping.differingNumber(art, rbId, konten(konto));
}

/** null only if it was never looked up: preloading prices does not remember
 * failures and needs this distinction. */
export function blFetchNumber(
  k: CatalogContext,
  art: BlArt,
  rbId: string,
  konto?: number | number[] | null,
): Promise<string | null> {
  return k.blMapping.effectiveNumber(art, rbId, konten(konto));
}

// One query for many numbers; every row comes back so that nothing is asked twice.
export async function blFetchNumbers(
  k: CatalogContext,
  art: BlArt,
  rbIds: string[],
  konto?: number | number[] | null,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!rbIds.length) return out;
  const rows = await k.blMapping.effectiveNumbers(art, rbIds, konten(konto));
  for (const z of rows) out.set(String(z.rb_id), String(z.nr));
  return out;
}

export function rememberBlColorNumber(k: CatalogContext, colorId: number, blColorId: number): Promise<void> {
  return k.blMapping.writeBlColorNumber(colorId, blColorId);
}

/** Rebrickable delivers `ext_ids` as a list or the list directly. */
type ExterneNumbers = { external_ids?: { BrickLink?: { ext_ids?: number[] } & number[] } } | null | undefined;
export function blColorNumberFrom(color: ExterneNumbers): number | null {
  const id = color?.external_ids?.BrickLink?.ext_ids?.[0] ?? color?.external_ids?.BrickLink?.[0];
  return id ?? null;
}
