package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.SetAnleger
import ch.brickinventoryapp.data.SetAnlegenSchritt
import ch.brickinventoryapp.data.model.AddSetResponse
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.Fehlerart
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.BarcodeUiState
import ch.brickinventoryapp.ui.Erfassung
import ch.brickinventoryapp.ui.ErfassungUiState
import ch.brickinventoryapp.ui.Pruefphase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Sets erfassen: Barcode und Texterkennung, das Erfassen über die Setnummer
 * (Galerie, Katalog) und die Prüfanzeige „wird geprüft“.
 *
 * An die Activity gebunden ([aktivitaetsViewModel]): Der Scanner schliesst
 * sich sofort, die Prüfung und der Bestätigungsdialog laufen über jedem
 * Bildschirm weiter, und die Galerie öffnet danach das gefundene Set.
 */
@HiltViewModel
class ErfassungViewModel @Inject constructor(
    dienste: AppDienste,
    private val sets: SetsRepository,
    private val katalog: KatalogRepository,
    private val anleger: SetAnleger,
) : BereichsViewModel(dienste) {

    private val _barcodeState = MutableStateFlow(BarcodeUiState())
    val barcodeState: StateFlow<BarcodeUiState> = _barcodeState.asStateFlow()

    private val erfassung = Erfassung()
    val erfassungState: StateFlow<ErfassungUiState> = erfassung.state

    /**
     * Die laufende Prüfung eines Scans, damit sie abgebrochen werden kann —
     * hängt die Gegenstelle, will man trotzdem weiterscannen. Das Anlegen
     * selbst steht nicht hier: Es schreibt bereits und lässt sich nicht
     * folgenlos abbrechen.
     */
    private var erfassungsJob: Job? = null

    /** Woher der Scan kommt: "gallery", "gallery_search", "partslist" oder "wanted". */
    fun setScannerSource(source: String) {
        _barcodeState.update { it.copy(source = source) }
    }

    /**
     * Einen Barcode auflösen. Die Prüfanzeige steht, bis die Frage beantwortet
     * ist; ein neuer Scan bricht den alten ab, sonst beantwortete die Anzeige
     * eine Frage, die niemand mehr stellt.
     */
    fun resolveBarcode(value: String) {
        erfassungsJob?.cancel()
        erfassungsJob = viewModelScope.launch {
            // Sechs Rückwege, vier davon vorzeitig: Nur das `finally` räumt die
            // Anzeige verlässlich weg.
            try {
                erfassung.zeige(value, Pruefphase.BARCODE)
                when (val r = sets.resolveBarcode(value)) {
                    is Result.Success -> {
                        val setNum = r.data.setNumber
                        if (setNum.isBlank()) {
                            _snackbar.value = text(R.string.vm_barcode_no_set, value)
                            _barcodeState.update { it.copy(manuelleErfassungAnfordern = true) }
                            return@launch
                        }
                        if (_barcodeState.value.source == "gallery_search" && zeigeVorhandenes(setNum)) return@launch
                        _snackbar.value = null
                        _barcodeState.update { it.copy(
                            result = setNum, setName = r.data.name ?: setNum,
                            imageUrl = r.data.imageUrl, imageLocal = r.data.imageLocal,
                            year = r.data.year, pieces = r.data.pieces, theme = r.data.theme,
                            minifigs = r.data.minifigs, unsicher = r.data.unsicher, adding = false,
                        ) }
                    }
                    is Result.Error -> {
                        // „Nicht gefunden“ nur, wenn der Server das sagt; ein Netzfehler
                        // ist keine Auskunft über den Barcode.
                        _snackbar.value = if (r.code == "barcode_kein_set") text(R.string.vm_barcode_not_found, value)
                                          else meldungFuerSnackbar(r)
                        _barcodeState.update { it.copy(result = null, manuelleErfassungAnfordern = true) }
                    }
                }
            } finally {
                erfassung.fertig()
            }
        }
    }

    /**
     * Eine erkannte Setnummer (Texterkennung) übernehmen. Gefragt wird der
     * Server, ob das Set schon im Blickfeld steht — nicht die geladene Liste,
     * die nur eine Seite und nicht die Unterkonten kennt.
     */
    fun useScannedSetNumber(raw: String) {
        erfassungsJob?.cancel()
        erfassungsJob = viewModelScope.launch {
            try {
                val setNum = raw.trim().let { if (it.contains("-")) it else "$it-1" }
                erfassung.zeige(setNum, Pruefphase.BESTAND)
                val ausListe = _barcodeState.value.source in setOf("partslist", "wanted")
                if (!ausListe && zeigeVorhandenes(setNum)) return@launch
                when (val r = katalog.getCatalogSetDetail(setNum)) {
                    is Result.Success -> {
                        val d = r.data.set
                        if (d == null) {
                            _snackbar.value = text(R.string.vm_barcode_no_set, setNum)
                            _barcodeState.update { it.copy(manuelleErfassungAnfordern = true) }
                            return@launch
                        }
                        _snackbar.value = null
                        _barcodeState.update { it.copy(
                            result = d.setNumber, setName = d.name ?: d.setNumber,
                            imageUrl = d.imageUrl, imageLocal = d.imageLocal,
                            year = d.year, pieces = d.numParts, theme = d.themeName,
                            minifigs = d.minifigs, unsicher = true, adding = false,
                        ) }
                    }
                    is Result.Error -> {
                        _snackbar.value = meldungFuerSnackbar(r)
                        _barcodeState.update { it.copy(manuelleErfassungAnfordern = true) }
                    }
                }
            } finally {
                erfassung.fertig()
            }
        }
    }

    /**
     * Steht das Set schon im Blickfeld? Dann öffnet die Galerie es, und es
     * wird nicht erfasst. Wahr heisst: erledigt (gefunden oder Fehler gemeldet).
     */
    private suspend fun zeigeVorhandenes(setNum: String): Boolean {
        erfassung.zeige(setNum, Pruefphase.BESTAND)
        return when (val vorhanden = sets.getSetExists(setNum)) {
            is Result.Success -> {
                if (vorhanden.data.exists) {
                    _snackbar.value = null
                    _barcodeState.update { it.copy(gefundenesSet = vorhanden.data.setNumber) }
                }
                vorhanden.data.exists
            }
            is Result.Error -> {
                _snackbar.value = meldungFuerSnackbar(vorhanden)
                true
            }
        }
    }

    /** Die Galerie hat zum gefundenen Set navigiert. */
    fun gallerySearchFoundConsumed() {
        _barcodeState.update { it.copy(gefundenesSet = null) }
    }

    /** Der Bestätigungsdialog nach einem Scan: merken, an die Teileliste geben oder anlegen. */
    fun confirmAddBarcode(setNum: String, purchasePrice: Double? = null, condition: String? = null,
                          ownerUserId: Int? = null, storage: String? = null) {
        val stand = _barcodeState.value
        if (stand.adding) return
        when (stand.source) {
            "wanted" -> {
                viewModelScope.launch {
                    _snackbar.value = merkpostenAnlegen(sets, dienste.texte, setNum,
                                                        if (condition == "U") "U" else "N", ownerUserId)
                    dienste.bestand.melde(Aenderung.Merkliste)
                }
                cancelBarcode()
                return
            }
            "partslist" -> {
                _barcodeState.update { ohneErgebnis(it).copy(fuerTeileliste = setNum) }
                return
            }
        }
        _barcodeState.update { ohneErgebnis(it).copy(adding = true) }
        viewModelScope.launch {
            when (val r = sets.addSet(setNum, 1, purchasePrice, condition, ownerUserId,
                                      storage?.trim()?.takeIf { it.isNotEmpty() })) {
                is Result.Success -> {
                    // Offline gespeichert: Den Hinweis gibt der Ausgangsmelder, mit Zahl.
                    if (!r.gepuffert) _snackbar.value = text(
                        if (r.data.katalogOffen) R.string.vm_set_added_no_catalog else R.string.vm_set_added, setNum)
                    dienste.bestand.melde(Aenderung.Sets)
                }
                is Result.Error -> meldeFehlgeschlageneErfassung(setNum, meldung(r))
            }
            _barcodeState.update { it.copy(adding = false) }
        }
    }

    fun cancelBarcode() {
        _barcodeState.update { ohneErgebnis(it) }
    }

    private fun ohneErgebnis(b: BarcodeUiState) = b.copy(
        result = null, setName = null, imageUrl = null, imageLocal = null, year = null,
        pieces = null, theme = null, minifigs = null, adding = false, unsicher = false)

    fun manuelleErfassungQuittieren() {
        _barcodeState.update { it.copy(manuelleErfassungAnfordern = false) }
    }

    /** Die Teileliste hat die gescannte Setnummer übernommen. */
    fun clearBarcodeForPartsList() {
        _barcodeState.update { it.copy(fuerTeileliste = null) }
    }

    /**
     * Ein Set über die Setnummer erfassen (Galerie, Katalog).
     *
     * Ob es schon im Blickfeld steht, beantwortet der Server im Aufruf selbst
     * (`action = "exists"`, ohne zu schreiben); die Prüfanzeige zeigt die
     * Schritte des Ereignisstroms und verschwindet mit der Antwort, nicht erst
     * nach dem Nachladen.
     */
    fun addSet(setNumber: String, quantity: Int = 1, purchasePrice: Double? = null,
               condition: String? = null, ownerUserId: Int? = null, storage: String? = null) {
        viewModelScope.launch {
            val eingabe = setNumber.trim()
            // Nur für die Anzeige auf die Grundvariante; angelegt wird mit der Eingabe.
            val sn = if (eingabe.contains("-")) eingabe else "$eingabe-1"
            val gestreamt = try {
                erfassung.zeige(sn, Pruefphase.BESTAND)
                var letzte: Result<AddSetResponse> = Result.Error("", art = Fehlerart.LEERE_ANTWORT)
                anleger.anlegen(eingabe, quantity, purchasePrice, condition, ownerUserId,
                                storage?.trim()?.takeIf { it.isNotEmpty() })
                    .collect { schritt ->
                        when (schritt) {
                            is SetAnlegenSchritt.Stammdaten -> erfassung.zeige(schritt.name ?: sn, Pruefphase.ANLEGEN_STAMMDATEN)
                            SetAnlegenSchritt.Bild -> erfassung.zeige(sn, Pruefphase.ANLEGEN_BILD)
                            SetAnlegenSchritt.FastFertig -> erfassung.zeige(sn, Pruefphase.ANLEGEN_ABSCHLUSS)
                            is SetAnlegenSchritt.Fertig -> letzte = Result.Success(schritt.ergebnis)
                            SetAnlegenSchritt.KeineVerbindung -> letzte = Result.Error("", transient = true, art = Fehlerart.NETZ)
                            is SetAnlegenSchritt.Fehler -> letzte =
                                if (schritt.meldung.isBlank()) Result.Error("", art = Fehlerart.NETZ)
                                else Result.Success(AddSetResponse(success = false, error = schritt.meldung))
                        }
                    }
                letzte
            } finally {
                erfassung.fertig()
            }
            // Ohne Verbindung kein Ereignisstrom: dann der gewöhnliche Aufruf, der in
            // den Ausgang geht, statt das Erfassen scheitern zu lassen.
            val r = if (gestreamt is Result.Error && gestreamt.transient)
                sets.addSet(eingabe, quantity, purchasePrice, condition, ownerUserId,
                            storage?.trim()?.takeIf { it.isNotEmpty() })
            else gestreamt
            when (r) {
                is Result.Success -> when {
                    r.gepuffert -> dienste.bestand.melde(Aenderung.Sets)
                    r.data.success && r.data.action == "exists" ->
                        _barcodeState.update { it.copy(gefundenesSet = r.data.setNumber ?: sn) }
                    r.data.success -> {
                        _snackbar.value = text(when {
                            r.data.katalogOffen -> R.string.vm_set_added_no_catalog
                            r.data.action == "added" -> R.string.vm_added
                            else -> R.string.vm_updated
                        }, r.data.setNumber)
                        dienste.bestand.melde(Aenderung.Sets)
                    }
                    else -> meldeFehlgeschlageneErfassung(sn, r.data.error)
                }
                is Result.Error -> meldeFehlgeschlageneErfassung(sn, meldung(r))
            }
        }
    }

    /** Ein Fehlschlag beim Erfassen nennt Setnummer und Grund — sonst sieht man nur, dass nichts geschah. */
    private fun meldeFehlgeschlageneErfassung(setNumber: String, grund: String?) {
        _snackbar.value = text(R.string.vm_add_failed, setNumber, grund ?: text(R.string.pdfexp_unknown_error))
    }

    /** Der Abbrechen-Knopf der Prüfanzeige: Ein laufender Scan wird abgebrochen, die Anzeige geräumt. */
    fun brichPruefungAb() {
        erfassungsJob?.cancel()
        erfassungsJob = null
        erfassung.fertig()
    }

    override fun zuruecksetzen() {
        brichPruefungAb()
        _barcodeState.value = BarcodeUiState()
    }
}
