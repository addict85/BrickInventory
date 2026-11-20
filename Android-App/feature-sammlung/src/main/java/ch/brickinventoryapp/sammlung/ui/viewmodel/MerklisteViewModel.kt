package ch.brickinventoryapp.sammlung.ui.viewmodel

import ch.brickinventoryapp.zustand.ui.viewmodel.Observed
import ch.brickinventoryapp.zustand.ui.viewmodel.observeLoadOn
import kotlinx.coroutines.flow.first
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.data.repository.WantedRepository
import ch.brickinventoryapp.model.fach.Merksortierung
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.SharingStarted
import ch.brickinventoryapp.model.lokal.Local
import ch.brickinventoryapp.model.fach.WantedItemView
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.sitzung.abgeleitet
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.CatalogRepository
import ch.brickinventoryapp.data.repository.FinancesRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.Kontosicht
import ch.brickinventoryapp.sammlung.ui.WantedUiState
import ch.brickinventoryapp.sammlung.ui.WantedItemDetailUiState
import ch.brickinventoryapp.sammlung.ui.Preisalarmeingabe
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.zustand.ui.errorClass
import ch.brickinventoryapp.zustand.ui.errorMessage
import ch.brickinventoryapp.model.ui.Laden
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.sitzung.AppUiState
import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.zustand.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen
import ch.brickinventoryapp.zustand.ui.viewmodel.Texte
import ch.brickinventoryapp.zustand.ui.viewmodel.sequenceSignOut

/**
 * Merkliste und Merkposten-Detail — was man haben möchte, getrennt vom Besitz.
 *
 * Wie ein Merkposten angelegt, übernommen oder gefiltert wird, entscheidet der
 * Server (utils/merkliste.ts); hier wird nur gefragt und gezeigt. Suche,
 * Zustand und Sortierung stehen im [SavedStateHandle].
 */
@HiltViewModel
class MerklisteViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val merkliste: WantedRepository,
    private val alerts: AlarmRepository,
    private val kontosicht: Kontosicht,
    private val catalogRepo: CatalogRepository,
    private val finanzen: FinancesRepository,
    private val gemerkt: SavedStateHandle,
) : ViewModel(), Filterwahl by filter, MerklisteAktionen {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        sequenceSignOut(sitzung) { reset() }
    }

    override fun setScope(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setAccount(view, value)
            afterFilter(view)
        }
    }

    override fun setStorageFilter(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setzeLager(view, value)
            afterFilter(view)
        }
    }

    private val _wantedState = MutableStateFlow(WantedUiState(
        query = gemerkt[SEARCH] ?: "",
        stateFilter = Zustand.aus(gemerkt[STATE]),
        sorting = Merksortierung.aus(gemerkt[SORTING]),
    ))
    /** Ein Merkposten, der erst gelöscht wird, wenn die Snackbar ohne „Rückgängig“ endet. */
    data class ReservedWantedItem(val setNumber: String, val zustand: Zustand, val besitzer: Int?, val name: String)

    private val _reserved = MutableStateFlow<ReservedWantedItem?>(null)
    val vorgemerkt: StateFlow<ReservedWantedItem?> = _reserved.asStateFlow()

    /** Die Quelle der Liste für die eingestellten Filter; [loadWanted] wählt sie. */
    private val quelle = MutableStateFlow<Flow<Local<WantedItemView>>>(flowOf(Local(emptyList(), null)))

    @OptIn(ExperimentalCoroutinesApi::class)
    private val liste: StateFlow<Local<WantedItemView>?> =
        quelle.flatMapLatest { it }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /**
     * Die Liste zeigt nur die Quelle — die Ablage, über gewählte Konten die Kontosicht —,
     * auch offline Angelegtes oder Gelöschtes sofort. Der vorgemerkte Posten fehlt darin.
     */
    val wantedState: StateFlow<WantedUiState> = _wantedState
        .abgeleitet(liste) { st, l ->
            if (l?.stand != null) st.copy(merkposten = l.liste) else st
        }
        .abgeleitet(_reserved) { st, v ->
            if (v == null) st else st.copy(merkposten = st.merkposten.filterNot { it.setNumber == v.setNumber && it.condition == v.zustand })
        }

    init {
        // Wer die Liste zeigt, bekommt sie frisch; die Quelle danach folgt der Ablage selbst.
        observeLoadOn(_wantedState) { loadWanted() }
    }

    private val _wantedItemDetailState = MutableStateFlow(WantedItemDetailUiState())
    val wantedItemDetailState: StateFlow<WantedItemDetailUiState> = _wantedItemDetailState.asStateFlow()

    // Ein eigener Auftrag für die Suche: Ein neuer Tastendruck bricht den
    // wartenden Abruf ab, geladen wird erst nach der Pause.
    private var suchJob: Job? = null

    private fun accountQuery(f: WantedUiState): Kontosicht.RememberQuery? =
        filter.accountFor(ScopeFilter.View.MERKLISTE)?.let {
            Kontosicht.RememberQuery(it, f.query.trim().ifBlank { null }, f.stateFilter, f.sorting)
        }

    private val alarmInput = Preisalarmeingabe(
        scope = viewModelScope, alerts = alerts,
        melde = { meldungen.zeige(it) },
        describe = { meldungen.meldungFuerSnackbar(it) },
        gespeichert = { sn -> if (_wantedItemDetailState.value.setNumber == sn) loadPreisalarme(sn) },
    )

    override fun loadWanted() {
        viewModelScope.launch {
            val f = _wantedState.value
            _wantedState.update { it.copy(abruf = Laden.Loads) }
            val konto = accountQuery(f)
            quelle.value = konto?.let { kontosicht.merkliste.observe(it) }
                ?: merkliste.observeWanted(f.query.trim().ifBlank { null }, f.stateFilter, f.sorting)
            // Der Abruf füllt nur die Quelle; gezeigt wird sie (wantedState).
            val r = konto?.let { kontosicht.merkliste.refresh(it) } ?: merkliste.refreshWanted()
            when (r) {
                is Ergebnis.Erfolg -> _wantedState.update { it.copy(abruf = Laden.Daten(Unit, r.stand)) }
                is Ergebnis.Fehler -> {
                    _wantedState.update { it.copy(abruf = Laden.Fehler(errorClass(r), errorMessage(r))) }
                    meldungen.zeige(meldungen.meldungFuerSnackbar(r)?.let { meldungen.text(R.string.vm_error, it) })
                }
            }
        }
    }

    override fun setWantedSearch(q: String) {
        gemerkt[SEARCH] = q
        _wantedState.update { it.copy(query = q) }
        suchJob?.cancel()
        suchJob = viewModelScope.launch {
            delay(SUCHPAUSE_MS)
            loadWanted()
        }
    }

    override fun setWantedState(zustand: Zustand?) {
        gemerkt[STATE] = zustand?.kennung
        _wantedState.update { it.copy(stateFilter = zustand) }
        loadWanted()
    }

    override fun setWantedSorting(sorting: Merksortierung) {
        gemerkt[SORTING] = sorting.kennung
        _wantedState.update { it.copy(sorting = sorting) }
        loadWanted()
    }

    override fun legeMerkpostenAn(setNumber: String, zustand: Zustand, besitzer: Int?) {
        val nummer = setNumber.trim()
        if (nummer.isBlank()) { meldungen.zeige(meldungen.text(R.string.wanted_need_number)); return }
        viewModelScope.launch {
            meldungen.zeige(createWantedItem(merkliste, meldungen, nummer, zustand, besitzer))
        }
    }

    override fun moveWantedItem(setNumber: String, zustand: Zustand, ofId: Int, toId: Int) {
        if (ofId == toId) return
        viewModelScope.launch {
            when (val r = merkliste.moveWantedItem(setNumber, zustand, ofId, toId)) {
                is Ergebnis.Erfolg -> {
                    meldungen.zeige(meldungen.text(
                        if (r.data) R.string.wanted_already else R.string.vm_saved))
                }
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r)?.let { meldungen.text(R.string.vm_error, it) })
            }
        }
    }

    /**
     * Löschen mit „Rückgängig“ wie in der Galerie: Der Posten verschwindet sofort, der
     * Server erfährt es erst mit [executeWantedItemDelete]. Mit ihm gingen Schwelle,
     * Richtung und „auf der Liste seit“ verloren. Ein früher vorgemerkter wird zuerst gelöscht.
     */
    override fun deleteWantedItem(setNumber: String, zustand: Zustand, besitzer: Int?) {
        executeWantedItemDelete()
        // Die gezeigte Liste, nicht die rohe: Ohne Filter steht der Posten nur in der Ablage.
        val name = wantedState.value.merkposten
            .firstOrNull { it.setNumber == setNumber && it.condition == zustand }?.name ?: setNumber
        _reserved.value = ReservedWantedItem(setNumber, zustand, besitzer, name)
    }

    /** Der vorgemerkte Posten bleibt; er stand die ganze Zeit in der Quelle. */
    fun wantedItemUndo(nur: ReservedWantedItem? = null) {
        if (_reserved.value == null || (nur != null && _reserved.value != nur)) return
        _reserved.value = null
    }

    /** [nur]: nur diesen Posten — eine abgelöste Snackbar führt nicht den nächsten aus. */
    fun executeWantedItemDelete(nur: ReservedWantedItem? = null) {
        val v = _reserved.value ?: return
        if (nur != null && v != nur) return
        _reserved.value = null
        viewModelScope.launch {
            when (val r = merkliste.deleteWantedItem(v.setNumber, v.zustand, v.besitzer)) {
                // „genommen“ stand schon in der Snackbar mit „Rückgängig“; die Ablage hat ihn nicht mehr.
                is Ergebnis.Erfolg -> Unit
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r)?.let { meldungen.text(R.string.vm_error, it) })
            }
        }
    }

    /** Aus dem Merkposten wird Besitz; der Server entscheidet, was mit Eintrag und Alarm geschieht. */
    override fun adoptWantedItem(
        setNumber: String, zustand: Zustand, besitzer: Int?,
        anzahl: Int, purchasePriceRaw: String, recordedAs: Zustand?,
        lagerort: String?,
    ) {
        viewModelScope.launch {
            val preis = Alarmeingabe.zahl(purchasePriceRaw)
            when (val r = merkliste.adoptWantedItem(setNumber, zustand, anzahl, preis,
                                                   recordedAs, besitzer,
                                                   lagerort?.trim()?.takeIf { it.isNotEmpty() })) {
                is Ergebnis.Erfolg -> {
                    meldungen.zeige(meldungen.text(
                        if (r.data) R.string.wanted_taken_existing
                        else R.string.wanted_taken))
                }
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r)?.let { meldungen.text(R.string.vm_error, it) })
            }
        }
    }

    /** Katalogdaten, Preise und Verlauf eines Merkpostens — je für sich, was fehlt, bleibt leer. */
    override fun wantedItemDetailOf(setNumber: String): StateFlow<WantedItemDetailUiState> =
        Observed(wantedItemDetailState) { loadWantedItemDetail(setNumber) }

    override fun loadWantedItemDetail(setNumber: String) {
        viewModelScope.launch {
            _wantedItemDetailState.value = WantedItemDetailUiState(setNumber = setNumber, abruf = Laden.Loads)
            if (wantedState.value.merkposten.isEmpty()) loadWanted()
            loadPreisalarme(setNumber)
            val katalog = (catalogRepo.getCatalogSetDetail(setNumber) as? Ergebnis.Erfolg)?.data
            _wantedItemDetailState.update { it.copy(katalog = katalog) }
            val preise = (merkliste.getWantedItemPrices(setNumber) as? Ergebnis.Erfolg)?.data
            _wantedItemDetailState.update { it.copy(preise = preise) }
            val history = (finanzen.getSetPriceHistory(setNumber) as? Ergebnis.Erfolg)?.data
            _wantedItemDetailState.update { it.copy(history = history, abruf = Laden.Daten(Unit)) }
        }
    }

    fun loadPreisalarme(setNumber: String) {
        viewModelScope.launch {
            alerts.refreshAlerts()
            val liste = alerts.observeAlerts(setNumber).first().liste
            _wantedItemDetailState.update { if (it.setNumber == setNumber) it.copy(preisalarme = liste) else it }
        }
    }

    override fun setPriceAlert(setNumber: String, richtung: Alarmrichtung, roh: String, zustand: Zustand) =
        alarmInput.setze(setNumber, richtung, roh, zustand)

    private fun afterFilter(view: ScopeFilter.View) {
        if (view == ScopeFilter.View.MERKLISTE) loadWanted()
    }

    private fun reset() {
        suchJob?.cancel()
        quelle.value = flowOf(Local(emptyList(), null))
        _wantedState.value = WantedUiState()
        _wantedItemDetailState.value = WantedItemDetailUiState()
    }

    private companion object {
        const val SEARCH = "merkliste_suche"
        const val STATE = "merkliste_zustand"
        const val SORTING = "merkliste_sortierung"
        const val SUCHPAUSE_MS = 350L
    }
}

/**
 * Einen Merkposten anlegen und sagen, was daraus wurde. Geteilt mit der
 * Erfassung: Ein Scan aus der Merkliste heraus legt ebenfalls einen an.
 */
internal suspend fun createWantedItem(
    merkliste: WantedRepository, texts: Texte, setNumber: String, zustand: Zustand, besitzer: Int?,
): String? = when (val r = merkliste.legeMerkpostenAn(setNumber, zustand, besitzer)) {
    is Ergebnis.Erfolg -> texts.text(if (r.data) R.string.wanted_added else R.string.wanted_already)
    is Ergebnis.Fehler -> texts.meldungFuerSnackbar(r)?.let { texts.text(R.string.vm_error, it) }
}
