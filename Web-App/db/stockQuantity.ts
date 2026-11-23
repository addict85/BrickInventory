/**
 * The quantity of a set — derived, not stored.
 */

/** `::int`: SUM(INTEGER) yields BIGINT, and the driver returns that as a
 * string — otherwise the JSON type of `quantity` would depend on the branch. */
const SUM = 'SUM(a.quantity)::int';

/** Quantity as a subquery in the column list. `bezug` is the alias
 * of a row with `user_id` and `set_number` (i.e. `sets`). */
export function quantityScalar(basis: string): string {
  return `COALESCE((SELECT ${SUM} FROM set_acquisitions a
                     WHERE a.user_id = ${basis}.user_id
                       AND a.set_number = ${basis}.set_number), 0)`;
}

/** Quantity as a grouped JOIN source (`<alias>.menge`). `accounts`, e.g.
 * `= ANY($1)`, already filters in the subquery: the planner does not pull the
 * account condition of the JOIN inside and would otherwise sum all accounts. */
export function setQuantityJoin(basis: string, alias = 'sm', accounts?: AccountFilter): string {
  const filter = accounts
    ? `
                      WHERE ${onAccounts('a.user_id', accounts)}`
    : '';
  return `LEFT JOIN (SELECT a.user_id, a.set_number, ${SUM} AS quantity
                       FROM set_acquisitions a${filter}
                      GROUP BY a.user_id, a.set_number) ${alias}
               ON ${alias}.user_id = ${basis}.user_id
              AND ${alias}.set_number = ${basis}.set_number`;
}

/** The quantity column for [setQuantityJoin], never NULL (NULL would make every product
 * NULL). `fehlt`: 0 for a quantity, 1 for a factor. */
export function quantityFrom(alias = 'sm', isMissing: 0 | 1 = 0): string {
  return `COALESCE(${alias}.quantity, ${isMissing})`;
}

/**
 * The quantity of a set across a whole SCOPE, as a finished query.
 * @param accounts 'eines' for one account id, 'blickfeld' for a list.
 */
export function quantitySumSql(accounts: 'eines' | 'blickfeld'): string {
  return `SELECT COALESCE(${SUM}, 0) AS q
            FROM set_acquisitions a
            JOIN sets s ON s.user_id = a.user_id AND s.set_number = a.set_number
           WHERE a.user_id ${accounts === 'blickfeld' ? '= ANY($1)' : '= $1'}
             AND a.set_number = $2`;
}

import type { DbInterface } from './database';
import { onAccounts, type AccountFilter } from './accounts';
import { colorId } from '../src/infra/validate';

/** What a reader needs to be able to do here, and no more: `db` or a transaction. */
type Writer = Pick<DbInterface, 'get'>;

/**
 * The quantity of ONE set row — as a number, not as an SQL snippet.
 */
export async function quantityOfSets(userId: number, setNumber: string, dbh: Writer): Promise<number | null> {
  const row = await dbh.get<{ quantity: unknown }>(
    `SELECT ${quantityScalar('s')} AS quantity
       FROM sets s WHERE s.user_id = $1 AND s.set_number = $2`,
    [userId, setNumber],
  );
  return row ? parseInt(String(row.quantity), 10) || 0 : null;
}

// Parts and minifigs still have a quantity column, because it carries two
// meanings.

/** Which inventory. Sets are not here: their column is gone since 0036. */
export interface EntryRow {
  id: number;
  quantity: number;
  purchase_price?: number | null;
  unit_price?: number | null;
  condition: string;
  price_estimated: boolean;
  currency: string | null;
  created_at: Date | null;
  owner_user_id: number;
}

export type StockKind = 'part' | 'fig';

/** Per kind: tables, keys and column names. Once, as a table. */
const KIND = {
  part: {
    holding: 'parts',
    acquisition: 'part_acquisitions',
    catalogTable: 'set_parts',
    number: 'part_number',
    // The color belongs in both keys; "not specified" is 0 in the
    // acquisition, possibly NULL in the inventory row.
    color: true,
  },
  fig: {
    holding: 'minifigs',
    acquisition: 'minifig_acquisitions',
    catalogTable: 'set_minifigs_catalog',
    number: 'fig_number',
    color: false,
  },
} as const;

/** The JOIN sources `<alias>_e` (acquisitions) and `<alias>_k` (catalog) for
 * the quantity of the inventory row `bezug`; `accounts` as for [setQuantityJoin]. */
export function quantityJoin(basis: string, kind: StockKind, alias = 'tm', accounts?: AccountFilter): string {
  const a = KIND[kind];
  const colorAcq = a.color ? `, x.color_id AS fk` : '';
  const colorCmp = a.color ? ` AND ${alias}_e.fk = ${basis}.color_id` : '';
  const colorCat = a.color ? ` AND ${alias}_k.color_id = ${basis}.color_id` : '';
  return `LEFT JOIN (SELECT x.user_id, x.${a.number}${colorAcq},
                             SUM(x.quantity)::int AS quantity
                        FROM ${a.acquisition} x${
                          accounts
                            ? `
                       WHERE ${onAccounts('x.user_id', accounts)}`
                            : ''
                        }
                       GROUP BY x.user_id, x.${a.number}${a.color ? ', x.color_id' : ''}) ${alias}_e
               ON ${alias}_e.user_id = ${basis}.user_id
              AND ${alias}_e.${a.number} = ${basis}.${a.number}${colorCmp}
    LEFT JOIN ${a.catalogTable} ${alias}_k
               ON ${alias}_k.set_number = ${basis}.set_number
              AND ${alias}_k.${a.number} = ${basis}.${a.number}${colorCat}`;
}

/**
 * The quantity of the inventory row — the case distinction itself.
 */
export function subsetFrom(basis: string, _kind: StockKind, alias = 'tm'): string {
  return `CASE WHEN COALESCE(${basis}.source, 'set') = 'manual'
               THEN COALESCE(${alias}_e.quantity, 0)
               ELSE COALESCE(${alias}_k.quantity, 1) END`;
}

/**
 * The quantity of ONE manual item — as a number, not as a snippet.
 */
export async function quantityThePosition(
  kind: StockKind,
  userId: number,
  keys: (string | number | null)[],
  dbh: Pick<DbInterface, 'get'>,
): Promise<number | null> {
  const a = KIND[kind];
  const color = a.color ? ' AND b.color_id = $3' : '';
  const colorAcq = a.color ? ' AND x.color_id = $3' : '';
  const params = a.color ? [userId, keys[0], colorId(keys[1])] : [userId, keys[0]];
  const row = await dbh.get<{ quantity: unknown }>(
    `SELECT COALESCE((SELECT SUM(x.quantity) FROM ${a.acquisition} x
                       WHERE x.user_id = $1 AND x.${a.number} = $2${colorAcq}), 0)::int AS quantity
       FROM ${a.holding} b
      WHERE b.user_id = $1 AND b.${a.number} = $2${color}
        AND b.source = 'manual'`,
    params,
  );
  return row ? parseInt(String(row.quantity), 10) || 0 : null;
}

/** The day of an acquisition exactly as in the unique index (0070): `day`, for
 * older rows the UTC day. A different expression would not hit the index. */
export function acquisitionDaySql(alias = ''): string {
  const a = alias ? `${alias}.` : '';
  return `COALESCE(${a}day, (${a}created_at AT TIME ZONE 'UTC')::date)`;
}

/** Condition: the purchase price is recorded in today's account currency — a
 * price in another currency would falsify averages. The currency comes
 * once per query from [kontowaehrungJoin]. */
export function inAccountCurrency(table: string, alias = 'kw'): string {
  return `${table}.currency = COALESCE(${alias}.value, 'EUR')`;
}

/** The account currency as a JOIN source for [inKontowaehrung]. */
export function accountCurrencyJoin(table: string, alias = 'kw'): string {
  return `LEFT JOIN user_settings ${alias}
            ON ${alias}.user_id = ${table}.user_id AND ${alias}.key = 'currency'`;
}

/** The three acquisition tables; the unique index (migration 0070) covers
 * account, element, day, condition, price, estimate and currency. */
export type AcquisitionKind = 'set' | 'part' | 'fig';
export const ENTRY_TABLES = {
  set: { table: 'set_acquisitions', price: 'purchase_price', keys: ['set_number'] },
  part: { table: 'part_acquisitions', price: 'unit_price', keys: ['part_number', 'color_id'] },
  fig: { table: 'minifig_acquisitions', price: 'unit_price', keys: ['fig_number'] },
} as const;
export const priceColumn = (kind: AcquisitionKind): string => ENTRY_TABLES[kind].price;
export const keyColumns = (kind: AcquisitionKind): readonly string[] => ENTRY_TABLES[kind].keys;
