import { mengeSummeSql, erfassungsTagSql, mengeAus, mengeJoin, inKontowaehrung, kontowaehrungJoin } from '../../../db/bestandsmenge';
import { ausTabelle } from '../../infra/validate';
import type { DbSchnittstelle } from '../../../db/database';
import * as db from '../../../db/database';

/** Datenzugriff auf Sets und Set-Stammdaten. */

/** Das eigene Konto gewinnt, wenn mehrere Konten das Set halten. */
export function setImBlickfeld(ids: unknown[], setNumber: string, viewerId: number) {
  return db.get(`SELECT set_number, user_id FROM sets
      WHERE user_id = ANY($1) AND set_number = $2
      -- Das eigene Konto gewinnt, wenn mehrere Konten dasselbe Set haben:
      -- die Detailansicht soll die eigene Zeile zeigen, nicht die eines
      -- Geschwisterkontos.
      ORDER BY (user_id = $3) DESC
      LIMIT 1`, [ids, setNumber, viewerId]);
}

/** Der angefragte Zustand gewinnt, wenn er einen Preis hat; der andere nur, wo keiner steht. */
export function marktpreisAusCache(dbh: DbSchnittstelle, setNumber: string, currency: unknown, zustand: string) {
  return dbh.get(`SELECT avg_price FROM price_cache
     WHERE set_number=$1 AND currency_code=$2 AND condition IN ('N','U') AND avg_price > 0
     ORDER BY (condition = $3) DESC LIMIT 1`, [setNumber, currency, zustand]);
}

/** Rückfall, wenn der Cache leer ist (CSV-Import ohne Kontingent): der jüngste Preis im Verlauf. */
export function marktpreisAusVerlauf(dbh: DbSchnittstelle, setNumber: string, currency: unknown, zustand: string) {
  return dbh.get(`SELECT avg_price FROM price_history
        WHERE set_number=$1 AND currency_code=$2 AND condition IN ('N','U') AND avg_price > 0
        ORDER BY (condition = $3) DESC, recorded_at DESC LIMIT 1`, [setNumber, currency, zustand]);
}

export function setErfassungenNeuesteZuerst(dbh: DbSchnittstelle, userId: number, setNumber: string) {
  return dbh.all('SELECT id, quantity, created_at FROM set_acquisitions WHERE user_id=$1 AND set_number=$2 ORDER BY created_at DESC, id DESC', [userId, setNumber]);
}

export function loescheSetErfassungNachId(dbh: DbSchnittstelle, id: number) {
  return dbh.run('DELETE FROM set_acquisitions WHERE id=$1', [id]);
}

export function kuerzeSetErfassung(dbh: DbSchnittstelle, menge: number, id: number) {
  return dbh.run('UPDATE set_acquisitions SET quantity = quantity - $1 WHERE id=$2', [menge, id]);
}

export function setZeileDesKontos(userId: number, setNumber: string) {
  return db.get('SELECT id FROM sets WHERE user_id = $1 AND set_number = $2', [userId, setNumber]);
}

/** Vorhandene Werte bleiben, wo der neue Abruf nichts liefert. */
export function merkeSetKatalog(setNumber: string, name: string | null, year: unknown, theme: unknown, pieces: unknown, minifigs: unknown, imageUrl: unknown, localImage: unknown) {
  return db.run(`INSERT INTO set_catalog (set_number,name,year,theme,pieces,minifigs,image_url,image_local)
                VALUES ($1, COALESCE($2, 'Set ' || $1), $3,$4,$5,$6,$7,$8)
                ON CONFLICT (set_number) DO UPDATE SET
                  name = COALESCE($2, set_catalog.name), year = COALESCE($3, set_catalog.year),
                  theme = COALESCE($4, set_catalog.theme), pieces = COALESCE($5, set_catalog.pieces),
                  minifigs = COALESCE($6, set_catalog.minifigs),
                  image_url = COALESCE($7, set_catalog.image_url),
                  image_local = COALESCE($8, set_catalog.image_local), updated_at = NOW()`, [setNumber, name, year, theme, pieces, minifigs, imageUrl, localImage]);
}

export function legeSetZeileAn(tx: DbSchnittstelle, userId: number, setNumber: string) {
  return tx.run('INSERT INTO sets (user_id,set_number) VALUES ($1,$2) ON CONFLICT (user_id,set_number) DO NOTHING', [userId, setNumber]);
}

export function setzeFigurenzahl(minifigs: unknown, setNumber: string) {
  return db.run('UPDATE set_catalog SET minifigs = $1 WHERE set_number = $2', [minifigs, setNumber]);
}

/** `feld` ist ein fester Spaltenname, keine Eingabe von aussen. */
export function schreibeInNeuesteSetErfassung(wert: unknown, ownerId: number, setNumber: string, feld: 'purchase_price' | 'condition') {
  return db.run(`UPDATE set_acquisitions SET ${feld} = $1
                 WHERE id = (SELECT id FROM set_acquisitions
                              WHERE user_id=$2 AND set_number=$3
                              ORDER BY created_at DESC, id DESC LIMIT 1)`, [wert, ownerId, setNumber]);
}

/** Die eigene Zeile gewinnt — sonst entschiede die Tabellenreihenfolge. */
export function setZeileImSchreibfeld(wids: unknown[], setNumber: string, uid: number) {
  return db.get(`SELECT id, user_id FROM sets WHERE user_id = ANY($1) AND set_number=$2
      ORDER BY (user_id = $3) DESC, id ASC LIMIT 1`, [wids, setNumber, uid]);
}

/** Eine eigene Zeile, wenn das Set bisher nur einem anderen Konto des Blickfelds gehörte. */
export function uebernimmSetZeile(tx: DbSchnittstelle, uid: number, leseFeld: unknown, setNumber: string) {
  return tx.run(`INSERT INTO sets (user_id, set_number)
           SELECT $1, set_number
             FROM sets WHERE user_id = ANY($2) AND set_number = $3
            ORDER BY id ASC LIMIT 1
           ON CONFLICT DO NOTHING`, [uid, leseFeld, setNumber]);
}

export function zustandNeuesteSetErfassung(ownerId: number, setNumber: string) {
  return db.get(`SELECT condition FROM set_acquisitions
          WHERE user_id=$1 AND set_number=$2
          ORDER BY created_at DESC, id DESC LIMIT 1`, [ownerId, setNumber]);
}

/** Menge eines Sets aus den Erfassungen: über das Blickfeld (ids = Liste) oder ein Konto. */
export async function setMenge(dbh: Pick<DbSchnittstelle, 'get'>, konten: 'eines' | 'blickfeld', ids: unknown, setNumber: string): Promise<number> {
  return (await dbh.get<{ q: number }>(mengeSummeSql(konten), [ids, setNumber]))?.q ?? 0;
}

// Shared logic to build the Sets CSV export content. Used by both the
// standalone CSV download and the combined ZIP export in settings.js.
// Eine Zeile pro Erfassung, damit Kaufpreis, Zustand und Datum je Kauf erhalten
// bleiben und beim Re-Import 1:1 wiederhergestellt werden. Sets ohne Erfassungen …
// Ausführlich: docs/begruendungen/src/sets/setService.ts.md#sets-csv-sql
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
         -- db/bestandsmenge.ts (mengeAus mit 0). Ein leeres Feld im Export
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

export function setsFuerCsv(uid: number) {
  return db.all(SETS_CSV_SQL, [uid]);
}

/**
 * Sortierschlüssel der Galerie. Whitelist statt Interpolation: Der Wert kommt
 * aus einem <select> im Client und darf niemals ungeprüft in die Abfrage.
 */
const SET_SORTS = {
  added_desc: 's.added_at DESC',
  added_asc:  's.added_at ASC',
  name_asc:   's.name ASC NULLS LAST',
  num_asc:    's.set_number ASC',
  year_desc:  's.year DESC NULLS LAST',
  // Nur noch aus den Erfassungen: Der zweite Operand war sets.purchase_price,
  // den es seit Migration 0032 nicht mehr gibt.
  price_desc: 'COALESCE(a.max_purchase_price, 0) DESC',
  price_asc:  'COALESCE(a.max_purchase_price, 0) ASC',
  // Anzahl der besessenen Exemplare.
  // Ausführlich: docs/begruendungen/src/sets/abfragen.ts.md#set-sorts-2
  qty_desc:   's.quantity DESC, s.added_at DESC',
  qty_asc:    's.quantity ASC, s.added_at DESC',
};

export type SetFilter = { search?: unknown; theme?: unknown; storage?: unknown; sort?: unknown;
  seite: { groesse: number; versatz: number } | null; themen: boolean };

/**
 * Die Setliste im Blickfeld: eine Seite, die Gesamtzahl (nur mit Seite) und
 * die Themen (nur auf der ersten Seite). Mehrere Konten werden je Set
 * zusammengefasst; der Lagerort beschreibt das Exemplar und wird deshalb
 * aufgezählt statt gewählt.
 */
export async function setListe(uids: number[], f: SetFilter) {
  const SET_COLS = ['set_number','name','year','theme','pieces','minifigs','quantity',
                    'image_local','image_url','added_at','storage']
                   .map(c => `s.${c}`).join(', ');
  const { search, theme, sort, storage } = f;

  // Ein Set, EINE Zeile
  // Im Haushalt besitzen womöglich zwei Kinder dasselbe Set. Es soll trotzdem
  // nur einmal erscheinen — mit der Summe der Mengen und den Kaufpreisen aller
  // Besitzer. Zwei Zeilen mit demselben Bild und Namen lesen sich wie ein …
  // Ausführlich: docs/begruendungen/src/sets/abfragen.ts.md#getsets-setsfrom
  const setsFrom = uids.length > 1
    ? `(SELECT s.set_number,
               MIN(c.name) AS name, MIN(c.year) AS year, MIN(c.theme) AS theme,
               MIN(c.pieces) AS pieces, MIN(c.minifigs) AS minifigs,
               -- Die Menge kommt aus den ERFASSUNGEN (Migration 0036 hat
               -- sets.quantity geloescht). Die gruppierte Quelle haengt
               -- db/bestandsmenge.ts an — hier stand SUM(s.quantity).
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
               -- Nur Konten, die auch wirklich ein Exemplar halten.
               --
               -- Marcos Befund: „Ich habe den Kaufpreis für den Marco
               -- gelöscht. Somit sollte auch das Label auf der Kachel von
               -- Marco nicht mehr angezeigt werden."
               --
               -- Beim Löschen der letzten Erfassung setzt parentQuantitySql
               -- die Menge auf 0, lässt die sets-Zeile aber stehen (bewusst —
               -- eine Menge von 0 ist ein gültiger Zustand, etwa über den
               -- Mengenregler). Ohne FILTER stand das Konto danach weiter als
               -- Besitzer auf der Kachel, obwohl es nichts mehr besitzt.
               --
               -- Die Bedingung liest jetzt die ERFASSUNGEN (Migration 0036
               -- hat sets.quantity geloescht) — dieselbe Summe wie in der
               -- Mengenspalte darueber, also dieselbe Aussage wie vorher.
               array_agg(DISTINCT s.user_id) FILTER (WHERE ${mengeAus('sm', 0)} > 0) AS owner_ids
          FROM sets s
          -- Der JOIN steht ausgeschrieben, nicht hinter einer Sicht: So sagt
          -- die Abfrage selbst, dass Name, Jahr und Bild aus dem Katalog
          -- kommen. LEFT JOIN, weil ein Set ohne Katalogzeile sonst aus der
          -- Liste verschwaende — lieber ohne Namen als unsichtbar.
          LEFT JOIN set_catalog c ON c.set_number = s.set_number
          LEFT JOIN storage_locations lo ON lo.id = s.storage_id
          ${mengeJoin('s', 'sm', '= ANY($1)')}
         WHERE s.user_id = ANY($1)
         GROUP BY s.set_number) s`
    // Auch ohne Haushalt eine Unterabfrage, und zwar NUR wegen des Lagerorts:
    // Alles darunter (Filter `s.storage = $n`, Sortierung, Ausgabe) erwartet
    // den NAMEN in einer Spalte namens `storage` — die Tabelle traegt seit
    // Migration 0031 aber die ID. `s.*` plus die aufgeloeste Spalte liefert …
    // Ausführlich: docs/begruendungen/src/sets/abfragen.ts.md#getsets
    : `(SELECT s.id, s.user_id, s.set_number,
               ${mengeAus('sm', 0)}::int AS quantity,
               s.added_at, s.updated_at, s.storage_id,
               lo.name AS storage,
               c.name, c.year, c.theme, c.pieces, c.minifigs,
               c.image_url, c.image_local
          FROM sets s
          LEFT JOIN set_catalog c ON c.set_number = s.set_number
          LEFT JOIN storage_locations lo ON lo.id = s.storage_id
          ${mengeJoin('s', 'sm', '= ANY($1)')}) s`;
  const SET_OWNER_COL = uids.length > 1 ? ', s.owner_ids' : '';
  // Ohne Gruppierung filtert die WHERE-Klausel wie bisher; mit Gruppierung hat
  // die Unterabfrage bereits gefiltert.
  const where = uids.length > 1 ? [] : ['s.user_id = ANY($1)'];
  const params: any[] = [uids];
  if (theme) { params.push(theme); where.push(`s.theme = $${params.length}`); }
  // Lagerort als eigener Filter, nicht als Teil der Volltextsuche: „Kiste 3"
  // soll genau die Sets in Kiste 3 zeigen und nicht zusaetzlich jedes Set,
  // dessen Name zufaellig „Kiste" enthaelt.
  if (storage) {
    params.push(String(storage));
    where.push(`s.storage = $${params.length}`);
  }
  if (search) {
    params.push(`%${String(search).toLowerCase()}%`);
    const i = params.length;
    where.push(`(LOWER(s.set_number) LIKE $${i} OR LOWER(s.name) LIKE $${i}
                 OR LOWER(COALESCE(s.theme,'')) LIKE $${i} OR COALESCE(s.year,0)::text LIKE $${i})`);
  }
  const whereSql = where.length ? where.join(' AND ') : 'TRUE';
  // ausTabelle: siehe src/infra/validate — ein direkter Zugriff liefert auch
  // geerbte Eigenschaften, und die haette `|| SET_SORTS.added_desc` durchgelassen.
  const orderSql = ausTabelle(SET_SORTS, sort, SET_SORTS.added_desc);

  // Ohne page_size bleibt die Set-Liste UNBEGRENZT.
  // Ausführlich: docs/begruendungen/src/sets/abfragen.ts.md#getsets-limitsql
  const listParams = [...params];
  let limitSql = '';
  if (f.seite) {
    listParams.push(f.seite.groesse, f.seite.versatz);
    limitSql = ` LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`;
  }

  // Die Anleitungen werden ERST für die geladene Seite geholt (siehe unten) —
  // dafür braucht es die Setnummern der Seite, also läuft die Set-Abfrage
  // zuerst und die übrigen danach parallel.
  // Ausführlich: docs/begruendungen/src/sets/abfragen.ts.md#getsets-2
  const [sets, countRow, themeRows] = await Promise.all([
    // Vorher: drei korrelierte Subqueries pro Zeile, also drei Index-Scans auf
    // set_acquisitions je Set. Jetzt ein einziger gruppierter Scan, per
    // LEFT JOIN angehängt — identisches Ergebnis, eine Grössenordnung weniger
    // Arbeit ab ein paar hundert Sets.
    db.all(`SELECT ${SET_COLS}${SET_OWNER_COL},
      a.max_purchase_price, a.avg_purchase_price, a.letzter_kauf,
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
               -- Die Kachel zeigt den letzten Kauf, nicht die Aufnahme des Sets.
               MAX(set_acquisitions.created_at)        AS letzter_kauf,
               COUNT(*)                                AS acq_count,
               COUNT(*) FILTER (WHERE condition = 'U') AS used_count
        FROM set_acquisitions ${kontowaehrungJoin('set_acquisitions')}
        WHERE set_acquisitions.user_id = ANY($1)
        GROUP BY set_number
      ) a ON a.set_number = s.set_number
      WHERE ${whereSql} ORDER BY ${orderSql}${limitSql}`, listParams),
    f.seite ? db.get(`SELECT COUNT(*)::int AS c FROM ${setsFrom} WHERE ${whereSql}`, params)
              : Promise.resolve(null),
    // Themenliste für das Auswahlfeld. Muss aus ALLEN Sets kommen, nicht aus
    // der geladenen Seite — sonst schrumpft das Auswahlfeld beim Paginieren.
    // Nur bei der ersten Seite nötig; Folgeseiten sparen die Abfrage.
    f.themen
      // `theme` steht seit Migration 0033 im Katalog — deshalb der JOIN.
      ? db.all(`SELECT DISTINCT c.theme AS theme
                  FROM sets s JOIN set_catalog c ON c.set_number = s.set_number
                 WHERE s.user_id = ANY($1) AND c.theme IS NOT NULL AND c.theme <> ''
                 ORDER BY c.theme`, [uids])
      : Promise.resolve(null),
  ]);
  return { sets, countRow, themeRows };
}

/** Nur zu Sets, die ein Konto des Blickfelds hält. */
export function geteilteAnleitungen(setNummern: unknown[], uids: unknown[]) {
  return db.all(`SELECT si.* FROM shared_instructions si
                WHERE si.set_number = ANY($1)
                  AND EXISTS (SELECT 1 FROM sets s
                              WHERE s.set_number = si.set_number AND s.user_id = ANY($2))`, [setNummern, uids]);
}

export function eigeneAnleitungen(uids: unknown[], setNummern: unknown[]) {
  return db.all('SELECT * FROM instructions WHERE user_id = ANY($1) AND set_number = ANY($2)', [uids, setNummern]);
}

export function setErfassungsKennzahlen(uids: unknown[], setNumber: string) {
  return db.get("SELECT COUNT(*) AS acq_count, COUNT(*) FILTER (WHERE condition='U') AS used_count," +
    " MAX(purchase_price) AS max_purchase_price," +
    " SUM(purchase_price * quantity) FILTER (WHERE purchase_price IS NOT NULL)::numeric" +
    "   / NULLIF(SUM(quantity) FILTER (WHERE purchase_price IS NOT NULL), 0) AS avg_purchase_price" +
    " FROM set_acquisitions WHERE user_id = ANY($1) AND set_number=$2", [uids, setNumber]);
}

/** Menge und Lagerort über das Blickfeld; die eigene Zeile gewinnt. */
export function setDetailZeile(uids: unknown[], setNumber: string, eigenes: unknown) {
  return db.get(`SELECT s.id, s.user_id, s.set_number, s.added_at, s.updated_at, s.storage_id,
              -- Beide Listen ausgeschrieben, kein s.*: Auf einer Datenbank
              -- ohne Migration 0033 braechte s.* ein zweites name mit, und
              -- der Zugriff darauf waere zweideutig (siehe die Begruendung
              -- bei setsFrom weiter oben).
              c.name, c.year, c.theme, c.pieces, c.minifigs,
              c.image_url, c.image_local,
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
                 JOIN storage_locations lo ON lo.id = d.storage_id
                WHERE d.user_id = ANY($1) AND d.set_number = s.set_number) AS storage,
              -- Besitzer wie in getSets(); withOwners() macht daraus Plaketten.
              (SELECT array_agg(DISTINCT e.user_id ORDER BY e.user_id)
                 FROM sets e WHERE e.user_id = ANY($1) AND e.set_number = s.set_number) AS owner_ids
         FROM sets s
         LEFT JOIN set_catalog c ON c.set_number = s.set_number
        WHERE s.user_id = ANY($1) AND s.set_number = $2
        ORDER BY (s.user_id = $3) DESC, s.id ASC
        LIMIT 1`, [uids, setNumber, eigenes]);
}

export function eigeneAnleitungenDesSets(uids: unknown[], setNumber: string) {
  return db.all('SELECT * FROM instructions WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
}

export function besitzerDesSets(tx: DbSchnittstelle, uids: unknown[], setNumber: string) {
  return tx.all('SELECT user_id FROM sets WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
}

/** Set samt Teilen, Figuren und Erfassungen in diesen Konten. */
export async function entferneSetZeilen(tx: DbSchnittstelle, uids: number[], setNumber: string): Promise<void> {
  await tx.run('DELETE FROM sets WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
  await tx.run('DELETE FROM parts WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
  await tx.run('DELETE FROM minifigs WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
  await tx.run('DELETE FROM set_acquisitions WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
}
