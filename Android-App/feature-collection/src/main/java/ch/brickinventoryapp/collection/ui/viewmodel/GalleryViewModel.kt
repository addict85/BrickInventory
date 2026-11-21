package ch.brickinventoryapp.collection.ui.viewmodel

import ch.brickinventoryapp.state.ui.viewmodel.Observed
import ch.brickinventoryapp.state.ui.viewmodel.loadPerServer
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.domain.Setsortierung
import ch.brickinventoryapp.session.abgeleitet
import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.model.domain.MetricsView
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.FinancesRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.data.repository.Kontosicht
import ch.brickinventoryapp.collection.ui.Galerie
import ch.brickinventoryapp.collection.ui.GalleryUiState
import ch.brickinventoryapp.collection.ui.TilePrice
import ch.brickinventoryapp.collection.ui.tilePrices
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.state.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.state.ui.viewmodel.Meldungen
import ch.brickinventoryapp.state.ui.viewmodel.Texte
import ch.brickinventoryapp.state.ui.viewmodel.sequenceSignOut

/**
 * The set collection: list, filters, key figures.
 *
 * The flows (debouncing, switching source) live in [Galerie]; this
 * ViewModel chooses the source: the store, or, over selected accounts, the account view.
 * Search, theme and sorting live in the [SavedStateHandle].
 */
@HiltViewModel
class GalleryViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val changes: Bestandsabgleich,
    private val scrollMemory: ScrollMemory,
    private val sets: SetsRepository,
    private val kontosicht: Kontosicht,
    private val finanzen: FinancesRepository,
    private val gemerkt: SavedStateHandle,
) : ViewModel(), Filterwahl by filter {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        sequenceSignOut(sitzung) { reset() }
        // The key figures are computed by the server from the stock; if it changes in the store, they are no longer correct.
        viewModelScope.launch { changes.inventoryChanged().collect { loadStats() } }
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

    /** For selected accounts only the server computes the quantities; otherwise the store applies. */
    private fun accountQuery(g: GalleryUiState): Kontosicht.SetsQuery? =
        filter.accountFor(ScopeFilter.View.GALLERY)?.let {
            Kontosicht.SetsQuery(it, g.galleryQuery.ifBlank { null }, g.galleryTheme.ifBlank { null }, g.gallerySort,
                filter.storageFor(ScopeFilter.View.GALLERY)?.ifBlank { null })
        }

    private val galerie = Galerie(
        scope = viewModelScope,
        quelle = { g ->
            accountQuery(g)?.let { kontosicht.galerie.observe(it) }
                ?: sets.observeSets(g.galleryQuery, g.galleryTheme, filter.storageFor(ScopeFilter.View.GALLERY), g.gallerySort)
        },
        refresh = { g -> accountQuery(g)?.let { kontosicht.galerie.refresh(it) } ?: sets.aktualisiereSets() },
        fetchMetrics = { finanzen.getStats(filter.accountFor(ScopeFilter.View.GALLERY)) },
        reportError = { meldungen.zeige(meldungen.meldungFuerSnackbar(it)) },
        vergissScroll = { scrollMemory.vergiss("gallery") },
    )
    /** A deleted set that can still be brought back — the snackbar's „Rückgängig“. */
    data class ReservedDelete(val setNumber: String, val name: String, val set: SetAnsicht? = null)

    private val _reserved = MutableStateFlow<ReservedDelete?>(null)
    val vorgemerkt: StateFlow<ReservedDelete?> = _reserved.asStateFlow()

    /**
     * The gallery without the set pending deletion: the store keeps it until the
     * server deletion completes, and „Rückgängig“ brings it back this way without a reload.
     */
    private val galleryObserved = Observed(galerie.state
        .abgeleitet(_reserved) { st, v ->
            // The key figures likewise: next to two tiles there would otherwise still be „3 Sets“.
            if (v == null) st else st.copy(sets = st.sets.filterNot { it.setNumber == v.setNumber },
                stats = st.stats?.let { k -> v.set?.let { withoutSet(k, it) } ?: k })
        })
    val galleryState: StateFlow<GalleryUiState> = galleryObserved

    private val _prices = MutableStateFlow<Map<String, TilePrice>>(emptyMap())
    /** Market price and P&L per set; its own flow because it arrives after the list. */
    val preise: StateFlow<Map<String, TilePrice>> = _prices.asStateFlow()

    init {
        galerie.placeFilterAgain(
            suche = gemerkt[SEARCH] ?: "",
            thema = gemerkt[THEME] ?: "",
            sorting = Setsortierung.aus(gemerkt[SORTING]),
        )
        loadPerServer(sitzung, galleryObserved) { loadIfEmpty() }
    }

    fun loadSets() = galerie.laden()

    /**
     * On show (loadPerServer): load when the gallery is empty and a server
     * is configured; a failure at startup is thus retried on the next visit.
     */
    fun loadIfEmpty() {
        val g = galerie.state.value
        if (sitzung.state.value.serverUrl.isBlank() || g.sets.isNotEmpty() || g.abruf.laedt) return
        loadSets()
        loadStats()
    }
    fun loadStats() {
        galerie.loadMetrics()
        loadPrices()
    }

    /**
     * Price and P&L for the tiles. If the fetch fails, the old
     * values remain and the tile falls back to the purchase price; the tab's
     * error comes from the list, not from this addition.
     */
    private fun loadPrices() {
        viewModelScope.launch {
            val r = finanzen.getPnl(filter.accountFor(ScopeFilter.View.GALLERY))
            if (r is Ergebnis.Erfolg) _prices.value = tilePrices(r.data.sets)
        }
    }

    fun setGalleryQuery(q: String) {
        gemerkt[SEARCH] = q
        galerie.setzeSuche(q)
    }

    fun setGalleryTheme(theme: String) {
        gemerkt[THEME] = theme
        galerie.setzeThema(theme)
    }

    fun setGallerySort(sort: Setsortierung) {
        gemerkt[SORTING] = sort.kennung
        galerie.setzeSortierung(sort)
    }

    /**
     * Pull-to-refresh: list, key figures and the filter lists. If their
     * single fetch at startup had failed, account and storage filters would otherwise be missing until the
     * next start.
     */
    fun aktualisieren() {
        loadSets()
        loadStats()
        viewModelScope.launch {
            filter.loadMembers()
            filter.ladeLagerorte()
        }
    }

    /**
     * Delete with „Rückgängig“: the tile disappears right away, the server learns
     * of it only with [executeDelete] — a confirmation prompt alone did not protect against
     * deleting the wrong set. A still-pending earlier deletion is carried out first.
     */
    fun loeschenVormerken(setNumber: String, name: String) {
        executeDelete()
        val set = galerie.state.value.sets.firstOrNull { it.setNumber == setNumber }
        _reserved.value = ReservedDelete(setNumber, name, set)
    }

    /**
     * The set pending deletion remains; it was in the store the whole time.
     * [nur]: only this one — the snackbar of a superseded deletion does not bring back the next one.
     */
    fun rueckgaengig(nur: ReservedDelete? = null) {
        val v = _reserved.value ?: return
        if (nur != null && v != nur) return
        _reserved.value = null
    }

    /**
     * [nur]: only this one. When the snackbar of a superseded deletion ends, it must not
     * carry out the new one — otherwise it would be deleted without „Rückgängig“.
     */
    fun executeDelete(nur: ReservedDelete? = null) {
        val v = _reserved.value ?: return
        if (nur != null && v != nur) return
        _reserved.value = null
        deleteSet(v.setNumber, successReport = false)
    }

    /** [successReport] off, when „gelöscht“ was already in the snackbar together with „Rückgängig“. */
    fun deleteSet(setNumber: String, successReport: Boolean = true) {
        viewModelScope.launch {
            val (geloescht, satz) = setLoeschen(sets, meldungen, setNumber)
            if (!geloescht || successReport) meldungen.zeige(satz)
        }
    }

    private fun afterFilter(view: ScopeFilter.View) {
        if (view != ScopeFilter.View.GALLERY) return
        loadSets()
        loadStats()
    }

    private fun reset() {
        galerie.reset()
        _prices.value = emptyMap()
        gemerkt[SEARCH] = ""
        gemerkt[THEME] = ""
        gemerkt[SORTING] = Setsortierung.DEFAULT.kennung
    }

    private companion object {
        const val SEARCH = "galerie_suche"
        const val THEME = "galerie_thema"
        const val SORTING = "galerie_sortierung"
    }
}

/** The key figures without [set] — for as long as its deletion is pending. */
internal fun withoutSet(k: MetricsView, set: SetAnsicht): MetricsView {
    val teile = (set.pieces ?: 0) * set.quantity
    return k.copy(
        totalSets = (k.totalSets - 1).coerceAtLeast(0),
        totalQuantity = (k.totalQuantity - set.quantity).coerceAtLeast(0),
        totalParts = (k.totalParts - teile).coerceAtLeast(0),
        partsFromSets = k.partsFromSets?.let { (it - teile).coerceAtLeast(0) },
        totalMinifigs = (k.totalMinifigs - (set.minifigs ?: 0) * set.quantity).coerceAtLeast(0),
        totalInstructions = (k.totalInstructions - set.instructions.size).coerceAtLeast(0),
    )
}

/**
 * Delete a set: success, and the sentence for the message channel. Shared with
 * the set detail, which offers the same path.
 */
internal suspend fun setLoeschen(sets: SetsRepository, texts: Texte, setNumber: String, name: String = setNumber): Pair<Boolean, String?> =
    when (val r = sets.deleteSet(setNumber)) {
        is Ergebnis.Erfolg -> true to texts.text(R.string.vm_set_deleted, name)
        is Ergebnis.Fehler -> false to texts.meldungFuerSnackbar(r)
    }
