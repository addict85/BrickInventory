package ch.brickinventoryapp.collection.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavBackStackEntry
import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeResultRoute
import ch.brickinventoryapp.collection.ui.dialogs.SetCheckRoute
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import coil3.ImageLoader

/** Key in the SavedStateHandle of the destination that opened the scanner. */
private const val SCAN = "erfassung.scan"
private const val KIND_BARCODE = "B"
private const val KIND_SET_NUMBER = "S"
private const val KIND_TYPE_IN = "E"

/**
 * The scanner hands its result back to the destination below and closes. Only
 * text and an ordinal: this way the entry survives the process too.
 */
internal fun SavedStateHandle.putScanAb(wert: String, setnummer: Boolean, herkunft: Scannerherkunft) {
    this[SCAN] = arrayListOf(herkunft.name, if (setnummer) KIND_SET_NUMBER else KIND_BARCODE, wert)
}

/** Without a camera, "type number": the destination below opens input as after a scan with no hit. */
internal fun SavedStateHandle.putTypeInAb(herkunft: Scannerherkunft) {
    this[SCAN] = arrayListOf(herkunft.name, KIND_TYPE_IN, "")
}

/**
 * Binds an entry flow to destination [entry]: a returned scan is resolved
 * there, check display and confirmation sit above this destination, and an
 * already-existing set opens [onPresent]. The ViewModel belongs to the destination,
 * not the Activity — no other destination reads its results.
 */
@Composable
internal fun Erfassungsrahmen(
    entry: NavBackStackEntry,
    erfassung: EntryViewModel,
    bilder: ImageLoader,
    onPresent: (String) -> Unit,
) {
    val scan by entry.savedStateHandle.getStateFlow<ArrayList<String>?>(SCAN, null).collectAsStateWithLifecycle()
    LaunchedEffect(scan) {
        val (originName, art, wert) = scan ?: return@LaunchedEffect
        entry.savedStateHandle.remove<ArrayList<String>>(SCAN)
        val herkunft = Scannerherkunft.entries.firstOrNull { it.name == originName } ?: Scannerherkunft.GALERIE
        when (art) {
            KIND_SET_NUMBER -> erfassung.useScannedSetNumber(wert, herkunft)
            KIND_TYPE_IN -> erfassung.manuellErfassen(herkunft)
            else -> erfassung.resolveBarcode(wert, herkunft)
        }
    }
    val barcode by erfassung.barcodeState.collectAsStateWithLifecycle()
    LaunchedEffect(barcode.gefundenesSet) {
        val gefunden = barcode.gefundenesSet ?: return@LaunchedEffect
        erfassung.gallerySearchFoundConsumed()
        onPresent(gefunden)
    }
    if (barcode.result != null) BarcodeResultRoute(erfassung, bilder)
    SetCheckRoute(erfassung)
}

/**
 * Entry for areas the collection doesn't know about (catalog): the entry flow
 * hangs on the asking destination, its check display sits above it.
 */
@Composable
fun setEntry(entry: NavBackStackEntry, bilder: ImageLoader, onPresent: (String) -> Unit): (Erfassungswunsch) -> Unit {
    val erfassung: EntryViewModel = hiltViewModel(entry)
    Erfassungsrahmen(entry, erfassung, bilder, onPresent)
    return erfassung::addSet
}

/**
 * The parts list's entry flow: at the parts-list destination, the confirmation dialog above it.
 * [asScan] gets the scanned set number, whether to enter manually, and the
 * two receipts — the shape is decided by the area that doesn't know the collection.
 */
@Composable
fun <T> partListsEntry(
    entry: NavBackStackEntry,
    bilder: ImageLoader,
    onPresent: (String) -> Unit,
    asScan: (setNumber: String?, manuell: Boolean, uebernommen: () -> Unit, quittiert: () -> Unit) -> T,
): T {
    val erfassung: EntryViewModel = hiltViewModel(entry)
    Erfassungsrahmen(entry, erfassung, bilder, onPresent)
    val scan by erfassung.barcodeState.collectAsStateWithLifecycle()
    return asScan(scan.forPartList, scan.manuelleErfassungAnfordern,
        erfassung::clearBarcodeForPartsList, erfassung::manuelleErfassungQuittieren)
}
