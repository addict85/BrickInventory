package ch.brickinventoryapp.collection.ui.viewmodel

import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.model.ui.Laden
import kotlinx.coroutines.flow.first
import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.data.repository.SetDateienRepository
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.data.repository.SetKatalogRepository
import ch.brickinventoryapp.model.domain.Zustand
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.data.repository.FinancesRepository
import ch.brickinventoryapp.data.repository.HouseholdRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.collection.ui.Preisalarmeingabe
import ch.brickinventoryapp.collection.ui.SetDetailUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import ch.brickinventoryapp.model.domain.SetAnsicht
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.Gelesen
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.state.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.state.ui.viewmodel.Meldungen
import ch.brickinventoryapp.state.ui.viewmodel.sequenceSignOut

/**
 * Wie gross eine Anleitung sein darf — derselbe Wert wie `limits.fileSize` in
 * routes/sets.ts. Die App muss die Grenze kennen, bevor sie 80 MB durchs
 * Mobilfunknetz schickt.
 */
internal const val INSTRUCTION_MAX_BYTES = 50L * 1024 * 1024

/**
 * Die Typen, die der Server annimmt (INSTR_EXT_BY_MIME in routes/sets.ts). Er
 * leitet daraus die Dateiendung ab; die App filtert schon die Auswahl.
 */
internal val INSTRUCTION_TYPES = arrayOf("application/pdf", "image/jpeg", "image/png")

/**
 * Die Detailansicht eines Sets: Stammdaten, Preis und Verlauf, Käufe,
 * Preisalarme, Anleitungen, Menge und Lagerort.
 *
 * Welches Set, steht im [SavedStateHandle] (Navigationsargument `setNumber`):
 * Nach einem Prozess-Tod öffnet die Ansicht wieder dasselbe Set.
 */
@HiltViewModel
class SetDetailViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val sets: SetsRepository,
    private val katalog: SetKatalogRepository,
    private val alerts: AlarmRepository,
    private val dateien: SetDateienRepository,
    private val finanzen: FinancesRepository,
    private val haushalt: HouseholdRepository,
    private val reader: FileReader,
    gemerkt: SavedStateHandle,
) : ViewModel(), Filterwahl by filter, SetDetailAktionen {

    val state: StateFlow<AppUiState> = sitzung.state

    /** Aus der Route set_detail/{setNumber}. */
    val setNumber: String = gemerkt[ARG_SET] ?: ""

    private val _setDetailState = MutableStateFlow(SetDetailUiState())
    val setDetailState: StateFlow<SetDetailUiState> = _setDetailState.asStateFlow()

    /**
     * Dieses Set, wie die Galerie es aus der Ablage zeigt: Die Kachel steht da, bis das
     * Detail geladen ist. Aus derselben Quelle statt aus dem ViewModel der Galerie.
     */
    val vorschau: StateFlow<SetAnsicht?> = sets.observeSets()
        .map { l -> l.liste.firstOrNull { it.setNumber == setNumber } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(PREVIEW_HOLD_MS), null)

    // Je Abschnitt ein Abruf: Ein neuer bricht den laufenden ab, damit keine späte
    // Antwort eines alten Abrufs die neuere überschreibt.
    private val laufend = HashMap<Abschnitt, Job>()

    // Nach setNumber und dem Zustand: Ein init davor sähe beide noch nicht belegt.
    init {
        sequenceSignOut(sitzung) { reset() }
        // Ändert sich dieses Set in der Ablage — hier oder anderswo —, gelten Detail und Käufe nicht mehr.
        viewModelScope.launch {
            sets.observeSets().map { l -> l.liste.firstOrNull { it.setNumber == setNumber } }
                .distinctUntilChanged().drop(1).collect {
                    if (_setDetailState.value.setDetail != null) { loadDetail(); loadPurchases() }
                }
        }
    }

    // Menge, Lagerort und Alarm warten die Ruhezeit ab; die Aufträge laufen im
    // Scope des ViewModels und überstehen so das Zurückgehen.
    private var storageJob: Job? = null
    private val alarmInput = Preisalarmeingabe(
        scope = viewModelScope, alerts = alerts,
        melde = { meldungen.zeige(it) },
        describe = { meldungen.meldungFuerSnackbar(it) },
        gespeichert = { sn -> if (sn == setNumber) loadPriceAlerts() },
    )

    // Am Ende der Felder: Die Abrufe brauchen laufend und alarmInput schon belegt.
    init { refresh() }

    /** Alles, was die Ansicht zeigt, neu holen; beim Erzeugen und auf „Erneut versuchen“. */
    override fun refresh() {
        loadDetail()
        loadPrice()
        loadHistory()
        loadPurchases()
        loadPriceAlerts()
    }

    private fun starte(section: Abschnitt, abruf: suspend () -> Unit) {
        if (setNumber.isBlank()) return
        laufend.remove(section)?.cancel()
        laufend[section] = viewModelScope.launch { abruf() }
    }

    private fun loadDetail() = starte(Abschnitt.DETAIL) {
        _setDetailState.update { it.copy(detailFetch = Laden.Loads) }
        when (val r = katalog.getSetDetail(setNumber)) {
            is Ergebnis.Erfolg -> {
                _setDetailState.update { it.copy(setDetail = r.data, detailFetch = Laden.Daten(Unit)) }
                // Die Vorschläge fürs Lagerortfeld gehören dem Besitzer des Sets, nicht dem Betrachter.
                filter.loadLocationStock(r.data?.owners.orEmpty().map { it.id })
            }
            is Ergebnis.Fehler -> _setDetailState.update { it.copy(detailFetch = loadError(r)) }
        }
    }

    private fun loadPrice() = starte(Abschnitt.PRICE) {
        _setDetailState.update { it.copy(priceFetch = Laden.Loads) }
        when (val r = finanzen.getSetPrice(setNumber)) {
            is Ergebnis.Erfolg -> _setDetailState.update { it.copy(setPrice = r.data, priceFetch = Laden.Daten(Unit)) }
            is Ergebnis.Fehler -> _setDetailState.update { it.copy(priceFetch = loadError(r)) }
        }
    }

    private fun loadHistory() = starte(Abschnitt.HISTORY) {
        _setDetailState.update { it.copy(historyFetch = Laden.Loads) }
        when (val r = finanzen.getSetPriceHistory(setNumber)) {
            is Ergebnis.Erfolg -> _setDetailState.update { it.copy(priceHistory = r.data, historyFetch = Laden.Daten(Unit)) }
            is Ergebnis.Fehler -> _setDetailState.update { it.copy(historyFetch = loadError(r)) }
        }
    }

    private fun loadPurchases() = starte(Abschnitt.PURCHASES) {
        _setDetailState.update { it.copy(purchasesFetch = Laden.Loads) }
        when (val r = haushalt.getAcquisitions(setNumber)) {
            is Ergebnis.Erfolg -> _setDetailState.update {
                it.copy(acquisitions = r.data.kaeufe, acquisitionTotals = r.data.sums,
                        purchasesFetch = Laden.Daten(Unit))
            }
            is Ergebnis.Fehler -> _setDetailState.update { it.copy(purchasesFetch = loadError(r)) }
        }
    }

    private fun loadPriceAlerts() = starte(Abschnitt.ALERTS) {
        alerts.refreshAlerts()
        val liste = alerts.observeAlerts(setNumber).first().liste
        _setDetailState.update { it.copy(preisalarme = liste) }
    }

    override fun setPriceAlert(setNumber: String, richtung: Alarmrichtung, roh: String, zustand: Zustand) =
        alarmInput.setze(setNumber, richtung, roh, zustand)

    /**
     * Die Menge ändern. Die neue Zahl steht sofort in der Ansicht; die übrigen
     * Bestandsansichten folgen der Ablage, in die das Repository sie schreibt.
     */
    fun setQuantity(setNumber: String, quantity: Int, purchasePrice: Double? = null, condition: Zustand? = null) =
        changeQuantity(setNumber) { sets.setQuantity(setNumber, quantity, purchasePrice, condition) }

    /** Der Regler: ein Schritt, damit gleichzeitige Klicks auf zwei Geräten zusammenzählen. */
    override fun changeQuantityUm(setNumber: String, schritt: Int) =
        changeQuantity(setNumber) { sets.changeQuantityUm(setNumber, schritt) }

    private fun changeQuantity(setNumber: String, call: suspend () -> Ergebnis<Int?>) {
        viewModelScope.launch {
            when (val r = call()) {
                is Ergebnis.Erfolg -> {
                    r.data?.let { echt ->
                        _setDetailState.update { st ->
                            if (st.setDetail?.setNumber == setNumber)
                                st.copy(setDetail = st.setDetail.copy(quantity = echt)) else st
                        }
                    }
                }
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r)?.let { meldungen.text(R.string.vm_error, it) })
            }
        }
    }

    /** Lagerort des Sets, entprellt; massgeblich ist der normalisierte Ort aus der Antwort. */
    override fun setSetLocation(setNumber: String, ort: String) {
        storageJob?.cancel()
        storageJob = viewModelScope.launch {
            delay(Alarmeingabe.RUHE_MS)
            when (val r = sets.setSetStorage(setNumber, ort)) {
                is Ergebnis.Erfolg -> Unit
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    fun deleteSet(setNumber: String) {
        viewModelScope.launch {
            meldungen.zeige(setLoeschen(sets, meldungen, setNumber).second)
        }
    }

    override fun loadInstructionHigh(setNumber: String, datei: FileRef) {
        viewModelScope.launch {
            val gelesen = reader.readAtMost(datei, INSTRUCTION_MAX_BYTES)
            if (gelesen == Gelesen.ToLarge) {
                meldungen.zeige(meldungen.text(R.string.csv_upload_too_big, INSTRUCTION_MAX_BYTES / 1024 / 1024))
                return@launch
            }
            val typ = (gelesen as? Gelesen.Inhalt)?.typ
            if (gelesen !is Gelesen.Inhalt || typ == null) { meldungen.zeige(meldungen.text(R.string.csv_upload_unreadable)); return@launch }
            if (typ !in INSTRUCTION_TYPES) { meldungen.zeige(meldungen.text(R.string.instr_upload_wrong_type)); return@launch }
            val bytes = gelesen.bytes
            val name = reader.name(datei) ?: "anleitung"
            when (val r = dateien.uploadInstruction(setNumber, name, typ, bytes, name)) {
                is Ergebnis.Erfolg -> {
                    meldungen.zeige(meldungen.text(R.string.instr_upload_done))
                    loadDetail()
                }
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    override fun loescheAnleitung(setNumber: String, instrId: Int) {
        viewModelScope.launch {
            when (val r = dateien.deleteAnleitung(setNumber, instrId)) {
                is Ergebnis.Erfolg -> loadDetail()
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    private fun reset() {
        storageJob?.cancel()
        laufend.values.forEach { it.cancel() }
        laufend.clear()
        _setDetailState.value = SetDetailUiState()
    }

    private enum class Abschnitt { DETAIL, PRICE, HISTORY, PURCHASES, ALERTS }

    private companion object {
        const val ARG_SET = "setNumber"
    }
}

/** So lange bleibt die Vorschau nach dem letzten Beobachter abonniert (Drehen des Geräts). */
private const val PREVIEW_HOLD_MS = 5_000L
