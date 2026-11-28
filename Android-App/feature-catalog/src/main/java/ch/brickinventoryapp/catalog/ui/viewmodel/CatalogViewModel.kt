package ch.brickinventoryapp.catalog.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.catalog.ui.CatalogTarget
import ch.brickinventoryapp.catalog.ui.CatalogUiState
import ch.brickinventoryapp.catalog.ui.WantedRequest
import ch.brickinventoryapp.dataapi.alarm.AlarmInput
import ch.brickinventoryapp.dataapi.catalog.CatalogRepository
import ch.brickinventoryapp.dataapi.collection.AlarmRepository
import ch.brickinventoryapp.dataapi.collection.WantedRepository
import ch.brickinventoryapp.dataapi.message.MessageChannel
import ch.brickinventoryapp.model.domain.CatalogSetView
import ch.brickinventoryapp.model.domain.CatalogSort
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.model.text.Message
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.state.ui.viewmodel.Texts
import ch.brickinventoryapp.state.ui.viewmodel.observeLoadOn
import ch.brickinventoryapp.uistate.ErrorClass
import ch.brickinventoryapp.uistate.Load
import ch.brickinventoryapp.uistate.ScrollMemory
import ch.brickinventoryapp.uistate.loading
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * How long the list must stay still before its visible pages are fetched:
 * 150 ms as in the web app (`_ladeSichtbareSeiten`). A drag across the whole bar
 * thus collapses into one fetch; shorter than a touch interval wouldn't debounce anything.
 */
internal const val VIEWPORT_REST_MS = 150L

private const val QUERY = "catalog.query"
private const val THEME = "catalog.theme"
private const val YEAR = "catalog.year"
private const val SORT = "catalog.sort"

/**
 * The catalog as its own ViewModel: search, list and detail have jobs and a
 * filter generation, which belong as fields of one instance, not process-wide.
 * Not via hiltViewModel(): list and detail are two NavHost destinations, and two
 * instances wouldn't see the detail's "I own this" in the list. That's why
 * it, like AppViewModel, is held by the Activity.
 */
@HiltViewModel
internal class CatalogViewModel @Inject constructor(
    private val catalog: CatalogRepository,
    private val messages: MessageChannel,
    /** Texts in the app's language and error messages like everywhere else (AppTexts). */
    private val texts: Texts,
    /** Watchlist and price alert: the detail shows the item and creates it, without knowing the collection. */
    private val wantedList: WantedRepository,
    private val alerts: AlarmRepository,
    private val scrollMemory: ScrollMemory,
    /** Search and filters survive a process death: the list reloads with them, not unfiltered. */
    private val saved: SavedStateHandle,
) : ViewModel(), CatalogActions {

    private val _catalogState = MutableStateFlow(CatalogUiState(
        query = saved[QUERY] ?: "", themeId = saved[THEME], year = saved[YEAR], sort = CatalogSort.from(saved[SORT])))
    val state = _catalogState.asStateFlow()

    init {
        // Only whoever sees the catalog loads it; returning only loads what's still missing.
        observeLoadOn(_catalogState) {
            val s = _catalogState.value
            if (s.loadedPages.isEmpty() && !s.fetch.loading) { loadCatalogMeta(); loadCatalogSets() }
        }
    }

    // Debounced search: each keypress cancels the previous load
    // job, loading only starts 350 ms after the last one.
    private var catalogSearchJob: Job? = null

    // Active list/page load job: a filter change cancels the running
    // load IMMEDIATELY, including its retry wait times. Without that, a
    // hanging request (e.g. parallel CDN image downloads saturating the
    // connection) would block every further catalog interaction for
    // minutes via isLoading.
    private var catalogListJob: Job? = null
    private var catalogDetailJob: Job? = null

    // Filter generation: responses from an older generation are discarded —
    // prevents a late page-2 response of the OLD filter from being
    // appended to the new list (mixed content + duplicate LazyGrid keys).
    private var catalogGeneration = 0

    override fun loadCatalogMeta() {
        viewModelScope.launch {
            when (val r = catalog.getCatalogMeta()) {
                is Outcome.Success -> _catalogState.update {
                    it.copy(themes = r.data.themes, yearMin = r.data.yearMin, yearMax = r.data.yearMax)
                }
                is Outcome.Failure -> { /* Meta is optional — filters stay empty, the list still works */ }
            }
        }
    }

    /**
     * Load the first page with the current filters (replaces everything loaded).
     * Cancels a running load (cancel-and-replace).
     */
    override fun loadCatalogSets() {
        val gen = ++catalogGeneration
        catalogListJob?.cancel()
        catalogListJob = viewModelScope.launch {
            // Also forget the remembered position: after a filter change it pointed to
            // sets that no longer exist in the new list.
            scrollMemory.forgetNow(CatalogTarget.Catalog.rollKey)
            _catalogState.update {
                it.copy(fetch = Load.Loads,
                        loadedPages = emptyMap(), loadingPages = emptySet(), scrollTo = null,
                        yearDistribution = emptyList())
            }
            loadYearDistribution(gen)
            val s = _catalogState.value
            // Retrying happens in the repository, briefly: the error state has its own button.
            val r = catalog.getCatalogSets(
                q = s.query.ifBlank { null }, themeId = s.themeId,
                yearFrom = s.year, yearTo = s.year, sort = s.sort, page = 1
            )
            if (gen != catalogGeneration) return@launch   // a new filter in the meantime
            when (r) {
                is Outcome.Success -> {
                    _catalogState.update {
                        it.copy(fetch = Load.Data(Unit), loadedPages = mapOf(1 to r.data.sets), total = r.data.total)
                    }
                }
                is Outcome.Failure -> {
                    _catalogState.update { it.copy(fetch = loadError(r)) }
                    if (_catalogState.value.loadedPages.isNotEmpty()) messages.show(texts.messageForSnackbar(r))
                }
            }
        }
    }

    /**
     * Load the page a slot that became visible sits on — while scrolling in
     * either direction and after a jump. Loaded or loading pages are
     * skipped; responses from an older filter generation are discarded, otherwise
     * a late page of the old filter would hang around in the new list.
     */
    private val viewport = ViewportLoader(viewModelScope, VIEWPORT_REST_MS, ::ensureCatalogPage)

    /** What the grid currently shows (pages, 1-based); only loaded once it's still. */
    override fun catalogVisible(firstPage: Int, lastPage: Int) = viewport.visible(firstPage, lastPage)

    fun ensureCatalogPage(page: Int) {
        if (page < 1) return
        val s = _catalogState.value
        if (s.loadedPages.containsKey(page) || s.loadingPages.contains(page)) return
        val gen = catalogGeneration
        _catalogState.update { it.copy(loadingPages = it.loadingPages + page) }
        viewModelScope.launch {
            // Retrying happens in the repository, briefly: the error state has its own button.
            val r = catalog.getCatalogSets(
                q = s.query.ifBlank { null }, themeId = s.themeId,
                yearFrom = s.year, yearTo = s.year, sort = s.sort, page = page
            )
            if (gen != catalogGeneration) return@launch
            _catalogState.update { st ->
                val without = st.loadingPages - page
                when (r) {
                    is Outcome.Success ->
                        st.copy(loadingPages = without, loadedPages = st.loadedPages + (page to r.data.sets),
                            total = if (r.data.total > 0) r.data.total else st.total)
                    is Outcome.Failure -> st.copy(loadingPages = without)
                }
            }
        }
    }

    /**
     * Fetch the year distribution for the current filters — from the server, because only it
     * knows the filters; once per list build as in the web app. `gen` discards the
     * response if the filter has changed in the meantime.
     */
    private fun loadYearDistribution(gen: Int) {
        viewModelScope.launch {
            val s = _catalogState.value
            val r = catalog.getCatalogYearDistribution(
                q = s.query.ifBlank { null }, themeId = s.themeId, sort = s.sort)
            if (gen != catalogGeneration) return@launch
            if (r is Outcome.Success) {
                // Drop years WITHOUT a year — exactly as the web app does.
                // Their count stays included in `total`; see
                // CatalogYearMath.yearAnPosition.
                _catalogState.update { it.copy(yearDistribution = r.data.filter { j -> j.year != null }) }
            }
        }
    }

    /**
     * The bar on the right scrolls the list to a spot. The number goes to the
     * view through the state, because scrolling happens there; catalogScrollConsumed() resets
     * it, otherwise the same spot couldn't be jumped to a second time.
     */
    override fun scrollCatalogTo(number: Int) {
        _catalogState.update { it.copy(scrollTo = number) }
    }

    /** The view reports that it has jumped. */
    override fun catalogScrollConsumed() {
        _catalogState.update { it.copy(scrollTo = null) }
    }

    override fun setCatalogQuery(q: String) {
        _catalogState.update { it.copy(query = q) }
        saved[QUERY] = q
        catalogSearchJob?.cancel()
        catalogSearchJob = viewModelScope.launch {
            delay(350)
            loadCatalogSets()
        }
    }

    override fun setCatalogTheme(themeId: Int?) {
        _catalogState.update { it.copy(themeId = themeId) }
        saved[THEME] = themeId
        loadCatalogSets()
    }

    override fun setCatalogYear(year: Int?) {
        _catalogState.update { it.copy(year = year) }
        saved[YEAR] = year
        loadCatalogSets()
    }

    override fun setCatalogSort(sort: CatalogSort) {
        _catalogState.update { it.copy(sort = sort) }
        saved[SORT] = sort.identifier
        loadCatalogSets()
    }

    // ── Detail ────────────────────────────────────────────────────────────────────
    /** The watchlist item for [setNumber] from the watchlist cache; null as long as the set isn't on it. */
    fun wanted(setNumber: String): Flow<WantedItemView?> =
        wantedList.observeWanted().map { l -> l.list.firstOrNull { it.setNumber == setNumber } }

    /** Watchlist, and if a threshold is given, the price alert right along with it. */
    fun track(w: WantedRequest) {
        viewModelScope.launch {
            when (val r = wantedList.createWantedItem(w.setNumber, w.condition, w.account)) {
                is Outcome.Failure ->
                    messages.show(texts.messageForSnackbar(r)?.let { Message.Resource(R.string.vm_error, listOf(it)) })
                is Outcome.Success -> {
                    AlarmInput.number(w.thresholdRaw)?.let { alerts.setPriceAlarm(w.setNumber, w.direction, it, w.condition) }
                    messages.show(Message.Resource(if (r.data) R.string.wanted_added else R.string.wanted_already))
                }
            }
        }
    }

    fun loadCatalogDetail(setNumber: String) {
        catalogDetailJob?.cancel()
        catalogDetailJob = viewModelScope.launch {
            // The watchlist into the cache, so [wanted] knows the item; silent, the detail counts.
            launch { wantedList.refreshWanted() }
            _catalogState.update { it.copy(detail = Load.Loads) }
            // The error belongs in the state, not in a snackbar: the screen has
            // nothing to show without the detail and needs a reason and "Try again".
            when (val r = catalog.getCatalogSetDetail(setNumber)) {
                is Outcome.Success -> {
                    val detail = r.data
                    val loaded = if (detail != null) Load.Data(detail)
                    else Load.Failure(ErrorClass.UNKNOWN, Message.Resource(R.string.err_set_not_found))
                    _catalogState.update { it.copy(detail = loaded) }
                }
                is Outcome.Failure -> _catalogState.update { it.copy(detail = loadError(r)) }
            }
        }
    }

    /**
     * Mark an added set as "I own this". Adding belongs to the
     * gallery, marking to the catalog; the graph calls both in sequence, so
     * the dependency sits at the call site.
     */
    fun markCaptured(setNumber: String, quantity: Int) {
        // Set the "I own this" badge right away, without reloading — across all
        // loaded pages, because the tile can sit on any of them.
        _catalogState.update { st ->
            val mark: (CatalogSetView) -> CatalogSetView = {
                if (it.setNumber == setNumber)
                    it.copy(owned = true, ownedQuantity = it.ownedQuantity + quantity) else it
            }
            st.copy(
                loadedPages = st.loadedPages.mapValues { (_, page) -> page.map(mark) },
                detail = st.detail.let {
                    if (it is Load.Data && it.value.setNumber == setNumber)
                        Load.Data(it.value.copy(owned = true, ownedQuantity = it.value.ownedQuantity + quantity)) else it
                }
            )
        }
    }
}
