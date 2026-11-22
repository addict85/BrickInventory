import { storages, setBestand } from '../../../db/inventoryView';
import { blJoin, blNumberSql } from '../../../db/blMappingSql';
import { quantityFrom, mengeJoin, subsetFrom, teilmengeJoin } from '../../../db/stockQuantity';
import type { Row, DbInterface } from '../../../db/database';
import { minifigViewJoin, MINIFIG } from '../../../db/catalogView';
import { LIKE_ESCAPE as E, containsPattern } from '../../../db/likeSearch';

// One search for both minifig lists; it searches the number shown on the tile.
function minifigSearch(number: string, name: string, pi: number) {
  return `(${number} ILIKE $${pi}${E} OR ${name} ILIKE $${pi}${E})`;
}

/** Groups are counted, or a minifig from five sets would count five times. */
export async function groupedMinifigs(
  db: DbInterface,
  uids: number[],
  f: {
    search?: string | null;
    source?: string | null;
    setNumber: string | null;
    seite: { groesse: number; versatz: number } | null;
  },
) {
  const { search, source } = f;
  const params: unknown[] = [uids];
  let pi = 2;
  let where = 'm.user_id = ANY($1)';
  if (f.setNumber) {
    where += ` AND m.set_number = $${pi++}`;
    params.push(f.setNumber);
  }
  if (source === 'set') where += " AND m.source = 'set'";
  if (source === 'manual') where += " AND m.source = 'manual'";
  if (search) {
    // The minifig's name sits in the catalog; figurSichtJoin follows every
    // query that uses this condition.
    where += ` AND ${minifigSearch('m.fig_number', MINIFIG.name, pi)}`;
    params.push(containsPattern(search));
    pi++;
  }
  const figParams = [...params];
  let figLimit = '';
  if (f.seite) {
    figParams.push(f.seite.groesse, f.seite.versatz);
    figLimit = ` LIMIT $${figParams.length - 1} OFFSET $${figParams.length}`;
  }
  // The count needs no join on sets.
  const figCount = f.seite
    ? await db.get<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM (
         SELECT 1 FROM minifigs m
         ${minifigViewJoin('m.user_id', 'm.fig_number')}
         WHERE ${where} GROUP BY LOWER(TRIM(m.fig_number)), m.source) g`,
        params,
      )
    : null;

  const figs = await db.all<Row<{ fig_number: string; image_local: string | null; owner_ids: number[] | null }>>(
    `
    SELECT MIN(m.id) AS id,
           -- Owners of the GROUP: the row sums the minifig across every account
           -- and no longer has a single user_id.
           array_agg(DISTINCT m.user_id) AS owner_ids,
           MIN(TRIM(m.fig_number)) AS fig_number,
           -- MAX, because the group merges several spellings of the same number.
           MAX(${MINIFIG.name}) AS fig_name,
           -- Manually the sum of acquisitions, from a set the catalog count.
           SUM(${subsetFrom('m', 'fig')})::int AS quantity,
           MAX(${MINIFIG.image}) AS image_url,
           MAX(${MINIFIG.bildDatei}) AS image_local,
           m.source,
           -- Price from the latest acquisition; MAX, because the group merges
           -- several spellings of the same number.
           MAX(neu.unit_price) AS unit_price,
           MIN(m.set_number) AS set_number,
           -- The set's quantity as a factor; 1 without an acquisition, so a
           -- manual minifig simply counts.
           SUM(${subsetFrom('m', 'fig')} * ${quantityFrom('sm', 1)})::int AS total_quantity,
           STRING_AGG(DISTINCT m.set_number, ',') FILTER (WHERE m.set_number IS NOT NULL) AS in_sets,
           -- Storage location of the GROUP: if the minifig sits in two places, both show.
           NULLIF(STRING_AGG(DISTINCT lo.name, ', '), '') AS storage,
           MAX(s.added_at) AS set_added_at
    FROM minifigs m
    ${mengeJoin('m')}
    ${teilmengeJoin('m', 'fig')}
    -- The sets row only for added_at; the quantity comes from mengeJoin().
    LEFT JOIN ${setBestand()} s ON s.user_id = m.user_id AND s.set_number = m.set_number
    -- LEFT JOIN, so a minifig without a location doesn't fall out of the list.
    LEFT JOIN ${storages()} lo ON lo.id = m.storage_id
    -- Over the primary key, so at most one row per match.
    ${minifigViewJoin('m.user_id', 'm.fig_number')}
    -- The latest acquisition per minifig — same ordering as latestSql in
    -- routes/api_v1/acquisitions.ts, so "latest price" and "latest
    -- acquisition" mean the same thing.
    LEFT JOIN LATERAL (
      SELECT a.unit_price
        FROM minifig_acquisitions a
       WHERE a.user_id = m.user_id AND a.fig_number = m.fig_number
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 1
    ) neu ON TRUE
    WHERE ${where}
    -- LOWER(TRIM(...)): import paths (Rebrickable API vs. CSV catalog) can
    -- return the same minifig number with whitespace/case variants — those
    -- would otherwise silently defeat the grouping.
    GROUP BY LOWER(TRIM(m.fig_number)), m.source
    ORDER BY MAX(${MINIFIG.name}) ASC, LOWER(TRIM(m.fig_number)) ASC${figLimit}`,
    figParams,
  );
  return { figCount, figs };
}

export async function manualMinifigsList(
  db: DbInterface,
  uids: number[],
  search: string | null | undefined,
  page: { groesse: number; versatz: number } | null,
) {
  const params: unknown[] = [uids];
  // Placeholders before LIMIT/OFFSET.
  let suche = '';
  if (search) {
    params.push(containsPattern(search));
    suche = ` AND ${minifigSearch('m.fig_number', MINIFIG.name, params.length)}`;
  }
  let limit = '';
  if (page) {
    params.push(page.groesse, page.versatz);
    limit = ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  const figs = await db.all<Row<{ fig_number: string; image_local: string | null }>>(
    // Name and image: verified from the catalog, else the account's own entry.
    `SELECT m.id, m.user_id, m.set_number, m.fig_number,
            -- The BrickLink number from the mapping (migration 0037); used to be
            -- m.bl_fig_number, a per-account copy. The outward field name stays.
            ${blNumberSql('m.fig_number', 'blz')} AS bl_fig_number,
            -- The quantity from acquisitions (migration 0038); used to be
            -- m.quantity. This list shows only manual minifigs.
            ${subsetFrom('m', 'fig')} AS quantity,
            m.source, m.storage_id,
            -- Price and condition from the LATEST acquisition (migration 0035).
            -- The two meanings stay distinct, as src/finances/priceRule.ts
            -- spells them out: unit_price is the entered price and may be
            -- empty, purchase_price is the DISPLAY value and is never empty.
            neu.unit_price,
            COALESCE(neu.unit_price, 0) AS purchase_price,
            COALESCE(neu.condition, 'N') AS condition,
            ${MINIFIG.name} AS fig_name, ${MINIFIG.image} AS image_url, ${MINIFIG.bildDatei} AS image_local,
            lo.name AS storage
       FROM minifigs m
       ${teilmengeJoin('m', 'fig')}
       ${blJoin('m.fig_number', 'fig', 'm.user_id')}
       ${minifigViewJoin('m.user_id', 'm.fig_number')}
       LEFT JOIN ${storages()} lo ON lo.id = m.storage_id
       LEFT JOIN LATERAL (
         SELECT a.unit_price, a.condition
           FROM minifig_acquisitions a
          WHERE a.user_id = m.user_id AND a.fig_number = m.fig_number
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT 1
       ) neu ON TRUE
      WHERE m.user_id = ANY($1) AND m.source = 'manual'${suche}
      ORDER BY ${MINIFIG.name} ASC, m.fig_number ASC${limit}`,
    params,
  );
  return figs;
}

export function conditionCountsOfManualMinifigs(db: DbInterface, uids: number[]) {
  return db.all<{ fkey: string; acq_count: number; used_count: number }>(
    `SELECT LOWER(TRIM(a.fig_number)) AS fkey,
            COUNT(*)::int AS acq_count,
            COUNT(*) FILTER (WHERE a.condition = 'U')::int AS used_count
     FROM minifig_acquisitions a
     WHERE a.user_id = ANY($1)
     GROUP BY LOWER(TRIM(a.fig_number))`,
    [uids],
  );
}

export function minifigStats(db: DbInterface, uids: number[]) {
  return db.get<{ types: number; total_quantity: number; manual: number }>(
    `
    SELECT COUNT(*)::int AS types,
           COALESCE(SUM(g.quantity), 0)::int AS total_quantity,
           COUNT(*) FILTER (WHERE g.source = 'manual')::int AS manual
      FROM (
        SELECT m.source, SUM(${subsetFrom('m', 'fig')} * ${quantityFrom('sm', 1)}) AS quantity
          FROM minifigs m
          ${mengeJoin('m', 'sm', '= ANY($1)')}
          ${teilmengeJoin('m', 'fig')}
         WHERE m.user_id = ANY($1)
         GROUP BY LOWER(TRIM(m.fig_number)), m.source
      ) g`,
    [uids],
  );
}
