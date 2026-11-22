package ch.brickinventoryapp.parts.ui

import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.domain.CategoryView
import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.model.domain.FigureView
import ch.brickinventoryapp.model.domain.FilterColorView
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.MinifigsMetricsView
import ch.brickinventoryapp.model.domain.PartView
import ch.brickinventoryapp.model.domain.PartsMetricsView
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.model.ui.ListView
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.state.ui.loadError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The fetches next to the parts list: key figures and filter values; the caller sets the view. */
internal interface PartsSource {
    suspend fun partsMetrics(): Outcome<PartsMetricsView?>
    suspend fun filterColors(): Outcome<List<FilterColorView>>
    suspend fun categories(): Outcome<List<CategoryView>>
    suspend fun allColors(): Outcome<List<ColorView>>
}

/**
 * The lists for a filter, and how they are filled — the display's only source,
 * as in the gallery: the store, or, where account, storage location or "In Sets" demand it,
 * the account view. The fetch only fills the source.
 */
internal class PartsLocal(
    val parts: (PartsUiState) -> Flow<Local<PartView>>,
    val manualParts: (PartsUiState) -> Flow<Local<ManualPartView>>,
    val refresh: suspend (PartsUiState) -> Outcome<Unit>,
)

/** The same for the figures. */
internal class MinifigsLocal(
    val figures: (MinifigsUiState) -> Flow<Local<FigureView>>,
    val manualMinifigs: (MinifigsUiState) -> Flow<Local<ManualMinifigView>>,
    val refresh: suspend (MinifigsUiState) -> Outcome<Unit>,
    val metrics: suspend () -> Outcome<MinifigsMetricsView>,
)

/**
 * Follows the store and reports the fetch — shared for parts and figures. A new
 * job cancels the old one: a slow old answer would otherwise overwrite a newer one,
 * and while typing, every keystroke clears the debounced previous one.
 */
internal class ListOrder<S>(
    private val scope: CoroutineScope,
    private val uiState: MutableStateFlow<S>,
    private val reportError: (Outcome.Failure) -> Unit,
    private val suchPause: Long,
) {
    private var follow: List<Job> = emptyList()
    private var job: Job? = null

    /** A list never loaded (without a cached state) clears nothing. */
    fun <T> sequence(source: Flow<Local<T>>, newValue: (S, List<T>) -> S): Job =
        scope.launch { source.collect { l -> if (l.state != null) uiState.update { st -> newValue(st, l.list) } } }

    fun launch(debounced: Boolean, load: suspend () -> Unit) {
        cancel()
        job = scope.launch {
            if (debounced) delay(suchPause)
            load()
        }
    }

    fun sequenceAll(newValue: List<Job>) { follow = newValue }

    /** Without network, the store stays with its cached state; without a store it is an error. */
    fun outbox(r: Outcome<Unit>, state: Long?, done: (S, Long?) -> S, error: (S, Outcome.Failure) -> S) {
        when {
            r is Outcome.Success -> uiState.update { done(it, null) }
            r is Outcome.Failure && r.transient && state != null -> uiState.update { done(it, state) }
            r is Outcome.Failure -> {
                uiState.update { error(it, r) }
                reportError(r)
            }
        }
    }

    fun cancel() {
        job?.cancel()
        follow.forEach { it.cancel() }
    }
}

/**
 * The parts list's state and how it changes — like the gallery: a private flow,
 * named methods, sources from outside. Every loader reads the filters from the state:
 * this way source and fetch always match what the filter chips show.
 */
internal class Parts(
    private val scope: CoroutineScope,
    private val source: PartsSource,
    reportError: (Outcome.Failure) -> Unit,
    /** Filter change: the remembered scroll position points at a different list. */
    private val forgetScroll: () -> Unit,
    suchPause: Long = 350,
    private val lists: PartsLocal,
    /** Every new filter, so that the caller can remember it. */
    private val filterChanged: (PartsFilter) -> Unit = {},
) {
    private val _state = MutableStateFlow(PartsUiState())
    val state: StateFlow<PartsUiState> = _state.asStateFlow()
    private val sequence = ListOrder(scope, _state, reportError, suchPause)

    /** Everything is there at once; there is no further page. */
    fun load(page: Int = 1, debounced: Boolean = false) {
        if (page > 1) return
        sequence.launch(debounced) { loadParts() }
    }

    /** Read after the debounce: the most recently started job sees the newest filter. */
    private suspend fun loadParts() {
        val st = _state.value
        sequence.sequenceAll(listOf(
            sequence.sequence(lists.parts(st)) { s, l ->
                s.copy(parts = sorted(l, s.filter.order), partsTotal = l.size, partsPage = 1)
            },
            sequence.sequence(lists.manualParts(st)) { s, l -> s.copy(manualParts = l) },
        ))
        _state.update { it.copy(partsFetch = Load.Loads) }
        val r = lists.refresh(st)
        sequence.outbox(r, lists.parts(st).first().state,
            { s, state -> s.copy(partsFetch = Load.Data(Unit), partsOfflineStatus = state) },
            { s, r -> s.copy(partsFetch = loadError(r)) })
        loadMetrics()
    }

    /** Key figures are an extra: a failure leaves the list as is. */
    suspend fun loadMetrics() {
        (source.partsMetrics() as? Outcome.Success)
            ?.let { s -> _state.update { it.copy(partsStats = s.data) } }
    }

    /**
     * Set a new filter. A click is a finished wish; only typing in the search
     * is debounced. Sort order only reorders: the whole list is already there.
     */
    fun setFilter(newValue: PartsFilter) {
        val old = _state.value.filter
        if (old == newValue) return
        if (newValue.copy(view = old.view) != old) forgetScroll()
        _state.update { it.copy(filter = newValue, parts = if (newValue.order != old.order) sorted(it.parts, newValue.order) else it.parts) }
        filterChanged(newValue)
        if (newValue.copy(order = old.order) == old) return
        load(debounced = newValue.search != old.search)
    }

    /**
     * The filters' color and category list. Silent on errors: a missing
     * filter is no reason to hold back the list or interrupt it.
     */
    fun loadFilter() {
        scope.launch {
            (source.filterColors() as? Outcome.Success)?.data
                ?.let { d -> _state.update { it.copy(partsFilterColors = d) } }
            (source.categories() as? Outcome.Success)?.data
                ?.let { d -> _state.update { it.copy(partsCategories = d) } }
        }
    }

    /** Color choice in the entry dialog; if it is missing, one types the color ID. */
    fun loadColors() {
        scope.launch {
            (source.allColors() as? Outcome.Success)?.data
                ?.let { d -> _state.update { it.copy(partsColors = d) } }
        }
    }

    /** Take over a remembered filter, without loading. */
    fun placeFilterAgain(f: PartsFilter) = _state.update { it.copy(filter = f) }

    /** Sign out: leave nothing of the previous account behind, discard running fetches. */
    fun reset() {
        sequence.cancel()
        _state.value = PartsUiState()
    }
}

/** State of the figures list, built like [Parts]. */
internal class Figures(
    private val scope: CoroutineScope,
    reportError: (Outcome.Failure) -> Unit,
    suchPause: Long = 350,
    private val lists: MinifigsLocal,
) {
    private val _uiState = MutableStateFlow(MinifigsUiState())
    val uiState: StateFlow<MinifigsUiState> = _uiState.asStateFlow()
    private val sequence = ListOrder(scope, _uiState, reportError, suchPause)

    suspend fun loadMetrics() {
        (lists.metrics() as? Outcome.Success)
            ?.let { r -> _uiState.update { it.copy(minifigStats = r.data) } }
    }

    /**
     * Load the figures list. The key figures come along and show the whole
     * stock — not while typing, otherwise every keystroke would recount, with no
     * job that could cancel it.
     */
    fun load(debounced: Boolean = false) {
        if (!debounced) scope.launch { loadMetrics() }
        sequence.launch(debounced) { sequenceMinifigs() }
    }

    private suspend fun sequenceMinifigs() {
        val st = _uiState.value
        sequence.sequenceAll(listOf(
            sequence.sequence(lists.figures(st)) { s, l -> s.copy(minifigs = l) },
            sequence.sequence(lists.manualMinifigs(st)) { s, l -> s.copy(manualFigs = l) },
        ))
        _uiState.update { it.copy(minifigsFetch = Load.Loads) }
        val r = lists.refresh(st)
        sequence.outbox(r, lists.figures(st).first().state,
            { s, state -> s.copy(minifigsFetch = Load.Data(Unit), minifigsOfflineStatus = state) },
            { s, r -> s.copy(minifigsFetch = loadError(r)) })
    }

    fun setSearch(q: String) {
        _uiState.update { it.copy(minifigsQuery = q) }
        load(debounced = true)
    }

    /** Cards or table; without a reload, the fields are already there. */
    fun setView(value: ListView) = _uiState.update { it.copy(minifigsView = value) }

    /** Take over a remembered search and view, without loading. */
    fun placeAgain(search: String, view: ListView) =
        _uiState.update { it.copy(minifigsQuery = search, minifigsView = view) }

    fun reset() {
        sequence.cancel()
        _uiState.value = MinifigsUiState()
    }
}
