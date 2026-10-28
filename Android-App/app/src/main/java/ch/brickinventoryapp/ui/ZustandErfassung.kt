package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.*

/**
 * Zustand rund um den Barcode-/OCR-Scanner.
 *
 * ── Warum eigener Fluss (Nachtrag 117) ──────────────────────────────────────
 * Diese zwölf Felder lagen in `AppUiState` — dem gemeinsamen Objekt, an dem
 * jeder Reiter hängt. Jede Änderung während eines Scans (und das sind viele:
 * Zwischenstände beim Auflösen, Sperre gegen den zweiten Klick) rekomponierte
 * damit Galerie, Teile, Minifiguren und Finanzen mit, obwohl der Scanner sie
 * nichts angeht. Dieselbe Begründung, aus der `_snackbar`, `PartsUiState` und
 * `FinanceUiState` schon eigene Flüsse haben.
 *
 * Die Feldnamen behalten den `barcode`-Vorsatz NICHT — innerhalb dieser Klasse
 * wäre er eine Wiederholung des Klassennamens. Am Zugriffsort steht dafür
 * `barcodeState.setName` statt `state.barcodeSetName`, was dieselbe Länge hat
 * und die Herkunft deutlicher macht.
 */
data class BarcodeUiState(
    val result: String? = null,
    /**
     * „Öffne die Detailansicht dieses Sets“: Der Scan oder das Erfassen fand ein
     * Set, das schon in der Sammlung steht. Die Galerie navigiert und quittiert.
     */
    val gefundenesSet: String? = null,
    /** "gallery", "gallery_search", "partslist" oder "wanted". */
    val source: String = "gallery",
    /**
     * Der Scan blieb ohne Setnummer → die manuelle Erfassung soll aufgehen.
     *
     * ── Marcos Vorgabe (Nachtrag 113) ────────────────────────────────────────
     * „Wenn der Barcode erkannt wurde, aber die API keine Setnummer liefert,
     * oder wenn die Texterkennung keine Nummer erkennt, soll automatisch die
     * manuelle Erfassung erscheinen — an allen Stellen, wo der Barcodescanner
     * eingebaut ist."
     *
     * Ein Zustandsfeld statt eines Aufrufs je Bildschirm: Die drei erfolglosen
     * Wege liegen alle im ViewModel (EAN nicht auflösbar, EAN ohne Setnummer,
     * Texterkennung ohne Treffer). Wer den Scanner einbindet, liest das Feld
     * und öffnet seinen eigenen Erfassen-Dialog — die Galerie den für Sets, die
     * Teileliste ihren eigenen.
     */
    val manuelleErfassungAnfordern: Boolean = false,
    val fuerTeileliste: String? = null,
    val setName: String? = null,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val year: Int? = null,
    val pieces: Int? = null,
    val theme: String? = null,
    val minifigs: Int? = null,
    // Läuft gerade ein Hinzufügen aus dem Barcode-Dialog? Sperrt den Knopf
    // gegen den zweiten Klick, der sonst dasselbe Set ein zweites Mal erfasst.
    val adding: Boolean = false,
    /**
     * Die angezeigte Nummer ist GERATEN — der Dialog weist darauf hin.
     *
     * Zwei Quellen setzen das Feld:
     *  - Der Server, wenn er die EAN nicht abgleichen konnte und nur einen
     *    plausiblen Kandidaten hat (BarcodeResponse.unsicher).
     *  - Die App selbst bei der Texterkennung: Dort ist schon das LESEN eine
     *    Vermutung. Die gefundene Zahl ergibt zwar ein echtes Set — sonst käme
     *    der Dialog gar nicht —, aber ob es das Set auf dem Papier ist, weiss
     *    niemand.
     *
     * Der Dialog zeigt Bild und Namen ohnehin. Es fehlte nur der Hinweis,
     * WANN man hinsehen muss.
     */
    val unsicher: Boolean = false,
)

/**
 * Welche Frage beantwortet die App gerade, bevor ein Set erfasst wird?
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 * „Wenn man mit dem Barcode oder auch manuell ein Set erfasst, sieht man nicht,
 * dass die App am Prüfen ist, ob man das Set bereits besitzt. Erst das
 * effektive Hinzufügen soll im Hintergrund passieren — sonst passiert es, dass
 * man zu schnell Sets einscannt."
 *
 * Genau so war es. Der Scanner-Bildschirm ruft `popBackStack()` SOFORT und
 * startet die Auflösung erst danach (nav/ToolsGraph.kt) — die Kamera ist also
 * schon weg, während die eigentliche Arbeit noch läuft:
 *
 *   • `resolveBarcode()` löste die EAN auf (bis zu acht Rebrickable-Abrufe)
 *     und fragte danach `GET /sets/exists`. Sichtbar war davon nur eine
 *     Schnellmeldung, die von selbst wieder verschwindet.
 *   • `useScannedSetNumber()` (Texterkennung) zeigte GAR NICHTS an.
 *   • Der Galerie-Weg `addSet()` schloss seinen Dialog sofort und wartete
 *     stumm auf die Antwort des Servers.
 *
 * Wer in dieser Lücke den Scanner erneut öffnet, scannt das nächste Set,
 * während das vorige noch geprüft wird.
 *
 * ── Die Regel, die daraus folgt ─────────────────────────────────────────────
 * PRÜFEN ist sichtbar und hält an. ERFASSEN läuft unsichtbar im Hintergrund.
 *
 * Beides zusammen ist die eigentliche Aussage: Der Anzeige-Dialog steht nur,
 * solange die App noch nicht weiss, ob das Set schon vorhanden ist. Sobald die
 * Antwort da ist, verschwindet er — das Nachladen von Teilen, Anleitungen und
 * Preisen erledigt der Server ohnehin im Hintergrund.
 */
enum class Pruefphase {
    /** EAN → Setnummer. Der lange Teil: bis zu acht Rebrickable-Abrufe. */
    BARCODE,
    /** Steht das Set schon im Blickfeld? */
    BESTAND,
    // ── Die Schritte des Anlegens (Nachtrag 131) ────────────────────────────
    //
    // Bis hierher zeigte die App waehrend des Anlegens nur BESTAND — einen
    // Kringel, bis alles vorbei war. Die Webapp meldet unterdessen, was
    // passiert, und bei einem grossen Set dauert das lange genug, um
    // aufzufallen. Dieselben drei Schritte, die der Server ohnehin schickt
    // (routes/sets.ts → add-stream).
    /** Stammdaten holen — Name, Teilezahl, Jahr. */
    ANLEGEN_STAMMDATEN,
    /** Bild herunterladen. */
    ANLEGEN_BILD,
    /** Stammdaten und Bild sind durch, es fehlt das Aufraeumen. */
    ANLEGEN_ABSCHLUSS,
}

/**
 * @param bezeichner Was gerade geprüft wird — die EAN oder die Setnummer. Ohne
 *   sie sagt der Dialog beim schnellen Scannen nicht, WELCHES Set gemeint ist.
 */
data class Pruefschritt(
    val bezeichner: String,
    val phase: Pruefphase,
)

/**
 * Eigener Fluss statt eines Feldes in `BarcodeUiState` oder `AppUiState`.
 *
 * Die Prüfung gehört zu KEINEM der beiden: Sie läuft im Barcode-Weg, im
 * Texterkennungs-Weg und beim manuellen Erfassen aus Galerie und Katalog. In
 * `BarcodeUiState` wäre sie für die manuellen Wege ein falscher Name; in
 * `AppUiState` ginge jeder Zwischenstand jeden Reiter an — genau der Grund,
 * aus dem die zwölf Barcode-Felder dort herausgelöst wurden (Nachtrag 117).
 */
data class ErfassungUiState(
    val pruefung: Pruefschritt? = null,
)
