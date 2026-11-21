package ch.brickinventoryapp.parts.ui.viewmodel

import ch.brickinventoryapp.model.domain.Kategoriewahl
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.Teilerfassung
import ch.brickinventoryapp.model.domain.Zustand
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.data.repository.Kontosicht
import ch.brickinventoryapp.parts.ui.Teile
import ch.brickinventoryapp.parts.ui.PartsLocal
import ch.brickinventoryapp.parts.ui.PartsSource
import ch.brickinventoryapp.parts.ui.PartsUiState
import ch.brickinventoryapp.parts.ui.Teilefilter
import ch.brickinventoryapp.parts.ui.SetItemFlow
import ch.brickinventoryapp.parts.ui.SetItemUiState
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.state.ui.viewmodel.Observed
import ch.brickinventoryapp.state.ui.viewmodel.Loeschvormerkung
import ch.brickinventoryapp.state.ui.viewmodel.loadPerServer
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.state.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.state.ui.viewmodel.Meldungen
import ch.brickinventoryapp.state.ui.viewmodel.sequenceSignOut
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.ui.ListView
import ch.brickinventoryapp.parts.ui.PartsSessionUiState
import ch.brickinventoryapp.session.abgeleitet

/**
 * The parts tab: list, filter, entering and editing manual parts, plus the dialog
 * "which sets is this part in". The figures have their own [MinifigsViewModel].
 *
 * The [Teilefilter] lives in the [SavedStateHandle] and survives a process death; account and
 * storage location do not, they apply only in memory (the view).
 */
@HiltViewModel
class PartsViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val changes: Bestandsabgleich,
    private val scrollMemory: ScrollMemory,
    private val repo: PartsRepository,
    private val kontosicht: Kontosicht,
    private val gemerkt: SavedStateHandle,
) : ViewModel(), Filterwahl by filter, TeileAktionen, WithSetItem {

    internal val state: StateFlow<PartsSessionUiState> =
        sitzung.state.abgeleitet { PartsSessionUiState(it.serverUrl, it.currency, it.userDefaultCondition) }

    init {
        sequenceSignOut(sitzung) { reset() }
    }

    override fun setScope(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setAccount(view, value)
            if (view == ScopeFilter.View.PARTS) loadParts()
        }
    }

    override fun setStorageFilter(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setzeLager(view, value)
            if (view == ScopeFilter.View.PARTS) loadParts()
        }
    }

    private val partsAccount get() = filter.accountFor(ScopeFilter.View.PARTS)
    private val partsStorage get() = filter.storageFor(ScopeFilter.View.PARTS)?.ifBlank { null }

    /**
     * Account and storage location split the quantities, "In Sets" counts the table: only
     * the server computes that (account view). Otherwise the store applies.
     */
    private fun partsQuery(st: PartsUiState): Kontosicht.PartsQuery? {
        val f = st.filter
        return if (partsAccount == null && partsStorage == null && f.ansicht != ListView.TABLE) null
        else Kontosicht.PartsQuery(partsAccount, f.suche.ifBlank { null }, f.farbe,
            f.kategorie, f.ersatz, f.ansicht == ListView.TABLE, partsStorage)
    }

    private fun manualQuery(st: PartsUiState): Kontosicht.ManualQuery? =
        if (partsAccount == null && partsStorage == null) null
        else Kontosicht.ManualQuery(partsAccount, st.filter.suche.ifBlank { null }, partsStorage)

    private val teile = Teile(
        scope = viewModelScope,
        quelle = object : PartsSource {
            override suspend fun partsMetrics() = repo.getPartsStats(partsAccount)
            override suspend fun filterColors() = repo.getPartsFilterColors(partsAccount)
            override suspend fun kategorien() = repo.getPartsCategories(partsAccount)
            override suspend fun allColors() = repo.getBrickColors()
        },
        reportError = { meldungen.zeige(meldungen.meldungFuerSnackbar(it)) },
        vergissScroll = { scrollMemory.vergiss("parts") },
        listen = PartsLocal(
            teile = { st -> partsQuery(st)?.let { kontosicht.teileliste.observe(it) }
                ?: st.filter.let { f -> repo.observeParts(f.suche, f.farbe, f.kategorie, f.ersatz) } },
            manuelleTeile = { st -> manualQuery(st)?.let { kontosicht.manuelleTeile.observe(it) }
                ?: repo.observeManualParts(st.filter.suche) },
            refresh = { st -> refreshParts(st) },
        ),
        filterChanged = { gemerkt[F_FILTER] = it },
    )

    /** Fill every source the state shows; the table alone leaves the manual ones in the store. */
    private suspend fun refreshParts(st: PartsUiState): Ergebnis<Unit> {
        val liste = partsQuery(st) ?: return repo.refreshParts()
        val r = kontosicht.teileliste.refresh(liste)
        if (r is Ergebnis.Fehler) return r
        return manualQuery(st)?.let { kontosicht.manuelleTeile.refresh(it) } ?: repo.refreshManualParts()
    }

    /** A manual part that is only deleted once the snackbar ends without „Rückgängig“. */
    data class ReservedPart(val partNumber: String, val colorId: Int, val owner: Int?, val name: String)

    val loeschen = Loeschvormerkung<ReservedPart>(viewModelScope) { v ->
        val r = repo.deletePart(v.partNumber, v.colorId, v.owner)
        if (r is Ergebnis.Fehler) meldungen.zeige(meldungen.meldungFuerSnackbar(r))
    }

    private val partsObserved = Observed(teile.state.abgeleitet(loeschen.wert) { st, v ->
        if (v == null) st else st.copy(manualParts = st.manualParts?.filterNot {
            it.partNumber == v.partNumber && it.colorId == v.colorId && (v.owner == null || it.userId == v.owner) })
    })
    val teileState: StateFlow<PartsUiState> = partsObserved

    private val inSets = SetItemFlow(viewModelScope, Postenart.PART,
        abfrage = { nummer, farbe -> repo.getSetsWithPart(nummer, farbe, partsAccount) },
        afterHeader = filter::loadLocationStock)
    override val setItemState: StateFlow<SetItemUiState> = inSets.zustand

    // Debounced like the price alert: whoever types "Kiste 3" should not leave five half
    // locations in the supply, and the job survives navigating back.
    private var storageJob: Job? = null

    init {
        // The list follows the store itself; the server computes the key figures from it.
        viewModelScope.launch { changes.partsChanged().collect { teile.loadMetrics() } }
        gemerkt.get<Teilefilter>(F_FILTER)?.let(teile::placeFilterAgain)
        // Whoever shows the tab or a single item gets the list, color catalog and filter lists;
        // the two filter lists come from two addresses (PartsApi.getPartsFilterColors).
        loadPerServer(sitzung, partsObserved) { loadParts(); loadPartsColors(); loadPartsFilters() }
    }

    // ── List and filter ─────────────────────────────────────────────────────

    override fun loadParts(page: Int, debounce: Boolean) = teile.laden(seite = page, debounced = debounce)
    fun loadPartsFilters() = teile.loadFilter()
    override fun loadPartsColors() = teile.loadColors()

    private fun filtere(aenderung: (Teilefilter) -> Teilefilter) = teile.setFilter(aenderung(teile.state.value.filter))
    override fun setPartsQuery(q: String) = filtere { it.copy(suche = q) }
    override fun setPartsSpare(wert: Ersatzteilwahl) = filtere { it.copy(ersatz = wert) }
    override fun setPartsView(wert: ListView) = filtere { it.copy(ansicht = wert) }
    override fun setPartsOrder(wert: Teilefilter.Order) = filtere { it.copy(order = wert) }
    override fun setPartsColorFilter(wert: ColorPicker) = filtere { it.copy(farbe = wert) }
    override fun setPartsCategoryFilter(wert: Kategoriewahl) = filtere { it.copy(kategorie = wert) }

    // ── Entering and editing ──────────────────────────────────────────────────

    override fun addPart(erfassung: Teilerfassung) {
        val e = erfassung
        viewModelScope.launch {
            when (val r = repo.addPart(e.nummer.trim(), e.farbId, e.farbname, e.farbHex, e.menge,
                                       e.stueckpreis, e.zustand, e.besitzer,
                                       e.lagerort?.trim()?.takeIf { it.isNotEmpty() })) {
                is Ergebnis.Erfolg -> meldungen.zeige(entryMessage(meldungen, r.data.angelegt, r.data.nummer, r.data.priceFromState))
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    override fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?,
                   condition: Zustand?, owner: Int?) =
        aendere(meldungen, meldungen.text(R.string.vm_saved)) {
            repo.updatePart(partNumber, colorId, quantity, unitPrice, condition, owner)
        }

    override fun partDeleteReserve(partNumber: String, colorId: Int, owner: Int?, name: String) =
        loeschen.reserve(ReservedPart(partNumber, colorId, owner, name))

    override fun deletePart(partNumber: String, colorId: Int, owner: Int?) =
        aendere(meldungen, meldungen.text(R.string.vm_part_deleted)) {
            repo.deletePart(partNumber, colorId, owner)
        }

    /**
     * Change a manual part's color. The color is part of the key
     * and the detail view's route — [onFertig] opens it with the new one.
     */
    override fun setzeTeilFarbe(partNumber: String, colorId: Int, neueFarbe: Int,
                       farbName: String?, farbHex: String?,
                       owner: Int?, onFertig: (Int) -> Unit) {
        if (neueFarbe == colorId) return
        aendere(meldungen, meldungen.text(R.string.vm_saved), danach = { onFertig(neueFarbe) }) {
            repo.setPartColor(partNumber, colorId, neueFarbe, farbName, farbHex, owner)
        }
    }

    // ── "Which sets is this in?" ────────────────────────────────────────

    override fun openSetItem(nummer: String, colorId: Int) = inSets.oeffne(nummer, colorId)

    override fun closeSetItem() = inSets.schliesse()

    override fun setPartLocation(nummer: String, farbe: Int, ort: String) {
        storageJob?.cancel()
        storageJob = viewModelScope.launch {
            delay(Alarmeingabe.RUHE_MS)
            when (val r = repo.setPartStorage(nummer, farbe, ort)) {
                is Ergebnis.Erfolg -> inSets.withLocation(r.data)
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    private fun reset() {
        storageJob?.cancel()
        teile.reset()
        inSets.schliesse()
        gemerkt.remove<Teilefilter>(F_FILTER)
    }

    private companion object {
        const val F_FILTER = "teile_filter"
    }
}
