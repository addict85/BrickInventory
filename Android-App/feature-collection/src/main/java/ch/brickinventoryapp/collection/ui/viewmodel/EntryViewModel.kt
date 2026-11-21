package ch.brickinventoryapp.collection.ui.viewmodel

import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.data.repository.WantedRepository
import ch.brickinventoryapp.data.repository.SetKatalogRepository
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.domain.Fehlercode
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.model.domain.SetRecorded
import ch.brickinventoryapp.data.repository.CatalogRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.collection.ui.Erfassung
import ch.brickinventoryapp.collection.ui.EntryUiState
import ch.brickinventoryapp.collection.ui.CheckPhase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.state.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.state.ui.viewmodel.Meldungen
import ch.brickinventoryapp.state.ui.viewmodel.sequenceSignOut

/**
 * Entering sets: barcode and text recognition, entering via the set number
 * (gallery, catalog) and the "checking" display.
 *
 * Tied to the destination that scans or enters (Erfassungsrahmen): the scanner
 * hands its result back there, checking and confirmation sit above that
 * destination, and no other destination reads the results.
 */
@HiltViewModel
class EntryViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val sets: SetsRepository,
    private val setCatalog: SetKatalogRepository,
    private val merkliste: WantedRepository,
    private val katalog: CatalogRepository,
    private val creator: SetCreator,
) : ViewModel(), Filterwahl by filter, ErfassungAktionen {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        sequenceSignOut(sitzung) { reset() }
    }

    private val _barcodeState = MutableStateFlow(BarcodeUiState())
    val barcodeState: StateFlow<BarcodeUiState> = _barcodeState.asStateFlow()

    private val erfassung = Erfassung()
    val entryState: StateFlow<EntryUiState> = erfassung.state

    /**
     * A scan's running check, so it can be canceled —
     * the other end hangs if you want to keep scanning anyway. Creating
     * itself isn't here: it already writes and can't be
     * canceled without consequences.
     */
    private var erfassungsJob: Job? = null

    /**
     * Resolve a barcode. The checking display stands until the question is answered;
     * a new scan cancels the old one, otherwise the display would answer
     * a question nobody is asking anymore.
     */
    fun resolveBarcode(value: String, herkunft: Scannerherkunft = Scannerherkunft.GALERIE) {
        erfassungsJob?.cancel()
        _barcodeState.update { it.copy(source = herkunft) }
        erfassungsJob = viewModelScope.launch {
            // Six return paths, four of them early: only the `finally` reliably
            // clears the display.
            try {
                erfassung.zeige(value, CheckPhase.BARCODE)
                when (val r = setCatalog.resolveBarcode(value)) {
                    is Ergebnis.Erfolg -> {
                        val setNum = r.data.setNumber
                        if (setNum.isBlank()) {
                            meldungen.zeige(meldungen.text(R.string.vm_barcode_not_found, value))
                            _barcodeState.update { it.copy(manuelleErfassungAnfordern = true) }
                            return@launch
                        }
                        if (_barcodeState.value.source == Scannerherkunft.GALERIE_SUCHE && showExisting(setNum)) return@launch
                        meldungen.acknowledge()
                        _barcodeState.update { it.copy(
                            result = setNum, setName = r.data.name ?: setNum,
                            imageUrl = r.data.bildUrl, imageLocal = r.data.bildLokal,
                            year = r.data.year, pieces = r.data.pieces, theme = r.data.theme,
                            minifigs = r.data.minifigs, unsicher = r.data.unsicher, hinzufuegen = Vorgang.Fertig,
                            ownershipQuantity = 0,
                        ) }
                        // "Already in your collection (×N)": the catalog knows one's own
                        // inventory; its own job, so the checking display doesn't wait on it.
                        viewModelScope.launch {
                            val antwort = katalog.getCatalogSetDetail(setNum)
                            val ownership = if (antwort is Ergebnis.Erfolg) antwort.data else null
                            if (ownership?.owned == true && _barcodeState.value.result == setNum)
                                _barcodeState.update { it.copy(ownershipQuantity = ownership.ownedQuantity.coerceAtLeast(1)) }
                        }
                    }
                    is Ergebnis.Fehler -> {
                        // "Not found" only if the server says so; a network error
                        // tells you nothing about the barcode.
                        meldungen.zeige(if (r.code == Fehlercode.BARCODE_KEIN_SET) meldungen.text(R.string.vm_barcode_not_found, value)
                                          else meldungen.meldungFuerSnackbar(r))
                        _barcodeState.update { it.copy(result = null, manuelleErfassungAnfordern = true) }
                    }
                }
            } finally {
                erfassung.fertig()
            }
        }
    }

    /**
     * Take over a recognized set number (text recognition). The
     * server is asked whether the set is already in view — not the loaded list,
     * which only knows one page and not the sub-accounts.
     */
    fun useScannedSetNumber(raw: String, herkunft: Scannerherkunft = Scannerherkunft.GALERIE) {
        erfassungsJob?.cancel()
        _barcodeState.update { it.copy(source = herkunft) }
        erfassungsJob = viewModelScope.launch {
            try {
                val setNum = raw.trim().let { if (it.contains("-")) it else "$it-1" }
                erfassung.zeige(setNum, CheckPhase.BESTAND)
                val fromList = _barcodeState.value.source in setOf(Scannerherkunft.TEILELISTE, Scannerherkunft.MERKLISTE)
                if (!fromList && showExisting(setNum)) return@launch
                when (val r = katalog.getCatalogSetDetail(setNum)) {
                    is Ergebnis.Erfolg -> {
                        val d = r.data
                        if (d == null) {
                            meldungen.zeige(meldungen.text(R.string.vm_barcode_not_found, setNum))
                            _barcodeState.update { it.copy(manuelleErfassungAnfordern = true) }
                            return@launch
                        }
                        meldungen.acknowledge()
                        _barcodeState.update { it.copy(
                            result = d.setNumber, setName = d.name ?: d.setNumber,
                            imageUrl = d.imageUrl, imageLocal = d.imageLocal,
                            year = d.year, pieces = d.numParts, theme = d.themeName,
                            minifigs = d.minifigs, unsicher = true, hinzufuegen = Vorgang.Fertig,
                            ownershipQuantity = if (d.owned) d.ownedQuantity.coerceAtLeast(1) else 0,
                        ) }
                    }
                    is Ergebnis.Fehler -> {
                        meldungen.zeige(meldungen.meldungFuerSnackbar(r))
                        _barcodeState.update { it.copy(manuelleErfassungAnfordern = true) }
                    }
                }
            } finally {
                erfassung.fertig()
            }
        }
    }

    /**
     * Is the set already in view? Then the gallery opens it, and it
     * isn't entered. True means: done (found or error reported).
     */
    private suspend fun showExisting(setNum: String): Boolean {
        erfassung.zeige(setNum, CheckPhase.BESTAND)
        return when (val vorhanden = setCatalog.getSetExists(setNum)) {
            is Ergebnis.Erfolg -> {
                val gefunden = vorhanden.data
                if (gefunden != null) {
                    meldungen.acknowledge()
                    _barcodeState.update { it.copy(gefundenesSet = gefunden) }
                }
                gefunden != null
            }
            is Ergebnis.Fehler -> {
                meldungen.zeige(meldungen.meldungFuerSnackbar(vorhanden))
                true
            }
        }
    }

    /** The gallery has navigated to the found set. */
    fun gallerySearchFoundConsumed() {
        _barcodeState.update { it.copy(gefundenesSet = null) }
    }

    /** The confirmation dialog after a scan: watchlist, hand to the parts list, or enter. */
    override fun confirmAddBarcode(wish: Erfassungswunsch) {
        val setNum = wish.setNumber
        val stand = _barcodeState.value
        if (stand.hinzufuegen.laeuft) return
        when (stand.source) {
            Scannerherkunft.MERKLISTE -> {
                viewModelScope.launch {
                    meldungen.zeige(createWantedItem(merkliste, meldungen, setNum,
                                                        wish.zustand ?: Zustand.NEU, wish.besitzer))
                }
                cancelBarcode()
                return
            }
            Scannerherkunft.TEILELISTE -> {
                _barcodeState.update { withoutResult(it).copy(forPartList = setNum) }
                return
            }
            Scannerherkunft.GALERIE, Scannerherkunft.GALERIE_SUCHE -> Unit
        }
        _barcodeState.update { withoutResult(it).copy(hinzufuegen = Vorgang.Laeuft) }
        viewModelScope.launch {
            when (val r = sets.addSet(setNum, wish.menge.coerceAtLeast(1), wish.kaufpreis, wish.zustand,
                                      wish.besitzer, wish.lagerort?.trim()?.takeIf { it.isNotEmpty() })) {
                is Ergebnis.Erfolg -> {
                    // Saved offline: the outbox reporter gives the notice, with a count.
                    if (!r.gepuffert) meldungen.zeige(meldungen.text(
                        if (r.data.katalogOffen) R.string.vm_set_added_no_catalog else R.string.vm_set_added,
                        if (r.data.katalogOffen) setNum else r.data.name ?: setNum))
                    if (!r.gepuffert) supplementStore(r.data)
                }
                is Ergebnis.Fehler -> reportFailedEntry(setNum, meldungen.meldung(r))
            }
            _barcodeState.update { it.copy(hinzufuegen = Vorgang.Fertig) }
        }
    }

    override fun cancelBarcode() {
        _barcodeState.update { withoutResult(it) }
    }

    private fun withoutResult(b: BarcodeUiState) = b.copy(
        result = null, setName = null, imageUrl = null, imageLocal = null, year = null,
        pieces = null, theme = null, minifigs = null, hinzufuegen = Vorgang.Fertig, unsicher = false, ownershipQuantity = 0)

    /** Open manual entry, without a scan having happened first (camera not permitted). */
    fun manuellErfassen(herkunft: Scannerherkunft) {
        _barcodeState.update { it.copy(source = herkunft, manuelleErfassungAnfordern = true) }
    }

    fun manuelleErfassungQuittieren() {
        _barcodeState.update { it.copy(manuelleErfassungAnfordern = false) }
    }

    /** The parts list has taken over the scanned set number. */
    fun clearBarcodeForPartsList() {
        _barcodeState.update { it.copy(forPartList = null) }
    }

    /**
     * Ein Set über die Setnummer erfassen (Galerie, Katalog).
     *
     * Ob es schon im Blickfeld steht, beantwortet der Server im Aufruf selbst
     * (`action = "exists"`, ohne zu schreiben); die Prüfanzeige zeigt die
     * Schritte des Ereignisstroms und verschwindet mit der Antwort, nicht erst
     * nach dem Nachladen.
     */
    fun addSet(wish: Erfassungswunsch) {
        viewModelScope.launch {
            val eingabe = wish.setNumber.trim()
            val lagerort = wish.lagerort?.trim()?.takeIf { it.isNotEmpty() }
            // Nur für die Anzeige auf die Grundvariante; angelegt wird mit der Eingabe.
            val sn = if (eingabe.contains("-")) eingabe else "$eingabe-1"
            val streamed = try {
                erfassung.zeige(sn, CheckPhase.BESTAND)
                var letzte: Ergebnis<SetRecorded> = Ergebnis.Fehler.LeereAntwort()
                creator.anlegen(eingabe, wish.menge, wish.kaufpreis, wish.zustand, wish.besitzer, lagerort)
                    .collect { schritt ->
                        when (schritt) {
                            is SetCreateStep.Stammdaten -> erfassung.zeige(schritt.name ?: sn, CheckPhase.ANLEGEN_STAMMDATEN)
                            SetCreateStep.Bild -> erfassung.zeige(sn, CheckPhase.ANLEGEN_BILD)
                            SetCreateStep.FastDone -> erfassung.zeige(sn, CheckPhase.ANLEGEN_ABSCHLUSS)
                            is SetCreateStep.Fertig -> letzte = Ergebnis.Erfolg(schritt.ergebnis)
                            SetCreateStep.NoConnection -> letzte = Ergebnis.Fehler.Netz()
                            is SetCreateStep.Fehler -> letzte =
                                if (schritt.meldung.isBlank()) Ergebnis.Fehler.Abgebrochen
                                else Ergebnis.Fehler.Absage(schritt.meldung)
                        }
                    }
                letzte
            } finally {
                erfassung.fertig()
            }
            // Ohne Verbindung kein Ereignisstrom: dann der gewöhnliche Aufruf, der in
            // den Ausgang geht, statt das Erfassen scheitern zu lassen.
            val r = if (streamed is Ergebnis.Fehler && streamed.transient)
                sets.addSet(eingabe, wish.menge, wish.kaufpreis, wish.zustand, wish.besitzer, lagerort)
            else streamed
            when (r) {
                is Ergebnis.Erfolg -> when {
                    r.gepuffert -> Unit
                    r.data.vorhanden -> _barcodeState.update { it.copy(gefundenesSet = r.data.nummer ?: sn) }
                    else -> {
                        meldungen.zeige(meldungen.text(when {
                            r.data.katalogOffen -> R.string.vm_set_added_no_catalog
                            r.data.angelegt -> R.string.vm_added
                            else -> R.string.vm_updated
                        }, if (r.data.katalogOffen) r.data.nummer else r.data.name ?: r.data.nummer))
                        supplementStore(r.data)
                    }
                }
                is Ergebnis.Fehler -> reportFailedEntry(sn, meldungen.meldung(r))
            }
        }
    }

    /**
     * In der Ablage steht das Set schon mit Nummer und Menge; Name, Bild und Preise
     * kennt erst der Server. Steht dort noch eine Ergänzung aus, erst nach ihr holen.
     */
    private fun supplementStore(antwort: SetRecorded) {
        viewModelScope.launch {
            if (antwort.supplementPending) delay(SUPPLEMENT_AFTER_MS)
            sets.aktualisiereSets()
        }
    }

    /** Ein Fehlschlag beim Erfassen nennt Setnummer und Grund — sonst sieht man nur, dass nichts geschah. */
    private fun reportFailedEntry(setNumber: String, grund: String?) {
        meldungen.zeige(meldungen.text(R.string.vm_add_failed, setNumber, grund ?: meldungen.text(R.string.pdfexp_unknown_error)))
    }

    /** Der Abbrechen-Knopf der Prüfanzeige: Ein laufender Scan wird abgebrochen, die Anzeige geräumt. */
    override fun abortCheckAb() {
        erfassungsJob?.cancel()
        erfassungsJob = null
        erfassung.fertig()
    }

    private fun reset() {
        abortCheckAb()
        _barcodeState.value = BarcodeUiState()
    }
}

/** Der Auftrag beginnt sofort, im Ereignisstrom nach einer Minute. */
private const val SUPPLEMENT_AFTER_MS = 70_000L
