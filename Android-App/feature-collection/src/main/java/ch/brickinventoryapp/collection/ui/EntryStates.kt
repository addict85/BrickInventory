package ch.brickinventoryapp.collection.ui

import ch.brickinventoryapp.model.ui.Operation
import ch.brickinventoryapp.model.ui.ScannerOrigin
/**
 * State around the barcode and OCR scanner — its own flow, because a scan
 * produces many intermediate states that would otherwise redraw every tab. The fields
 * carry no `barcode` prefix; at the access point it reads `barcodeState.setName`.
 */
data class BarcodeUiState(
    val result: String? = null,
    /**
     * "Open this set's detail view": the scan or manual entry found a
     * set already in the collection. The gallery navigates and acknowledges it.
     */
    val foundSet: String? = null,
    /** Where the running scan came from. */
    val source: ScannerOrigin = ScannerOrigin.GALLERY,
    /**
     * The scan came back without a set number → manual entry should open, everywhere
     * the scanner is embedded. A state field instead of a call per screen:
     * the unsuccessful paths live in the ViewModel, and whoever embeds the scanner opens
     * its own entry dialog.
     */
    val requestManualEntry: Boolean = false,
    val forPartList: String? = null,
    val setName: String? = null,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val year: Int? = null,
    val pieces: Int? = null,
    val theme: String? = null,
    val minifigs: Int? = null,
    /** How many times the scanned set is already in the collection; 0 = not at all. */
    val ownershipQuantity: Int = 0,
    // Is an add from the barcode dialog running right now? Locks the button
    // against a second click, which would otherwise enter the same set a second time.
    val add: Operation = Operation.Done,
    /**
     * The displayed number is a guess — the dialog points this out. Set by the
     * server (no matched EAN, only a plausible candidate) and by the app during
     * text recognition, where even the reading is a guess.
     */
    val unsafe: Boolean = false,
)

/**
 * Which question is the app currently answering before a set is entered? The scanner
 * closes right away and the check runs afterward; without a display, the
 * next set would be scanned while the previous one is still being checked. The rule:
 * checking is visible and halts, entering runs in the background — the display stays
 * up until it's settled whether the set is already there.
 */
enum class CheckPhase {
    /** EAN → set number. The long part: up to eight Rebrickable calls. */
    BARCODE,
    /** Is the set already in view? */
    STOCK,
    // ── The steps of creating ──
    //
    // The same three steps the server sends (add-stream in routes/sets.ts),
    // so you can see what's happening for a large set.
    /** Stammdaten holen — Name, Teilezahl, Jahr. */
    CREATE_MASTER_DATA,
    /** Bild herunterladen. */
    CREATE_IMAGE,
    /** Core data and image are done, cleanup is missing. */
    CREATE_COMPLETION,
}

/**
 * @param bezeichner What's currently being checked — the EAN or the set number. Without
 *   it, the dialog doesn't say WHICH set is meant during fast scanning.
 */
data class CheckStep(
    val identifier: String,
    val phase: CheckPhase,
)

/**
 * Its own flow: the check runs in the barcode path, the text-recognition path and the
 * manual path from gallery and catalog — in BarcodeUiState it would be wrongly
 * named, in AppUiState every intermediate state would concern every tab.
 */
data class EntryUiState(
    val check: CheckStep? = null,
)
