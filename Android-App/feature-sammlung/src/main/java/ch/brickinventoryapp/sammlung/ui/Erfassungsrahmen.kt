package ch.brickinventoryapp.sammlung.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavBackStackEntry
import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.sammlung.ui.dialogs.BarcodeResultRoute
import ch.brickinventoryapp.sammlung.ui.dialogs.SetCheckRoute
import ch.brickinventoryapp.sammlung.ui.viewmodel.EntryViewModel
import coil3.ImageLoader

/** Schlüssel im SavedStateHandle des Ziels, das den Scanner geöffnet hat. */
private const val SCAN = "erfassung.scan"
private const val KIND_BARCODE = "B"
private const val KIND_SET_NUMBER = "S"
private const val KIND_TYPE_IN = "E"

/**
 * Der Scanner gibt seinen Treffer dem Ziel darunter zurück und schliesst sich. Nur
 * Text und Aufzählung: Der Eintrag überdauert so auch den Prozess.
 */
internal fun SavedStateHandle.putScanAb(wert: String, setnummer: Boolean, herkunft: Scannerherkunft) {
    this[SCAN] = arrayListOf(herkunft.name, if (setnummer) KIND_SET_NUMBER else KIND_BARCODE, wert)
}

/** Ohne Kamera „Nummer eintippen“: Das Ziel darunter öffnet die Eingabe wie nach einem Scan ohne Treffer. */
internal fun SavedStateHandle.putTypeInAb(herkunft: Scannerherkunft) {
    this[SCAN] = arrayListOf(herkunft.name, KIND_TYPE_IN, "")
}

/**
 * Bindet eine Erfassung an das Ziel [entry]: Ein zurückgegebener Scan wird dort
 * aufgelöst, Prüfanzeige und Bestätigung stehen über diesem Ziel, und ein schon
 * vorhandenes Set öffnet [onPresent]. Das ViewModel gehört dem Ziel, nicht der
 * Activity — kein anderes Ziel liest seine Ergebnisse.
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
 * Erfassen für Bereiche, die die Sammlung nicht kennen (Katalog): Die Erfassung
 * hängt am fragenden Ziel, ihre Prüfanzeige steht darüber.
 */
@Composable
fun setEntry(entry: NavBackStackEntry, bilder: ImageLoader, onPresent: (String) -> Unit): (Erfassungswunsch) -> Unit {
    val erfassung: EntryViewModel = hiltViewModel(entry)
    Erfassungsrahmen(entry, erfassung, bilder, onPresent)
    return erfassung::addSet
}

/**
 * Die Erfassung der Teileliste: am Ziel der Teileliste, der Bestätigungsdialog darüber.
 * [asScan] bekommt die gescannte Setnummer, ob manuell erfasst werden soll, und die
 * beiden Quittungen — die Form bestimmt der Bereich, der die Sammlung nicht kennt.
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
