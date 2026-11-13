import {
  mengeSummeSql,
  erfassungsTagSql,
  mengeAus,
  mengeJoin,
  inKontowaehrung,
  kontowaehrungJoin,
} from '../../../db/bestandsmenge';
import { ausTabelle } from '../../infra/validate';
import type { DbSchnittstelle, Zeile } from '../../../db/database';
import { LIKE_ESCAPE as E, enthaeltMuster } from '../../../db/likeSuche';
import { setStammJoin, SET } from '../../../db/katalogSicht';
import { marktpreisSql } from '../../../db/geldSql';
import { LOCKS } from '../../infra/lockNamespaces';
import { sperreBisZumEnde } from '../../../db/txLock';

/** Das eigene Konto gewinnt, wenn mehrere Konten das Set halten. */
export function setImBlickfeld(db: DbSchnittstelle, ids: number[], setNumber: string, viewerId: number) {
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

/** Der angefragte Zustand gewinnt, wenn er einen Preis hat. */
export function marktpreisAusCache(dbh: DbSchnittstelle, setNumber: string, currency: string, zustand: string) {
  return dbh.get<{ marktpreis: string }>(
    `SELECT ${marktpreisSql()} AS marktpreis FROM price_cache
     WHERE set_number=$1 AND currency_code=$2 AND condition IN ('N','U') AND ${marktpreisSql()} IS NOT NULL
     ORDER BY (condition = $3) DESC LIMIT 1`,
    [setNumber, currency, zustand],
  );
}

/** Rückfall, wenn der Cache leer ist (CSV-Import ohne Kontingent). */
export function marktpreisAusVerlauf(dbh: DbSchnittstelle, setNumber: string, currency: string, zustand: string) {
  return dbh.get<{ marktpreis: string }>(
    `SELECT ${marktpreisSql()} AS marktpreis FROM price_history
        WHERE set_number=$1 AND currency_code=$2 AND condition IN ('N','U') AND ${marktpreisSql()} IS NOT NULL
        ORDER BY (condition = $3) DESC, recorded_at DESC LIMIT 1`,
    [setNumber, currency, zustand],
  );
}

export function setErfassungenNeuesteZuerst(dbh: DbSchnittstelle, userId: number, setNumber: string) {
  return dbh.all<{ id: number; quantity: number; created_at: Date }>(
    'SELECT id, quantity, created_at FROM set_acquisitions WHERE user_id=$1 AND set_number=$2 ORDER BY created_at DESC, id DESC',
    [userId, setNumber],
  );
}

/** Die ganze Zeile, für den Papierkorb: Wiederherstellen schreibt sie Spalte für Spalte zurück. */
export async function setErfassungAlsJson(dbh: DbSchnittstelle, id: number) {
  return (
    await dbh.get<{ z: Record<string, unknown> }>('SELECT to_jsonb(t) AS z FROM set_acquisitions t WHERE id = $1', [id])
  )?.z;
}

export async function setErfassungenAlsJson(dbh: DbSchnittstelle, userId: number, setNumber: string) {
  return (
    await dbh.all<{ z: Record<string, unknown> }>(
      'SELECT to_jsonb(t) AS z FROM set_acquisitions t WHERE user_id = $1 AND set_number = $2 ORDER BY created_at DESC, id DESC',
      [userId, setNumber],
    )
  ).map(r => r.z);
}

export function loescheSetErfassungNachId(dbh: DbSchnittstelle, id: number) {
  return dbh.run('DELETE FROM set_acquisitions WHERE id=$1', [id]);
}

export function kuerzeSetErfassung(dbh: DbSchnittstelle, menge: number, id: number) {
  return dbh.run('UPDATE set_acquisitions SET quantity = quantity - $1 WHERE id=$2', [menge, id]);
}

export function setZeileDesKontos(db: DbSchnittstelle, userId: number, setNumber: string) {
  return db.get<{ id: number }>('SELECT id FROM sets WHERE user_id = $1 AND set_number = $2', [userId, setNumber]);
}

export function legeSetZeileAn(tx: DbSchnittstelle, userId: number, setNumber: string) {
  return tx.run('INSERT INTO sets (user_id,set_number) VALUES ($1,$2) ON CONFLICT (user_id,set_number) DO NOTHING', [
    userId,
    setNumber,
  ]);
}

/** Je Setnummer, dann wie jede andere Änderung dieses Bestands (db/txLock.ts); bis zum Ende der Transaktion. */
export async function sperreSetErfassen(tx: DbSchnittstelle, setNumber: string, besitzer: number) {
  await sperreBisZumEnde(tx, LOCKS.SET_ERFASSEN, setNumber);
  await sperreBisZumEnde(tx, LOCKS.INVENTAR, `${besitzer}|${setNumber}`);
}

export function erfassungenOhnePreisDesSets(db: DbSchnittstelle, userId: number, setNumber: string) {
  return db.all<{ id: number; condition: string | null }>(
    'SELECT id, condition FROM set_acquisitions WHERE user_id = $1 AND set_number = $2 AND purchase_price IS NULL ORDER BY id',
    [userId, setNumber],
  );
}

/** `feld` ist ein fester Spaltenname, keine Eingabe von aussen. */
export function schreibeInNeuesteSetErfassung(
  db: DbSchnittstelle,
  wert: number | string | null,
  ownerId: number,
  setNumber: string,
  feld: 'purchase_price' | 'condition',
) {
  return db.run(
    `UPDATE set_acquisitions SET ${feld} = $1
                 WHERE id = (SELECT id FROM set_acquisitions
                              WHERE user_id=$2 AND set_number=$3
                              ORDER BY created_at DESC, id DESC LIMIT 1)`,
    [wert, ownerId, setNumber],
  );
}

export function setZeileImSchreibfeld(db: DbSchnittstelle, wids: number[], setNumber: string, uid: number) {
  return db.get<{ id: number; user_id: number }>(
    `SELECT id, user_id FROM sets WHERE user_id = ANY($1) AND set_number=$2
      ORDER BY (user_id = $3) DESC, id ASC LIMIT 1`,
    [wids, setNumber, uid],
  );
}

/** Gehörte das Set bisher nur einem anderen Konto, braucht das eigene eine Zeile. */
export function uebernimmSetZeile(tx: DbSchnittstelle, uid: number, leseFeld: number[], setNumber: string) {
  return tx.run(
    `INSERT INTO sets (user_id, set_number)
           SELECT $1, set_number
             FROM sets WHERE user_id = ANY($2) AND set_number = $3
            ORDER BY id ASC LIMIT 1
           ON CONFLICT DO NOTHING`,
    [uid, leseFeld, setNumber],
  );
}

export function zustandNeuesteSetErfassung(db: DbSchnittstelle, ownerId: number, setNumber: string) {
  return db.get<{ condition: string | null }>(
    `SELECT condition FROM set_acquisitions
          WHERE user_id=$1 AND set_number=$2
          ORDER BY created_at DESC, id DESC LIMIT 1`,
    [ownerId, setNumber],
  );
}

export async function setMenge(
  dbh: Pick<DbSchnittstelle, 'get'>,
  konten: 'eines' | 'blickfeld',
  ids: number | number[],
  setNumber: string,
): Promise<number> {
  return (await dbh.get<{ q: number }>(mengeSummeSql(konten), [ids, setNumber]))?.q ?? 0;
}

// Eine Zeile je Erfassung, damit Kaufpreis, Zustand und Datum beim Re-Import
// 1:1 zurückkommen.
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

export function setsFuerCsv(db: DbSchnittstelle, uid: number) {
  return db.all<Record<string, unknown>>(SETS_CSV_SQL, [uid]);
}

/** Whitelist statt Interpolation: Der Wert kommt aus einem <select> und darf
 * nie ungeprüft in die Abfrage. */
const SET_SORTS = {
  added_desc: 's.added_at DESC',
  added_asc: 's.added_at ASC',
  name_asc: 's.name ASC NULLS LAST',
  num_asc: 's.set_number ASC',
  year_desc: 's.year DESC NULLS LAST',
  price_desc: 'COALESCE(a.max_purchase_price, 0) DESC',
  price_asc: 'COALESCE(a.max_purchase_price, 0) ASC',
  // quantity kommt aus der Unterabfrage; added_at ordnet gleiche Mengen fest.
  qty_desc: 's.quantity DESC, s.added_at DESC',
  qty_asc: 's.quantity ASC, s.added_at DESC',
};

/** acq_count und used_count sind ::int, die Preise numeric (Text). */
export type SetListenZeile = {
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

/** Die Sets der Konten als Unterabfrage `s`. Im Haushalt ein Set, EINE Zeile,
 * auch wenn zwei Kinder es besitzen: Zwei Zeilen mit demselben Bild lesen sich
 * wie ein Fehler. */
function setsQuelle(uids: number[]): string {
  return uids.length > 1
    ? `(SELECT s.set_number,
               MIN(${SET.name}) AS name, MIN(${SET.jahr}) AS year, MIN(${SET.thema}) AS theme,
               MIN(${SET.teile}) AS pieces, MIN(c.minifigs) AS minifigs,
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
          LEFT JOIN storage_locations lo ON lo.id = s.storage_id
          ${mengeJoin('s', 'sm', '= ANY($1)')}
         WHERE s.user_id = ANY($1)
         GROUP BY s.set_number) s`
    : // Unterabfrage nur wegen des Lagerorts: Alles darunter erwartet den NAMEN in
      // `storage`, die Tabelle trägt die ID.
      `(SELECT s.id, s.user_id, s.set_number,
               ${mengeAus('sm', 0)}::int AS quantity,
               s.added_at, s.updated_at, s.storage_id,
               lo.name AS storage,
               ${SET.name} AS name, ${SET.jahr} AS year, ${SET.thema} AS theme, ${SET.teile} AS pieces,
               c.minifigs, c.image_url, c.image_local
          FROM sets s
          LEFT JOIN set_catalog c ON c.set_number = s.set_number
          ${setStammJoin('s.set_number')}
          LEFT JOIN storage_locations lo ON lo.id = s.storage_id
          ${mengeJoin('s', 'sm', '= ANY($1)')}) s`;
}

/** Mehrere Konten werden je Set zusammengefasst; der Lagerort beschreibt das
 * Exemplar und wird deshalb aufgezählt statt gewählt. */
export async function setListe(db: DbSchnittstelle, uids: number[], f: SetFilter) {
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

  const setsFrom = setsQuelle(uids);
  const SET_OWNER_COL = uids.length > 1 ? ', s.owner_ids' : '';
  const where = uids.length > 1 ? [] : ['s.user_id = ANY($1)'];
  const params: unknown[] = [uids];
  if (theme) {
    params.push(theme);
    where.push(`s.theme = $${params.length}`);
  }
  // Eigener Filter statt Volltext: „Kiste 3" soll nicht jedes Set mit „Kiste"
  // im Namen zeigen.
  if (storage) {
    params.push(String(storage));
    where.push(`s.storage = $${params.length}`);
  }
  if (search) {
    params.push(enthaeltMuster(String(search).toLowerCase()));
    const i = params.length;
    where.push(`(LOWER(s.set_number) LIKE $${i}${E} OR LOWER(s.name) LIKE $${i}${E}
                 OR LOWER(COALESCE(s.theme,'')) LIKE $${i}${E} OR COALESCE(s.year,0)::text LIKE $${i}${E})`);
  }
  const whereSql = where.length ? where.join(' AND ') : 'TRUE';
  // ausTabelle: Ein direkter Zugriff liefert auch geerbte Eigenschaften.
  const orderSql = ausTabelle(SET_SORTS, sort, SET_SORTS.added_desc);

  // Ohne page_size unbegrenzt.
  const listParams = [...params];
  let limitSql = '';
  if (f.seite) {
    listParams.push(f.seite.groesse, f.seite.versatz);
    limitSql = ` LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`;
  }

  // Die Set-Abfrage zuerst: Die Anleitungen brauchen die Setnummern der Seite.
  const [sets, countRow, themeRows] = await Promise.all([
    // Ein gruppierter Scan per LEFT JOIN statt drei korrelierter Subqueries je Zeile.
    db.all<Zeile<SetListenZeile>>(
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
    // Aus ALLEN Sets, sonst schrumpft das Auswahlfeld beim Blättern; nur auf der
    // ersten Seite.
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

export function geteilteAnleitungen(db: DbSchnittstelle, setNummern: string[], uids: number[]) {
  return db.all<Zeile<{ set_number: string }>>(
    `SELECT si.* FROM shared_instructions si
                WHERE si.set_number = ANY($1)
                  AND EXISTS (SELECT 1 FROM sets s
                              WHERE s.set_number = si.set_number AND s.user_id = ANY($2))`,
    [setNummern, uids],
  );
}

export function eigeneAnleitungen(db: DbSchnittstelle, uids: number[], setNummern: string[]) {
  return db.all<Zeile<{ set_number: string }>>(
    'SELECT * FROM instructions WHERE user_id = ANY($1) AND set_number = ANY($2)',
    [uids, setNummern],
  );
}

export function setErfassungsKennzahlen(db: DbSchnittstelle, uids: number[], setNumber: string) {
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

/** Die eigene Zeile gewinnt. */
export function setDetailZeile(db: DbSchnittstelle, uids: number[], setNumber: string, eigenes: number | undefined) {
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
                 JOIN storage_locations lo ON lo.id = d.storage_id
                WHERE d.user_id = ANY($1) AND d.set_number = s.set_number) AS storage,
              -- Besitzer wie in getSets(); besitzerAnhaengen() macht daraus Plaketten.
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

export function eigeneAnleitungenDesSets(db: DbSchnittstelle, uids: number[], setNumber: string) {
  return db.all<Zeile<{ set_number: string }>>(
    'SELECT * FROM instructions WHERE user_id = ANY($1) AND set_number = $2',
    [uids, setNumber],
  );
}

export function besitzerDesSets(tx: DbSchnittstelle, uids: number[], setNumber: string) {
  return tx.all<{ user_id: number }>('SELECT user_id FROM sets WHERE user_id = ANY($1) AND set_number = $2', [
    uids,
    setNumber,
  ]);
}

export async function entferneSetZeilen(tx: DbSchnittstelle, uids: number[], setNumber: string): Promise<void> {
  await tx.run('DELETE FROM sets WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
  await tx.run('DELETE FROM set_acquisitions WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
}
