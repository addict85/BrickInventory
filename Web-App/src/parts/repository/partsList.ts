import { storages } from '../../../db/inventoryView';
import type { DbInterface, Hit } from '../../../db/database';
import { mengeJoin, quantityFrom, quantityJoin, subsetFrom } from '../../../db/stockQuantity';
import { blJoin, blNumberSql } from '../../../db/blMappingSql';
import { teilSichtJoin, TEIL } from '../../../db/catalogView';
import { LIKE_ESCAPE as E, containsPattern } from '../../../db/likeSearch';

/** Both paths (summary and live) return the same shape, so the UIs don't need to
 * know where the rows came from. */

export interface PartsFilter {
  color?: string | null;
  category?: string | number | null;
  search?: string | null;
  spare?: '0' | '1' | null;
  set_number?: string | null;
  storage?: string | null;
  withoutManual?: boolean;
}

export type PartsOrder = 'color' | 'name' | 'quantity';
/** Fixed list, because the value goes into the query as SQL. */
export function partsOrder(wert: unknown): PartsOrder {
  return wert === 'name' || wert === 'quantity' ? wert : 'color';
}
/** The last key makes the pages stable. */
function orderSql(o: PartsOrder, sp: { color: string; name: string; quantity: string; number: string }): string {
  if (o === 'name') return `${sp.name} ASC, ${sp.color} ASC, ${sp.number} ASC`;
  if (o === 'quantity') return `${sp.quantity} DESC, ${sp.name} ASC, ${sp.number} ASC`;
  return `${sp.color} ASC, ${sp.name} ASC`;
}

/** `pi` is the placeholder for `%text%`. */
function partsSearch(number: string, name: string, blNumber: string, pi: number) {
  return `(${number} ILIKE $${pi}${E} OR ${name} ILIKE $${pi}${E} OR ${blNumber} ILIKE $${pi}${E})`;
}

export interface PartRow {
  part_number: string;
  bl_part_number: string;
  part_name: string | null;
  color_id: number;
  color_name: string | null;
  color_hex: string | null;
  category_name: string | null;
  image_url: string | null;
  image_local: string | null;
  is_spare: boolean;
  total_quantity: number;
  storage: string | null;
  in_sets?: string | null;
}

export interface Page {
  size: number;
  offset: number;
  withSets: boolean;
  order: PartsOrder;
}

export function stockColors(db: DbInterface, uids: number[], fromSummary: boolean) {
  type Color = { color_name: string | null; color_hex: string | null; unique_parts: number; total_quantity: number };
  if (fromSummary)
    return db.all<Color>(
      `
      SELECT ps.color_name, COALESCE(ps.color_hex, rc.rgb) AS color_hex,
             -- DISTINCT on part_key: within a household the same part appears once per account.
             COUNT(DISTINCT ps.part_key)::int AS unique_parts,
             SUM(ps.total_quantity)::int      AS total_quantity
      FROM parts_summary ps
      LEFT JOIN rb_colors rc ON rc.id = ps.color_id
      WHERE ps.user_id = ANY($1)
      GROUP BY ps.color_name, COALESCE(ps.color_hex, rc.rgb)
      ORDER BY total_quantity DESC`,
      [uids],
    );
  return db.all<Color>(
    `
    SELECT ${TEIL.colorName} AS color_name, COALESCE(${TEIL.colorHex}, rc.rgb) AS color_hex,
           COUNT(DISTINCT p.part_number)::int AS unique_parts,
           SUM(${subsetFrom('p', 'part')} * ${quantityFrom('sm', 1)})::int AS total_quantity
    FROM parts p
    ${mengeJoin('p', 'sm', '= ANY($1)')}
    ${quantityJoin('p', 'part')}
    ${teilSichtJoin('p.user_id', 'p.part_number', 'p.color_id')}
    LEFT JOIN rb_colors rc ON rc.id = p.color_id
    WHERE p.user_id = ANY($1) AND COALESCE(p.source,'set') <> 'manual'
    GROUP BY 1, 2 ORDER BY total_quantity DESC`,
    [uids],
  );
}

export async function pageFromSummary(db: DbInterface, uids: number[], f: PartsFilter, s: Page) {
  const cond: string[] = ['user_id = ANY($1)'];
  const params: unknown[] = [uids];
  // The filter sends the color name, not the ID — same as the live path.
  if (f.color) {
    cond.push(`color_name = $${params.length + 1}`);
    params.push(f.color);
  }
  if (f.category) {
    // Own category first, else the one from rb_parts. IN instead of EXISTS: the
    // subquery doesn't hang off the row and is built once as a hash table.
    const pi = params.length + 1;
    cond.push(`(category_name = $${pi} OR part_number IN (SELECT rp.part_num FROM rb_parts rp
                 WHERE rp.part_cat_id::text = $${pi}))`);
    params.push(String(f.category));
  }
  if (f.spare === '0' || f.spare === '1') {
    cond.push(`is_spare = $${params.length + 1}`);
    params.push(f.spare === '1');
  }
  if (f.search) {
    cond.push(partsSearch('part_number', 'part_name', 'bl_part_number', params.length + 1));
    params.push(containsPattern(f.search));
  }
  const where = cond.join(' AND ');
  const multi = uids.length > 1;
  const cols = multi
    ? `MIN(part_number) AS part_number, MIN(bl_part_number) AS bl_part_number, color_id,
       MIN(part_name) AS part_name, MIN(color_name) AS color_name, MIN(color_hex) AS color_hex,
       MIN(category_name) AS category_name, MIN(image_url) AS image_url,
       MIN(image_local) AS image_local, bool_or(is_spare) AS is_spare,
       SUM(total_quantity)::int AS total_quantity,
       NULLIF(STRING_AGG(DISTINCT storage, ', '), '') AS storage` +
      (s.withSets ? ", STRING_AGG(DISTINCT in_sets, ',') AS in_sets" : '')
    : `part_number, bl_part_number, color_id, part_name, color_name, color_hex,
       category_name, image_url, image_local, is_spare, total_quantity::int, storage` + (s.withSets ? ', in_sets' : '');
  const groupSql = multi ? ' GROUP BY part_key, color_id' : '';
  const orderSqlStr = orderSql(
    s.order,
    multi
      ? {
          color: 'MIN(color_name)',
          name: 'MIN(part_name)',
          quantity: 'SUM(total_quantity)',
          number: 'part_key, color_id',
        }
      : { color: 'color_name', name: 'part_name', quantity: 'total_quantity', number: 'part_key, color_id' },
  );
  const [count, rows] = await Promise.all([
    multi
      ? db.get<{ c: number }>(
          `SELECT COUNT(*)::int AS c FROM (
                  SELECT 1 FROM parts_summary WHERE ${where} GROUP BY part_key, color_id
                ) t`,
          params,
        )
      : db.get<{ c: number }>(`SELECT COUNT(*)::int AS c FROM parts_summary WHERE ${where}`, params),
    db.all<PartRow>(
      `SELECT ${cols} FROM parts_summary WHERE ${where}${groupSql}
            ORDER BY ${orderSqlStr} LIMIT ${Number(s.size)} OFFSET ${Number(s.offset)}`,
      params,
    ),
  ]);
  return { total: count?.c ?? 0, rows };
}

function partsWhere(uids: number[], f: PartsFilter) {
  let where = 'p.user_id = ANY($1)';
  const params: unknown[] = [uids];
  let pi = 2;
  if (f.set_number) {
    where += ` AND p.set_number = $${pi++}`;
    params.push(f.set_number);
  }
  // Color, category and name live in the catalog views (pc/pcc), the spare-part
  // flag in the set list (tm_k from quantityJoin).
  if (f.color) {
    where += ` AND ${TEIL.colorName} = $${pi++}`;
    params.push(f.color);
  }
  // Category also via rb_parts: Rebrickable's set-parts response often has
  // none, so the filter list shows the resolved ID.
  if (f.category) {
    where += ` AND (${TEIL.category} = $${pi}
                    OR EXISTS (SELECT 1 FROM rb_parts rp
                                WHERE rp.part_num = p.part_number
                                  AND rp.part_cat_id::text = $${pi}))`;
    pi++;
    params.push(f.category);
  }
  // Spare is a property of the set list; without a row there, there is none.
  if (f.spare === '0') where += ' AND NOT COALESCE(tm_k.is_spare, false)';
  if (f.spare === '1') where += ' AND COALESCE(tm_k.is_spare, false)';
  if (f.withoutManual) where += " AND COALESCE(p.source,'set') <> 'manual'";
  if (f.search) {
    where += ` AND ${partsSearch('p.part_number', TEIL.name, blNumberSql('p.part_number'), pi)}`;
    params.push(containsPattern(f.search));
    pi++;
  }
  // Storage as its own filter, by name, from the stock location view (lo).
  if (f.storage) {
    where += ` AND lo.name = $${pi++}`;
    params.push(String(f.storage));
  }
  return { where, params, pi };
}

/** With a set filter, no set-count multiplier, because that is about the parts OF a set. */
export async function pageLive(db: DbInterface, uids: number[], f: PartsFilter, s: Page) {
  const { where, params, pi } = partsWhere(uids, f);
  // ::int: total_quantity's JSON type must not depend on the branch.
  const qtyExpr = f.set_number
    ? `SUM(${subsetFrom('p', 'part')})::int`
    : `SUM(${subsetFrom('p', 'part')} * ${quantityFrom('sm', 1)})::int`;
  const joinClause =
    (f.set_number ? 'FROM parts p' : `FROM parts p ${mengeJoin('p')}`) +
    ` ${quantityJoin('p', 'part', 'tm', '= ANY($1)')}` +
    ` ${blJoin('p.part_number', 'part', 'p.user_id')}` +
    ` LEFT JOIN ${storages()} lo ON lo.id = p.storage_id` +
    ` ${teilSichtJoin('p.user_id', 'p.part_number', 'p.color_id')}`;
  // Same joins as the main query: each hangs off the primary key and doesn't change the count.
  const countSql = `SELECT COUNT(*)::int AS c FROM (
       SELECT 1 ${joinClause} WHERE ${where}
       GROUP BY ${blNumberSql('p.part_number')}, p.color_id
     ) g`;
  const partsSql = `
    SELECT
      ${blNumberSql('p.part_number')} AS part_number,
      ${blNumberSql('p.part_number')} AS bl_part_number,
      -- The group combines several Rebrickable numbers under the same BrickLink number.
      MIN(${TEIL.name})      AS part_name,
      p.color_id,
      MIN(${TEIL.colorName})  AS color_name,
      MIN(${TEIL.colorHex})  AS color_hex,
      MIN(${TEIL.category}) AS category_name,
      MIN(${TEIL.image})      AS image_url,
      MIN(${TEIL.imageFile}) AS image_local,
      bool_or(COALESCE(tm_k.is_spare, false)) AS is_spare,
      -- All storage locations: the same part sits in different bins coming from different sets.
      NULLIF(STRING_AGG(DISTINCT lo.name, ', '), '') AS storage,
      ${qtyExpr}          AS total_quantity${
        s.withSets
          ? `,
      STRING_AGG(DISTINCT p.set_number, ',') AS in_sets`
          : ''
      }
    ${joinClause}
    WHERE ${where}
    GROUP BY ${blNumberSql('p.part_number')}, p.color_id
    ORDER BY ${orderSql(s.order, {
      color: `MIN(${TEIL.colorName})`,
      name: `MIN(${TEIL.name})`,
      quantity: qtyExpr,
      number: `${blNumberSql('p.part_number')}, p.color_id`,
    })} LIMIT $${pi} OFFSET $${pi + 1}`;
  const [count, rows] = await Promise.all([
    db.get<{ c: number }>(countSql, params),
    db.all<PartRow>(partsSql, [...params, s.size, s.offset]),
  ]);
  return { total: count?.c ?? 0, rows };
}

export function usedManualParts(db: DbInterface, uids: number[]) {
  return db.all<{ pid: string; color_id: number; any_used: number }>(
    `SELECT ${blNumberSql('p.part_number')} AS pid, p.color_id,
            MAX(CASE WHEN pa.condition='U' THEN 1 ELSE 0 END) AS any_used
     FROM parts p
     ${blJoin('p.part_number', 'part', 'p.user_id')}
     JOIN part_acquisitions pa ON pa.user_id=p.user_id AND pa.part_number=p.part_number AND pa.color_id=p.color_id
     WHERE p.user_id = ANY($1) AND p.source='manual'
     GROUP BY ${blNumberSql('p.part_number')}, p.color_id`,
    [uids],
  );
}

export async function hasUnseenBlNumber(db: DbInterface, uids: number[]): Promise<boolean> {
  return !!(await db.get<Hit>(
    `SELECT 1 FROM parts p
     LEFT JOIN bl_mapping m ON m.type = 'part' AND m.rb_id = p.part_number
     WHERE p.user_id = ANY($1) AND m.rb_id IS NULL LIMIT 1`,
    [uids],
  ));
}

export function inventoryAsParts(db: DbInterface, inventoryId: number, setNumber: string) {
  return db.all<PartRow>(
    `
        SELECT ip.part_num AS part_number,
               COALESCE(m.bl_id, ip.part_num) AS bl_part_number,
               p.name AS part_name, ip.color_id,
               c.name AS color_name, c.rgb AS color_hex,
               NULL AS category_name,
               p.part_img_url AS image_url, NULL AS image_local,
               ip.is_spare,
               ip.quantity AS total_quantity,
               $2 AS in_sets
        FROM rb_inventory_parts ip
        LEFT JOIN rb_parts p ON p.part_num = ip.part_num
        LEFT JOIN rb_colors c ON c.id = ip.color_id
        LEFT JOIN bl_mapping  m ON m.type = 'part' AND m.rb_id = ip.part_num
        WHERE ip.inventory_id = $1`,
    [inventoryId, setNumber],
  );
}

export function categories(db: DbInterface, uids: number[], fromSummary: boolean) {
  type Category = { category_name: string | null; label: string | null; unique_parts: number; total_quantity: number };
  const categoryJoin = (column: string, number: string) => `
      LEFT JOIN rb_part_categories rc
             ON rc.id = (CASE WHEN ${column} ~ '^[0-9]+$' THEN ${column}::int ELSE NULL END)
      LEFT JOIN rb_parts rp ON rp.part_num = ${number}
      LEFT JOIN rb_part_categories rp_cat ON rp_cat.id = rp.part_cat_id`;
  // Without a catalog entry a saved name remains ("Bricks"); anything with none shows as ONE unnamed entry.
  const name = (k: string) =>
    `COALESCE(rc.name, rp_cat.name, CASE WHEN ${k} ~ '^[0-9]+$' THEN NULL ELSE NULLIF(${k}, '') END)`;
  const key = (k: string) =>
    `CASE WHEN ${name(k)} IS NULL THEN NULL ELSE COALESCE(rc.id::text, rp_cat.id::text, ${k}) END`;
  const groupBy = 'GROUP BY 1, 2 ORDER BY total_quantity DESC';
  if (fromSummary)
    return db.all<Category>(
      `
      SELECT ${key('ps.category_name')}                         AS category_name,
             ${name('ps.category_name')}                                AS label,
             COUNT(DISTINCT ps.part_key)::int AS unique_parts,
             SUM(ps.total_quantity)::int      AS total_quantity
        FROM parts_summary ps
        ${categoryJoin('ps.category_name', 'ps.part_number')}
       WHERE ps.user_id = ANY($1)
      ${groupBy}`,
      [uids],
    );
  return db.all<Category>(
    `
    SELECT ${key(TEIL.category)}                             AS category_name,
           ${name(TEIL.category)}                                    AS label,
           COUNT(DISTINCT p.part_number)::int AS unique_parts,
           SUM(${subsetFrom('p', 'part')} * ${quantityFrom('sm', 1)})::int AS total_quantity
    FROM parts p
    ${mengeJoin('p', 'sm', '= ANY($1)')}
    ${quantityJoin('p', 'part', 'tm', '= ANY($1)')}
    ${teilSichtJoin('p.user_id', 'p.part_number', 'p.color_id')}
    ${categoryJoin(TEIL.category, 'p.part_number')}
    WHERE p.user_id = ANY($1) AND COALESCE(p.source,'set') <> 'manual'
    ${groupBy}`,
    [uids],
  );
}

export async function stats(db: DbInterface, uids: number[], fromSummary: boolean) {
  type Raw = {
    unique_parts: string | number | null;
    unique_colors: string | number | null;
    total_parts: string | number | null;
  };
  // Part types and colors count set parts AND individually logged parts, because the
  // list below shows both. The total stays without individual parts;
  // those are added as manual_parts (breakdown in the tile).
  const r = fromSummary
    ? await db.get<Raw>(
        `
      WITH arten AS (
        SELECT part_number, color_id FROM parts_summary WHERE user_id = ANY($1)
        UNION
        SELECT part_number, color_id FROM parts WHERE user_id = ANY($1) AND source = 'manual')
      SELECT (SELECT COUNT(DISTINCT part_number) FROM arten)::int AS unique_parts,
             (SELECT COUNT(DISTINCT color_id) FROM arten)::int    AS unique_colors,
             (SELECT COALESCE(SUM(total_quantity), 0) FROM parts_summary WHERE user_id = ANY($1)) AS total_parts`,
        [uids],
      )
    : await db.get<Raw>(
        `
    SELECT COUNT(DISTINCT p.part_number) AS unique_parts,
           COUNT(DISTINCT p.color_id)    AS unique_colors,
           SUM(${subsetFrom('p', 'part')} * ${quantityFrom('sm', 1)})
             FILTER (WHERE COALESCE(p.source, 'set') <> 'manual') AS total_parts
    FROM parts p
    ${mengeJoin('p', 'sm', '= ANY($1)')}
    ${quantityJoin('p', 'part')}
    WHERE p.user_id = ANY($1)`,
        [uids],
      );
  if (!r) return null;
  // Individually logged parts aren't in the summary; the UI adds them to the
  // total so the collection tab and the parts tab show the same number.
  const individual = await db.get<{ t: string | number | null }>(
    `
    SELECT SUM(${subsetFrom('p', 'part')} * ${quantityFrom('sm', 1)}) AS t
    FROM parts p
    ${mengeJoin('p', 'sm', '= ANY($1)')}
    ${quantityJoin('p', 'part')}
    WHERE p.user_id = ANY($1) AND p.source = 'manual'`,
    [uids],
  );
  const number = (v: string | number | null) => parseInt(String(v ?? 0), 10) || 0;
  return {
    unique_parts: number(r.unique_parts),
    unique_colors: number(r.unique_colors),
    total_parts: number(r.total_parts),
    manual_parts: number(individual?.t ?? null),
  };
}

export interface ManualPart {
  id: number;
  user_id: number;
  part_number: string;
  bl_part_number: string;
  part_name: string | null;
  color_id: number;
  color_name: string | null;
  color_hex: string | null;
  category_name: string | null;
  quantity: number;
  image_url: string | null;
  image_local: string | null;
  unit_price: string | null;
  purchase_price: string;
  source: string;
  condition: string;
  storage: string | null;
  created_at: Date;
}

export function manualParts(
  db: DbInterface,
  uids: number[],
  f: { search?: string | null; storage?: string | null },
  page: { size: number; offset: number } | null,
) {
  const params: unknown[] = [uids];
  let filter = '';
  if (f.search) {
    params.push(containsPattern(f.search));
    filter = ` AND ${partsSearch('t.part_number', TEIL.name, blNumberSql('t.part_number'), params.length)}`;
  }
  if (f.storage) {
    params.push(String(f.storage));
    filter += ` AND lo.name = $${params.length}`;
  }
  let limit = '';
  if (page) {
    params.push(page.size, page.offset);
    limit = ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  return db.all<ManualPart>(
    `
    SELECT t.id, t.user_id, t.part_number,
           ${blNumberSql('t.part_number')} AS bl_part_number,
           ${TEIL.name} AS part_name, t.color_id,
           ${TEIL.colorName} AS color_name, ${TEIL.colorHex} AS color_hex,
           ${TEIL.category} AS category_name,
           ${subsetFrom('t', 'part')} AS quantity,
           ${TEIL.image} AS image_url, ${TEIL.imageFile} AS image_local,
           -- unit_price is the entered price and may be empty, purchase_price
           -- is the display value (0 means "nothing known"), see src/finances/priceRule.ts.
           neu.unit_price,
           COALESCE(neu.unit_price, 0) AS purchase_price,
           t.source,
           COALESCE(neu.condition, 'N') AS condition,
           lo.name AS storage,
           -- The name stays as-is externally, so UIs and the app read it unchanged.
           t.added_at AS created_at
    FROM parts t
    ${quantityJoin('t', 'part')}
    ${blJoin('t.part_number', 'part', 't.user_id')}
    ${teilSichtJoin('t.user_id', 't.part_number', 't.color_id')}
    LEFT JOIN ${storages()} lo ON lo.id = t.storage_id
    -- The latest acquisition: same ordering as everywhere else, otherwise
    -- "latest price" and "latest acquisition" would mean two different things.
    LEFT JOIN LATERAL (
      SELECT a.unit_price, a.condition
        FROM part_acquisitions a
       WHERE a.user_id = t.user_id AND a.part_number = t.part_number
         AND a.color_id = t.color_id
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 1
    ) neu ON TRUE
    WHERE t.user_id = ANY($1) AND t.source = 'manual'${filter}
    ORDER BY ${TEIL.name} ASC, t.part_number ASC${limit}`,
    params,
  );
}

type Holding = { total: number; loose: number };

/** gesamt includes the set multiplier, lose only from manual acquisitions. */
export function ownedParts(db: DbInterface, uids: number[], numbers: string[], colorIds: number[]) {
  return db.all<Holding & { part_number: string; color_id: number }>(
    `SELECT p.part_number,
            p.color_id,
            COALESCE(SUM(CASE WHEN COALESCE(p.source,'set') = 'manual'
                              THEN ${subsetFrom('p', 'part')}
                              ELSE ${subsetFrom('p', 'part')} * ${quantityFrom('sm', 1)}
                         END), 0)::int                                AS total,
            COALESCE(SUM(CASE WHEN COALESCE(p.source,'set') = 'manual'
                              THEN ${subsetFrom('p', 'part')} ELSE 0 END), 0)::int AS loose
       FROM parts p
       ${mengeJoin('p', 'sm', '= ANY($1)')}
       ${quantityJoin('p', 'part')}
       JOIN unnest($2::text[], $3::int[]) AS g(part_number, color_id)
         ON g.part_number = p.part_number AND g.color_id = p.color_id
      WHERE p.user_id = ANY($1)
      GROUP BY p.part_number, p.color_id`,
    [uids, numbers, colorIds],
  );
}

export function ownedMinifigs(db: DbInterface, uids: number[], numbers: string[]) {
  return db.all<Holding & { part_number: string }>(
    `SELECT m.fig_number                                                AS part_number,
            COALESCE(SUM(CASE WHEN COALESCE(m.source,'set') = 'manual'
                              THEN ${subsetFrom('m', 'fig')}
                              ELSE ${subsetFrom('m', 'fig')} * ${quantityFrom('sm', 1)}
                         END), 0)::int                                  AS total,
            COALESCE(SUM(CASE WHEN COALESCE(m.source,'set') = 'manual'
                              THEN ${subsetFrom('m', 'fig')} ELSE 0 END), 0)::int AS loose
       FROM minifigs m
       ${mengeJoin('m', 'sm', '= ANY($1)')}
       ${quantityJoin('m', 'fig')}
       JOIN unnest($2::text[]) AS g(fig_number)
         ON g.fig_number = m.fig_number
      WHERE m.user_id = ANY($1)
      GROUP BY m.fig_number`,
    [uids, numbers],
  );
}
