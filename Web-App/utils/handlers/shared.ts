import * as db from '../../db/database';
import { istErsatzteil } from '../validate';
import { asIds } from '../household';

/**
 * Was alle drei Domänen brauchen: Seitengrössen, Zustandsableitung aus
 * Erfassungen, Besitzer-Anreicherung.
 *
 * ── Warum aufgeteilt (Nachtrag 133) ────────────────────────────────────────
 * utils/handlers.ts fasste Sets, Teile und Minifiguren in 1313 Zeilen zusammen
 * — benannt nach seiner Rolle („handlers"), nicht nach seinem Inhalt, wie
 * zuvor schon js/07-admin.js. Die drei Domänen berühren sich kaum: Nur
 * getSets() liest Teile, und die Minifiguren-Kennzahlen lesen Sets. Beides
 * geht in EINE Richtung, es entsteht also kein Kreis.
 */

/**
 * Obergrenze für page_size — je Anfrage, unabhängig vom Abfrageweg.
 *
 * ── Woher die Zahl steht ────────────────────────────────────────────────────
 * Der Wert stand fünfmal als Literal im Code, und eine sechste Stelle hatte ihn
 * gar nicht: tryPartsSummary() reichte page_size ungeprüft ins LIMIT durch,
 * während die Live-Abfrage direkt daneben bei 500 deckelte. DIESELBE Anfrage
 * lieferte damit unterschiedlich viele Zeilen, je nachdem ob die
 * Zusammenfassung gerade frisch war — nachgestellt an 5000 Teilen mit
 * page_size=100000: 500 Zeilen über die Live-Abfrage, 5000 über die
 * Zusammenfassung. Ein Unterschied, der vom Cache-Zustand abhängt, ist beim
 * Suchen eines Fehlers das Letzte, was man vermutet.
 *
 * Als Konstante, damit die nächste Seitenabfrage sie nicht wieder vergisst.
 */
export const MAX_PAGE_SIZE = 500;

/**
 * Obergrenze, wenn ein Aufrufer GAR KEIN page_size schickt.
 *
 * Ohne Grenze liefert die Teile- und die Set-Liste den kompletten Bestand in
 * einer Antwort — bei 800 Sets sind das rund 270 KB, bei einer grossen
 * Teilesammlung ein Vielfaches, und alles davon liegt gleichzeitig im Speicher
 * des Workers und im Speicher des Clients.
 *
 * Beide echten Clients blättern längst (Webapp: PARTS_PAGE_SIZE in
 * public/js/03-parts.js, Android: page_size=500 mit onLoadMore) — die Grenze
 * hier trifft sie nicht. Sie fängt den Fall ab, dass ein Aufrufer das
 * Blättern vergisst: Statt der ganzen Tabelle bekommt er die erste Seite, und
 * `total` in derselben Antwort sagt ihm, dass es mehr gibt.
 */
export const UNPAGED_LIMIT = 2000;

/**
 * Obergrenze für die Teileliste EINES Sets (Filter set_number).
 *
 * ── Warum die normale Grenze hier zu klein ist ──────────────────────────────
 * Die Android-Set-Detailansicht fragt `page_size=2000` und holt NUR Seite 1.
 * clampPageSize deckelte das auf MAX_PAGE_SIZE = 500 — am laufenden Server
 * nachgestellt mit einem Set aus 915 Teilezeilen:
 *
 *   geliefert 500 von total 915, page_size (gemeldet) 2000
 *
 * Die App zeigte also gut die Hälfte der Teile, und die gemeldete
 * Seitengrösse behauptete, es seien alle angefragt worden. Auch die
 * PDF-Teileliste baut auf dieser Antwort auf.
 *
 * Ein Set ist eine begrenzte Menge — die grössten liegen bei rund 12 000
 * Teilen, nach Farbe gruppiert deutlich darunter. 5000 Zeilen sind hier also
 * eine Grenze gegen Unfug, keine Portionierung. Für die allgemeine Teileliste
 * (ohne set_number) bleibt es bei MAX_PAGE_SIZE; dort blättern beide Clients.
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
 *
 * NACHGEMESSEN, nicht angenommen: `COUNT(*)` ist in Postgres `bigint`, und der
 * pg-Treiber gibt bigint als ZEICHENKETTE zurueck ("0"), damit keine
 * Genauigkeit verlorengeht. Auch `COALESCE(count, 0)` bleibt bigint. Andere
 * Aufrufer reichen bereits mit parseInt normalisierte Zahlen herein, und
 * fehlende Zeilen ergeben null — deshalb alle drei Formen.
 */
type Zaehlwert = number | string | null | undefined;

/**
 * DIE Zustandsregel — für Sets, manuelle Teile und manuelle Minifiguren.
 *
 * Sobald EINE Erfassung gebraucht ist, gilt der Eintrag als gebraucht. Gibt es
 * Erfassungen, aber keine gebrauchte, ist er neu. Ohne Erfassungen zählt der
 * gespeicherte Wert.
 *
 * Steht bewusst an genau einer Stelle: Sie war früher in getSets() und getSet()
 * doppelt ausformuliert und lief dadurch auseinander. Ein Test hält fest, dass
 * `usedCount > 0 ? 'U'` im Code nur einmal vorkommt.
 */
function conditionFromAcquisitions(acqCount: Zaehlwert, usedCount: Zaehlwert, stored: string | null | undefined) {
  // parseInt wie in der Schwesterfunktion unten. Vorher stand hier
  // `usedCount > 0` — das ging nur ueber die JS-Umwandlung gut, weil COUNT(*)
  // als "2" ankommt. Nachgemessen und gleichwertig fuer alles, was hier
  // ankommt: "2"/2 -> wahr, "0"/0/null/undefined -> falsch. Der Typ hat die
  // Stelle sichtbar gemacht; verlassen wollen wir uns auf die Umwandlung nicht.
  const acq  = parseInt(String(acqCount ?? ''))  || 0;
  const used = parseInt(String(usedCount ?? '')) || 0;
  return used > 0 ? 'U' : (acq > 0 ? 'N' : (stored || 'N'));
}

/**
 * WELCHE Zustände hat der Eintrag — für die Plaketten auf der Kachel.
 *
 * conditionFromAcquisitions() oben beantwortet „gilt das Ganze als gebraucht?"
 * und muss dafür einen einzelnen Wert liefern. Auf der Kachel ist das zu wenig:
 * Wer ein Exemplar neu und eines gebraucht gekauft hat, sah bisher nur
 * „Gebraucht" — die Neu-Erfassung war unsichtbar, obwohl sie mit ihrem eigenen
 * Preis in die Bewertung eingeht.
 *
 * Beide Funktionen stehen bewusst nebeneinander an dieser einen Stelle: Sie
 * müssen zusammenpassen, und getrennt gepflegt liefen sie in diesem Projekt
 * schon einmal auseinander.
 *
 * Reihenfolge immer Neu vor Gebraucht — nicht nach Häufigkeit, sonst tauschen
 * die Plaketten beim nächsten Kauf die Plätze.
 */
function conditionsFromAcquisitions(acqCount: Zaehlwert, usedCount: Zaehlwert, stored: string | null | undefined): ('N' | 'U')[] {
  const acq  = parseInt(String(acqCount ?? ''))  || 0;
  const used = parseInt(String(usedCount ?? '')) || 0;
  if (acq <= 0) return [stored === 'U' ? 'U' : 'N'];
  const out: ('N' | 'U')[] = [];
  if (acq - used > 0) out.push('N');
  if (used > 0)       out.push('U');
  return out.length ? out : ['N'];
}

/**
 * Angezeigter Zustand manuell erfasster Teile und Minifiguren.
 *
 * Dieselbe Regel wie bei Sets (getSetConditionAggregate): Sobald EINE Erfassung
 * gebraucht ist, gilt der Eintrag als gebraucht. Gibt es Erfassungen, aber
 * keine gebrauchte, ist er neu. Ohne Erfassungen zählt der gespeicherte Wert.
 *
 * Vorher lasen beide Funktionen nur die Stammtabelle. Wurden Kaufpreise
 * ausschliesslich mit „Gebraucht" erfasst, stand auf der Kachel trotzdem „Neu",
 * weil parts.condition beim Anlegen auf dem Vorgabewert stehen blieb.
 *
 * Eine Abfrage für die ganze Seite statt eine je Zeile.
 *
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
                SUM(unit_price * quantity) FILTER (WHERE unit_price IS NOT NULL)::numeric
                  / NULLIF(SUM(quantity) FILTER (WHERE unit_price IS NOT NULL), 0) AS avg_purchase_price
           FROM part_acquisitions WHERE user_id = ANY($1)
          GROUP BY part_number, color_id`
      : `SELECT fig_number,
                COUNT(*) AS acq_count,
                COUNT(*) FILTER (WHERE condition = 'U') AS used_count,
                SUM(unit_price * quantity) FILTER (WHERE unit_price IS NOT NULL)::numeric
                  / NULLIF(SUM(quantity) FILTER (WHERE unit_price IS NOT NULL), 0) AS avg_purchase_price
           FROM minifig_acquisitions WHERE user_id = ANY($1)
          GROUP BY fig_number`,
    [uids]
  ).catch(() => []);

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
      condition: conditionFromAcquisitions(acqCount, usedCount, r.condition),
      conditions: conditionsFromAcquisitions(acqCount, usedCount, r.condition),
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
 *
 * Nur im Haushalt: Im Einzelkonto stünde an jedem Eintrag „gehört mir", und
 * das ist Rauschen. Eine Abfrage für die ganze Liste, nicht eine je Zeile.
 *
 * Anders als bei Sets wird bei manuell erfassten Teilen und Minifiguren NICHT
 * verdichtet: Zwei Konten mit demselben Teil sind zwei Bestände mit eigener
 * Menge und eigenem Kaufpreis, und der Bearbeiten-Weg (Menge, Preis, Löschen)
 * führt immer auf genau eine Zeile. Sie zusammenzufalten hiesse, für jede
 * Änderung wieder auseinanderzunehmen, wem was gehört. Die Plakette macht
 * sichtbar, warum dasselbe Teil zweimal erscheint.
 */
/**
 * Besitzer-Plaketten anhaengen — fuer EINZELNE Zeilen (`user_id`) und fuer
 * GRUPPIERTE (`owner_ids`).
 *
 * ── Warum beide Formen hier ─────────────────────────────────────────────────
 * Die Namensauflösung stand zweimal: hier fuer die ungruppierten Listen und in
 * getSets() noch einmal, weil die Galerie im Haushalt nach set_number
 * gruppiert und die Zeile deshalb MEHRERE Besitzer hat. Eine dritte Kopie
 * waere faellig geworden, als die Set-Figuren dieselbe Plakette bekamen —
 * `array_agg(DISTINCT user_id)`, dieselbe Auflösung, dieselbe Form.
 *
 * Deshalb kennt der Helfer jetzt beide Eingaben. Zeilen, die weder das eine
 * noch das andere Feld tragen (die gruppierte Teileliste), bleiben unberuehrt
 * — sonst stuende dort ploetzlich ein leeres `owners`.
 */
async function withOwners(uids: number[], rows: any[]) {
  if (uids.length < 2 || !rows?.length) return rows;
  const owners = await db.all('SELECT id, username FROM users WHERE id = ANY($1)', [uids])
    .catch(() => []);
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
 *
 * ── Marcos Wunsch ───────────────────────────────────────────────────────────
 * „Es soll angezeigt werden, welche Sets dieses Teil und Minifigur verwenden.
 * Inkl. mit Link, um den Detail-Dialog des Sets öffnen zu können."
 *
 * ── Warum EINE Funktion für beide ───────────────────────────────────────────
 * Die Frage ist zweimal dieselbe, nur die Tabelle und der Schlüssel wechseln:
 * `parts` wird über Teilenummer UND Farbe angesprochen, `minifigs` über die
 * Figurennummer. Alles andere — Blickfeld, Zusammenzählen je Set, Verbinden
 * mit der Set-Zeile für Name und Bild — ist Wort für Wort gleich.
 *
 * In diesem Projekt ist genau das schon mehrfach schiefgegangen: dieselbe
 * Regel an zwei Stellen, eine davon gepflegt. Deshalb hier einmal.
 *
 * ── Warum die automatisch erfassten Zeilen ──────────────────────────────────
 * `parts.set_number` steht in jeder Zeile, die aus dem Inventar eines Sets
 * stammt (`source = 'set'`). Manuell erfasste Positionen haben dort NULL —
 * `set_number IS NOT NULL` trennt die beiden, ohne sich auf `source` zu
 * verlassen. Das ist wichtig, weil eine Zeile mit Set-Nummer auch dann
 * dorthin gehört, wenn `source` einmal anders gesetzt wurde.
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
  parts: `x.part_number AS nummer, MAX(x.part_name) AS name,
          MAX(x.color_id) AS color_id, MAX(x.color_name) AS color_name,
          MAX(x.color_hex) AS color_hex, MAX(x.category_name) AS category_name,
          MAX(x.image_local) AS teil_image_local, MAX(x.image_url) AS teil_image_url,
          MAX(x.is_spare) AS is_spare`,
  minifigs: `x.fig_number AS nummer, MAX(x.fig_name) AS name,
          NULL::int AS color_id, NULL::text AS color_name,
          NULL::text AS color_hex, NULL::text AS category_name,
          MAX(x.image_local) AS teil_image_local, MAX(x.image_url) AS teil_image_url,
          0 AS is_spare`,
} as const;

const SCHLUESSELSPALTE = { parts: 'x.part_number', minifigs: 'x.fig_number' } as const;

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
            SUM(x.quantity)::int AS quantity,
            s.name               AS set_name,
            s.image_local        AS set_image_local,
            s.image_url          AS set_image_url,
            ${KOPFFELDER[tabelle]}
       FROM ${tabelle} x
       LEFT JOIN sets s ON s.user_id = x.user_id AND s.set_number = x.set_number
      WHERE x.user_id = ANY($1)
        AND x.set_number IS NOT NULL
        AND ${bedingungen.join(' AND ')}
      GROUP BY x.set_number, x.user_id, ${SCHLUESSELSPALTE[tabelle]},
               s.name, s.image_local, s.image_url
      ORDER BY x.set_number`,
    params,
  ).catch(() => []);

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
    total_quantity: sets.reduce((n, s) => n + s.quantity, 0),
  } : null;

  return { item, sets };
}

export { clampPageSize, conditionFromAcquisitions, conditionsFromAcquisitions, applyManualCondition, withOwners, verwendendeSets };


/**
 * Die manuell erfasste Stammzeile eines Teils bzw. einer Figur entfernen.
 *
 * Stand je zweimal da — einmal in der Loeschroute, einmal im Aufraeumen der
 * Erfassungen (routes/api_v1/acquisitions.ts). NACHGEMESSEN ueber HTTP,
 * dasselbe Teil mit zwei Erfassungen ueber beide Wege: Beide hinterlassen
 * parts=0, erfassungen=0 — kein Unterschied. Zusammengelegt wird trotzdem,
 * damit die Bedingung `source='manual'` (Teile AUS SETS haengen am Set und
 * werden mit ihm geloescht) an einer Stelle steht.
 *
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
