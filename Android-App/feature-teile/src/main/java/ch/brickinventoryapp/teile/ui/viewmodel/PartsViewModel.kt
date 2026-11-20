package ch.brickinventoryapp.teile.ui.viewmodel

import ch.brickinventoryapp.model.fach.Kategoriewahl
import ch.brickinventoryapp.model.fach.ColorPicker
import ch.brickinventoryapp.model.fach.Teilerfassung
import ch.brickinventoryapp.model.fach.Zustand
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.data.repository.Kontosicht
import ch.brickinventoryapp.teile.ui.Teile
import ch.brickinventoryapp.teile.ui.PartsLocal
import ch.brickinventoryapp.teile.ui.PartsSource
import ch.brickinventoryapp.teile.ui.PartsUiState
import ch.brickinventoryapp.teile.ui.Teilefilter
import ch.brickinventoryapp.teile.ui.SetItemFlow
import ch.brickinventoryapp.teile.ui.SetItemUiState
import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.zustand.ui.viewmodel.Observed
import ch.brickinventoryapp.zustand.ui.viewmodel.Loeschvormerkung
import ch.brickinventoryapp.zustand.ui.viewmodel.loadPerServer
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.zustand.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen
import ch.brickinventoryapp.zustand.ui.viewmodel.sequenceSignOut
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.ui.ListView
import ch.brickinventoryapp.teile.ui.PartsSessionUiState
import ch.brickinventoryapp.sitzung.abgeleitet

/**
 * Der Teile-Reiter: Liste, Filter, Erfassen und Ändern manueller Teile, dazu der Dialog
 * „in welchen Sets steckt dieses Teil“. Die Figuren haben ihr eigenes [MinifigsViewModel].
 *
 * Der [Teilefilter] liegt im [SavedStateHandle] und übersteht den Prozesstod; Konto und
 * Lagerort nicht, die gelten nur im Speicher (Blickfeld).
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
     * Konto und Lagerort teilen die Mengen auf, „In Sets“ zählt die Tabelle: Das
     * rechnet nur der Server (Kontosicht). Sonst gilt die Ablage.
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

    /** Jede Quelle füllen, die der Zustand zeigt; die Tabelle allein lässt die manuellen in der Ablage. */
    private suspend fun refreshParts(st: PartsUiState): Ergebnis<Unit> {
        val liste = partsQuery(st) ?: return repo.refreshParts()
        val r = kontosicht.teileliste.refresh(liste)
        if (r is Ergebnis.Fehler) return r
        return manualQuery(st)?.let { kontosicht.manuelleTeile.refresh(it) } ?: repo.refreshManualParts()
    }

    /** Ein manuelles Teil, das erst gelöscht wird, wenn die Snackbar ohne „Rückgängig“ endet. */
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

    // Entprellt wie der Preisalarm: Wer „Kiste 3“ tippt, soll nicht fünf halbe
    // Orte im Vorrat hinterlassen, und der Auftrag überlebt das Zurückgehen.
    private var storageJob: Job? = null

    init {
        // Die Liste folgt der Ablage selbst; die Kennzahlen rechnet der Server darüber.
        viewModelScope.launch { changes.partsChanged().collect { teile.loadMetrics() } }
        gemerkt.get<Teilefilter>(F_FILTER)?.let(teile::placeFilterAgain)
        // Wer den Reiter oder ein Einzelstück zeigt, bekommt Liste, Farbkatalog und Filterlisten;
        // die beiden Filterlisten kommen von zwei Adressen (PartsApi.getPartsFilterColors).
        loadPerServer(sitzung, partsObserved) { loadParts(); loadPartsColors(); loadPartsFilters() }
    }

    // ── Liste und Filter ─────────────────────────────────────────────────────

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

    // ── Erfassen und Ändern ──────────────────────────────────────────────────

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
     * Die Farbe eines manuellen Teils ändern. Die Farbe ist Teil des Schlüssels
     * und der Route der Detailansicht — [onFertig] öffnet sie mit der neuen.
     */
    override fun setzeTeilFarbe(partNumber: String, colorId: Int, neueFarbe: Int,
                       farbName: String?, farbHex: String?,
                       owner: Int?, onFertig: (Int) -> Unit) {
        if (neueFarbe == colorId) return
        aendere(meldungen, meldungen.text(R.string.vm_saved), danach = { onFertig(neueFarbe) }) {
            repo.setPartColor(partNumber, colorId, neueFarbe, farbName, farbHex, owner)
        }
    }

    // ── „In welchen Sets steckt das?“ ────────────────────────────────────────

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
