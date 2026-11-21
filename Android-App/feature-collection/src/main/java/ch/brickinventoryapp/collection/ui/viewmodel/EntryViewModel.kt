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
 * Sets erfassen: Barcode und Texterkennung, das Erfassen über die Setnummer
 * (Galerie, Katalog) und die Prüfanzeige „wird geprüft“.
 *
 * An das Ziel gebunden, das scannt oder erfasst (Erfassungsrahmen): Der Scanner
 * gibt seinen Treffer dorthin zurück, Prüfung und Bestätigung stehen über diesem
 * Ziel, und kein anderes Ziel liest die Ergebnisse.
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
     * Die laufende Prüfung eines Scans, damit sie abgebrochen werden kann —
     * hängt die Gegenstelle, will man trotzdem weiterscannen. Das Anlegen
     * selbst steht nicht hier: Es schreibt bereits und lässt sich nicht
     * folgenlos abbrechen.
     */
    private var erfassungsJob: Job? = null

    /**
     * Einen Barcode auflösen. Die Prüfanzeige steht, bis die Frage beantwortet
     * ist; ein neuer Scan bricht den alten ab, sonst beantwortete die Anzeige
     * eine Frage, die niemand mehr stellt.
     */
    fun resolveBarcode(value: String, herkunft: Scannerherkunft = Scannerherkunft.GALERIE) {
        erfassungsJob?.cancel()
        _barcodeState.update { it.copy(source = herkunft) }
        erfassungsJob = viewModelScope.launch {
            // Sechs Rückwege, vier davon vorzeitig: Nur das `finally` räumt die
            // Anzeige verlässlich weg.
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
                        // „Schon in deiner Sammlung (×N)“: Der Katalog kennt den eigenen Bestand;
                        // eigener Auftrag, damit die Prüfanzeige nicht auf ihn wartet.
                        viewModelScope.launch {
                            val antwort = katalog.getCatalogSetDetail(setNum)
                            val ownership = if (antwort is Ergebnis.Erfolg) antwort.data else null
                            if (ownership?.owned == true && _barcodeState.value.result == setNum)
                                _barcodeState.update { it.copy(ownershipQuantity = ownership.ownedQuantity.coerceAtLeast(1)) }
                        }
                    }
                    is Ergebnis.Fehler -> {
                        // „Nicht gefunden“ nur, wenn der Server das sagt; ein Netzfehler
                        // ist keine Auskunft über den Barcode.
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
     * Eine erkannte Setnummer (Texterkennung) übernehmen. Gefragt wird der
     * Server, ob das Set schon im Blickfeld steht — nicht die geladene Liste,
     * die nur eine Seite und nicht die Unterkonten kennt.
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
     * Steht das Set schon im Blickfeld? Dann öffnet die Galerie es, und es
     * wird nicht erfasst. Wahr heisst: erledigt (gefunden oder Fehler gemeldet).
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

    /** Die Galerie hat zum gefundenen Set navigiert. */
    fun gallerySearchFoundConsumed() {
        _barcodeState.update { it.copy(gefundenesSet = null) }
    }

    /** Der Bestätigungsdialog nach einem Scan: merken, an die Teileliste geben oder anlegen. */
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
                    // Offline gespeichert: Den Hinweis gibt der Ausgangsmelder, mit Zahl.
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

    /** Die Eingabe öffnen, ohne dass ein Scan voranging (Kamera nicht erlaubt). */
    fun manuellErfassen(herkunft: Scannerherkunft) {
        _barcodeState.update { it.copy(source = herkunft, manuelleErfassungAnfordern = true) }
    }

    fun manuelleErfassungQuittieren() {
        _barcodeState.update { it.copy(manuelleErfassungAnfordern = false) }
    }

    /** Die Teileliste hat die gescannte Setnummer übernommen. */
    fun clearBarcodeForPartsList() {
        _barcodeState.update { it.copy(forPartList = null) }
    }

    /**
     * Add a set by its set number (gallery, catalog).
     *
     * Whether it is already in view is answered by the server in the call itself
     * (`action = "exists"`, without writing); the check display shows the
     * steps of the event stream and disappears with the answer, not only
     * after the reload.
     */
    fun addSet(wish: Erfassungswunsch) {
        viewModelScope.launch {
            val eingabe = wish.setNumber.trim()
            val lagerort = wish.lagerort?.trim()?.takeIf { it.isNotEmpty() }
            // Only for display, reduced to the base variant; it is created with the entered value.
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
            // Without a connection there is no event stream: then the ordinary call, which
            // goes into the outbox, instead of letting the add fail.
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
     * In the store the set already has its number and quantity; name, image and prices
     * are known only to the server. If a sync is still pending there, fetch only after it.
     */
    private fun supplementStore(antwort: SetRecorded) {
        viewModelScope.launch {
            if (antwort.supplementPending) delay(SUPPLEMENT_AFTER_MS)
            sets.aktualisiereSets()
        }
    }

    /** A failure while adding names the set number and the reason — otherwise all one sees is that nothing happened. */
    private fun reportFailedEntry(setNumber: String, grund: String?) {
        meldungen.zeige(meldungen.text(R.string.vm_add_failed, setNumber, grund ?: meldungen.text(R.string.pdfexp_unknown_error)))
    }

    /** The cancel button of the check display: a running scan is aborted, the display cleared. */
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

/** The job starts right away, in the event stream after one minute. */
private const val SUPPLEMENT_AFTER_MS = 70_000L
