package ch.brickinventoryapp.sammlung.ui.viewmodel

import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.data.repository.MerklisteRepository
import ch.brickinventoryapp.data.repository.SetKatalogRepository
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.fach.Fehlercode
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.SetAnleger
import ch.brickinventoryapp.data.SetAnlegenSchritt
import ch.brickinventoryapp.model.fach.SetErfasst
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.sammlung.ui.BarcodeUiState
import ch.brickinventoryapp.sammlung.ui.Erfassung
import ch.brickinventoryapp.sammlung.ui.ErfassungUiState
import ch.brickinventoryapp.sammlung.ui.Pruefphase
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
import ch.brickinventoryapp.sitzung.AppUiState
import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.zustand.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen
import ch.brickinventoryapp.zustand.ui.viewmodel.folgeAbmeldung

/**
 * Sets erfassen: Barcode und Texterkennung, das Erfassen über die Setnummer
 * (Galerie, Katalog) und die Prüfanzeige „wird geprüft“.
 *
 * An das Ziel gebunden, das scannt oder erfasst (Erfassungsrahmen): Der Scanner
 * gibt seinen Treffer dorthin zurück, Prüfung und Bestätigung stehen über diesem
 * Ziel, und kein anderes Ziel liest die Ergebnisse.
 */
@HiltViewModel
class ErfassungViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val sets: SetsRepository,
    private val setKatalog: SetKatalogRepository,
    private val merkliste: MerklisteRepository,
    private val katalog: KatalogRepository,
    private val anleger: SetAnleger,
) : ViewModel(), Filterwahl by filter, ErfassungAktionen {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        folgeAbmeldung(sitzung) { zuruecksetzen() }
    }

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
                erfassung.zeige(value, Pruefphase.BARCODE)
                when (val r = setKatalog.resolveBarcode(value)) {
                    is Ergebnis.Erfolg -> {
                        val setNum = r.data.setNumber
                        if (setNum.isBlank()) {
                            meldungen.zeige(meldungen.text(R.string.vm_barcode_not_found, value))
                            _barcodeState.update { it.copy(manuelleErfassungAnfordern = true) }
                            return@launch
                        }
                        if (_barcodeState.value.source == Scannerherkunft.GALERIE_SUCHE && zeigeVorhandenes(setNum)) return@launch
                        meldungen.quittiere()
                        _barcodeState.update { it.copy(
                            result = setNum, setName = r.data.name ?: setNum,
                            imageUrl = r.data.bildUrl, imageLocal = r.data.bildLokal,
                            year = r.data.year, pieces = r.data.pieces, theme = r.data.theme,
                            minifigs = r.data.minifigs, unsicher = r.data.unsicher, hinzufuegen = Vorgang.Fertig,
                            besitzMenge = 0,
                        ) }
                        // „Schon in deiner Sammlung (×N)“: Der Katalog kennt den eigenen Bestand;
                        // eigener Auftrag, damit die Prüfanzeige nicht auf ihn wartet.
                        viewModelScope.launch {
                            val antwort = katalog.getCatalogSetDetail(setNum)
                            val besitz = if (antwort is Ergebnis.Erfolg) antwort.data else null
                            if (besitz?.owned == true && _barcodeState.value.result == setNum)
                                _barcodeState.update { it.copy(besitzMenge = besitz.ownedQuantity.coerceAtLeast(1)) }
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
                erfassung.zeige(setNum, Pruefphase.BESTAND)
                val ausListe = _barcodeState.value.source in setOf(Scannerherkunft.TEILELISTE, Scannerherkunft.MERKLISTE)
                if (!ausListe && zeigeVorhandenes(setNum)) return@launch
                when (val r = katalog.getCatalogSetDetail(setNum)) {
                    is Ergebnis.Erfolg -> {
                        val d = r.data
                        if (d == null) {
                            meldungen.zeige(meldungen.text(R.string.vm_barcode_not_found, setNum))
                            _barcodeState.update { it.copy(manuelleErfassungAnfordern = true) }
                            return@launch
                        }
                        meldungen.quittiere()
                        _barcodeState.update { it.copy(
                            result = d.setNumber, setName = d.name ?: d.setNumber,
                            imageUrl = d.imageUrl, imageLocal = d.imageLocal,
                            year = d.year, pieces = d.numParts, theme = d.themeName,
                            minifigs = d.minifigs, unsicher = true, hinzufuegen = Vorgang.Fertig,
                            besitzMenge = if (d.owned) d.ownedQuantity.coerceAtLeast(1) else 0,
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
    private suspend fun zeigeVorhandenes(setNum: String): Boolean {
        erfassung.zeige(setNum, Pruefphase.BESTAND)
        return when (val vorhanden = setKatalog.getSetExists(setNum)) {
            is Ergebnis.Erfolg -> {
                val gefunden = vorhanden.data
                if (gefunden != null) {
                    meldungen.quittiere()
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
    override fun confirmAddBarcode(wunsch: Erfassungswunsch) {
        val setNum = wunsch.setNumber
        val stand = _barcodeState.value
        if (stand.hinzufuegen.laeuft) return
        when (stand.source) {
            Scannerherkunft.MERKLISTE -> {
                viewModelScope.launch {
                    meldungen.zeige(merkpostenAnlegen(merkliste, meldungen, setNum,
                                                        wunsch.zustand ?: Zustand.NEU, wunsch.besitzer))
                }
                cancelBarcode()
                return
            }
            Scannerherkunft.TEILELISTE -> {
                _barcodeState.update { ohneErgebnis(it).copy(fuerTeileliste = setNum) }
                return
            }
            Scannerherkunft.GALERIE, Scannerherkunft.GALERIE_SUCHE -> Unit
        }
        _barcodeState.update { ohneErgebnis(it).copy(hinzufuegen = Vorgang.Laeuft) }
        viewModelScope.launch {
            when (val r = sets.addSet(setNum, wunsch.menge.coerceAtLeast(1), wunsch.kaufpreis, wunsch.zustand,
                                      wunsch.besitzer, wunsch.lagerort?.trim()?.takeIf { it.isNotEmpty() })) {
                is Ergebnis.Erfolg -> {
                    // Offline gespeichert: Den Hinweis gibt der Ausgangsmelder, mit Zahl.
                    if (!r.gepuffert) meldungen.zeige(meldungen.text(
                        if (r.data.katalogOffen) R.string.vm_set_added_no_catalog else R.string.vm_set_added,
                        if (r.data.katalogOffen) setNum else r.data.name ?: setNum))
                    if (!r.gepuffert) ergaenzeAblage(r.data)
                }
                is Ergebnis.Fehler -> meldeFehlgeschlageneErfassung(setNum, meldungen.meldung(r))
            }
            _barcodeState.update { it.copy(hinzufuegen = Vorgang.Fertig) }
        }
    }

    override fun cancelBarcode() {
        _barcodeState.update { ohneErgebnis(it) }
    }

    private fun ohneErgebnis(b: BarcodeUiState) = b.copy(
        result = null, setName = null, imageUrl = null, imageLocal = null, year = null,
        pieces = null, theme = null, minifigs = null, hinzufuegen = Vorgang.Fertig, unsicher = false, besitzMenge = 0)

    /** Die Eingabe öffnen, ohne dass ein Scan voranging (Kamera nicht erlaubt). */
    fun manuellErfassen(herkunft: Scannerherkunft) {
        _barcodeState.update { it.copy(source = herkunft, manuelleErfassungAnfordern = true) }
    }

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
    fun addSet(wunsch: Erfassungswunsch) {
        viewModelScope.launch {
            val eingabe = wunsch.setNumber.trim()
            val lagerort = wunsch.lagerort?.trim()?.takeIf { it.isNotEmpty() }
            // Nur für die Anzeige auf die Grundvariante; angelegt wird mit der Eingabe.
            val sn = if (eingabe.contains("-")) eingabe else "$eingabe-1"
            val gestreamt = try {
                erfassung.zeige(sn, Pruefphase.BESTAND)
                var letzte: Ergebnis<SetErfasst> = Ergebnis.Fehler.LeereAntwort()
                anleger.anlegen(eingabe, wunsch.menge, wunsch.kaufpreis, wunsch.zustand, wunsch.besitzer, lagerort)
                    .collect { schritt ->
                        when (schritt) {
                            is SetAnlegenSchritt.Stammdaten -> erfassung.zeige(schritt.name ?: sn, Pruefphase.ANLEGEN_STAMMDATEN)
                            SetAnlegenSchritt.Bild -> erfassung.zeige(sn, Pruefphase.ANLEGEN_BILD)
                            SetAnlegenSchritt.FastFertig -> erfassung.zeige(sn, Pruefphase.ANLEGEN_ABSCHLUSS)
                            is SetAnlegenSchritt.Fertig -> letzte = Ergebnis.Erfolg(schritt.ergebnis)
                            SetAnlegenSchritt.KeineVerbindung -> letzte = Ergebnis.Fehler.Netz()
                            is SetAnlegenSchritt.Fehler -> letzte =
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
            val r = if (gestreamt is Ergebnis.Fehler && gestreamt.transient)
                sets.addSet(eingabe, wunsch.menge, wunsch.kaufpreis, wunsch.zustand, wunsch.besitzer, lagerort)
            else gestreamt
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
                        ergaenzeAblage(r.data)
                    }
                }
                is Ergebnis.Fehler -> meldeFehlgeschlageneErfassung(sn, meldungen.meldung(r))
            }
        }
    }

    /**
     * In der Ablage steht das Set schon mit Nummer und Menge; Name, Bild und Preise
     * kennt erst der Server. Steht dort noch eine Ergänzung aus, erst nach ihr holen.
     */
    private fun ergaenzeAblage(antwort: SetErfasst) {
        viewModelScope.launch {
            if (antwort.ergaenzungAusstehend) delay(ERGAENZUNG_NACH_MS)
            sets.aktualisiereSets()
        }
    }

    /** Ein Fehlschlag beim Erfassen nennt Setnummer und Grund — sonst sieht man nur, dass nichts geschah. */
    private fun meldeFehlgeschlageneErfassung(setNumber: String, grund: String?) {
        meldungen.zeige(meldungen.text(R.string.vm_add_failed, setNumber, grund ?: meldungen.text(R.string.pdfexp_unknown_error)))
    }

    /** Der Abbrechen-Knopf der Prüfanzeige: Ein laufender Scan wird abgebrochen, die Anzeige geräumt. */
    override fun brichPruefungAb() {
        erfassungsJob?.cancel()
        erfassungsJob = null
        erfassung.fertig()
    }

    private fun zuruecksetzen() {
        brichPruefungAb()
        _barcodeState.value = BarcodeUiState()
    }
}

/** Der Auftrag beginnt sofort, im Ereignisstrom nach einer Minute. */
private const val ERGAENZUNG_NACH_MS = 70_000L
