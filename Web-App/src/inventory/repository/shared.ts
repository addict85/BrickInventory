import type { DbInterface } from '../../../db/database';
import { inAccountCurrency, accountCurrencyJoin, subsetFrom } from '../../../db/stockQuantity';
import type { InventoryReadContract } from '../readContract';
import { teilSichtJoin, minifigViewJoin, setMasterJoin, TEIL, MINIFIG, SET } from '../../../db/catalogView';

/** Purchase price weighted by quantity in the account currency. */
export function entryMetrics(db: DbInterface, l: InventoryReadContract, kind: 'part' | 'fig', uids: number[]) {
  return db.all<{
    part_number?: string;
    color_id?: number | null;
    fig_number?: string;
    acq_count: string;
    used_count: string;
    avg_purchase_price: number | null;
  }>(
    kind === 'part'
      ? `SELECT part_number, color_id,
                COUNT(*) AS acq_count,
                COUNT(*) FILTER (WHERE condition = 'U') AS used_count,
                SUM(unit_price * quantity) FILTER (WHERE unit_price IS NOT NULL AND ${inAccountCurrency('e')})::numeric
                  / NULLIF(SUM(quantity) FILTER (WHERE unit_price IS NOT NULL AND ${inAccountCurrency('e')}), 0) AS avg_purchase_price
           FROM ${l.teilErfassungen('= ANY($1)')} e ${accountCurrencyJoin('e')}
          GROUP BY part_number, color_id`
      : `SELECT fig_number,
                COUNT(*) AS acq_count,
                COUNT(*) FILTER (WHERE condition = 'U') AS used_count,
                SUM(unit_price * quantity) FILTER (WHERE unit_price IS NOT NULL AND ${inAccountCurrency('e')})::numeric
                  / NULLIF(SUM(quantity) FILTER (WHERE unit_price IS NOT NULL AND ${inAccountCurrency('e')}), 0) AS avg_purchase_price
           FROM ${l.figurErfassungen('= ANY($1)')} e ${accountCurrencyJoin('e')}
          GROUP BY fig_number`,
    [uids],
  );
}

/** Columns that may be searched. See usingSets(). */
const SEARCH_COLUMNS = new Set(['part_number', 'color_id', 'fig_number']);

/** Figures have neither color nor category; fixed NULL, so that both branches
 * deliver the same shape. */
const HEADER_FIELDS = {
  parts: `x.part_number AS number, MAX(${TEIL.name}) AS name,
          MAX(x.color_id) AS color_id, MAX(${TEIL.farbname}) AS color_name,
          MAX(${TEIL.farbcode}) AS color_hex, MAX(${TEIL.kategorie}) AS category_name,
          MAX(${TEIL.bildDatei}) AS teil_image_local, MAX(${TEIL.image}) AS teil_image_url,
          bool_or(COALESCE(spc.is_spare, false)) AS is_spare,
          NULLIF(STRING_AGG(DISTINCT lo.name, ', '), '') AS storage`,
  minifigs: `x.fig_number AS number, MAX(${MINIFIG.name}) AS name,
          NULL::int AS color_id, NULL::text AS color_name,
          NULL::text AS color_hex, NULL::text AS category_name,
          MAX(${MINIFIG.bildDatei}) AS teil_image_local, MAX(${MINIFIG.image}) AS teil_image_url,
          false AS is_spare, NULL::text AS storage`,
} as const;

// Since 0034 the description is in the catalog; JOINs over the primary key do not change the grouping.
const CATALOG_JOIN = {
  parts: `${teilSichtJoin('x.user_id', 'x.part_number', 'x.color_id')}
          LEFT JOIN set_parts spc ON spc.set_number  = x.set_number
                                         AND spc.part_number = x.part_number
                                         AND spc.color_id    = x.color_id`,
  minifigs: minifigViewJoin('x.user_id', 'x.fig_number'),
} as const;

const KEY_COLUMN = { parts: 'x.part_number', minifigs: 'x.fig_number' } as const;

const ART = { parts: 'part', minifigs: 'fig' } as const;

/** A set that contains the component, with the component's header fields. */
export interface UsageRow {
  set_number: string;
  owner_user_id: number;
  quantity: number;
  set_name: string | null;
  set_image_local: string | null;
  set_image_url: string | null;
  number: string;
  name: string | null;
  color_id: number | null;
  color_name: string | null;
  color_hex: string | null;
  category_name: string | null;
  teil_image_local: string | null;
  teil_image_url: string | null;
  is_spare: unknown;
  storage: string | null;
}

export async function setsWithComponent(
  db: DbInterface,
  l: InventoryReadContract,
  uids: number[],
  table: 'parts' | 'minifigs',
  key: Record<string, string | number>,
) {
  const columns = Object.keys(key);
  // The names come from literals, the bound stays anyway: a column name
  // cannot be bound as a parameter.
  for (const sp of columns) {
    if (!SEARCH_COLUMNS.has(sp)) throw new Error(`verwendendeSets: unerlaubte Spalte ${sp}`);
  }
  const params: (number[] | string | number | undefined)[] = [uids];
  const conditions = columns.map(sp => `x.${sp} = $${params.push(key[sp])}`);
  return db.all<UsageRow>(
    `SELECT x.set_number,
            x.user_id            AS owner_user_id,
            -- Die Stückzahl der Bestandszeile (Migration 0038): Fuer ein
            -- Set-Teil die Katalogzahl, fuer ein manuelles die Summe der
            -- Erfassungen. Hier stand SUM(x.quantity).
            --
            -- Die Art steht nicht im Alias: Diese Abfrage bedient BEIDE
            -- Tabellen ueber ${table}, und der Helfer braucht dieselbe
            -- Unterscheidung — deshalb kommt sie wie KOPFFELDER aus einer
            -- Zuordnung je Tabelle.
            SUM(${subsetFrom('x', ART[table])})::int AS quantity,
            ${SET.name}          AS set_name,
            c.image_local        AS set_image_local,
            c.image_url          AS set_image_url,
            ${HEADER_FIELDS[table]}
       FROM ${table} x
       ${l.teilmengeJoin('x', ART[table])}
       -- Name und Bild haengen nur an der Setnummer, nicht am Konto.
       LEFT JOIN set_catalog c ON c.set_number = x.set_number
       ${setMasterJoin('x.set_number')}
       -- Der Lagerortname aus dem Vorrat (Migration 0031). Steht hier und
       -- nicht nur im parts-Zweig von KOPFFELDER, weil der minifigs-Zweig ihn
       -- als feste NULL fuehrt — ein unbenutzter LEFT JOIN kostet dort nichts
       -- und haelt die Abfrage in EINER Form.
       LEFT JOIN storage_locations lo ON lo.id = x.storage_id
       ${CATALOG_JOIN[table]}
      WHERE x.user_id = ANY($1)
        AND x.set_number IS NOT NULL
        AND ${conditions.join(' AND ')}
      GROUP BY x.set_number, x.user_id, ${KEY_COLUMN[table]},
               rs.name, c.image_local, c.image_url
      ORDER BY x.set_number`,
    params,
  );
}

/** With the set go its parts and figures. */
/** The set with contents and purchases; manual parts and figures carry no set number and stay. */
export async function removeSetContent(tx: DbInterface, uids: number[], setNumber: string): Promise<void> {
  await tx.run('DELETE FROM parts WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
  await tx.run('DELETE FROM minifigs WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
  await tx.run('DELETE FROM set_acquisitions WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
  await tx.run('DELETE FROM sets WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
}

export async function createSet(tx: DbInterface, uid: number, sn: string, addedAt?: string): Promise<void> {
  await tx.run(
    `INSERT INTO sets (user_id, set_number, added_at) VALUES ($1, $2, COALESCE($3::timestamptz, NOW()))
     ON CONFLICT (user_id, set_number) DO NOTHING`,
    [uid, sn, addedAt ?? null],
  );
}

/** Only key and origin: description and piece count are in the catalog. */
export async function copySetContent(
  tx: DbInterface,
  table: 'parts' | 'minifigs',
  sn: string,
  fromValue: number,
  nach: number,
): Promise<number> {
  const sql = {
    parts: `INSERT INTO parts (user_id, set_number, part_number, color_id, source)
            SELECT $1, set_number, part_number, color_id, source FROM parts
             WHERE user_id = $2 AND set_number = $3 AND COALESCE(source,'set') <> 'manual'
               AND NOT EXISTS (SELECT 1 FROM parts WHERE user_id = $1 AND set_number = $3)`,
    minifigs: `INSERT INTO minifigs (user_id, set_number, fig_number, source)
               SELECT $1, set_number, fig_number, source FROM minifigs
                WHERE user_id = $2 AND set_number = $3 AND COALESCE(source,'set') <> 'manual'
                  AND NOT EXISTS (SELECT 1 FROM minifigs WHERE user_id = $1 AND set_number = $3)`,
  }[table];
  return (await tx.run(sql, [nach, fromValue, sn])).changes ?? 0;
}

/** Without quantity: it arises from the acquisition that moves along right away. */
export async function createManual(
  tx: DbInterface,
  kind: 'part' | 'fig',
  uid: number,
  key: (string | number)[],
): Promise<void> {
  if (kind === 'part')
    await tx.run(
      `INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1,$2,$3,'manual') ON CONFLICT DO NOTHING`,
      [uid, ...key],
    );
  else
    await tx.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,$2,'manual') ON CONFLICT DO NOTHING`, [
      uid,
      ...key,
    ]);
}

export function loescheTeilZeile(dbh: Pick<DbInterface, 'run'>, ownerId: number, partNumber: string, colorId: number) {
  return dbh.run("DELETE FROM parts WHERE user_id=$1 AND part_number=$2 AND color_id=$3 AND source='manual'", [
    ownerId,
    partNumber,
    colorId,
  ]);
}

export function deleteMinifigRow(dbh: Pick<DbInterface, 'run'>, ownerId: number, figNumber: string) {
  return dbh.run("DELETE FROM minifigs WHERE user_id=$1 AND fig_number=$2 AND source='manual'", [ownerId, figNumber]);
}

export function setPartLocation(tx: DbInterface, storageId: number, id: number) {
  return tx.run('UPDATE parts SET storage_id = $1 WHERE id = $2', [storageId, id]);
}

export function loescheTeilzeile(tx: DbInterface, id: number) {
  return tx.run('DELETE FROM parts WHERE id = $1', [id]);
}

export function updatePartRowColor(tx: DbInterface, colorId: number, id: number) {
  return tx.run('UPDATE parts SET color_id = $1 WHERE id = $2', [colorId, id]);
}

export function manualPartsOfAccount(db: DbInterface, uid: number) {
  return db.all<{ part_number: string; color_id: number }>(
    "SELECT part_number, color_id FROM parts WHERE user_id = $1 AND source = 'manual'",
    [uid],
  );
}

export function manualMinifigsOfAccount(db: DbInterface, uid: number) {
  return db.all<{ fig_number: string }>("SELECT fig_number FROM minifigs WHERE user_id = $1 AND source = 'manual'", [
    uid,
  ]);
}
