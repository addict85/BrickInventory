/** Inventory, acquisitions, wanted list and price alerts as subqueries with fixed columns: whoever
 * restructures a table adjusts the view, not every reader. The SQL counts towards the area that
 * embeds it; if that area sits below the owner, it gets it through its read contract (docs/architektur.md).
 * Without `konten` all accounts apply. */
import { onAccounts, type Konten } from './accounts';

const nur = (konten?: Konten) => (konten ? ` WHERE ${onAccounts('user_id', konten)}` : '');

/** Sets in the inventory (src/inventory): id, user_id, set_number, storage_id, added_at. */
export const setBestand = (konten?: Konten) =>
  `(SELECT id, user_id, set_number, storage_id, added_at FROM sets${nur(konten)})`;

/** Parts in the inventory (src/inventory): id, user_id, set_number, part_number, color_id, source, storage_id, added_at. */
export const teilBestand = (konten?: Konten) =>
  `(SELECT id, user_id, set_number, part_number, color_id, source, storage_id, added_at FROM parts${nur(konten)})`;

/** Minifigs in the inventory (src/inventory): id, user_id, set_number, fig_number, source, storage_id. */
export const figurBestand = (konten?: Konten) =>
  `(SELECT id, user_id, set_number, fig_number, source, storage_id FROM minifigs${nur(konten)})`;

/** Storage locations (src/inventory): id, user_id, name. */
export const storages = (konten?: Konten) => `(SELECT id, user_id, name FROM storage_locations${nur(konten)})`;

const ACQUISITION = 'id, user_id, quantity, condition, created_at, currency, price_estimated, day';

/** Purchases of a set (src/inventory): the acquisition columns, set_number, purchase_price. */
export const setErfassungen = (konten?: Konten) =>
  `(SELECT ${ACQUISITION}, set_number, purchase_price FROM set_acquisitions${nur(konten)})`;

/** Purchases of manual parts (src/inventory): the acquisition columns, part_number, color_id, unit_price. */
export const teilErfassungen = (konten?: Konten) =>
  `(SELECT ${ACQUISITION}, part_number, color_id, unit_price FROM part_acquisitions${nur(konten)})`;

/** Purchases of manual minifigs (src/inventory): the acquisition columns, fig_number, unit_price. */
export const figurErfassungen = (konten?: Konten) =>
  `(SELECT ${ACQUISITION}, fig_number, unit_price FROM minifig_acquisitions${nur(konten)})`;

/** Wanted list (src/wanted); the name mirrors src/finances's FinancesReadContract.merkliste,
 * which is out of this phase's scope — see the Phase 2a report. */
export const merkliste = (konten?: Konten) => `(SELECT user_id, set_number, condition FROM wanted${nur(konten)})`;

/** Own instructions (src/sets): user_id, set_number. */
export const anleitungen = (konten?: Konten) => `(SELECT user_id, set_number FROM instructions${nur(konten)})`;

/** A set counts as long as an account holds, wants or watches it: only then does it need an image,
 * a master row and a price. The rule stands once, for images, catalog sync and scope. */
const COUNTS = [
  { tabelle: 'sets', besitz: true },
  { tabelle: 'wanted', besitz: false },
  { tabelle: 'price_alerts', besitz: false },
] as const;

/** Condition: the set with number `nummer` counts for some account. */
export const setZaehlt = (number: string) =>
  `(${COUNTS.map(z => `EXISTS (SELECT 1 FROM ${z.tabelle} WHERE set_number = ${number})`).join(' OR ')})`;

/** Query: per set that counts for `konten`, set_number and besitz (held, not only wanted). */
export const countedSets = (konten?: Konten) =>
  `SELECT set_number, bool_or(besitz) AS besitz FROM (
     ${COUNTS.map(z => `SELECT set_number, ${z.besitz} AS besitz FROM ${z.tabelle}${nur(konten)}`).join('\n     UNION ALL ')}) t
   GROUP BY set_number`;
