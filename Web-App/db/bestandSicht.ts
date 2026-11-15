/** Bestand, Erfassungen, Merkliste und Preisalarme, wie tiefere Bereiche sie lesen: Die Tabellen
 * gehören höheren Bereichen (docs/architektur.md). Jede Sicht ist eine Unterabfrage mit festen
 * Spalten; wer eine Tabelle umbaut, passt die Sicht an, nicht jeden Leser darunter. `konten` ist
 * eine Bedingung auf user_id wie `= ANY($1)`, ohne sie gelten alle Konten. */

const nur = (konten?: string) => (konten ? ` WHERE user_id ${konten}` : '');

/** Sets im Bestand (src/sets): id, user_id, set_number, storage_id, added_at. */
export const setBestand = (konten?: string) =>
  `(SELECT id, user_id, set_number, storage_id, added_at FROM sets${nur(konten)})`;

/** Teile im Bestand (src/bestand): id, user_id, set_number, part_number, color_id, source, storage_id, added_at. */
export const teilBestand = (konten?: string) =>
  `(SELECT id, user_id, set_number, part_number, color_id, source, storage_id, added_at FROM parts${nur(konten)})`;

/** Figuren im Bestand (src/bestand): id, user_id, set_number, fig_number, source, storage_id. */
export const figurBestand = (konten?: string) =>
  `(SELECT id, user_id, set_number, fig_number, source, storage_id FROM minifigs${nur(konten)})`;

const ERFASSUNG = 'id, user_id, quantity, condition, created_at, currency, price_estimated, tag';

/** Käufe eines Sets (src/sets): die Erfassungsspalten, set_number, purchase_price. */
export const setErfassungen = (konten?: string) =>
  `(SELECT ${ERFASSUNG}, set_number, purchase_price FROM set_acquisitions${nur(konten)})`;

/** Käufe manueller Teile (src/teile): die Erfassungsspalten, part_number, color_id, unit_price. */
export const teilErfassungen = (konten?: string) =>
  `(SELECT ${ERFASSUNG}, part_number, color_id, unit_price FROM part_acquisitions${nur(konten)})`;

/** Käufe manueller Figuren (src/figuren): die Erfassungsspalten, fig_number, unit_price. */
export const figurErfassungen = (konten?: string) =>
  `(SELECT ${ERFASSUNG}, fig_number, unit_price FROM minifig_acquisitions${nur(konten)})`;

/** Merkliste (src/merkliste): user_id, set_number, condition. */
export const merkliste = (konten?: string) => `(SELECT user_id, set_number, condition FROM wanted${nur(konten)})`;

/** Eigene Anleitungen (src/sets): user_id, set_number. */
export const anleitungen = (konten?: string) => `(SELECT user_id, set_number FROM instructions${nur(konten)})`;

/** Ein Set zählt, solange ein Konto es hält, merkt oder beobachtet: Nur dann braucht es Bild,
 * Stammzeile und Preis. Die Regel steht einmal, für Bilder, Katalogabgleich und Blickfeld. */
const ZAEHLT = [
  { tabelle: 'sets', besitz: true },
  { tabelle: 'wanted', besitz: false },
  { tabelle: 'price_alerts', besitz: false },
] as const;

/** Bedingung: Das Set mit der Nummer `nummer` zählt für irgendein Konto. */
export const setZaehlt = (nummer: string) =>
  `(${ZAEHLT.map(z => `EXISTS (SELECT 1 FROM ${z.tabelle} WHERE set_number = ${nummer})`).join(' OR ')})`;

/** Abfrage: je Set, das für `konten` zählt, set_number und besitz (gehalten, nicht nur gemerkt). */
export const gezaehlteSets = (konten?: string) =>
  `SELECT set_number, bool_or(besitz) AS besitz FROM (
     ${ZAEHLT.map(z => `SELECT set_number, ${z.besitz} AS besitz FROM ${z.tabelle}${nur(konten)}`).join('\n     UNION ALL ')}) t
   GROUP BY set_number`;
