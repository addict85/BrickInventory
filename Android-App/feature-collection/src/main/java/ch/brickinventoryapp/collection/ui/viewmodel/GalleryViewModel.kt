package ch.brickinventoryapp.collection.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.collection.ui.Gallery
import ch.brickinventoryapp.collection.ui.GalleryUiState
import ch.brickinventoryapp.collection.ui.TilePrice
import ch.brickinventoryapp.collection.ui.tilePrices
import ch.brickinventoryapp.data.repository.AccountView
import ch.brickinventoryapp.data.repository.FinancesRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.StockReconciliation
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.domain.MetricsView
import ch.brickinventoryapp.model.domain.SetSort
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.session.derived
import ch.brickinventoryapp.state.ui.viewmodel.FilterChoice
import ch.brickinventoryapp.state.ui.viewmodel.Messages
import ch.brickinventoryapp.state.ui.viewmodel.Observed
import ch.brickinventoryapp.state.ui.viewmodel.Texts
import ch.brickinventoryapp.state.ui.viewmodel.loadPerServer
import ch.brickinventoryapp.state.ui.viewmodel.logoutSequence
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * The set collection: list, filters, key figures.
 *
 * The flows (debouncing, switching source) live in [Gallery]; this
 * ViewModel chooses the source: the store, or, over selected accounts, the account view.
 * Search, theme and sorting live in the [SavedStateHandle].
 */
@HiltViewModel
class GalleryViewModel @Inject constructor(
    private val session: Session,
    private val filter: FilterChoice,
    private val messages: Messages,
    private val changes: StockReconciliation,
    private val scrollMemory: ScrollMemory,
    private val sets: SetsRepository,
    private val accountView: AccountView,
    private val finances: FinancesRepository,
    private val wanted: SavedStateHandle,
) : ViewModel(), FilterChoice by filter {

    val state: StateFlow<AppUiState> = session.state

    init {
        logoutSequence(session) { reset() }
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
            filter.applyStorage(view, value)
            afterFilter(view)
        }
    }

    /** For selected accounts only the server computes the quantities; otherwise the store applies. */
    private fun accountQuery(g: GalleryUiState): AccountView.SetsQuery? =
        filter.accountFor(ScopeFilter.View.GALLERY)?.let {
            AccountView.SetsQuery(it, g.galleryQuery.ifBlank { null }, g.galleryTheme.ifBlank { null }, g.gallerySort,
                filter.storageFor(ScopeFilter.View.GALLERY)?.ifBlank { null })
        }

    private val gallery = Gallery(
        scope = viewModelScope,
        source = { g ->
            accountQuery(g)?.let { accountView.gallery.observe(it) }
                ?: sets.observeSets(g.galleryQuery, g.galleryTheme, filter.storageFor(ScopeFilter.View.GALLERY), g.gallerySort)
        },
        refresh = { g -> accountQuery(g)?.let { accountView.gallery.refresh(it) } ?: sets.refreshSets() },
        fetchMetrics = { finances.getStats(filter.accountFor(ScopeFilter.View.GALLERY)) },
        reportError = { messages.show(messages.messageForSnackbar(it)) },
        forgetScroll = { scrollMemory.forgetNow("gallery") },
    )
    /** A deleted set that can still be brought back — the snackbar's „Rückgängig“. */
    data class ReservedDelete(val setNumber: String, val name: String, val set: SetView? = null)

    private val _reserved = MutableStateFlow<ReservedDelete?>(null)
    val marked: StateFlow<ReservedDelete?> = _reserved.asStateFlow()

    /**
     * The gallery without the set pending deletion: the store keeps it until the
     * server deletion completes, and „Rückgängig“ brings it back this way without a reload.
     */
    private val galleryObserved = Observed(gallery.state
        .derived(_reserved) { st, v ->
            // The key figures likewise: next to two tiles there would otherwise still be „3 Sets“.
            if (v == null) st else st.copy(sets = st.sets.filterNot { it.setNumber == v.setNumber },
                stats = st.stats?.let { k -> v.set?.let { withoutSet(k, it) } ?: k })
        })
    val galleryState: StateFlow<GalleryUiState> = galleryObserved

    private val _prices = MutableStateFlow<Map<String, TilePrice>>(emptyMap())
    /** Market price and P&L per set; its own flow because it arrives after the list. */
    val prices: StateFlow<Map<String, TilePrice>> = _prices.asStateFlow()

    init {
        gallery.placeFilterAgain(
            search = wanted[SEARCH] ?: "",
            theme = wanted[THEME] ?: "",
            sorting = SetSort.from(wanted[SORTING]),
        )
        loadPerServer(session, galleryObserved) { loadIfEmpty() }
    }

    fun loadSets() = gallery.load()

    /**
     * On show (loadPerServer): load when the gallery is empty and a server
     * is configured; a failure at startup is thus retried on the next visit.
     */
    fun loadIfEmpty() {
        val g = gallery.state.value
        if (session.state.value.serverUrl.isBlank() || g.sets.isNotEmpty() || g.fetch.loading) return
        loadSets()
        loadStats()
    }
    fun loadStats() {
        gallery.loadMetrics()
        loadPrices()
    }

    /**
     * Price and P&L for the tiles. If the fetch fails, the old
     * values remain and the tile falls back to the purchase price; the tab's
     * error comes from the list, not from this addition.
     */
    private fun loadPrices() {
        viewModelScope.launch {
            val r = finances.getPnl(filter.accountFor(ScopeFilter.View.GALLERY))
            if (r is Outcome.Success) _prices.value = tilePrices(r.data.sets)
        }
    }

    fun setGalleryQuery(q: String) {
        wanted[SEARCH] = q
        gallery.setSearch(q)
    }

    fun setGalleryTheme(theme: String) {
        wanted[THEME] = theme
        gallery.setTheme(theme)
    }

    fun setGallerySort(sort: SetSort) {
        wanted[SORTING] = sort.identifier
        gallery.setSort(sort)
    }

    /**
     * Pull-to-refresh: list, key figures and the filter lists. If their
     * single fetch at startup had failed, account and storage filters would otherwise be missing until the
     * next start.
     */
    fun refresh() {
        loadSets()
        loadStats()
        viewModelScope.launch {
            filter.loadMembers()
            filter.fetchStorageLocations()
        }
    }

    /**
     * Delete with „Rückgängig“: the tile disappears right away, the server learns
     * of it only with [executeDelete] — a confirmation prompt alone did not protect against
     * deleting the wrong set. A still-pending earlier deletion is carried out first.
     */
    fun markForDeletion(setNumber: String, name: String) {
        executeDelete()
        val set = gallery.state.value.sets.firstOrNull { it.setNumber == setNumber }
        _reserved.value = ReservedDelete(setNumber, name, set)
    }

    /**
     * The set pending deletion remains; it was in the store the whole time.
     * [only]: only this one — the snackbar of a superseded deletion does not bring back the next one.
     */
    fun undo(only: ReservedDelete? = null) {
        val v = _reserved.value ?: return
        if (only != null && v != only) return
        _reserved.value = null
    }

    /**
     * [only]: only this one. When the snackbar of a superseded deletion ends, it must not
     * carry out the new one — otherwise it would be deleted without „Rückgängig“.
     */
    fun executeDelete(only: ReservedDelete? = null) {
        val v = _reserved.value ?: return
        if (only != null && v != only) return
        _reserved.value = null
        deleteSet(v.setNumber, successReport = false)
    }

    /** [successReport] off, when „gelöscht“ was already in the snackbar together with „Rückgängig“. */
    fun deleteSet(setNumber: String, successReport: Boolean = true) {
        viewModelScope.launch {
            val (deleted, sentence) = setDelete(sets, messages, setNumber)
            if (!deleted || successReport) messages.show(sentence)
        }
    }

    private fun afterFilter(view: ScopeFilter.View) {
        if (view != ScopeFilter.View.GALLERY) return
        loadSets()
        loadStats()
    }

    private fun reset() {
        gallery.reset()
        _prices.value = emptyMap()
        wanted[SEARCH] = ""
        wanted[THEME] = ""
        wanted[SORTING] = SetSort.DEFAULT.identifier
    }

    private companion object {
        const val SEARCH = "galerie_suche"
        const val THEME = "galerie_thema"
        const val SORTING = "galerie_sortierung"
    }
}

/** The key figures without [set] — for as long as its deletion is pending. */
internal fun withoutSet(k: MetricsView, set: SetView): MetricsView {
    val parts = (set.pieces ?: 0) * set.quantity
    return k.copy(
        totalSets = (k.totalSets - 1).coerceAtLeast(0),
        totalQuantity = (k.totalQuantity - set.quantity).coerceAtLeast(0),
        totalParts = (k.totalParts - parts).coerceAtLeast(0),
        partsFromSets = k.partsFromSets?.let { (it - parts).coerceAtLeast(0) },
        totalMinifigs = (k.totalMinifigs - (set.minifigs ?: 0) * set.quantity).coerceAtLeast(0),
        totalInstructions = (k.totalInstructions - set.instructions.size).coerceAtLeast(0),
    )
}

/**
 * Delete a set: success, and the sentence for the message channel. Shared with
 * the set detail, which offers the same path.
 */
internal suspend fun setDelete(sets: SetsRepository, texts: Texts, setNumber: String, name: String = setNumber): Pair<Boolean, String?> =
    when (val r = sets.deleteSet(setNumber)) {
        is Outcome.Success -> true to texts.text(R.string.vm_set_deleted, name)
        is Outcome.Failure -> false to texts.messageForSnackbar(r)
    }
