import * as db from '../../db/database';
import { resolveImageLocal } from '../images';
import { asIds } from '../household';
import { ensureFresh } from '../partsSummary';
import { fetchMissingBlIds } from '../../routes/parts';
import { getAllSetParts, getRbKey, httpsGetRobust } from '../../clients/rebrickable';
import { clampPageSize, conditionFromAcquisitions, conditionsFromAcquisitions, applyManualCondition, withOwners, MAX_PAGE_SIZE, UNPAGED_LIMIT, SET_PARTS_MAX_PAGE_SIZE } from './shared';
import { getParts } from './parts';
import { ausTabelle } from '../validate';

/**
 * Leseabfragen für Sets, samt der Ableitung des Zustands aus den Erfassungen.
 *
 * ── Warum aufgeteilt (Nachtrag 133) ────────────────────────────────────────
 * utils/handlers.ts fasste Sets, Teile und Minifiguren in 1313 Zeilen zusammen
 * — benannt nach seiner Rolle („handlers"), nicht nach seinem Inhalt, wie
 * zuvor schon js/07-admin.js. Die drei Domänen berühren sich kaum: Nur
 * getSets() liest Teile, und die Minifiguren-Kennzahlen lesen Sets. Beides
 * geht in EINE Richtung, es entsteht also kein Kreis.
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
  price_desc: 'COALESCE(a.max_purchase_price, s.purchase_price, 0) DESC',
  price_asc:  'COALESCE(a.max_purchase_price, s.purchase_price, 0) ASC',
  // Anzahl der besessenen Exemplare. sets.quantity wird bei jeder Änderung an
  // den Erfassungen neu aus set_acquisitions gespiegelt (routes/sets.ts), ist
  // hier also der richtige Wert — und der einzige, der ohne zusätzlichen JOIN
  // auskommt.
  //
  // Zweiter Sortierschlüssel: Ohne ihn stehen alle Sets mit derselben Anzahl —
  // und das sind fast alle, nämlich die mit genau einem Exemplar — in einer
  // von Postgres nicht festgelegten Reihenfolge. Beim Blättern könnte
  // dasselbe Set dadurch zweimal oder gar nicht erscheinen.
  qty_desc:   's.quantity DESC, s.added_at DESC',
  qty_asc:    's.quantity ASC, s.added_at DESC',
};

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
async function getSets(userId, query: any = {}) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId as any);
  // Explizite Spaltenliste statt SELECT *: id/user_id/brickset_id/updated_at
  // werden weder von der Webapp noch von der Android-App gelesen — sie haben
  // den JSON-Payload der /sets-Antwort nur unnötig aufgebläht.
  // Mit "s." qualifiziert: die angehängte Aggregat-Subquery führt set_number
  // ebenfalls, unqualifiziert wäre die Spalte ab jetzt mehrdeutig.
  const SET_COLS = ['set_number','name','year','theme','pieces','minifigs','quantity',
                    'image_local','added_at','purchase_price','condition']
                   .map(c => `s.${c}`).join(', ') +
    // image_url mit Rückfall auf den GEMEINSAMEN Katalog (Nachtrag 36, Marcos
    // Bericht: „wenn das Bild lokal noch nicht vorhanden ist, soll es direkt
    // via Proxy vom CDN geholt werden").
    //
    // Bisher kam die Adresse ausschliesslich aus der eigenen sets-Zeile. Steht
    // dort nichts — weil der Bild-Download beim Erfassen in seine 15-Sekunden-
    // Frist lief, weil das Set über CSV-Import oder Barcode-Scan kam, oder
    // weil eine ältere Zeile das Feld nie gefüllt hat —, lieferte die API
    // image_url: null UND image_local: null. Beide Clients hatten dann nichts
    // in der Hand und zeigten den Platzhalter, obwohl die CDN-Adresse im
    // set_catalog längst bekannt war. Genau dieser Fall ist Marco aufgefallen.
    //
    // set_catalog wird beim Erfassen JEDES Sets gefüllt (routes/sets.ts) und
    // ist kontoübergreifend — der Rückfall greift damit auch für Sets, die ein
    // anderes Haushaltsmitglied zuerst erfasst hat.
    ', COALESCE(s.image_url, sc.image_url) AS image_url';
  const { search, theme, sort, page = 1, page_size = null } = query;

  // ── Ein Set, EINE Zeile ─────────────────────────────────────────────────
  //
  // Im Haushalt besitzen womöglich zwei Kinder dasselbe Set. Es soll trotzdem
  // nur einmal erscheinen — mit der Summe der Mengen und den Kaufpreisen aller
  // Besitzer. Zwei Zeilen mit demselben Bild und Namen lesen sich wie ein
  // Fehler in der Liste.
  //
  // Das Verdichten steckt in einer Unterabfrage, die dieselben Spaltennamen
  // liefert wie die Tabelle. Alles darunter — Filter, Sortierung,
  // Seitenaufteilung, der Erfassungs-JOIN — bleibt dadurch unverändert; nur
  // die Quelle ist eine andere. Ohne Haushalt (ein Konto) wird gar nicht erst
  // gruppiert, dann ist es wörtlich die alte Abfrage.
  //
  // MIN() auf den Stammdaten ist kein Zufallsgriff: Name, Jahr, Thema und Bild
  // beschreiben DAS SET, nicht das Exemplar — sie sind über die Konten hinweg
  // gleich. MIN(added_at) ist bewusst das früheste Aufnahmedatum im Haushalt.
  const setsFrom = uids.length > 1
    ? `(SELECT s.set_number,
               MIN(s.name) AS name, MIN(s.year) AS year, MIN(s.theme) AS theme,
               MIN(s.pieces) AS pieces, MIN(s.minifigs) AS minifigs,
               SUM(s.quantity)::int AS quantity,
               MIN(s.image_url) AS image_url, MIN(s.image_local) AS image_local,
               MIN(s.added_at) AS added_at,
               MIN(s.purchase_price) AS purchase_price, MIN(s.condition) AS condition,
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
               array_agg(DISTINCT s.user_id) FILTER (WHERE s.quantity > 0) AS owner_ids
          FROM sets s WHERE s.user_id = ANY($1)
         GROUP BY s.set_number) s`
    : 'sets s';
  const SET_OWNER_COL = uids.length > 1 ? ', s.owner_ids' : '';
  // Ohne Gruppierung filtert die WHERE-Klausel wie bisher; mit Gruppierung hat
  // die Unterabfrage bereits gefiltert.
  const where = uids.length > 1 ? [] : ['s.user_id = ANY($1)'];
  const params: any[] = [uids];
  if (theme) { params.push(theme); where.push(`s.theme = $${params.length}`); }
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
  //
  // Hier stand kurzzeitig eine Obergrenze. Das war falsch: Die Android-App
  // blättert die Galerie NICHT (BrickApiService.getSets kennt keinen
  // page-Parameter, siehe auch die Notiz in routes/api_v1/sets.ts). Eine
  // Grenze hätte ihr ab dem Grenzwert stillschweigend Sets unterschlagen —
  // schlimmer als eine grosse Antwort. Für die Teileliste gilt das nicht,
  // dort blättern beide Clients (siehe getParts).
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
  //
  // VORHER hingen alle fünf Abfragen in EINEM Promise.all, und die beiden
  // Anleitungs-Abfragen filterten nur auf user_id. Bei 1000 Sets und einer
  // Seitengrösse von 60 wurde damit für JEDE Seite der komplette
  // Anleitungsbestand geladen und zu 94 % weggeworfen — inklusive des JOIN
  // über shared_instructions.
  const [sets, countRow, themeRows] = await Promise.all([
    // Vorher: drei korrelierte Subqueries pro Zeile, also drei Index-Scans auf
    // set_acquisitions je Set. Jetzt ein einziger gruppierter Scan, per
    // LEFT JOIN angehängt — identisches Ergebnis, eine Grössenordnung weniger
    // Arbeit ab ein paar hundert Sets.
    db.all(`SELECT ${SET_COLS}${SET_OWNER_COL},
      a.max_purchase_price, a.avg_purchase_price,
      COALESCE(a.acq_count, 0) AS acq_count, COALESCE(a.used_count, 0) AS used_count
      FROM ${setsFrom}
      LEFT JOIN set_catalog sc ON sc.set_number = s.set_number
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
      ? db.all(`SELECT DISTINCT theme FROM sets WHERE user_id = ANY($1) AND theme IS NOT NULL AND theme <> '' ORDER BY theme`, [uids])
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
               [pageSetNumbers, userId]),
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
    condition: conditionFromAcquisitions(s.acq_count, s.used_count, s.condition),
    // Alle vorkommenden Zustände — die Kachel zeigt je eine Plakette.
    conditions: conditionsFromAcquisitions(s.acq_count, s.used_count, s.condition),
    avg_purchase_price: s.avg_purchase_price != null ? parseFloat(s.avg_purchase_price) : null,
    image_local: resolveImageLocal(s.image_local),
    // Besitzer nur im Haushalt: Im Einzelkonto wäre die Angabe „gehört mir“ an
    // jeder Kachel nur Rauschen.
    ...(s.owner_ids ? { owner_ids: s.owner_ids.map((n: any) => parseInt(n)) } : {}),
    instructions: [
      ...(sharedBySet.get(s.set_number) || []),
      ...(userBySet.get(s.set_number) || []),
    ],
  }));

  // Namen zu den Besitzer-IDs — eine Abfrage für die ganze Seite, nicht eine
  // je Zeile. Die Kachel zeigt sie als Plakette; ohne Namen bliebe nur eine
  // Zahl, mit der niemand etwas anfangen kann.
  if (uids.length > 1) {
    const owners = await db.all('SELECT id, username FROM users WHERE id = ANY($1)', [uids])
      .catch(() => []);
    const nameById = new Map<number, any>(owners.map((u: any) => [parseInt(u.id), u.username] as [number, any]));
    for (const row of mapped as any[]) {
      row.owners = (row.owner_ids || []).map((id: number) => ({ id, username: nameById.get(id) || String(id) }));
    }
  }

  // Rückgabeform ist jetzt ein Objekt statt eines nackten Arrays, damit die
  // Gesamtzahl für den Endlos-Scroll mitkommt. Ohne Paginierung entspricht
  // total der Länge der Liste — die Aufrufer bleiben dadurch beide gleich.
  return {
    sets: mapped,
    total: countRow ? parseInt(countRow.c) : mapped.length,
    ...(themeRows ? { themes: themeRows.map(r => r.theme) } : {}),
  };
}

/**
 * Zustands-Aggregat eines Sets aus seinen Erfassungen.
 *
 * Die Regel („eine U-Erfassung macht das Set gebraucht; gibt es Erfassungen,
 * zählt die Spalte sets.condition nicht mehr") stand vorher dreimal im Code:
 * in getSets(), in getSet() und — leicht falsch — im Frontend, wo nach einer
 * Zustandsänderung die Bedingung der ZULETZT erfassten Position genommen wurde
 * statt „irgendeine gebraucht". Bei der Reihenfolge [U, N] zeigte die Kachel
 * damit „neu", während der Server „gebraucht" meinte.
 *
 * Jetzt gibt es die Regel einmal, und die Schreib-Endpunkte liefern das
 * Ergebnis in ihrer Antwort mit — die Clients rechnen nichts mehr nach.
 */
async function getSetConditionAggregate(userId, setNumber, storedCondition) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId as any);
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
    condition: conditionFromAcquisitions(acqCount, usedCount, storedCondition),
    // Dieselben Felder wie in getSets() — die Schreib-Endpunkte liefern das
    // Aggregat mit, und die Kachel wird damit ohne Neuladen aktualisiert.
    // Fehlte conditions hier, verlöre sie nach dem Speichern die zweite
    // Plakette bis zum nächsten vollständigen Laden.
    conditions: conditionsFromAcquisitions(acqCount, usedCount, storedCondition),
    acq_count: acqCount,
    used_count: usedCount,
    max_purchase_price: acq?.max_purchase_price ?? null,
    avg_purchase_price: acq?.avg_purchase_price != null ? parseFloat(acq.avg_purchase_price) : null,
  };
}

/**
 * Hängt das neu berechnete Zustands-Aggregat an eine Antwort.
 *
 * Liegt hier und nicht in einer der beiden Routendateien, weil es GENAU dieses
 * Auseinanderlaufen war, das den Fehler verursacht hat: Der Wrapper existierte
 * zuerst nur in routes/api_v1/acquisitions.ts, die Webapp benutzt aber ihren
 * eigenen Handler in routes/sets.ts — und bekam deshalb kein `set` in der
 * Antwort, sodass die Galerie-Kachel weiterhin veraltet blieb.
 */
async function withSetAggregate(userId, setNumber, payload) {
  const uids = asIds(userId as any);
  const row = await db.get('SELECT condition FROM sets WHERE user_id = ANY($1) AND set_number=$2',
    [uids, setNumber]).catch(() => null);
  const agg = await getSetConditionAggregate(uids, setNumber, row?.condition).catch(() => null);
  return agg ? { ...payload, set: { set_number: setNumber, ...agg } } : payload;
}

async function getSet(userId, setNumber) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId as any);
  const [set, shared, uploaded] = await Promise.all([
    // ── Eine Zeile, aber die Menge des GANZEN Blickfelds ───────────────────
    //
    // Marcos Vorgabe: „Die Anzahl soll immer von allen angezeigt werden."
    //
    // Vorher nahm db.get() irgendeine der Haushaltszeilen — welche, entschied
    // die Reihenfolge in der Tabelle. Marco sah dadurch „Anzahl 0" für ein Set,
    // von dem das Unterkonto ein Exemplar hält. Die LISTE summierte längst
    // (getSets gruppiert für Haushalte), nur das DETAIL nicht: dieselbe Frage,
    // zwei Antworten.
    //
    // Die eigene Zeile gewinnt für die übrigen Felder — sie beschreibt das
    // eigene Exemplar (Zustand, Kaufpreis). Die MENGE dagegen kommt aus der
    // Summe über alle Konten im Blickfeld.
    db.get(
      `SELECT s.*,
              (SELECT COALESCE(SUM(a.quantity),0)::int FROM sets a
                WHERE a.user_id = ANY($1) AND a.set_number = s.set_number) AS quantity
         FROM sets s
        WHERE s.user_id = ANY($1) AND s.set_number = $2
        ORDER BY (s.user_id = $3) DESC, s.id ASC
        LIMIT 1`, [uids, setNumber, uids[0]]),
    db.all('SELECT * FROM shared_instructions WHERE set_number = $1', [setNumber]),
    db.all('SELECT * FROM instructions WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]),
  ]);
  if (!set) return null;
  // Aggregat inkl. acq_count/used_count/max_purchase_price — dieselben Felder
  // wie in getSets(). Vorher fehlten sie hier, weshalb ein Client die
  // Listen-Kachel nicht einfach mit dem Detail-Objekt überschreiben konnte,
  // ohne genau diese Werte zu verlieren.
  const agg = await getSetConditionAggregate(uids, setNumber, set.condition);
  return { ...set, ...agg,
    image_local: resolveImageLocal(set.image_local),
    instructions: [...shared, ...uploaded] };
}

/**
 * Die Zeilen, die zu EINEM Set-Exemplar eines Kontos gehören.
 *
 * Steht als eigene Funktion da, weil es zwei Anlässe gibt, sie loszuwerden:
 * das ausdrückliche Löschen (deleteSet) und das Wegfallen der letzten
 * Erfassung (routes/api_v1/acquisitions.ts). Zwei Listen von DELETEs wären
 * genau die Art Doppelung, an der in diesem Projekt schon mehrfach eine Regel
 * nur an einer der beiden Stellen nachgezogen wurde — hier hiesse das:
 * verwaiste Teile und Minifiguren ohne zugehöriges Set.
 *
 * Erwartet eine offene Transaktion; die Aufrufer bringen ihre eigene mit.
 */
async function deleteSetRows(tx, uids, setNumber) {
  await tx.run('DELETE FROM sets WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
  await tx.run('DELETE FROM parts WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
  await tx.run('DELETE FROM minifigs WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
  await tx.run('DELETE FROM set_acquisitions WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
}

async function deleteSet(userId, setNumber) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId as any);
  // Atomar: vorher waren das vier sequenzielle DELETEs ohne Transaktion —
  // bricht eins davon ab (Statement-Timeout, Verbindungsverlust), bleiben
  // Teile und Minifiguren ohne zugehöriges Set in der DB zurück und tauchen
  // in Teileliste und Finanzsummen weiter auf.
  return db.transaction(async (tx) => {
    const set = await tx.get('SELECT 1 FROM sets WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
    if (!set) return false;
    await deleteSetRows(tx, uids, setNumber);
    return true;
  });
}

async function updateSetQuantity(userId, setNumber, quantity) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId as any);
  // `uids` statt `userId`: Die normalisierte Liste wurde oben berechnet und
  // dann nicht benutzt — ANY() bekam den rohen Parameter. Mit einer nackten
  // Zahl statt eines Feldes bricht die Abfrage ab, und die Mengenänderung fiel
  // still aus.
  await db.run(
    'UPDATE sets SET quantity = $1 WHERE user_id = ANY($2) AND set_number = $3',
    [quantity, uids, setNumber]
  );
}

export { getSets, getSetConditionAggregate, withSetAggregate, getSet, deleteSetRows, deleteSet, updateSetQuantity };
