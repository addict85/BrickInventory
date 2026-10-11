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
 * Teile- und Figurenkatalog schreiben.
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
