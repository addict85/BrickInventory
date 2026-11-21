package ch.brickinventoryapp.collection.ui

import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.domain.Setsortierung
import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.model.domain.MetricsView
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.local.Local
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ch.brickinventoryapp.ui.LoadingIndicator
import ch.brickinventoryapp.ui.loadingIndicator

/**
 * The gallery's state and how it changes — in ONE place.
 * The flow is private, changes go through named methods: that way not every file of the
 * module writes into it.
 */
internal class Galerie(
    private val scope: CoroutineScope,
    /**
     * The list for a state's filters — the display's only source: the
     * cache, via chosen accounts the account view. What's changed offline shows up
     * right away this way.
     */
    private val quelle: (GalleryUiState) -> Flow<Local<SetAnsicht>>,
    /** Fills the state's source; no one looks at the response itself. */
    private val refresh: suspend (GalleryUiState) -> Ergebnis<Unit>,
    private val fetchMetrics: suspend () -> Ergebnis<MetricsView?>,
    private val reportError: (Ergebnis.Fehler) -> Unit,
    /** Filter change: the remembered scroll position points to a different list. */
    private val vergissScroll: () -> Unit,
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
    fun laden() {
        listJob?.cancel()
        sequenceJob?.cancel()
        val st = _state.value
        val liste = quelle(st)
        sequenceJob = scope.launch {
            liste.collect { l ->
                if (l.stand == null) return@collect
                _state.update {
                    it.copy(sets = l.liste, galleryTotal = l.liste.size,
                        galleryThemes = if (it.galleryQuery.isBlank() && it.galleryTheme.isBlank()) themesFrom(l.liste) else it.galleryThemes)
                }
            }
        }
        listJob = scope.launch {
            _state.update { it.copy(abruf = Laden.Loads) }
            val r = refresh(st)
            // Without network, what the source already holds counts; it hasn't changed from the failure.
            val stand = if (r is Ergebnis.Fehler && r.transient) liste.first().stand else null
            when {
                r is Ergebnis.Erfolg -> _state.update { it.copy(abruf = Laden.Daten(Unit), offlineStatus = null) }
                r is Ergebnis.Fehler && r.transient && stand != null ->
                    _state.update { it.copy(abruf = Laden.Daten(Unit), offlineStatus = stand) }
                r is Ergebnis.Fehler -> {
                    _state.update { it.copy(abruf = loadError(r)) }
                    reportError(r)
                }
            }
        }
    }

    /** Search text: debounced, so not every keypress triggers a query. */
    fun setzeSuche(q: String) {
        vergissScroll()
        _state.update { it.copy(galleryQuery = q) }
        suchJob?.cancel()
        suchJob = scope.launch { delay(suchPause); laden() }
    }

    fun setzeThema(theme: String) {
        vergissScroll()
        _state.update { it.copy(galleryTheme = theme) }
        laden()
    }

    fun setzeSortierung(sort: Setsortierung) {
        vergissScroll()
        _state.update { it.copy(gallerySort = sort) }
        laden()
    }

    /** Figures in the header; a failure stays silent — they're a nice-to-have. */
    fun loadMetrics() {
        scope.launch {
            val r = fetchMetrics()
            if (r is Ergebnis.Erfolg) _state.update { it.copy(stats = r.data) }
        }
    }

    /** Take over remembered filters without loading — the screen does that on entering. */
    fun placeFilterAgain(suche: String, thema: String, sorting: Setsortierung) =
        _state.update { it.copy(galleryQuery = suche, galleryTheme = thema, gallerySort = sorting) }

    /** Sign out: leave nothing from the previous account standing, discard running fetches. */
    fun reset() {
        listJob?.cancel()
        sequenceJob?.cancel()
        suchJob?.cancel()
        _state.value = GalleryUiState()
    }
}

/** The themes of the cached sets for the filter; the server otherwise only sends them with page 1. */
private fun themesFrom(sets: List<SetAnsicht>): List<String> =
    sets.mapNotNull { it.theme?.takeIf(String::isNotBlank) }.distinct().sorted()

/** What the gallery shows when no tile exists yet — or else the list. */
internal typealias GalleryDisplay = LoadingIndicator

/**
 * A load error and an empty collection call for different things: one
 * "Try again", the other "Add set". Loaded sets take priority —
 * a failed reload leaves the old list standing.
 */
internal fun galleryDisplay(g: GalleryUiState, gefiltert: Boolean): GalleryDisplay =
    loadingIndicator(g.sets.isNotEmpty(), g.abruf.laedt, g.abruf is Laden.Fehler, gefiltert)
