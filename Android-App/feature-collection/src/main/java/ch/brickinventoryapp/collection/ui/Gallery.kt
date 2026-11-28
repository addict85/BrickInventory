package ch.brickinventoryapp.collection.ui

import ch.brickinventoryapp.model.domain.MetricsView
import ch.brickinventoryapp.model.domain.SetSort
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.ui.LoadingIndicator
import ch.brickinventoryapp.ui.loadingIndicator
import ch.brickinventoryapp.uistate.Load
import ch.brickinventoryapp.uistate.loading
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

/**
 * The gallery's state and how it changes — in ONE place.
 * The flow is private, changes go through named methods: that way not every file of the
 * module writes into it.
 */
internal class Gallery(
    private val scope: CoroutineScope,
    /**
     * The list for a state's filters — the display's only source: the
     * cache, via chosen accounts the account view. What's changed offline shows up
     * right away this way.
     */
    private val source: (GalleryUiState) -> Flow<Local<SetView>>,
    /** Fills the state's source; no one looks at the response itself. */
    private val refresh: suspend (GalleryUiState) -> Outcome<Unit>,
    private val fetchMetrics: suspend () -> Outcome<MetricsView?>,
    private val reportError: (Outcome.Failure) -> Unit,
    /** Filter change: the remembered scroll position points to a different list. */
    private val forgetScroll: () -> Unit,
    private val suchPause: Long = 350,
) {
    private val _state = MutableStateFlow(GalleryUiState())
    val state: StateFlow<GalleryUiState> = _state.asStateFlow()

    // A new job cancels the old one: a late response from an old
    // filter would otherwise land with mixed content in the new list.
    private var sequenceJob: Job? = null
    private var listJob: Job? = null
    private var suchJob: Job? = null

    /**
     * With the configured filters: follow the source and fill it. Without network
     * the cached list stays as is, with its own state.
     */
    fun load() {
        listJob?.cancel()
        sequenceJob?.cancel()
        val st = _state.value
        val list = source(st)
        sequenceJob = scope.launch {
            list.collect { l ->
                if (l.state == null) return@collect
                _state.update {
                    it.copy(sets = l.list, galleryTotal = l.list.size,
                        galleryThemes = if (it.galleryQuery.isBlank() && it.galleryTheme.isBlank()) themesFrom(l.list) else it.galleryThemes)
                }
            }
        }
        listJob = scope.launch {
            _state.update { it.copy(fetch = Load.Loads) }
            val r = refresh(st)
            // Without network, what the source already holds counts; it hasn't changed from the failure.
            val state = if (r is Outcome.Failure && r.transient) list.first().state else null
            when {
                r is Outcome.Success -> _state.update { it.copy(fetch = Load.Data(Unit), offlineStatus = null) }
                r is Outcome.Failure && r.transient && state != null ->
                    _state.update { it.copy(fetch = Load.Data(Unit), offlineStatus = state) }
                r is Outcome.Failure -> {
                    _state.update { it.copy(fetch = loadError(r)) }
                    reportError(r)
                }
            }
        }
    }

    /** Search text: debounced, so not every keypress triggers a query. */
    fun setSearch(q: String) {
        forgetScroll()
        _state.update { it.copy(galleryQuery = q) }
        suchJob?.cancel()
        suchJob = scope.launch { delay(suchPause); load() }
    }

    fun setTheme(theme: String) {
        forgetScroll()
        _state.update { it.copy(galleryTheme = theme) }
        load()
    }

    fun setSort(sort: SetSort) {
        forgetScroll()
        _state.update { it.copy(gallerySort = sort) }
        load()
    }

    /** Figures in the header; a failure stays silent — they're a nice-to-have. */
    fun loadMetrics() {
        scope.launch {
            val r = fetchMetrics()
            if (r is Outcome.Success) _state.update { it.copy(stats = r.data) }
        }
    }

    /** Take over remembered filters without loading — the screen does that on entering. */
    fun placeFilterAgain(search: String, theme: String, sorting: SetSort) =
        _state.update { it.copy(galleryQuery = search, galleryTheme = theme, gallerySort = sorting) }

    /** Sign out: leave nothing from the previous account standing, discard running fetches. */
    fun reset() {
        listJob?.cancel()
        sequenceJob?.cancel()
        suchJob?.cancel()
        _state.value = GalleryUiState()
    }
}

/** The themes of the cached sets for the filter; the server otherwise only sends them with page 1. */
private fun themesFrom(sets: List<SetView>): List<String> =
    sets.mapNotNull { it.theme?.takeIf(String::isNotBlank) }.distinct().sorted()

/** What the gallery shows when no tile exists yet — or else the list. */
internal typealias GalleryDisplay = LoadingIndicator

/**
 * A load error and an empty collection call for different things: one
 * "Try again", the other "Add set". Loaded sets take priority —
 * a failed reload leaves the old list standing.
 */
internal fun galleryDisplay(g: GalleryUiState, filtered: Boolean): GalleryDisplay =
    loadingIndicator(g.sets.isNotEmpty(), g.fetch.loading, g.fetch is Load.Failure, filtered)
