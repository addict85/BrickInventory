package ch.brickinventoryapp.collection.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavBackStackEntry
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeResultRoute
import ch.brickinventoryapp.collection.ui.dialogs.SetCheckRoute
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.uistate.ScannerOrigin
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
internal fun SavedStateHandle.storeScan(value: String, setNumber: Boolean, origin: ScannerOrigin) {
    this[SCAN] = arrayListOf(origin.name, if (setNumber) KIND_SET_NUMBER else KIND_BARCODE, value)
}

/** Without a camera, "type number": the destination below opens input as after a scan with no hit. */
internal fun SavedStateHandle.storeTypeIn(origin: ScannerOrigin) {
    this[SCAN] = arrayListOf(origin.name, KIND_TYPE_IN, "")
}

/**
 * Binds an entry flow to destination [entry]: a returned scan is resolved
 * there, check display and confirmation sit above this destination, and an
 * already-existing set opens [onPresent]. The ViewModel belongs to the destination,
 * not the Activity — no other destination reads its results.
 */
@Composable
internal fun EntryFrame(
    entry: NavBackStackEntry,
    entryVm: EntryViewModel,
    images: ImageLoader,
    onSearch: (String) -> Unit = {},
    onPresent: (String) -> Unit,
) {
    val scan by entry.savedStateHandle.getStateFlow<ArrayList<String>?>(SCAN, null).collectAsStateWithLifecycle()
    LaunchedEffect(scan) {
        val (originName, kind, value) = scan ?: return@LaunchedEffect
        entry.savedStateHandle.remove<ArrayList<String>>(SCAN)
        val origin = ScannerOrigin.entries.firstOrNull { it.name == originName } ?: ScannerOrigin.GALLERY
        when (kind) {
            KIND_SET_NUMBER -> entryVm.useScannedSetNumber(value, origin)
            KIND_TYPE_IN -> entryVm.manualRecord(origin)
            else -> entryVm.resolveBarcode(value, origin)
        }
    }
    val barcode by entryVm.barcodeState.collectAsStateWithLifecycle()
    LaunchedEffect(barcode.foundSet) {
        val found = barcode.foundSet ?: return@LaunchedEffect
        entryVm.gallerySearchFoundConsumed()
        onPresent(found)
    }
    LaunchedEffect(barcode.searchFor) {
        val number = barcode.searchFor ?: return@LaunchedEffect
        entryVm.searchForConsumed()
        onSearch(number)
    }
    if (barcode.result != null) BarcodeResultRoute(entryVm, images)
    SetCheckRoute(entryVm)
}

/**
 * Entry for areas the collection doesn't know about (catalog): the entry flow
 * hangs on the asking destination, its check display sits above it.
 */
@Composable
fun setEntry(entry: NavBackStackEntry, images: ImageLoader, onPresent: (String) -> Unit): (EntryRequest) -> Unit {
    val entryVm: EntryViewModel = hiltViewModel(entry)
    EntryFrame(entry, entryVm, images, onPresent = onPresent)
    return entryVm::addSet
}

/**
 * The parts list's entry flow: at the parts-list destination, the confirmation dialog above it.
 * [asScan] gets the scanned set number, whether to enter manually, and the
 * two receipts — the shape is decided by the area that doesn't know the collection.
 */
@Composable
fun <T> partListsEntry(
    entry: NavBackStackEntry,
    images: ImageLoader,
    onPresent: (String) -> Unit,
    asScan: (setNumber: String?, manual: Boolean, adopted: () -> Unit, acknowledged: () -> Unit) -> T,
): T {
    val entryVm: EntryViewModel = hiltViewModel(entry)
    EntryFrame(entry, entryVm, images, onPresent = onPresent)
    val scan by entryVm.barcodeState.collectAsStateWithLifecycle()
    return asScan(scan.forPartList, scan.requestManualEntry,
        entryVm::clearBarcodeForPartsList, entryVm::acknowledgeManualEntry)
}
