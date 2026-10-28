package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.*

/**
 * Zustand rund um den Barcode- und OCR-Scanner — eigener Fluss, weil ein Scan
 * viele Zwischenstände erzeugt, die sonst jeden Reiter neu zeichneten. Die Felder
 * tragen keinen `barcode`-Vorsatz; am Zugriffsort steht `barcodeState.setName`.
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
     * Der Scan blieb ohne Setnummer → die manuelle Erfassung soll aufgehen, überall wo
     * der Scanner eingebaut ist. Ein Zustandsfeld statt eines Aufrufs je Bildschirm:
     * Die erfolglosen Wege liegen im ViewModel, und wer den Scanner einbindet, öffnet
     * seinen eigenen Erfassen-Dialog.
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
     * Die angezeigte Nummer ist geraten — der Dialog weist darauf hin. Gesetzt vom
     * Server (keine abgeglichene EAN, nur ein plausibler Kandidat) und von der App bei
     * der Texterkennung, wo schon das Lesen eine Vermutung ist.
     */
    val unsicher: Boolean = false,
)

/**
 * Welche Frage beantwortet die App gerade, bevor ein Set erfasst wird? Der Scanner
 * schliesst sofort und die Prüfung läuft danach; ohne Anzeige scannte man das
 * nächste Set, während das vorige noch geprüft wird. Die Regel: Prüfen ist
 * sichtbar und hält an, Erfassen läuft im Hintergrund — die Anzeige steht, bis
 * feststeht, ob das Set schon da ist.
 */
enum class Pruefphase {
    /** EAN → Setnummer. Der lange Teil: bis zu acht Rebrickable-Abrufe. */
    BARCODE,
    /** Steht das Set schon im Blickfeld? */
    BESTAND,
    // ── Die Schritte des Anlegens ──
    //
    // Dieselben drei Schritte, die der Server schickt (add-stream in routes/sets.ts),
    // damit man bei einem grossen Set sieht, was passiert.
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
 * Eigener Fluss: Die Prüfung läuft im Barcode-, im Texterkennungs- und im
 * manuellen Weg aus Galerie und Katalog — in BarcodeUiState wäre sie falsch
 * benannt, in AppUiState ginge jeder Zwischenstand jeden Reiter an.
 */
data class ErfassungUiState(
    val pruefung: Pruefschritt? = null,
)
