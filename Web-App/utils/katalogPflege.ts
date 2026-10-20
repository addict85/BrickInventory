import * as db from '../db/database';

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
 *
 * Das Lesen ist hier dazugekommen, weil es dieselbe Frage von der anderen
 * Seite ist: Wer Bestand anlegt, muss die Beschreibung mitschreiben — und
 * sollte vorher nachsehen, ob sie nicht schon dasteht. Die Begruendung steht
 * bei katalogTeil() am Dateiende.
 *
 * ── Warum eine eigene Stelle (Migration 0034) ───────────────────────────────
 *
 * Mit Migration 0034 tragen `parts` und `minifigs` nur noch den BESTAND: wer
 * welches Teil in welcher Farbe aus welchem Set hat. Die BESCHREIBUNG — Name,
 * Farbbezeichnung, Farbcode, Kategorie, Bild — gilt fuer alle Konten und steht
 * in `part_catalog`, `part_color_catalog` und `minifigs_catalog`.
 *
 * Jeder Weg, der Bestand anlegt, muss die Beschreibung also mitschreiben. Das
 * sind SECHS Stellen (gezaehlt): Anlegen von Hand und CSV-Import fuer Teile,
 * dieselben beiden fuer Figuren, und zweimal das Verschieben eines Sets in
 * utils/setMove.ts. Dazu die beiden Importe aus Rebrickable.
 *
 * Derselbe Upsert sechsmal hingeschrieben heisst: sechs Stellen, an denen er
 * beim naechsten Mal leicht anders aussieht. Genau so ist in diesem Baum schon
 * `is_spare` an sechs Stellen in vier Lesarten zerfallen (utils/validate.ts).
 *
 * ── Die Regel: der Katalog gewinnt NICHT gegen sich selbst ──────────────────
 *
 * COALESCE steht ueberall auf der SPALTE, nicht auf EXCLUDED: Was im Katalog
 * steht, bleibt stehen; nur Leerstellen werden gefuellt. Ein manuell
 * erfasstes Teil ueberschreibt damit keinen Namen aus dem Set-Import, und ein
 * CSV-Import mit halben Angaben macht keinen vollstaendigen Eintrag kaputt.
 *
 * NULLIF(..., '') statt nur COALESCE: Eine leere Zeichenkette ist kein Name.
 * Ohne das Ausleeren haette der erste Schreiber mit `''` den Platz besetzt und
 * jeder spaetere, echte Name waere daran vorbeigelaufen.
 */

/** Name und Kategorie je Teilenummer. */
export async function merkeTeil(
  partNumber: string,
  partName?: string | null,
  categoryName?: string | null,
  dbh: Schreiber = db,
) {
  if (!partNumber) return;
  // NULLIF(..., 'Unknown'): Die Set-Teile-Antwort von Rebrickable liefert kein
  // part_cat_id, die Kategorie steht dort oft auf 'Unknown'. Das ist keine
  // Kategorie, sondern ihr Fehlen — und es darf einen spaeteren, echten Wert
  // nicht blockieren.
  await dbh.run(`
    INSERT INTO part_catalog (part_number, part_name, category_name)
    VALUES ($1, NULLIF($2, ''), NULLIF(NULLIF($3, ''), 'Unknown'))
    ON CONFLICT (part_number) DO UPDATE SET
      part_name     = COALESCE(part_catalog.part_name,     EXCLUDED.part_name),
      category_name = COALESCE(part_catalog.category_name, EXCLUDED.category_name),
      updated_at    = NOW()`,
    [partNumber, partName ?? null, categoryName ?? null]);
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
) {
  if (!partNumber) return;
  // color_id ist Teil des Primaerschluessels und darf nicht NULL sein. 0 ist
  // im Baum die Farbe „ohne Angabe" — dieselbe Lesart wie in
  // recordAcquisitionForDay (`color_id || 0`).
  const farbe = Number.isFinite(Number(colorId)) ? Number(colorId) : 0;
  await dbh.run(`
    INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, image_url, image_local)
    VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''))
    ON CONFLICT (part_number, color_id) DO UPDATE SET
      color_name  = COALESCE(part_color_catalog.color_name,  EXCLUDED.color_name),
      color_hex   = COALESCE(part_color_catalog.color_hex,   EXCLUDED.color_hex),
      image_url   = COALESCE(part_color_catalog.image_url,   EXCLUDED.image_url),
      image_local = COALESCE(part_color_catalog.image_local, EXCLUDED.image_local),
      updated_at  = NOW()`,
    [partNumber, farbe, colorName ?? null, colorHex ?? null, imageUrl ?? null, imageLocal ?? null]);
}

/** Name und Bild je Figurennummer. */
export async function merkeFigur(
  figNumber: string,
  figName?: string | null,
  imageUrl?: string | null,
  imageLocal?: string | null,
  dbh: Schreiber = db,
) {
  if (!figNumber) return;
  await dbh.run(`
    INSERT INTO minifigs_catalog (fig_number, fig_name, image_url, image_local)
    VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), NULLIF($4, ''))
    ON CONFLICT (fig_number) DO UPDATE SET
      fig_name    = COALESCE(minifigs_catalog.fig_name,    EXCLUDED.fig_name),
      image_url   = COALESCE(minifigs_catalog.image_url,   EXCLUDED.image_url),
      image_local = COALESCE(minifigs_catalog.image_local, EXCLUDED.image_local),
      updated_at  = NOW()`,
    [figNumber, figName ?? null, imageUrl ?? null, imageLocal ?? null]);
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
 *
 * ── Marcos Frage vom 20.10. ─────────────────────────────────────────────────
 *
 *   „Wieso ist der Import so langsam? Wird jedes Teil bei Rebrickable
 *    abgefragt auch wenn es lokal bereits vorhanden ist, resp. das Mapping
 *    vorhanden ist?"
 *
 * Fuers MAPPING lautete die Antwort nein: loeseLokalAuf() in
 * utils/wantedListe.ts loest zuerst lokal auf und fragt nur die offenen
 * Nummern nach. Fuer Name und Bild lautete sie JA, und zwar GEMESSEN am
 * laufenden Server: addManualPartIntern() fragte lookupPart(), sobald kein
 * Name mitkam — auch bei Teil 3001 in Farbe 4, das mit Namen UND Farbbild im
 * Katalog stand. Jeder Abruf geht durch die Hintergrunddrossel, eine Anfrage
 * je 1,5 Sekunden (utils/rateLimiter.ts), und lookupPart macht zwei: das Teil
 * und das Farbbild. Bei 224 Posten sind das elf Minuten Warten und 448
 * Abrufe aus dem Tageskontingent — fuer Daten, die dalagen.
 *
 * Die Regel dort hiess „kein Name mitgegeben ⇒ fremden Dienst fragen". Richtig
 * ist „⇒ erst den eigenen Katalog fragen". Genau diese Staffelung stand
 * nebenan schon einmal, fuer das Bild allein (bildNachtragen in
 * utils/teilFarbeAendern.ts: set_parts_catalog vor Rebrickable) — sie holt sie
 * jetzt von hier, damit es bei EINER Fassung bleibt.
 *
 * ── Was als „Bild vorhanden" gilt, und was nicht ────────────────────────────
 *
 * Nur FARBRICHTIGE Quellen: `part_color_catalog` und `set_parts_catalog`
 * fuehren das Bild je Teil UND Farbe. `rb_parts.part_img_url` ist das
 * ALLGEMEINE Teilebild — bei vielen Teilen die weisse Fassung. Es als Treffer
 * zu zaehlen hiesse, den Farb-Abruf zu sparen und dafuer das falsche Bild zu
 * behalten. Gespart werden soll der UEBERFLUESSIGE Abruf, nicht der noetige.
 *
 * Ohne angegebene Farbe (`colorId` null) gibt es keine farbrichtige
 * Erwartung — lookupPart holt dann selbst nur das allgemeine Bild. Deshalb
 * zaehlt es in diesem Fall. Die beiden Farb-Joins greifen dabei von sich aus
 * nicht: `color_id = NULL` ist nie wahr.
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
   * Woher das Bild stammt, und die Datei dazu.
   *
   * Beide stehen hier fuer bildNachtragen() in utils/teilFarbeAendern.ts: Es
   * unterscheidet, ob das Bild schon an der Farbe steht (dann ist nichts zu
   * tun) oder aus einem eingespielten Set kommt (dann traegt es es nach) —
   * und dabei SCHREIBT es `image_local` mit, denn eine bereits
   * heruntergeladene Datei ist der bessere Wert.
   *
   * Sie sind der Preis dafuer, dass die Quellenreihenfolge nur EINMAL
   * dasteht. Sie zweimal zu fuehren waere der bequemere Weg und genau der,
   * an dem in diesem Baum schon mehrfach zwei Fassungen auseinandergelaufen
   * sind.
   */
  bildQuelle: 'farbe' | 'set' | 'allgemein' | null;
  bildDatei: string | null;
}

export async function katalogTeil(
  partNumber: string, colorId: number | null,
): Promise<KatalogTeil | null> {
  if (!partNumber) return null;
  const z = await db.get(`
    SELECT COALESCE(pc.part_name, rp.name) AS name,
           pc.category_name                AS kategorie,
           rp.part_img_url                 AS bild_allgemein,
           pcc.image_url                   AS farb_url,
           pcc.image_local                 AS farb_datei,
           spc.image_url                   AS set_url,
           spc.image_local                 AS set_datei
      FROM (SELECT $1::text AS nr) q
      LEFT JOIN part_catalog       pc  ON pc.part_number  = q.nr
      LEFT JOIN rb_parts           rp  ON rp.part_num     = q.nr
      LEFT JOIN part_color_catalog pcc ON pcc.part_number = q.nr AND pcc.color_id = $2
      LEFT JOIN LATERAL (
        SELECT image_url, image_local FROM set_parts_catalog
         WHERE part_number = q.nr AND color_id = $2
           AND (image_local IS NOT NULL OR image_url IS NOT NULL)
         ORDER BY (image_local IS NULL), set_number LIMIT 1) spc ON TRUE`,
    [partNumber, colorId]).catch(() => null);
  if (!z) return null;

  // Die Reihenfolge ist die von bildNachtragen(): Farbe vor Set, Datei vor
  // URL. Ohne Farbe bleibt nur das allgemeine Bild — siehe oben, warum es
  // genau dann zaehlt.
  const quelle: KatalogTeil['bildQuelle'] =
      (z.farb_datei || z.farb_url) ? 'farbe'
    : (z.set_datei  || z.set_url)  ? 'set'
    : (colorId === null && z.bild_allgemein) ? 'allgemein'
    : null;
  const url   = quelle === 'farbe' ? z.farb_url
              : quelle === 'set'   ? z.set_url
              : quelle === 'allgemein' ? z.bild_allgemein : null;
  const datei = quelle === 'farbe' ? z.farb_datei
              : quelle === 'set'   ? z.set_datei : null;

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
  figNumber: string,
): Promise<{ name: string | null; bild: string | null; hatBild: boolean } | null> {
  if (!figNumber) return null;
  const z = await db.get(
    'SELECT fig_name, image_url, image_local FROM minifigs_catalog WHERE fig_number = $1',
    [figNumber]).catch(() => null);
  if (!z) return null;
  return {
    name: z.fig_name ?? null,
    bild: z.image_url && String(z.image_url).startsWith('https:') ? String(z.image_url) : null,
    hatBild: !!(z.image_local || z.image_url),
  };
}
