import { lagerorte } from '../../../db/inventoryView';
import {
  quantitySumSql,
  erfassungsTagSql,
  mengeAus,
  mengeJoin,
  inKontowaehrung,
  kontowaehrungJoin,
} from '../../../db/stockQuantity';
import { fromTable } from '../../infra/validate';
import type { DbInterface, Zeile } from '../../../db/database';
import { LIKE_ESCAPE as E, containsPattern } from '../../../db/likeSearch';
import { setStammJoin, SET } from '../../../db/catalogView';
import { LOCKS } from '../../infra/lockNamespaces';
import { lockUntilToEnd } from '../../../db/txLock';

/** The own account wins if several accounts hold the set. */
export function setInScope(db: DbInterface, ids: number[], setNumber: string, viewerId: number) {
  return db.get<{ set_number: string; user_id: number }>(
    `SELECT set_number, user_id FROM sets
      WHERE user_id = ANY($1) AND set_number = $2
      -- Das eigene Konto gewinnt, wenn mehrere Konten dasselbe Set haben:
      -- die Detailansicht soll die eigene Zeile zeigen, nicht die eines
      -- Geschwisterkontos.
      ORDER BY (user_id = $3) DESC
      LIMIT 1`,
    [ids, setNumber, viewerId],
  );
}

export function setEntriesNewestFirst(dbh: DbInterface, userId: number, setNumber: string) {
  return dbh.all<{ id: number; quantity: number; created_at: Date }>(
    'SELECT id, quantity, created_at FROM set_acquisitions WHERE user_id=$1 AND set_number=$2 ORDER BY created_at DESC, id DESC',
    [userId, setNumber],
  );
}

/** The whole row, for the trash: restoring writes it back column by column. */
export async function setEntryAsJson(dbh: DbInterface, id: number) {
  return (
    await dbh.get<{ z: Record<string, unknown> }>('SELECT to_jsonb(t) AS z FROM set_acquisitions t WHERE id = $1', [id])
  )?.z;
}

export async function setEntriesAsJson(dbh: DbInterface, userId: number, setNumber: string) {
  return (
    await dbh.all<{ z: Record<string, unknown> }>(
      'SELECT to_jsonb(t) AS z FROM set_acquisitions t WHERE user_id = $1 AND set_number = $2 ORDER BY created_at DESC, id DESC',
      [userId, setNumber],
    )
  ).map(r => r.z);
}

export function setRowOfAccount(db: DbInterface, userId: number, setNumber: string) {
  return db.get<{ id: number }>('SELECT id FROM sets WHERE user_id = $1 AND set_number = $2', [userId, setNumber]);
}

/** Per set number, then like every other change of this inventory (db/txLock.ts); until the end of the transaction. */
export async function addLockSet(tx: DbInterface, setNumber: string, besitzer: number) {
  await lockUntilToEnd(tx, LOCKS.SET_ADD, setNumber);
  await lockUntilToEnd(tx, LOCKS.INVENTORY, `${besitzer}|${setNumber}`);
}

export function entriesWithoutPriceOfSets(db: DbInterface, userId: number, setNumber: string) {
  return db.all<{ id: number; condition: string | null }>(
    'SELECT id, condition FROM set_acquisitions WHERE user_id = $1 AND set_number = $2 AND purchase_price IS NULL ORDER BY id',
    [userId, setNumber],
  );
}

export function setRowInWriteField(db: DbInterface, wids: number[], setNumber: string, uid: number) {
  return db.get<{ id: number; user_id: number }>(
    `SELECT id, user_id FROM sets WHERE user_id = ANY($1) AND set_number=$2
      ORDER BY (user_id = $3) DESC, id ASC LIMIT 1`,
    [wids, setNumber, uid],
  );
}

export function stateNewestSetEntry(db: DbInterface, ownerId: number, setNumber: string) {
  return db.get<{ condition: string | null }>(
    `SELECT condition FROM set_acquisitions
          WHERE user_id=$1 AND set_number=$2
          ORDER BY created_at DESC, id DESC LIMIT 1`,
    [ownerId, setNumber],
  );
}

export async function setMenge(
  dbh: Pick<DbInterface, 'get'>,
  konten: 'eines' | 'blickfeld',
  ids: number | number[],
  setNumber: string,
): Promise<number> {
  return (await dbh.get<{ q: number }>(quantitySumSql(konten), [ids, setNumber]))?.q ?? 0;
}

// One row per acquisition, so that purchase price, condition and date come back
// 1:1 on re-import.
const SETS_CSV_SQL = `
  SELECT s.set_number,
         -- Hier stand CASE WHEN a.id IS NULL THEN s.quantity ELSE a.quantity.
         -- (Keine Gegenstriche: Der Kommentar steht in einem Template-Literal.)
         -- Der Rueckfall auf die Set-Zeile ist weg: Migration 0036 hat die
         -- Spalte geloescht, und Migration 0032 garantiert fuer jede Set-Zeile
         -- eine Erfassung. Der LEFT JOIN bleibt, damit ein Export an einer
         -- unerwarteten Lage nicht ganz ausfaellt.
         -- COALESCE(..., 0) und nicht NULL: Eine Set-Zeile ohne Erfassung
         -- bedeutet null Exemplare — dieselbe Lesart wie in
         -- db/stockQuantity.ts (mengeAus mit 0). Ein leeres Feld im Export
         -- hiesse „keine Angabe", und das ist eine andere Aussage.
         COALESCE(a.quantity, 0) AS quantity,
         a.purchase_price AS purchase_price,
         COALESCE(a.condition, 'N') AS condition,
         CASE WHEN a.id IS NULL THEN ''
              ELSE TO_CHAR(${erfassungsTagSql('a')}, 'YYYY-MM-DD') END AS acquired_at
    FROM sets s
    LEFT JOIN set_acquisitions a
           ON a.user_id = s.user_id AND a.set_number = s.set_number
   WHERE s.user_id = $1
   ORDER BY s.set_number ASC, a.created_at ASC, a.id ASC`;

export function setsForCsv(db: DbInterface, uid: number) {
  return db.all<Record<string, unknown>>(SETS_CSV_SQL, [uid]);
}

/** Whitelist instead of interpolation: the value comes from a <select> and must
 * never go into the query unchecked. */
const SET_SORTS = {
  added_desc: 's.added_at DESC',
  added_asc: 's.added_at ASC',
  name_asc: 's.name ASC NULLS LAST',
  name_desc: 's.name DESC NULLS LAST',
  num_asc: 's.set_number ASC',
  num_desc: 's.set_number DESC',
  year_desc: 's.year DESC NULLS LAST',
  year_asc: 's.year ASC NULLS LAST',
  // The table sorts by the column "bought": the last purchase, as tile and row show it.
  kauf_desc: 'a.letzter_kauf DESC NULLS LAST, s.added_at DESC',
  kauf_asc: 'a.letzter_kauf ASC NULLS LAST, s.added_at DESC',
  price_desc: 'COALESCE(a.max_purchase_price, 0) DESC',
  price_asc: 'COALESCE(a.max_purchase_price, 0) ASC',
  // quantity comes from the subquery; added_at orders equal quantities deterministically.
  qty_desc: 's.quantity DESC, s.added_at DESC',
  qty_asc: 's.quantity ASC, s.added_at DESC',
};

/** acq_count and used_count are ::int, the prices numeric (text). */
export type SetListenRow = {
  set_number: string;
  acq_count: number;
  used_count: number;
  avg_purchase_price: string | null;
  kaufpreis_geschaetzt?: boolean | null;
  image_local: string | null;
  owner_ids?: number[] | null;
};

export type SetFilter = {
  search?: unknown;
  theme?: unknown;
  storage?: unknown;
  sort?: unknown;
  seite: { groesse: number; versatz: number } | null;
  themen: boolean;
};

/** The accounts' sets as subquery `s`. In the household one set, ONE row,
 * even if two children own it: two rows with the same image read
 * like an error. */
function setsSource(uids: number[]): string {
  return uids.length > 1
    ? `(SELECT s.set_number,
               MIN(${SET.name}) AS name, MIN(${SET.jahr}) AS year, MIN(${SET.thema}) AS theme,
               MIN(${SET.teile}) AS pieces, MIN(c.minifigs) AS minifigs,
               -- Die Menge kommt aus den ERFASSUNGEN (Migration 0036 hat
               -- sets.quantity geloescht). Die gruppierte Quelle haengt
               -- db/stockQuantity.ts an — hier stand SUM(s.quantity).
               SUM(${mengeAus('sm', 0)})::int AS quantity,
               MIN(c.image_url) AS image_url, MIN(c.image_local) AS image_local,
               MIN(s.added_at) AS added_at,
               -- Lagerort: string_agg statt MIN, und das ist kein Zierrat.
               --
               -- Alle anderen Spalten hier beschreiben DAS SET (Name, Jahr,
               -- Thema) und sind ueber die Konten hinweg gleich — MIN() greift
               -- dort irgendeinen und trifft immer denselben Wert. Der
               -- Lagerort beschreibt das EXEMPLAR: Besitzen zwei Kinder
               -- dasselbe Set, liegt es in zwei Kisten. MIN() haette eine
               -- davon gezeigt und die andere verschwiegen — und zwar so, dass
               -- es wie eine vollstaendige Antwort aussieht.
               -- Der Name kommt seit Migration 0031 aus dem Vorrat (die Zeile
               -- traegt eine ID). LEFT JOIN, weil ein Set ohne Ort weiter in
               -- der Liste stehen muss — ein INNER JOIN liesse es verschwinden,
               -- und zwar genau die Sets, die noch nicht eingeraeumt sind.
               NULLIF(string_agg(DISTINCT lo.name, ', '), '') AS storage,
               -- Nur Konten, die ein Exemplar halten: Eine Zeile mit Menge 0
               -- bleibt nach dem Löschen der letzten Erfassung stehen, ihr
               -- Konto besitzt aber nichts mehr.
               array_agg(DISTINCT s.user_id) FILTER (WHERE ${mengeAus('sm', 0)} > 0) AS owner_ids
          FROM sets s
          -- Der JOIN steht ausgeschrieben, nicht hinter einer Sicht: So sagt
          -- die Abfrage selbst, dass Name, Jahr und Bild aus dem Katalog
          -- kommen. LEFT JOIN, weil ein Set ohne Katalogzeile sonst aus der
          -- Liste verschwaende — lieber ohne Namen als unsichtbar.
          LEFT JOIN set_catalog c ON c.set_number = s.set_number
          ${setStammJoin('s.set_number')}
          LEFT JOIN ${lagerorte()} lo ON lo.id = s.storage_id
          ${mengeJoin('s', 'sm', '= ANY($1)')}
         WHERE s.user_id = ANY($1)
         GROUP BY s.set_number) s`
    : // Subquery only because of the storage location: everything below expects the NAME in
      // `storage`, the table carries the ID.
      `(SELECT s.id, s.user_id, s.set_number,
               ${mengeAus('sm', 0)}::int AS quantity,
               s.added_at, s.updated_at, s.storage_id,
               lo.name AS storage,
               ${SET.name} AS name, ${SET.jahr} AS year, ${SET.thema} AS theme, ${SET.teile} AS pieces,
               c.minifigs, c.image_url, c.image_local
          FROM sets s
          LEFT JOIN set_catalog c ON c.set_number = s.set_number
          ${setStammJoin('s.set_number')}
          LEFT JOIN ${lagerorte()} lo ON lo.id = s.storage_id
          ${mengeJoin('s', 'sm', '= ANY($1)')}) s`;
}

/** Several accounts are merged per set; the storage location describes the
 * copy and is therefore enumerated instead of chosen. */
export async function setList(db: DbInterface, uids: number[], f: SetFilter) {
  const SET_COLS = [
    'set_number',
    'name',
    'year',
    'theme',
    'pieces',
    'minifigs',
    'quantity',
    'image_local',
    'image_url',
    'added_at',
    'storage',
  ]
    .map(c => `s.${c}`)
    .join(', ');
  const { search, theme, sort, storage } = f;

  const setsFrom = setsSource(uids);
  const SET_OWNER_COL = uids.length > 1 ? ', s.owner_ids' : '';
  const where = uids.length > 1 ? [] : ['s.user_id = ANY($1)'];
  const params: unknown[] = [uids];
  if (theme) {
    params.push(theme);
    where.push(`s.theme = $${params.length}`);
  }
  // An own filter instead of full text: "box 3" should not show every set with "box"
  // in its name.
  if (storage) {
    params.push(String(storage));
    where.push(`s.storage = $${params.length}`);
  }
  if (search) {
    params.push(containsPattern(String(search).toLowerCase()));
    const i = params.length;
    where.push(`(LOWER(s.set_number) LIKE $${i}${E} OR LOWER(s.name) LIKE $${i}${E}
                 OR LOWER(COALESCE(s.theme,'')) LIKE $${i}${E} OR COALESCE(s.year,0)::text LIKE $${i}${E})`);
  }
  const whereSql = where.length ? where.join(' AND ') : 'TRUE';
  // fromTable: direct access also delivers inherited properties.
  const orderSql = fromTable(SET_SORTS, sort, SET_SORTS.added_desc);

  // Without page_size unlimited.
  const listParams = [...params];
  let limitSql = '';
  if (f.seite) {
    listParams.push(f.seite.groesse, f.seite.versatz);
    limitSql = ` LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`;
  }

  // The set query first: the instructions need the page's set numbers.
  const [sets, countRow, themeRows] = await Promise.all([
    // One grouped scan via LEFT JOIN instead of three correlated subqueries per row.
    db.all<Zeile<SetListenRow>>(
      `SELECT ${SET_COLS}${SET_OWNER_COL},
      a.max_purchase_price, a.avg_purchase_price, a.kaufpreis_geschaetzt, a.letzter_kauf,
      COALESCE(a.acq_count, 0)::int AS acq_count, COALESCE(a.used_count, 0)::int AS used_count
      FROM ${setsFrom}
      LEFT JOIN (
        SELECT set_number,
               MAX(purchase_price) FILTER (WHERE ${inKontowaehrung('set_acquisitions')}) AS max_purchase_price,
               -- Mengengewichteter Kaufpreis: 2x100 und 1x160 ergibt 120, nicht
               -- 130 — und nicht 160, was MAX() liefert. Die Kachel zeigt ihn,
               -- solange noch kein Marktpreis geladen ist.
               SUM(purchase_price * quantity) FILTER (WHERE purchase_price IS NOT NULL AND ${inKontowaehrung('set_acquisitions')})::numeric
                 / NULLIF(SUM(quantity) FILTER (WHERE purchase_price IS NOT NULL AND ${inKontowaehrung('set_acquisitions')}), 0)
                                                       AS avg_purchase_price,
               -- Nur geschätzte Kaufpreise: Die Kachel darf den Betrag nicht „bezahlt“ nennen.
               bool_and(price_estimated) FILTER (WHERE purchase_price IS NOT NULL AND ${inKontowaehrung('set_acquisitions')})
                                                       AS kaufpreis_geschaetzt,
               -- Die Kachel zeigt den letzten Kauf, nicht die Aufnahme des Sets.
               MAX(set_acquisitions.created_at)        AS letzter_kauf,
               COUNT(*)                                AS acq_count,
               COUNT(*) FILTER (WHERE condition = 'U') AS used_count
        FROM set_acquisitions ${kontowaehrungJoin('set_acquisitions')}
        WHERE set_acquisitions.user_id = ANY($1)
        GROUP BY set_number
      ) a ON a.set_number = s.set_number
      WHERE ${whereSql} ORDER BY ${orderSql}${limitSql}`,
      listParams,
    ),
    f.seite
      ? db.get<{ c: number }>(`SELECT COUNT(*)::int AS c FROM ${setsFrom} WHERE ${whereSql}`, params)
      : Promise.resolve(null),
    // From ALL sets, otherwise the select field shrinks while paging; only on the
    // first page.
    f.themen
      ? db.all<{ theme: string }>(
          `SELECT DISTINCT rt.name AS theme
                  FROM sets s JOIN rb_sets rs ON rs.set_num = s.set_number
                  JOIN rb_themes rt ON rt.id = rs.theme_id
                 WHERE s.user_id = ANY($1) AND rt.name IS NOT NULL AND rt.name <> ''
                 ORDER BY rt.name`,
          [uids],
        )
      : Promise.resolve(null),
  ]);
  return { sets, countRow, themeRows };
}

export function sharedInstructions(db: DbInterface, setNumbers: string[], uids: number[]) {
  return db.all<Zeile<{ set_number: string }>>(
    `SELECT si.* FROM shared_instructions si
                WHERE si.set_number = ANY($1)
                  AND EXISTS (SELECT 1 FROM sets s
                              WHERE s.set_number = si.set_number AND s.user_id = ANY($2))`,
    [setNumbers, uids],
  );
}

export function ownInstructions(db: DbInterface, uids: number[], setNumbers: string[]) {
  return db.all<Zeile<{ set_number: string }>>(
    'SELECT * FROM instructions WHERE user_id = ANY($1) AND set_number = ANY($2)',
    [uids, setNumbers],
  );
}

export function setEntryMetrics(db: DbInterface, uids: number[], setNumber: string) {
  return db.get<{
    acq_count: string;
    used_count: string;
    max_purchase_price: string | null;
    avg_purchase_price: string | null;
  }>(
    "SELECT COUNT(*) AS acq_count, COUNT(*) FILTER (WHERE condition='U') AS used_count," +
      ' MAX(purchase_price) AS max_purchase_price,' +
      ' SUM(purchase_price * quantity) FILTER (WHERE purchase_price IS NOT NULL)::numeric' +
      '   / NULLIF(SUM(quantity) FILTER (WHERE purchase_price IS NOT NULL), 0) AS avg_purchase_price' +
      ' FROM set_acquisitions WHERE user_id = ANY($1) AND set_number=$2',
    [uids, setNumber],
  );
}

/** The own row wins. */
export function setDetailRow(db: DbInterface, uids: number[], setNumber: string, eigenes: number | undefined) {
  return db.get<
    Zeile<{ set_number: string; name: string | null; image_local: string | null; owner_ids: number[] | null }>
  >(
    `SELECT s.id, s.user_id, s.set_number, s.added_at, s.updated_at, s.storage_id,
              -- Beide Listen ausgeschrieben, kein s.*: Auf einer Datenbank
              -- ohne Migration 0033 braechte s.* ein zweites name mit, und
              -- der Zugriff darauf waere zweideutig (siehe die Begruendung
              -- bei setsFrom weiter oben).
              ${SET.name} AS name, ${SET.jahr} AS year, ${SET.thema} AS theme, ${SET.teile} AS pieces,
              c.minifigs, c.image_url, c.image_local,
              -- Die Gesamtmenge im Blickfeld, aus den ERFASSUNGEN. Hier
              -- stand eine Summe ueber sets.quantity; die Spalte ist mit
              -- Migration 0036 weg. Der JOIN auf sets haelt die
              -- Einschraenkung „nur Konten, die das Set wirklich halten".
              (SELECT COALESCE(SUM(a.quantity),0)::int
                 FROM set_acquisitions a
                 JOIN sets b ON b.user_id = a.user_id AND b.set_number = a.set_number
                WHERE a.user_id = ANY($1) AND a.set_number = s.set_number) AS quantity,
              -- Und der Lagerortname, zusammengefasst ueber das Blickfeld
              -- (der Absatz darueber). Mit dem Wegfall von s.* muss er
              -- ausdruecklich dastehen — genau das war Marcos Befund: Seit
              -- Migration 0031 traegt die Zeile nur noch storage_id, und die
              -- liest kein Klient.
              (SELECT NULLIF(string_agg(DISTINCT lo.name, ', '), '')
                 FROM sets d
                 JOIN ${lagerorte()} lo ON lo.id = d.storage_id
                WHERE d.user_id = ANY($1) AND d.set_number = s.set_number) AS storage,
              -- Besitzer wie in setsLesen(); besitzerAnhaengen() macht daraus Plaketten.
              (SELECT array_agg(DISTINCT e.user_id ORDER BY e.user_id)
                 FROM sets e WHERE e.user_id = ANY($1) AND e.set_number = s.set_number) AS owner_ids
         FROM sets s
         LEFT JOIN set_catalog c ON c.set_number = s.set_number
         ${setStammJoin('s.set_number')}
        WHERE s.user_id = ANY($1) AND s.set_number = $2
        ORDER BY (s.user_id = $3) DESC, s.id ASC
        LIMIT 1`,
    [uids, setNumber, eigenes],
  );
}

export function ownInstructionsOfSets(db: DbInterface, uids: number[], setNumber: string) {
  return db.all<Zeile<{ set_number: string }>>(
    'SELECT * FROM instructions WHERE user_id = ANY($1) AND set_number = $2',
    [uids, setNumber],
  );
}

export function ownerOfSets(tx: DbInterface, uids: number[], setNumber: string) {
  return tx.all<{ user_id: number }>('SELECT user_id FROM sets WHERE user_id = ANY($1) AND set_number = $2', [
    uids,
    setNumber,
  ]);
}

export function setsOfAccount(db: DbInterface, uid: number) {
  return db.all<{ set_number: string }>('SELECT set_number FROM sets WHERE user_id = $1', [uid]);
}
