import { lagerorte } from '../../../db/inventoryView';
import type { DbInterface } from '../../../db/database';
import { mengeJoin, mengeAus, teilmengeJoin, teilmengeAus } from '../../../db/stockQuantity';
import { blJoin, blNummerSql } from '../../../db/blMappingSql';
import { teilSichtJoin, TEIL } from '../../../db/catalogView';
import { LOCKS } from '../../infra/lockNamespaces';

/** State of an account's raw data and whether catalog changes are pending (migration 0079). */
export async function rawState(db: DbInterface, userId: number): Promise<{ v: number; openCatalog: boolean }> {
  const r = await db.get<{ v: number | null; katalog_offen: boolean }>(
    `SELECT (SELECT v FROM parts_version_user WHERE user_id = $1) AS v,
            EXISTS (SELECT 1 FROM parts_catalog_pending) AS katalog_offen`,
    [userId],
  );
  return { v: Number(r?.v) || 0, openCatalog: !!r?.katalog_offen };
}

export async function builtState(db: DbInterface, userId: number): Promise<number | null> {
  const r = await db.get<{ built_version: number }>(
    'SELECT built_version FROM parts_summary_state WHERE user_id = $1',
    [userId],
  );
  return r ? Number(r.built_version) : null;
}

/** The same query for the full rebuild and for the follow-up, so the two can't drift apart. */
function summaryInsert(groupsOnly: boolean): string {
  return `
      INSERT INTO parts_summary (user_id, part_key, color_id, part_number, bl_part_number,
        part_name, color_name, color_hex, category_name, image_url, image_local,
        is_spare, total_quantity, in_sets, storage)
      SELECT p.user_id,
             -- Grouped by the BrickLink number, wherever one differs.
             ${blNummerSql('p.part_number')},
             p.color_id,
             MIN(p.part_number), MIN(${blNummerSql('p.part_number')}),
             MIN(${TEIL.name}), MIN(${TEIL.farbname}), MIN(${TEIL.farbcode}), MIN(${TEIL.kategorie}),
             MIN(${TEIL.bild}), MIN(${TEIL.bildDatei}),
             -- Spare is a property of the set list; the same part can be spare in
             -- one set and required in the next.
             bool_or(COALESCE(tm_k.is_spare, false)),
             SUM(${teilmengeAus('p', 'part')} * ${mengeAus('sm', 1)}),
             STRING_AGG(DISTINCT p.set_number, ','),
             -- All storage locations of the group: the same part sits in different bins from several sets.
             NULLIF(STRING_AGG(DISTINCT lo.name, ', '), '')
        FROM parts p
        ${mengeJoin('p', 'sm', '= $1')}
        ${teilmengeJoin('p', 'part', 'tm', '= $1')}
        ${blJoin('p.part_number', 'part', 'p.user_id')}
        LEFT JOIN ${lagerorte()} lo ON lo.id = p.storage_id
        ${teilSichtJoin('p.user_id', 'p.part_number', 'p.color_id')}
       WHERE p.user_id = $1 AND COALESCE(p.source, 'set') <> 'manual'${
         groupsOnly
           ? `
         AND ${blNummerSql('p.part_number')} = ANY($2)`
           : ''
       }
       GROUP BY p.user_id, ${blNummerSql('p.part_number')}, p.color_id`;
}

export async function lockAccount(tx: DbInterface, userId: number): Promise<boolean> {
  return !!(
    await tx.get<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1, $2) AS ok', [LOCKS.PARTS_SUMMARY, userId])
  )?.ok;
}

/** Same lock, but waiting: an in-progress rebuild gets waited out. */
export async function waitForAccount(tx: DbInterface, userId: number): Promise<void> {
  await tx.run('SELECT pg_advisory_xact_lock($1, $2)', [LOCKS.PARTS_SUMMARY, userId]);
}

export async function rebuildAll(tx: DbInterface, userId: number, stand: number): Promise<void> {
  await tx.run('DELETE FROM parts_summary WHERE user_id = $1', [userId]);
  await tx.run(summaryInsert(false), [userId]);
  await tx.run(
    `
      INSERT INTO parts_summary_state (user_id, built_version, built_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id) DO UPDATE SET built_version = $2, built_at = NOW()`,
    [userId, stand],
  );
}

export async function rebuildGroups(tx: DbInterface, userId: number, gruppen: string[]): Promise<void> {
  await tx.run('DELETE FROM parts_summary WHERE user_id = $1 AND part_key = ANY($2)', [userId, gruppen]);
  await tx.run(summaryInsert(true), [userId, gruppen]);
}

export function analyze(db: DbInterface) {
  return db.exec('ANALYZE parts_summary');
}

export async function lockCatalogFollowUp(tx: DbInterface): Promise<boolean> {
  return !!(await tx.get<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1, 0) AS ok', [LOCKS.PARTS_CATALOG]))?.ok;
}

/** What arrives after stays for the next run. */
export async function pendingNumbers(tx: DbInterface): Promise<string[]> {
  return [
    ...new Set(
      (await tx.all<{ number: string }>('DELETE FROM parts_catalog_pending RETURNING number')).map(r => r.number),
    ),
  ];
}

/** Discard all states: every account rebuilds on its next read. */
export async function discardAllStates(tx: DbInterface): Promise<number> {
  return (await tx.run('DELETE FROM parts_summary_state')).changes ?? 0;
}

/** Before and after: a new mapping moves a part into another group. */
export function affectedGroups(tx: DbInterface, nummern: string[]) {
  return tx.all<{ user_id: number; part_key: string }>(
    `
      SELECT DISTINCT p.user_id, ${blNummerSql('p.part_number')} AS part_key
        FROM parts p
        ${blJoin('p.part_number', 'part', 'p.user_id')}
        JOIN parts_summary_state st ON st.user_id = p.user_id
       WHERE COALESCE(p.source, 'set') <> 'manual'
         AND (p.part_number = ANY($1) OR ${blNummerSql('p.part_number')} = ANY($1))
      UNION
      SELECT user_id, part_key FROM parts_summary WHERE part_key = ANY($1) OR part_number = ANY($1)`,
    [nummern],
  );
}
