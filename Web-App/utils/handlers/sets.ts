import { resolveOne } from '../bricklinkLink';
import { meldeUndWeiter } from '../httpError';
import { fuerSet } from '../preisvergleich';
import * as db from '../../db/database';
import type { DbSchnittstelle } from '../../db/database';
import { resolveImageLocal } from '../images';
import { asIds } from '../household';
import { clampPageSize, conditionFromAcquisitions, conditionsFromAcquisitions, withOwners } from './shared';
import { ausTabelle } from '../validate';
import { anleitungenZuSet, anleitungenZusammenlegen } from '../instructions';
import { mengeJoin, mengeAus } from '../bestandsmenge';
import { legeInPapierkorb } from '../papierkorb';

/**
 * Leseabfragen für Sets, samt der Ableitung des Zustands aus den Erfassungen.
 * Ausführlich: docs/begruendungen/utils/handlers/sets.ts.md#set-sorts
 */

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
  // Ausführlich: docs/begruendungen/utils/handlers/sets.ts.md#set-sorts-2
  qty_desc:   's.quantity DESC, s.added_at DESC',
  qty_asc:    's.quantity ASC, s.added_at DESC',
};

/**
 * Ein Blickfeld: entweder eine einzelne Konto-ID oder die Liste aus
 * scopeIds() (utils/household.ts). asIds() normalisiert beides auf eine Liste.
 *
 * Der Typ macht die Casts `asIds(userId)` ueberfluessig — die standen
 * nur da, weil der Parameter gar keinen Typ hatte.
 */
import type { BlickfeldEingabe as Blickfeld } from '../household';

/**
 * @param {number} userId
 * @param {{search?:string, theme?:string, sort?:string, page?:number,
 *          page_size?:number|null}} [query]
 *
 * Filtern und Sortieren liegen seit der Paginierung auf dem Server. Vorher
 * holte die Galerie alle Sets samt Anleitungen und filterte im Browser über
 * das komplette Array — was mit seitenweisem Laden nicht zusammengeht: ein
 * Filter hätte nur die bereits geladene Seite durchsucht.
 *
 * Ohne page_size verhält sich die Funktion wie bisher und liefert alles. Die
 * Android-App ruft sie so auf und bleibt damit unverändert lauffähig.
 */
async function getSets(userId: Blickfeld, query: any = {}) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  // Explizite Spaltenliste statt SELECT *: id/user_id/updated_at
  // werden weder von der Webapp noch von der Android-App gelesen — sie haben
  // den JSON-Payload der /sets-Antwort nur unnötig aufgebläht.
  // Mit "s." qualifiziert: die angehängte Aggregat-Subquery führt set_number …
  // Ausführlich: docs/begruendungen/utils/handlers/sets.ts.md#getsets-set-cols
  const SET_COLS = ['set_number','name','year','theme','pieces','minifigs','quantity',
                    'image_local','image_url','added_at','storage']
                   .map(c => `s.${c}`).join(', ');
  const { search, theme, sort, page = 1, page_size = null } = query;

  // Ein Set, EINE Zeile
  // Im Haushalt besitzen womöglich zwei Kinder dasselbe Set. Es soll trotzdem
  // nur einmal erscheinen — mit der Summe der Mengen und den Kaufpreisen aller
  // Besitzer. Zwei Zeilen mit demselben Bild und Namen lesen sich wie ein …
  // Ausführlich: docs/begruendungen/utils/handlers/sets.ts.md#getsets-setsfrom
  const setsFrom = uids.length > 1
    ? `(SELECT s.set_number,
               MIN(c.name) AS name, MIN(c.year) AS year, MIN(c.theme) AS theme,
               MIN(c.pieces) AS pieces, MIN(c.minifigs) AS minifigs,
               -- Die Menge kommt aus den ERFASSUNGEN (Migration 0036 hat
               -- sets.quantity geloescht). Die gruppierte Quelle haengt
               -- utils/bestandsmenge.ts an — hier stand SUM(s.quantity).
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
          ${mengeJoin('s')}
         WHERE s.user_id = ANY($1)
         GROUP BY s.set_number) s`
    // Auch ohne Haushalt eine Unterabfrage, und zwar NUR wegen des Lagerorts:
    // Alles darunter (Filter `s.storage = $n`, Sortierung, Ausgabe) erwartet
    // den NAMEN in einer Spalte namens `storage` — die Tabelle traegt seit
    // Migration 0031 aber die ID. `s.*` plus die aufgeloeste Spalte liefert …
    // Ausführlich: docs/begruendungen/utils/handlers/sets.ts.md#getsets
    : `(SELECT s.id, s.user_id, s.set_number,
               ${mengeAus('sm', 0)}::int AS quantity,
               s.added_at, s.updated_at, s.storage_id,
               lo.name AS storage,
               c.name, c.year, c.theme, c.pieces, c.minifigs,
               c.image_url, c.image_local
          FROM sets s
          LEFT JOIN set_catalog c ON c.set_number = s.set_number
          LEFT JOIN storage_locations lo ON lo.id = s.storage_id
          ${mengeJoin('s')}) s`;
  const SET_OWNER_COL = uids.length > 1 ? ', s.owner_ids' : '';
  // Ohne Gruppierung filtert die WHERE-Klausel wie bisher; mit Gruppierung hat
  // die Unterabfrage bereits gefiltert.
  const where = uids.length > 1 ? [] : ['s.user_id = ANY($1)'];
  const params: any[] = [uids];
  if (theme) { params.push(theme); where.push(`s.theme = $${params.length}`); }
  // Lagerort als eigener Filter, nicht als Teil der Volltextsuche: „Kiste 3"
  // soll genau die Sets in Kiste 3 zeigen und nicht zusaetzlich jedes Set,
  // dessen Name zufaellig „Kiste" enthaelt.
  if (query.storage) {
    params.push(String(query.storage));
    where.push(`s.storage = $${params.length}`);
  }
  if (search) {
    params.push(`%${String(search).toLowerCase()}%`);
    const i = params.length;
    where.push(`(LOWER(s.set_number) LIKE $${i} OR LOWER(s.name) LIKE $${i}
                 OR LOWER(COALESCE(s.theme,'')) LIKE $${i} OR COALESCE(s.year,0)::text LIKE $${i})`);
  }
  const whereSql = where.length ? where.join(' AND ') : 'TRUE';
  // ausTabelle: siehe utils/validate — ein direkter Zugriff liefert auch
  // geerbte Eigenschaften, und die haette `|| SET_SORTS.added_desc` durchgelassen.
  const orderSql = ausTabelle(SET_SORTS, sort, SET_SORTS.added_desc);

  // Ohne page_size bleibt die Set-Liste UNBEGRENZT.
  // Ausführlich: docs/begruendungen/utils/handlers/sets.ts.md#getsets-limitsql
  let limitSql = '';
  const listParams = [...params];
  if (page_size) {
    const size = clampPageSize(page_size, 60);
    const off  = (Math.max(1, parseInt(page) || 1) - 1) * size;
    listParams.push(size, off);
    limitSql = ` LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`;
  }

  // Die Anleitungen werden ERST für die geladene Seite geholt (siehe unten) —
  // dafür braucht es die Setnummern der Seite, also läuft die Set-Abfrage
  // zuerst und die übrigen danach parallel.
  // Ausführlich: docs/begruendungen/utils/handlers/sets.ts.md#getsets-2
  const [sets, countRow, themeRows] = await Promise.all([
    // Vorher: drei korrelierte Subqueries pro Zeile, also drei Index-Scans auf
    // set_acquisitions je Set. Jetzt ein einziger gruppierter Scan, per
    // LEFT JOIN angehängt — identisches Ergebnis, eine Grössenordnung weniger
    // Arbeit ab ein paar hundert Sets.
    db.all(`SELECT ${SET_COLS}${SET_OWNER_COL},
      a.max_purchase_price, a.avg_purchase_price,
      COALESCE(a.acq_count, 0) AS acq_count, COALESCE(a.used_count, 0) AS used_count
      FROM ${setsFrom}
      LEFT JOIN (
        SELECT set_number,
               MAX(purchase_price)                     AS max_purchase_price,
               -- Mengengewichteter Kaufpreis: 2x100 und 1x160 ergibt 120, nicht
               -- 130 — und nicht 160, was MAX() liefert. Die Kachel zeigt ihn,
               -- solange noch kein Marktpreis geladen ist.
               SUM(purchase_price * quantity) FILTER (WHERE purchase_price IS NOT NULL)::numeric
                 / NULLIF(SUM(quantity) FILTER (WHERE purchase_price IS NOT NULL), 0)
                                                       AS avg_purchase_price,
               COUNT(*)                                AS acq_count,
               COUNT(*) FILTER (WHERE condition = 'U') AS used_count
        FROM set_acquisitions
        WHERE user_id = ANY($1)
        GROUP BY set_number
      ) a ON a.set_number = s.set_number
      WHERE ${whereSql} ORDER BY ${orderSql}${limitSql}`, listParams),
    page_size ? db.get(`SELECT COUNT(*)::int AS c FROM ${setsFrom} WHERE ${whereSql}`, params)
              : Promise.resolve(null),
    // Themenliste für das Auswahlfeld. Muss aus ALLEN Sets kommen, nicht aus
    // der geladenen Seite — sonst schrumpft das Auswahlfeld beim Paginieren.
    // Nur bei der ersten Seite nötig; Folgeseiten sparen die Abfrage.
    (page_size && parseInt(page) <= 1)
      // `theme` steht seit Migration 0033 im Katalog — deshalb der JOIN.
      ? db.all(`SELECT DISTINCT c.theme AS theme
                  FROM sets s JOIN set_catalog c ON c.set_number = s.set_number
                 WHERE s.user_id = ANY($1) AND c.theme IS NOT NULL AND c.theme <> ''
                 ORDER BY c.theme`, [uids])
      : Promise.resolve(null),
  ]);

  // Anleitungen nur für die Setnummern DIESER Seite. Ohne Sets auf der Seite
  // (leere Suche, letzte Seite) entfallen beide Abfragen ganz.
  const pageSetNumbers = sets.map((r: any) => r.set_number);
  const [sharedInstrs, userInstrs] = pageSetNumbers.length
    ? await Promise.all([
        db.all(`SELECT si.* FROM shared_instructions si
                WHERE si.set_number = ANY($1)
                  AND EXISTS (SELECT 1 FROM sets s
                              WHERE s.set_number = si.set_number AND s.user_id = ANY($2))`,
               // uids, nicht userId: asIds() ist genau dafuer da, dass ein
               // Aufrufer auch eine nackte Kennung schicken darf. Diese eine
               // Stelle nahm den Rohwert und uebergab ihn an `= ANY($2)` —
               // Postgres antwortete darauf mit „malformed array literal: 6",
               // und die ganze Galerie fiel aus. Gemessen beim Schreiben von
               // test/anleitungen-herkunft-db.test.js; im Betrieb blieb es
               // verborgen, weil beide Routen scopeIds() vorschalten und damit
               // ohnehin eine Liste schicken.
               [pageSetNumbers, uids]),
        db.all('SELECT * FROM instructions WHERE user_id = ANY($1) AND set_number = ANY($2)',
               [uids, pageSetNumbers]),
      ])
    : [[], []];

  const sharedBySet = new Map();
  for (const i of sharedInstrs) {
    if (!sharedBySet.has(i.set_number)) sharedBySet.set(i.set_number, []);
    sharedBySet.get(i.set_number).push(i);
  }
  const userBySet = new Map();
  for (const i of userInstrs) {
    if (!userBySet.has(i.set_number)) userBySet.set(i.set_number, []);
    userBySet.get(i.set_number).push(i);
  }
  const mapped = sets.map(s => ({
    ...s,
    // Angezeigter Zustand als Aggregat: sobald mindestens eine Kaufpreis-
    // Erfassung "Gebraucht" (U) ist, gilt das Set als gebraucht. Sind
    // Erfassungen vorhanden, aber alle "Neu", wird "Neu" angezeigt — der
    // gespeicherte sets.condition-Wert wird NICHT mehr als Fallback benutzt,
    // solange Erfassungen existieren (er kann nach Löschen/Reduzieren veraltet
    // sein). Nur ganz ohne Erfassungen zählt die gespeicherte Spalte.
    condition: conditionFromAcquisitions(s.acq_count, s.used_count),
    // Alle vorkommenden Zustände — die Kachel zeigt je eine Plakette.
    conditions: conditionsFromAcquisitions(s.acq_count, s.used_count),
    avg_purchase_price: s.avg_purchase_price != null ? parseFloat(s.avg_purchase_price) : null,
    image_local: resolveImageLocal(s.image_local),
    // Besitzer nur im Haushalt: Im Einzelkonto wäre die Angabe „gehört mir“ an
    // jeder Kachel nur Rauschen.
    // Im Haushalt IMMER dabei, auch leer: array_agg liefert NULL, wenn der
    // FILTER alles ausschliesst (ein Set, das niemand mehr in Menge > 0
    // besitzt). withOwners() unten macht daraus eine leere Plakettenliste —
    // wie die frueher hier stehende Schleife.
    ...(uids.length > 1 ? { owner_ids: (s.owner_ids || []).map((n: any) => parseInt(n)) } : {}),
    instructions: anleitungenZusammenlegen(
      sharedBySet.get(s.set_number) || [],
      userBySet.get(s.set_number) || [],
    ),
  }));

  // Namen zu den Besitzer-IDs steht in withOwners() (handlers/shared.ts) —
  // eine Abfrage fuer die ganze Seite, nicht eine je Zeile. Hier stand
  // dieselbe Aufloesung noch einmal ausformuliert; als die Set-Figuren
  // dieselbe Plakette bekamen, waere daraus eine dritte Kopie geworden.
  const mitBesitzern = await withOwners(uids, mapped);

  // Rückgabeform ist jetzt ein Objekt statt eines nackten Arrays, damit die
  // Gesamtzahl für den Endlos-Scroll mitkommt. Ohne Paginierung entspricht
  // total der Länge der Liste — die Aufrufer bleiben dadurch beide gleich.
  return {
    sets: mitBesitzern,
    total: countRow ? parseInt(countRow.c) : mapped.length,
    ...(themeRows ? { themes: themeRows.map(r => r.theme) } : {}),
  };
}

/**
 * Zustands-Aggregat eines Sets aus seinen Erfassungen.
 * Ausführlich: docs/begruendungen/utils/handlers/sets.ts.md#getsetconditionaggregate
 */
async function getSetConditionAggregate(userId: Blickfeld, setNumber: string) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  const acq = await db.get(
    "SELECT COUNT(*) AS acq_count, COUNT(*) FILTER (WHERE condition='U') AS used_count," +
    " MAX(purchase_price) AS max_purchase_price," +
    " SUM(purchase_price * quantity) FILTER (WHERE purchase_price IS NOT NULL)::numeric" +
    "   / NULLIF(SUM(quantity) FILTER (WHERE purchase_price IS NOT NULL), 0) AS avg_purchase_price" +
    " FROM set_acquisitions WHERE user_id = ANY($1) AND set_number=$2",
    [uids, setNumber]).catch(() => null);
  const acqCount  = parseInt(acq?.acq_count) || 0;
  const usedCount = parseInt(acq?.used_count) || 0;
  return {
    condition: conditionFromAcquisitions(acqCount, usedCount),
    // Dieselben Felder wie in getSets() — die Schreib-Endpunkte liefern das
    // Aggregat mit, und die Kachel wird damit ohne Neuladen aktualisiert.
    // Fehlte conditions hier, verlöre sie nach dem Speichern die zweite
    // Plakette bis zum nächsten vollständigen Laden.
    conditions: conditionsFromAcquisitions(acqCount, usedCount),
    acq_count: acqCount,
    used_count: usedCount,
    max_purchase_price: acq?.max_purchase_price ?? null,
    avg_purchase_price: acq?.avg_purchase_price != null ? parseFloat(acq.avg_purchase_price) : null,
  };
}

/**
 * Hängt das neu berechnete Zustands-Aggregat an eine Antwort.
 * Ausführlich: docs/begruendungen/utils/handlers/sets.ts.md#withsetaggregate
 */
async function withSetAggregate<T extends object>(userId: Blickfeld, setNumber: string, payload: T) {
  const uids = asIds(userId);
  // Die Abfrage auf sets.condition, die hier stand, ist mit Migration 0032
  // entfallen — samt der Spalte. Das Aggregat rechnet aus den Erfassungen.
  const agg = await getSetConditionAggregate(uids, setNumber).catch(() => null);
  return agg ? { ...payload, set: { set_number: setNumber, ...agg } } : payload;
}

async function getSet(userId: Blickfeld, setNumber: string) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  const [set, shared, uploaded] = await Promise.all([
    // Die eigene Zeile gewinnt für die übrigen Felder — sie beschreibt das
    // eigene Exemplar (Zustand, Kaufpreis). Die MENGE dagegen kommt aus der
    // Summe über alle Konten im Blickfeld.
    //  Der Lagerort muss AUSDRÜCKLICH dastehen
    // Ausführlich: docs/begruendungen/utils/handlers/sets.ts.md#getset
    db.get(
      `SELECT s.id, s.user_id, s.set_number, s.added_at, s.updated_at, s.storage_id,
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
                WHERE d.user_id = ANY($1) AND d.set_number = s.set_number) AS storage
         FROM sets s
         LEFT JOIN set_catalog c ON c.set_number = s.set_number
        WHERE s.user_id = ANY($1) AND s.set_number = $2
        ORDER BY (s.user_id = $3) DESC, s.id ASC
        LIMIT 1`, [uids, setNumber, uids[0]]),
    anleitungenZuSet(setNumber),
    db.all('SELECT * FROM instructions WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]),
  ]);
  if (!set) return null;
  // Aggregat inkl. acq_count/used_count/max_purchase_price — dieselben Felder
  // wie in getSets(). Vorher fehlten sie hier, weshalb ein Client die
  // Listen-Kachel nicht einfach mit dem Detail-Objekt überschreiben konnte,
  // ohne genau diese Werte zu verlieren.
  const agg = await getSetConditionAggregate(uids, setNumber);
  // Zwei Kaufadressen, vom Server aufgeloest
  // Der Preisvergleich kommt aus demselben Grund von hier: Bisher stand seine
  // Adresse an genau einer Stelle (dem Vergleichsbildschirm der App); vier
  // Stellen daraus zu machen waere der Anfang von vier Wahrheiten.
  // Ausführlich: docs/begruendungen/utils/handlers/sets.ts.md#getset-2
  const [bricklink, preisvergleich] = await Promise.all([
    resolveOne(setNumber).catch((e: unknown) => {
      meldeUndWeiter('setdetail:bricklink', e);
      return null;
    }),
    Promise.resolve(fuerSet(setNumber, set.name)),
  ]);
  return { ...set, ...agg,
    bricklink,
    preisvergleich_url: preisvergleich,
    image_local: resolveImageLocal(set.image_local),
    instructions: anleitungenZusammenlegen(shared, uploaded) };
}

/**
 * Die Zeilen, die zu EINEM Set-Exemplar eines Kontos gehören.
 * Ausführlich: docs/begruendungen/utils/handlers/sets.ts.md#deletesetrows
 */
async function deleteSetRows(tx: DbSchnittstelle, uids: number[], setNumber: string) {
  await tx.run('DELETE FROM sets WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
  await tx.run('DELETE FROM parts WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
  await tx.run('DELETE FROM minifigs WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
  await tx.run('DELETE FROM set_acquisitions WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
}

async function deleteSet(userId: Blickfeld, setNumber: string) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  // Atomar: vorher waren das vier sequenzielle DELETEs ohne Transaktion —
  // bricht eins davon ab (Statement-Timeout, Verbindungsverlust), bleiben
  // Teile und Minifiguren ohne zugehöriges Set in der DB zurück und tauchen
  // in Teileliste und Finanzsummen weiter auf.
  return db.transaction(async (tx) => {
    const besitzer = await tx.all('SELECT user_id FROM sets WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
    if (!besitzer.length) return false;
    // Ein Eintrag je Konto: Wiederhergestellt wird in das Konto, dem es gehörte.
    const papierkorb: number[] = [];
    for (const b of besitzer) {
      const id = await legeInPapierkorb(tx, 'set', b.user_id, setNumber);
      if (id !== null) papierkorb.push(id);
    }
    await deleteSetRows(tx, uids, setNumber);
    return papierkorb;
  });
}


export { getSets, getSetConditionAggregate, withSetAggregate, getSet, deleteSetRows, deleteSet };
