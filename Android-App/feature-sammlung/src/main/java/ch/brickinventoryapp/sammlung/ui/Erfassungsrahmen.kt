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
import ch.brickinventoryapp.sammlung.ui.dialogs.SetPruefungRoute
import ch.brickinventoryapp.sammlung.ui.viewmodel.ErfassungViewModel
import coil3.ImageLoader

/** Schlüssel im SavedStateHandle des Ziels, das den Scanner geöffnet hat. */
private const val SCAN = "erfassung.scan"
private const val ART_BARCODE = "B"
private const val ART_SETNUMMER = "S"

/**
 * Der Scanner gibt seinen Treffer dem Ziel darunter zurück und schliesst sich. Nur
 * Text und Aufzählung: Der Eintrag überdauert so auch den Prozess.
 */
internal fun SavedStateHandle.legeScanAb(wert: String, setnummer: Boolean, herkunft: Scannerherkunft) {
    this[SCAN] = arrayListOf(herkunft.name, if (setnummer) ART_SETNUMMER else ART_BARCODE, wert)
}

/**
 * Bindet eine Erfassung an das Ziel [eintrag]: Ein zurückgegebener Scan wird dort
 * aufgelöst, Prüfanzeige und Bestätigung stehen über diesem Ziel, und ein schon
 * vorhandenes Set öffnet [onVorhanden]. Das ViewModel gehört dem Ziel, nicht der
 * Activity — kein anderes Ziel liest seine Ergebnisse.
 */
@Composable
internal fun Erfassungsrahmen(
    eintrag: NavBackStackEntry,
    erfassung: ErfassungViewModel,
    bilder: ImageLoader,
    onVorhanden: (String) -> Unit,
) {
    val scan by eintrag.savedStateHandle.getStateFlow<ArrayList<String>?>(SCAN, null).collectAsStateWithLifecycle()
    LaunchedEffect(scan) {
        val (herkunftName, art, wert) = scan ?: return@LaunchedEffect
        eintrag.savedStateHandle.remove<ArrayList<String>>(SCAN)
        val herkunft = Scannerherkunft.entries.firstOrNull { it.name == herkunftName } ?: Scannerherkunft.GALERIE
        if (art == ART_SETNUMMER) erfassung.useScannedSetNumber(wert, herkunft) else erfassung.resolveBarcode(wert, herkunft)
    }
    val barcode by erfassung.barcodeState.collectAsStateWithLifecycle()
    LaunchedEffect(barcode.gefundenesSet) {
        val gefunden = barcode.gefundenesSet ?: return@LaunchedEffect
        erfassung.gallerySearchFoundConsumed()
        onVorhanden(gefunden)
    }
    if (barcode.result != null) BarcodeResultRoute(erfassung, bilder)
    SetPruefungRoute(erfassung)
}

/**
 * Erfassen für Bereiche, die die Sammlung nicht kennen (Katalog): Die Erfassung
 * hängt am fragenden Ziel, ihre Prüfanzeige steht darüber.
 */
@Composable
fun setErfassung(eintrag: NavBackStackEntry, bilder: ImageLoader, onVorhanden: (String) -> Unit): (Erfassungswunsch) -> Unit {
    val erfassung: ErfassungViewModel = hiltViewModel(eintrag)
    Erfassungsrahmen(eintrag, erfassung, bilder, onVorhanden)
    return erfassung::addSet
}

/**
 * Die Erfassung der Teileliste: am Ziel der Teileliste, der Bestätigungsdialog darüber.
 * [alsScan] bekommt die gescannte Setnummer, ob manuell erfasst werden soll, und die
 * beiden Quittungen — die Form bestimmt der Bereich, der die Sammlung nicht kennt.
 */
@Composable
fun <T> teilelistenErfassung(
    eintrag: NavBackStackEntry,
    bilder: ImageLoader,
    onVorhanden: (String) -> Unit,
    alsScan: (setNumber: String?, manuell: Boolean, uebernommen: () -> Unit, quittiert: () -> Unit) -> T,
): T {
    val erfassung: ErfassungViewModel = hiltViewModel(eintrag)
    Erfassungsrahmen(eintrag, erfassung, bilder, onVorhanden)
    val scan by erfassung.barcodeState.collectAsStateWithLifecycle()
    return alsScan(scan.fuerTeileliste, scan.manuelleErfassungAnfordern,
        erfassung::clearBarcodeForPartsList, erfassung::manuelleErfassungQuittieren)
}
