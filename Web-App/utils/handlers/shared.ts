import * as db from '../../db/database';
import { inKontowaehrung, kontowaehrungJoin } from '../acquisitions';
import { istErsatzteil } from '../validate';
import { asIds } from '../household';
import { teilmengeJoin, teilmengeAus } from '../bestandsmenge';

/**
 * Was alle drei Domänen brauchen: Seitengrössen, Zustandsableitung aus
 * Erfassungen, Besitzer-Anreicherung.
 * Ausführlich: docs/begruendungen/utils/handlers/shared.ts.md#abschnitt
 */

/**
 * Obergrenze für page_size — je Anfrage, unabhängig vom Abfrageweg.
 * Ausführlich: docs/begruendungen/utils/handlers/shared.ts.md#max-page-size
 */
export const MAX_PAGE_SIZE = 500;

/**
 * Obergrenze, wenn ein Aufrufer GAR KEIN page_size schickt.
 * Ausführlich: docs/begruendungen/utils/handlers/shared.ts.md#unpaged-limit
 */
export const UNPAGED_LIMIT = 2000;

/**
 * Obergrenze für die Teileliste EINES Sets (Filter set_number).
 * Ausführlich: docs/begruendungen/utils/handlers/shared.ts.md#set-parts-max-page-size
 */
export const SET_PARTS_MAX_PAGE_SIZE = 5000;

/** page_size auf einen brauchbaren Wert bringen: mindestens 1, höchstens MAX. */
function clampPageSize(value: any, fallback: number): number {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(value)) || fallback));
}

/** Manuell erfasste Teile (eigene Ansicht neben den Set-Teilen).
 *  Von /api/parts/manual UND /api/v1/parts/manual genutzt (Parität). */
/**
 * Eine Anzahl, wie sie aus der Datenbank kommt.
 * Ausführlich: docs/begruendungen/utils/handlers/shared.ts.md#zaehlwert
 */
type Zaehlwert = number | string | null | undefined;

/**
 * DIE Zustandsregel — für Sets, manuelle Teile und manuelle Minifiguren.
 * Ausführlich: docs/begruendungen/utils/handlers/shared.ts.md#conditionfromacquisitions
 */
function conditionFromAcquisitions(acqCount: Zaehlwert, usedCount: Zaehlwert) {
  // parseInt wie in der Schwesterfunktion unten. Vorher stand hier
  // `usedCount > 0` — das ging nur ueber die JS-Umwandlung gut, weil COUNT(*)
  // als "2" ankommt. Nachgemessen und gleichwertig fuer alles, was hier
  // ankommt: "2"/2 -> wahr, "0"/0/null/undefined -> falsch. Der Typ hat die …
  // Ausführlich: docs/begruendungen/utils/handlers/shared.ts.md#conditionfromacquisitions-acq
  const acq  = parseInt(String(acqCount ?? ''))  || 0;
  const used = parseInt(String(usedCount ?? '')) || 0;
  // Als Bedingungsausdruck und nicht als zwei Rueckgaben: Die Regel soll als
  // EIN Ausdruck lesbar sein, und test/set-condition-aggregate.test.js zaehlt
  // genau diese Form („die Aggregat-Regel steht nur noch an einer Stelle").
  if (acq > 0) return used > 0 ? 'U' : 'N';
  return 'N';
}

/**
 * WELCHE Zustände hat der Eintrag — für die Plaketten auf der Kachel.
 * Ausführlich: docs/begruendungen/utils/handlers/shared.ts.md#conditionsfromacquisitions
 */
function conditionsFromAcquisitions(acqCount: Zaehlwert, usedCount: Zaehlwert): ('N' | 'U')[] {
  const acq  = parseInt(String(acqCount ?? ''))  || 0;
  const used = parseInt(String(usedCount ?? '')) || 0;
  // Ohne Erfassungen die eine Plakette „Neu" — siehe die Begruendung in der
  // Schwesterfunktion oben, warum es keinen gespeicherten Wert mehr gibt.
  if (acq <= 0) return ['N'];
  const out: ('N' | 'U')[] = [];
  if (acq - used > 0) out.push('N');
  if (used > 0)       out.push('U');
  return out.length ? out : ['N'];
}

/**
 * Angezeigter Zustand manuell erfasster Teile und Minifiguren.
 * Ausführlich: docs/begruendungen/utils/handlers/shared.ts.md#abschnitt-2
 * @param {'part'|'fig'} kind
 */
/**
 * `rows` ist `any[]` und nicht `any[] | null`: Beide Aufrufstellen
 * (handlers/minifigs.ts, handlers/parts.ts) reichen das Ergebnis eines
 * `db.all(...).map(...)` herein, also immer ein Array. Die Abfrage
 * `!rows?.length` im Rumpf bleibt trotzdem stehen — sie kostet nichts und
 * faengt den leeren Fall, auf den es ihr eigentlich ankommt.
 */
async function applyManualCondition(userId: unknown, rows: any[], kind: 'part' | 'fig') {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId as any);
  if (!rows?.length) return rows;

  const isPart = kind === 'part';
  const keyOf = (r: any) => isPart
    ? `${r.part_number}|${r.color_id || 0}`
    : String(r.fig_number);

  const acq = await db.all(
    isPart
      ? `SELECT part_number, color_id,
                COUNT(*) AS acq_count,
                COUNT(*) FILTER (WHERE condition = 'U') AS used_count,
                SUM(unit_price * quantity) FILTER (WHERE unit_price IS NOT NULL AND ${inKontowaehrung('part_acquisitions')})::numeric
                  / NULLIF(SUM(quantity) FILTER (WHERE unit_price IS NOT NULL AND ${inKontowaehrung('part_acquisitions')}), 0) AS avg_purchase_price
           FROM part_acquisitions ${kontowaehrungJoin('part_acquisitions')}
          WHERE part_acquisitions.user_id = ANY($1)
          GROUP BY part_number, color_id`
      : `SELECT fig_number,
                COUNT(*) AS acq_count,
                COUNT(*) FILTER (WHERE condition = 'U') AS used_count,
                SUM(unit_price * quantity) FILTER (WHERE unit_price IS NOT NULL AND ${inKontowaehrung('minifig_acquisitions')})::numeric
                  / NULLIF(SUM(quantity) FILTER (WHERE unit_price IS NOT NULL AND ${inKontowaehrung('minifig_acquisitions')}), 0) AS avg_purchase_price
           FROM minifig_acquisitions ${kontowaehrungJoin('minifig_acquisitions')}
          WHERE minifig_acquisitions.user_id = ANY($1)
          GROUP BY fig_number`,
    [uids]
  );

  const byKey = new Map<string, any>(acq.map((a: any) => [
    isPart ? `${a.part_number}|${a.color_id || 0}` : String(a.fig_number),
    a,
  ] as [string, any]));

  return rows.map(r => {
    const a = byKey.get(keyOf(r));
    const acqCount = parseInt(a?.acq_count) || 0;
    const usedCount = parseInt(a?.used_count) || 0;
    return {
      ...r,
      // Ohne den gespeicherten Wert der Stammzeile: Migration 0035 hat die
      // Spalte geloescht und garantiert fuer jede manuelle Position eine
      // Erfassung.
      condition: conditionFromAcquisitions(acqCount, usedCount),
      conditions: conditionsFromAcquisitions(acqCount, usedCount),
      acq_count: acqCount,
      used_count: usedCount,
      // Mengengewichtet über die Erfassungen — die Kachel zeigte bisher den
      // Wert der Stammzeile, also den zuletzt geschriebenen Einzelpreis.
      avg_purchase_price: a?.avg_purchase_price != null ? parseFloat(a.avg_purchase_price) : null,
    };
  });
}

/** Kopf-/Übersichts-Statistik — von /api/settings/stats UND /api/v1/stats
 *  genutzt (Parität). Superset der historischen Felder beider Routen;
 *  total_parts ist ein Alias von total_pieces (v1-Altbestand). */
/**
 * Besitzer-Namen an Zeilen hängen, die eine `user_id` tragen.
 * Ausführlich: docs/begruendungen/utils/handlers/shared.ts.md#abschnitt-3
 */
/**
 * Besitzer-Plaketten anhaengen — fuer EINZELNE Zeilen (`user_id`) und fuer
 * GRUPPIERTE (`owner_ids`).
 * Ausführlich: docs/begruendungen/utils/handlers/shared.ts.md#withowners
 */
async function withOwners(uids: number[], rows: any[]) {
  if (uids.length < 2 || !rows?.length) return rows;
  const owners = await db.all('SELECT id, username FROM users WHERE id = ANY($1)', [uids]);
  const nameById = new Map<number, any>(owners.map((u: any) => [parseInt(u.id), u.username] as [number, any]));
  const platte = (id: number) => ({ id, username: nameById.get(id) || String(id) });
  return rows.map(r => {
    // `owner_ids` KANN als Schluessel mit dem Wert null dastehen: array_agg
    // liefert NULL, wenn der FILTER alles ausschliesst (ein Set, das niemand
    // mehr in Menge > 0 besitzt). Dann gehoert eine LEERE Plakettenliste
    // heraus, nicht keine — genau das tat getSets vorher schon.
    if ('owner_ids' in r) return { ...r, owners: (r.owner_ids || []).map((n: any) => platte(parseInt(n))) };
    if (r.user_id != null) return { ...r, owners: [platte(parseInt(r.user_id))] };
    return r;
  });
}

/**
 * In welchen Sets steckt dieses Teil / diese Figur?
 * Ausführlich: docs/begruendungen/utils/handlers/shared.ts.md#verwendendesset
 */
export interface VerwendendesSet {
  set_number: string;
  set_name: string | null;
  quantity: number;
  image_local: string | null;
  image_url: string | null;
  owner_user_id: number;
}

/** Das Teil bzw. die Figur selbst — für die Kopfzeile des Dialogs. */
export interface BestandteilKopf {
  nummer: string;
  name: string | null;
  color_id: number | null;
  color_name: string | null;
  color_hex: string | null;
  category_name: string | null;
  image_local: string | null;
  image_url: string | null;
  is_spare: boolean;
  /**
   * Lagerort — verdichtet über alle Zeilen dieses Teils.
   * Ausführlich: docs/begruendungen/utils/handlers/shared.ts.md#bestandteilkopf
   */
  storage: string | null;
  /**
   * Wem dieses Teil gehört — die Konten, in deren Sets es steckt.
   * Ausführlich: docs/begruendungen/utils/handlers/shared.ts.md#bestandteilkopf-2
   */
  owner_ids: number[];
  /** Summe über ALLE Sets im Blickfeld. */
  total_quantity: number;
}

export interface BestandteilAntwort {
  item: BestandteilKopf | null;
  sets: VerwendendesSet[];
}

/** Spalten, über die gesucht werden darf. Siehe verwendendeSets(). */
const SUCHSPALTEN = new Set(['part_number', 'color_id', 'fig_number']);

/**
 * Die Felder, die das Teil/die Figur selbst beschreiben — je Tabelle andere.
 *
 * `minifigs` hat keine Farbe und keine Kategorie; damit beide Zweige DIESELBE
 * Antwortform liefern, stehen sie dort als feste NULL im Ausdruck. Sonst
 * müssten die beiden Oberflächen zwei Formen unterscheiden, und genau daran
 * laufen in diesem Projekt Dinge auseinander.
 */
const KOPFFELDER = {
  parts: `x.part_number AS nummer, MAX(pc.part_name) AS name,
          MAX(x.color_id) AS color_id, MAX(pcc.color_name) AS color_name,
          MAX(pcc.color_hex) AS color_hex, MAX(pc.category_name) AS category_name,
          MAX(pcc.image_local) AS teil_image_local, MAX(pcc.image_url) AS teil_image_url,
          MAX(COALESCE(spc.is_spare, 0)) AS is_spare,
          NULLIF(STRING_AGG(DISTINCT lo.name, ', '), '') AS storage`,
  minifigs: `x.fig_number AS nummer, MAX(mc.fig_name) AS name,
          NULL::int AS color_id, NULL::text AS color_name,
          NULL::text AS color_hex, NULL::text AS category_name,
          MAX(mc.image_local) AS teil_image_local, MAX(mc.image_url) AS teil_image_url,
          0 AS is_spare, NULL::text AS storage`,
} as const;

/**
 * Die Katalog-JOINs je Tabelle.
 * Ausführlich: docs/begruendungen/utils/handlers/shared.ts.md#katalogjoin
 */
const KATALOGJOIN = {
  parts: `LEFT JOIN part_catalog pc ON pc.part_number = x.part_number
          LEFT JOIN part_color_catalog pcc ON pcc.part_number = x.part_number
                                          AND pcc.color_id    = x.color_id
          LEFT JOIN set_teile spc ON spc.set_number  = x.set_number
                                         AND spc.part_number = x.part_number
                                         AND spc.color_id    = x.color_id`,
  minifigs: `LEFT JOIN minifigs_catalog mc ON mc.fig_number = x.fig_number`,
} as const;

const SCHLUESSELSPALTE = { parts: 'x.part_number', minifigs: 'x.fig_number' } as const;

/**
 * Die Bestandsart je Tabelle — fuer teilmengeJoin/teilmengeAus
 * (utils/bestandsmenge.ts). Dieselbe Bauart wie KOPFFELDER und
 * KATALOGJOIN darueber: Diese Abfrage bedient beide Tabellen in EINER
 * Form, und was sich unterscheidet, steht in einer Zuordnung.
 */
const ART = { parts: 'part', minifigs: 'fig' } as const;

async function verwendendeSets(
  uids: number[],
  tabelle: 'parts' | 'minifigs',
  schluessel: Record<string, string | number>,
): Promise<BestandteilAntwort> {
  const spalten = Object.keys(schluessel);
  // Die Namen kommen aus Literalen der beiden Aufrufer, nie aus einer
  // Anfrage. Die Schranke steht trotzdem: Ein künftiger Aufrufer soll hier
  // nichts anderes einsetzen können, und ein Spaltenname lässt sich nicht
  // als Parameter binden — er wird zwangsläufig in den Text eingefügt.
  for (const sp of spalten) {
    if (!SUCHSPALTEN.has(sp)) throw new Error(`verwendendeSets: unerlaubte Spalte ${sp}`);
  }
  const params: any[] = [uids];
  const bedingungen = spalten.map(sp => `x.${sp} = $${params.push(schluessel[sp])}`);
  const rows = await db.all(
    `SELECT x.set_number,
            x.user_id            AS owner_user_id,
            -- Die Stückzahl der Bestandszeile (Migration 0038): Fuer ein
            -- Set-Teil die Katalogzahl, fuer ein manuelles die Summe der
            -- Erfassungen. Hier stand SUM(x.quantity).
            --
            -- Die Art steht nicht im Alias: Diese Abfrage bedient BEIDE
            -- Tabellen ueber ${tabelle}, und der Helfer braucht dieselbe
            -- Unterscheidung — deshalb kommt sie wie KOPFFELDER aus einer
            -- Zuordnung je Tabelle.
            SUM(${teilmengeAus('x', ART[tabelle])})::int AS quantity,
            c.name               AS set_name,
            c.image_local        AS set_image_local,
            c.image_url          AS set_image_url,
            ${KOPFFELDER[tabelle]}
       FROM ${tabelle} x
       ${teilmengeJoin('x', ART[tabelle])}
       -- Zwei JOINs, ausgeschrieben: sets sagt, WELCHES Konto das Set haelt
       -- (deshalb ueber user_id UND set_number), set_catalog sagt, wie es
       -- heisst und wie es aussieht (nur ueber set_number — der Name haengt
       -- nicht am Konto). Keine Gegenstriche: Der Kommentar steht in einem
       -- Template-Literal, und ein Gegenstrich beendet es.
       LEFT JOIN sets s ON s.user_id = x.user_id AND s.set_number = x.set_number
       LEFT JOIN set_catalog c ON c.set_number = x.set_number
       -- Der Lagerortname aus dem Vorrat (Migration 0031). Steht hier und
       -- nicht nur im parts-Zweig von KOPFFELDER, weil der minifigs-Zweig ihn
       -- als feste NULL fuehrt — ein unbenutzter LEFT JOIN kostet dort nichts
       -- und haelt die Abfrage in EINER Form.
       LEFT JOIN storage_locations lo ON lo.id = x.storage_id
       ${KATALOGJOIN[tabelle]}
      WHERE x.user_id = ANY($1)
        AND x.set_number IS NOT NULL
        AND ${bedingungen.join(' AND ')}
      GROUP BY x.set_number, x.user_id, ${SCHLUESSELSPALTE[tabelle]},
               c.name, c.image_local, c.image_url
      ORDER BY x.set_number`,
    params,
  );

  const sets: VerwendendesSet[] = rows.map((r: any) => ({
    set_number:    String(r.set_number),
    set_name:      r.set_name ?? null,
    quantity:      parseInt(r.quantity, 10) || 0,
    image_local:   r.set_image_local ?? null,
    image_url:     r.set_image_url ?? null,
    owner_user_id: parseInt(r.owner_user_id, 10),
  }));

  // Der Kopf entsteht aus DENSELBEN Zeilen — keine zweite Abfrage, die etwas
  // anderes sagen könnte als die Liste darunter. Das Bild wird von der ersten
  // Zeile genommen, die eines hat: Nicht jede Set-Zeile trägt ein Bild, und
  // ein leerer Rahmen im Dialog wäre schlechter als das Bild aus dem
  // Nachbarset — es ist dasselbe Teil.
  const erste = rows[0] as any;
  const mitBild = (rows as any[]).find(r => r.teil_image_local || r.teil_image_url);
  const item: BestandteilKopf | null = erste ? {
    nummer:         String(erste.nummer),
    name:           erste.name ?? null,
    color_id:       erste.color_id == null ? null : parseInt(erste.color_id, 10),
    color_name:     erste.color_name ?? null,
    color_hex:      erste.color_hex ?? null,
    category_name:  erste.category_name ?? null,
    image_local:    mitBild?.teil_image_local ?? null,
    image_url:      mitBild?.teil_image_url ?? null,
    // is_spare kommt als INTEGER aus der Spalte; der Treiber liefert
    // Aggregate als ZEICHENKETTE, und "0" ist in JavaScript WAHR. Deshalb
    // ausdrücklich über istErsatzteil() — dieselbe Lesart wie überall sonst.
    is_spare:       istErsatzteil(erste.is_spare),
    storage:        erste.storage ?? null,
    // Aus DENSELBEN Zeilen wie die Liste darunter — siehe owner_ids.
    owner_ids:      [...new Set(sets.map(s => s.owner_user_id))].filter(Number.isFinite),
    total_quantity: sets.reduce((n, s) => n + s.quantity, 0),
  } : null;

  return { item, sets };
}

export { clampPageSize, conditionFromAcquisitions, conditionsFromAcquisitions, applyManualCondition, withOwners, verwendendeSets };


/**
 * Die manuell erfasste Stammzeile eines Teils bzw. einer Figur entfernen.
 * Ausführlich: docs/begruendungen/utils/handlers/shared.ts.md#loeschemanuellesteil
 * @param dbh Transaktionsgriff, wo einer gebraucht wird
 */
export async function loescheManuellesTeil(
  dbh: { run: (sql: string, p?: any[]) => Promise<any> }, ownerId: number, partNumber: string, colorId: number,
) {
  return dbh.run(
    "DELETE FROM parts WHERE user_id=$1 AND part_number=$2 AND color_id=$3 AND source='manual'",
    [ownerId, partNumber, colorId]);
}

/** Wie loescheManuellesTeil, fuer eine manuell erfasste Figur. */
export async function loescheManuelleFigur(
  dbh: { run: (sql: string, p?: any[]) => Promise<any> }, ownerId: number, figNumber: string,
) {
  return dbh.run(
    "DELETE FROM minifigs WHERE user_id=$1 AND fig_number=$2 AND source='manual'",
    [ownerId, figNumber]);
}
