import * as db from '../db/database';
import { ERLAUBTE_BILD_HOSTS, hostErlaubt } from './fremdeAdressen';

/**
 * Was ein Schreiber hier koennen muss — und nicht mehr.
 *
 * `any` waere kuerzer und steht im Baum an vielen Stellen; hier geht es ohne.
 * Beide Aufrufer passen: das Modul db/database und das tx-Objekt aus
 * db.transaction(). Der Typ schreibt hin, was gebraucht wird, statt den
 * Typpruefer fuer den ganzen Ausdruck abzuschalten.
 */
type Schreiber = { run: (sql: string, params?: unknown[]) => Promise<unknown> };

/**
 * Teile- und Figurenkatalog — schreiben, und seit dem 20.10. auch LESEN.
 * Ausführlich: docs/begruendungen/utils/katalogPflege.ts.md#merketeil
 */

/**
 * Wer einen Wert eingetippt hat; `null` heißt: aus einer geprüften Quelle
 * (Rebrickable, BrickLink, eingespieltes Set). Der Katalog gilt für alle
 * Konten, deshalb ist eine Eingabe nur ein Platzhalter, den die geprüfte
 * Quelle ersetzt (Migration 0060).
 */
type Von = number | null;

/**
 * SET-Teil für ein Feld samt Herkunftsspalte. Alle Ausdrücke in ON CONFLICT
 * sehen die alte Zeile, deshalb können Feld und Herkunft getrennt stehen.
 */
function mitHerkunft(tabelle: string, feld: string, von: string): string {
  const ersetzt = `${tabelle}.${von} IS NOT NULL AND EXCLUDED.${von} IS NULL AND EXCLUDED.${feld} IS NOT NULL`;
  return `${feld} = CASE WHEN ${ersetzt} THEN EXCLUDED.${feld} ELSE COALESCE(${tabelle}.${feld}, EXCLUDED.${feld}) END,
      ${von} = CASE WHEN ${ersetzt} THEN NULL WHEN ${tabelle}.${feld} IS NULL THEN EXCLUDED.${von} ELSE ${tabelle}.${von} END`;
}

const leer = (v: string | null | undefined): string | null => (v === undefined || v === null || v === '') ? null : v;
/** Herkunft nur dort, wo auch ein Wert steht. */
const herkunft = (wert: string | null, von: Von): Von => wert === null ? null : von;
/** Ein eingetipptes Bild nur von den Hosts, die der Bild-Proxy ohnehin zeigt. */
const bildEingabe = (url: string | null, von: Von): string | null =>
  url !== null && von !== null && !hostErlaubt(url, ERLAUBTE_BILD_HOSTS) ? null : url;

/** Name und Kategorie je Teilenummer. */
export async function merkeTeil(
  partNumber: string,
  partName?: string | null,
  categoryName?: string | null,
  dbh: Schreiber = db,
  von: Von = null,
) {
  if (!partNumber) return;
  // 'Unknown': Die Set-Teile-Antwort von Rebrickable liefert kein
  // part_cat_id; das ist das Fehlen einer Kategorie und darf einen späteren,
  // echten Wert nicht blockieren.
  const name = leer(partName);
  const kategorie = leer(categoryName) === 'Unknown' ? null : leer(categoryName);
  await dbh.run(`
    INSERT INTO part_catalog (part_number, part_name, category_name, name_von, kategorie_von)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (part_number) DO UPDATE SET
      ${mitHerkunft('part_catalog', 'part_name', 'name_von')},
      ${mitHerkunft('part_catalog', 'category_name', 'kategorie_von')},
      updated_at = NOW()`,
    [partNumber, name, kategorie, herkunft(name, von), herkunft(kategorie, von)]);
}

/**
 * Farbbezeichnung, Farbcode und Bild je Teilenummer UND Farbe.
 *
 * Warum das Bild an der Farbe haengt und nicht am Teil: Ein 2x4-Stein in Rot
 * und derselbe in Blau haben verschiedene Bilder. `set_parts_catalog` fuehrt
 * es deshalb schon immer je (set_number, part_number, color_id).
 */
export async function merkeTeilFarbe(
  partNumber: string,
  colorId: number | null | undefined,
  colorName?: string | null,
  colorHex?: string | null,
  imageUrl?: string | null,
  imageLocal?: string | null,
  dbh: Schreiber = db,
  von: Von = null,
) {
  if (!partNumber) return;
  // color_id ist Teil des Primaerschluessels und darf nicht NULL sein. 0 ist
  // im Baum die Farbe „ohne Angabe" — dieselbe Lesart wie in
  // recordAcquisitionForDay (`color_id || 0`).
  const farbe = Number.isFinite(Number(colorId)) ? Number(colorId) : 0;
  const name = leer(colorName), code = leer(colorHex);
  const bild = bildEingabe(leer(imageUrl), von);
  // image_local schreibt nur der Server selbst (heruntergeladene Datei).
  await dbh.run(`
    INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, image_url, image_local,
                                    farbname_von, farbcode_von, bild_von)
    VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, $8, $9)
    ON CONFLICT (part_number, color_id) DO UPDATE SET
      ${mitHerkunft('part_color_catalog', 'color_name', 'farbname_von')},
      ${mitHerkunft('part_color_catalog', 'color_hex', 'farbcode_von')},
      ${mitHerkunft('part_color_catalog', 'image_url', 'bild_von')},
      image_local = COALESCE(part_color_catalog.image_local, EXCLUDED.image_local),
      updated_at  = NOW()`,
    [partNumber, farbe, name, code, bild, von === null ? (imageLocal ?? null) : null,
     herkunft(name, von), herkunft(code, von), herkunft(bild, von)]);
}

/** Name und Bild je Figurennummer. */
export async function merkeFigur(
  figNumber: string,
  figName?: string | null,
  imageUrl?: string | null,
  imageLocal?: string | null,
  dbh: Schreiber = db,
  von: Von = null,
) {
  if (!figNumber) return;
  const name = leer(figName);
  const bild = bildEingabe(leer(imageUrl), von);
  await dbh.run(`
    INSERT INTO minifigs_catalog (fig_number, fig_name, image_url, image_local, name_von, bild_von)
    VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6)
    ON CONFLICT (fig_number) DO UPDATE SET
      ${mitHerkunft('minifigs_catalog', 'fig_name', 'name_von')},
      ${mitHerkunft('minifigs_catalog', 'image_url', 'bild_von')},
      image_local = COALESCE(minifigs_catalog.image_local, EXCLUDED.image_local),
      updated_at  = NOW()`,
    [figNumber, name, bild, von === null ? (imageLocal ?? null) : null, herkunft(name, von), herkunft(bild, von)]);
}

/**
 * Ein Teil einer Setliste: nur Menge und Ersatzteil-Kennzeichen. Name, Farbe
 * und Bild stehen je Teil in den Katalogen (merkeTeil, merkeTeilFarbe); die
 * View set_parts_catalog fügt beides für die Lesestellen zusammen.
 */
export async function merkeSetTeil(
  setNumber: string,
  partNumber: string,
  colorId: number | string | null | undefined,
  quantity: number,
  isSpare: number = 0,
  dbh: Schreiber = db,
) {
  if (!setNumber || !partNumber) return;
  await dbh.run(`
    INSERT INTO set_teile (set_number, part_number, color_id, quantity, is_spare)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (set_number, part_number, color_id) DO UPDATE
      SET quantity = EXCLUDED.quantity, updated_at = NOW()`,
    [setNumber, partNumber, Number(colorId) || 0, quantity || 1, isSpare ? 1 : 0]);
}

/**
 * Bild je Teil und Farbe UEBERSCHREIBEN.
 *
 * Der Gegenpol zu merkeTeilFarbe(): Wenn der Bildabgleich eine Datei
 * tatsaechlich heruntergeladen hat, ist der neue Pfad der richtige — auch
 * wenn schon einer dasteht (der alte kann auf eine geloeschte Datei zeigen).
 * Deshalb hier ohne COALESCE.
 */
export async function setzeTeilBildLokal(
  partNumber: string,
  colorId: number | string,
  imageLocal: string,
  dbh: Schreiber = db,
) {
  if (!partNumber || !imageLocal) return;
  await dbh.run(`
    INSERT INTO part_color_catalog (part_number, color_id, image_local)
    VALUES ($1, $2, $3)
    ON CONFLICT (part_number, color_id) DO UPDATE
      SET image_local = EXCLUDED.image_local, updated_at = NOW()`,
    [partNumber, Number(colorId) || 0, imageLocal]);
}

/** Bild je Figur UEBERSCHREIBEN — dieselbe Begruendung wie setzeTeilBildLokal. */
export async function setzeFigurBildLokal(
  figNumber: string,
  imageLocal: string,
  dbh: Schreiber = db,
) {
  if (!figNumber || !imageLocal) return;
  await dbh.run(`
    INSERT INTO minifigs_catalog (fig_number, image_local)
    VALUES ($1, $2)
    ON CONFLICT (fig_number) DO UPDATE
      SET image_local = EXCLUDED.image_local, updated_at = NOW()`,
    [figNumber, imageLocal]);
}

/**
 * Was der EIGENE Katalog ueber ein Teil weiss — Name, Kategorie, Bild.
 * Ausführlich: docs/begruendungen/utils/katalogPflege.ts.md#katalogteil
 */
export interface KatalogTeil {
  /** Name aus `part_catalog`, Rueckfall `rb_parts`. */
  name: string | null;
  kategorie: string | null;
  /**
   * Das Bild als https-URL — und NUR als URL.
   *
   * `image_local` ist ein Pfad im eigenen Baum und faellt bei der
   * Eingangspruefung durch (V.optionalImageUrl verlangt https). Es steht
   * deshalb nicht hier, zaehlt aber bei `hatBild` mit: Dass eine Datei
   * dasteht, ist der beste Beleg dafuer, dass kein Abruf noetig ist.
   */
  bild: string | null;
  /** Steht ein Bild da — gleich ob als URL oder als Datei? */
  hatBild: boolean;
  /**
   * Woher das Bild kommt: von Teil und Farbe, oder (ohne Farbe) das
   * allgemeine Bild. Die Setlisten führen seit Migration 0062 keine eigenen
   * Bilder mehr; ihre stehen an der Farbe.
   */
  bildQuelle: 'farbe' | 'allgemein' | null;
  bildDatei: string | null;
}

/**
 * `fuer`: das fragende Konto. Was ein ANDERES Konto eingetippt hat, zählt hier
 * nicht als bekannt — sonst fragte niemand mehr nach, und der Platzhalter
 * würde nie durch die geprüfte Quelle ersetzt.
 */
export async function katalogTeil(
  partNumber: string, colorId: number | null, fuer: Von = null,
): Promise<KatalogTeil | null> {
  if (!partNumber) return null;
  const z = await db.get(`
    SELECT COALESCE(CASE WHEN pc.name_von IS NULL OR pc.name_von = $3 THEN pc.part_name END, rp.name) AS name,
           CASE WHEN pc.kategorie_von IS NULL OR pc.kategorie_von = $3 THEN pc.category_name END AS kategorie,
           rp.part_img_url                 AS bild_allgemein,
           CASE WHEN pcc.bild_von IS NULL OR pcc.bild_von = $3 THEN pcc.image_url END AS farb_url,
           pcc.image_local                 AS farb_datei
      FROM (SELECT $1::text AS nr) q
      LEFT JOIN part_catalog       pc  ON pc.part_number  = q.nr
      LEFT JOIN rb_parts           rp  ON rp.part_num     = q.nr
      LEFT JOIN part_color_catalog pcc ON pcc.part_number = q.nr AND pcc.color_id = $2`,
    [partNumber, colorId, fuer]).catch(() => null);
  if (!z) return null;

  // Ohne Farbe bleibt nur das allgemeine Bild — siehe oben, warum es genau dann zählt.
  const quelle: KatalogTeil['bildQuelle'] =
      (z.farb_datei || z.farb_url) ? 'farbe'
    : (colorId === null && z.bild_allgemein) ? 'allgemein'
    : null;
  const url   = quelle === 'farbe' ? z.farb_url
              : quelle === 'allgemein' ? z.bild_allgemein : null;
  const datei = quelle === 'farbe' ? z.farb_datei : null;

  return {
    name: z.name ?? null,
    kategorie: z.kategorie ?? null,
    bild: url && String(url).startsWith('https:') ? String(url) : null,
    hatBild: quelle !== null,
    bildQuelle: quelle,
    bildDatei: datei ?? null,
  };
}

/**
 * Was der eigene Katalog ueber eine Figur weiss.
 *
 * Zwilling zu katalogTeil() — und aus demselben Befund: addManualFigIntern()
 * fragt getMinifigInfo(), sobald kein Name mitkommt, obwohl
 * `minifigs_catalog` Name und Bild fuehrt. Hier gibt es keine Farbe und
 * deshalb auch keine Unterscheidung farbrichtig/allgemein.
 */
export async function katalogFigur(
  figNumber: string, fuer: Von = null,
): Promise<{ name: string | null; bild: string | null; hatBild: boolean } | null> {
  if (!figNumber) return null;
  // `fuer` wie bei katalogTeil(): fremde Eingaben zählen nicht als bekannt.
  const z = await db.get(`
    SELECT CASE WHEN name_von IS NULL OR name_von = $2 THEN fig_name END  AS fig_name,
           CASE WHEN bild_von IS NULL OR bild_von = $2 THEN image_url END AS image_url,
           image_local
      FROM minifigs_catalog WHERE fig_number = $1`,
    [figNumber, fuer]).catch(() => null);
  if (!z) return null;
  return {
    name: z.fig_name ?? null,
    bild: z.image_url && String(z.image_url).startsWith('https:') ? String(z.image_url) : null,
    hatBild: !!(z.image_local || z.image_url),
  };
}
