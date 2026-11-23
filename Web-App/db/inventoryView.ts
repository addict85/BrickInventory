/** Inventory, acquisitions, wanted list and price alerts as subqueries with fixed columns: whoever
 * restructures a table adjusts the view, not every reader. The SQL counts towards the area that
 * embeds it; if that area sits below the owner, it gets it through its read contract (docs/architecture.md).
 * Without `accounts` all accounts apply. */
import { onAccounts, type AccountFilter } from './accounts';

const only = (accounts?: AccountFilter) => (accounts ? ` WHERE ${onAccounts('user_id', accounts)}` : '');

/** Sets in the inventory (src/inventory): id, user_id, set_number, storage_id, added_at. */
export const setHoldings = (accounts?: AccountFilter) =>
  `(SELECT id, user_id, set_number, storage_id, added_at FROM sets${only(accounts)})`;

/** Parts in the inventory (src/inventory): id, user_id, set_number, part_number, color_id, source, storage_id, added_at. */
export const partHoldings = (accounts?: AccountFilter) =>
  `(SELECT id, user_id, set_number, part_number, color_id, source, storage_id, added_at FROM parts${only(accounts)})`;

/** Minifigs in the inventory (src/inventory): id, user_id, set_number, fig_number, source, storage_id. */
export const figHoldings = (accounts?: AccountFilter) =>
  `(SELECT id, user_id, set_number, fig_number, source, storage_id FROM minifigs${only(accounts)})`;

/** Storage locations (src/inventory): id, user_id, name. */
export const storages = (accounts?: AccountFilter) =>
  `(SELECT id, user_id, name FROM storage_locations${only(accounts)})`;

const ACQUISITION = 'id, user_id, quantity, condition, created_at, currency, price_estimated, day';

/** Purchases of a set (src/inventory): the acquisition columns, set_number, purchase_price. */
export const setAcquisitions = (accounts?: AccountFilter) =>
  `(SELECT ${ACQUISITION}, set_number, purchase_price FROM set_acquisitions${only(accounts)})`;

/** Purchases of manual parts (src/inventory): the acquisition columns, part_number, color_id, unit_price. */
export const partAcquisitions = (accounts?: AccountFilter) =>
  `(SELECT ${ACQUISITION}, part_number, color_id, unit_price FROM part_acquisitions${only(accounts)})`;

/** Purchases of manual minifigs (src/inventory): the acquisition columns, fig_number, unit_price. */
export const figAcquisitions = (accounts?: AccountFilter) =>
  `(SELECT ${ACQUISITION}, fig_number, unit_price FROM minifig_acquisitions${only(accounts)})`;

/** Wanted list (src/wanted); the name mirrors src/finances's FinancesReadContract.wantedList,
 * which is out of this phase's scope — see the Phase 2a report. */
export const wantedList = (accounts?: AccountFilter) =>
  `(SELECT user_id, set_number, condition FROM wanted${only(accounts)})`;

/** Own instructions (src/sets): user_id, set_number. */
export const instructions = (accounts?: AccountFilter) =>
  `(SELECT user_id, set_number FROM instructions${only(accounts)})`;

/** A set counts as long as an account holds, wants or watches it: only then does it need an image,
 * a master row and a price. The rule stands once, for images, catalog sync and scope. */
const COUNTS = [
  { table: 'sets', owned: true },
  { table: 'wanted', owned: false },
  { table: 'price_alerts', owned: false },
] as const;

/** Condition: the set with number `nummer` counts for some account. */
export const setCounts = (number: string) =>
  `(${COUNTS.map(z => `EXISTS (SELECT 1 FROM ${z.table} WHERE set_number = ${number})`).join(' OR ')})`;

/** Query: per set that counts for `accounts`, set_number and owned (held, not only wanted). */
export const countedSets = (accounts?: AccountFilter) =>
  `SELECT set_number, bool_or(owned) AS owned FROM (
     ${COUNTS.map(z => `SELECT set_number, ${z.owned} AS owned FROM ${z.table}${only(accounts)}`).join('\n     UNION ALL ')}) t
   GROUP BY set_number`;
