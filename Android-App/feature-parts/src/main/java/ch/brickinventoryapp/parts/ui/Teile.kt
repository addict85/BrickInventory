package ch.brickinventoryapp.parts.ui

import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.model.domain.FigurAnsicht
import ch.brickinventoryapp.model.domain.MinifigsMetricsView
import ch.brickinventoryapp.model.domain.FilterColorView
import ch.brickinventoryapp.model.domain.CategoryView
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.TeilAnsicht
import ch.brickinventoryapp.model.domain.PartsMetricsView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ch.brickinventoryapp.model.ui.ListView

/** The fetches next to the parts list: key figures and filter values; the caller sets the view. */
internal interface PartsSource {
    suspend fun partsMetrics(): Ergebnis<PartsMetricsView?>
    suspend fun filterColors(): Ergebnis<List<FilterColorView>>
    suspend fun kategorien(): Ergebnis<List<CategoryView>>
    suspend fun allColors(): Ergebnis<List<ColorView>>
}

/**
 * The lists for a filter, and how they are filled — the display's only source,
 * as in the gallery: the store, or, where account, storage location or "In Sets" demand it,
 * the account view. The fetch only fills the source.
 */
internal class PartsLocal(
    val teile: (PartsUiState) -> Flow<Local<TeilAnsicht>>,
    val manuelleTeile: (PartsUiState) -> Flow<Local<ManualPartView>>,
    val refresh: suspend (PartsUiState) -> Ergebnis<Unit>,
)

/** The same for the figures. */
internal class MinifigsLocal(
    val figuren: (MinifigsUiState) -> Flow<Local<FigurAnsicht>>,
    val manualMinifigs: (MinifigsUiState) -> Flow<Local<ManualMinifigView>>,
    val refresh: suspend (MinifigsUiState) -> Ergebnis<Unit>,
    val metrics: suspend () -> Ergebnis<MinifigsMetricsView>,
)

/**
 * Follows the store and reports the fetch — shared for parts and figures. A new
 * job cancels the old one: a slow old answer would otherwise overwrite a newer one,
 * and while typing, every keystroke clears the debounced previous one.
 */
internal class Listenfolge<S>(
    private val scope: CoroutineScope,
    private val zustand: MutableStateFlow<S>,
    private val reportError: (Ergebnis.Fehler) -> Unit,
    private val suchPause: Long,
) {
    private var folgen: List<Job> = emptyList()
    private var job: Job? = null

    /** A list never loaded (without a cached state) clears nothing. */
    fun <T> sequence(quelle: Flow<Local<T>>, neu: (S, List<T>) -> S): Job =
        scope.launch { quelle.collect { l -> if (l.stand != null) zustand.update { st -> neu(st, l.liste) } } }

    fun starte(debounced: Boolean, laden: suspend () -> Unit) {
        abbrechen()
        job = scope.launch {
            if (debounced) delay(suchPause)
            laden()
        }
    }

    fun sequenceAll(neu: List<Job>) { folgen = neu }

    /** Without network, the store stays with its cached state; without a store it is an error. */
    fun ausgang(r: Ergebnis<Unit>, stand: Long?, fertig: (S, Long?) -> S, fehler: (S, Ergebnis.Fehler) -> S) {
        when {
            r is Ergebnis.Erfolg -> zustand.update { fertig(it, null) }
            r is Ergebnis.Fehler && r.transient && stand != null -> zustand.update { fertig(it, stand) }
            r is Ergebnis.Fehler -> {
                zustand.update { fehler(it, r) }
                reportError(r)
            }
        }
    }

    fun abbrechen() {
        job?.cancel()
        folgen.forEach { it.cancel() }
    }
}

/**
 * The parts list's state and how it changes — like the gallery: a private flow,
 * named methods, sources from outside. Every loader reads the filters from the state:
 * this way source and fetch always match what the filter chips show.
 */
internal class Teile(
    private val scope: CoroutineScope,
    private val quelle: PartsSource,
    reportError: (Ergebnis.Fehler) -> Unit,
    /** Filter change: the remembered scroll position points at a different list. */
    private val vergissScroll: () -> Unit,
    suchPause: Long = 350,
    private val listen: PartsLocal,
    /** Every new filter, so that the caller can remember it. */
    private val filterChanged: (Teilefilter) -> Unit = {},
) {
    private val _state = MutableStateFlow(PartsUiState())
    val state: StateFlow<PartsUiState> = _state.asStateFlow()
    private val sequence = Listenfolge(scope, _state, reportError, suchPause)

    /** Everything is there at once; there is no further page. */
    fun laden(seite: Int = 1, debounced: Boolean = false) {
        if (seite > 1) return
        sequence.starte(debounced) { loadParts() }
    }

    /** Read after the debounce: the most recently started job sees the newest filter. */
    private suspend fun loadParts() {
        val st = _state.value
        sequence.sequenceAll(listOf(
            sequence.sequence(listen.teile(st)) { s, l ->
                s.copy(parts = sortiert(l, s.filter.order), partsTotal = l.size, partsPage = 1)
            },
            sequence.sequence(listen.manuelleTeile(st)) { s, l -> s.copy(manualParts = l) },
        ))
        _state.update { it.copy(partsFetch = Laden.Loads) }
        val r = listen.refresh(st)
        sequence.ausgang(r, listen.teile(st).first().stand,
            { s, stand -> s.copy(partsFetch = Laden.Daten(Unit), partsOfflineStatus = stand) },
            { s, r -> s.copy(partsFetch = loadError(r)) })
        loadMetrics()
    }

    /** Key figures are an extra: a failure leaves the list as is. */
    suspend fun loadMetrics() {
        (quelle.partsMetrics() as? Ergebnis.Erfolg)
            ?.let { s -> _state.update { it.copy(partsStats = s.data) } }
    }

    /**
     * Set a new filter. A click is a finished wish; only typing in the search
     * is debounced. Sort order only reorders: the whole list is already there.
     */
    fun setFilter(neu: Teilefilter) {
        val alt = _state.value.filter
        if (alt == neu) return
        if (neu.copy(ansicht = alt.ansicht) != alt) vergissScroll()
        _state.update { it.copy(filter = neu, parts = if (neu.order != alt.order) sortiert(it.parts, neu.order) else it.parts) }
        filterChanged(neu)
        if (neu.copy(order = alt.order) == alt) return
        laden(debounced = neu.suche != alt.suche)
    }

    /**
     * The filters' color and category list. Silent on errors: a missing
     * filter is no reason to hold back the list or interrupt it.
     */
    fun loadFilter() {
        scope.launch {
            (quelle.filterColors() as? Ergebnis.Erfolg)?.data
                ?.let { d -> _state.update { it.copy(partsFilterColors = d) } }
            (quelle.kategorien() as? Ergebnis.Erfolg)?.data
                ?.let { d -> _state.update { it.copy(partsCategories = d) } }
        }
    }

    /** Color choice in the entry dialog; if it is missing, one types the color ID. */
    fun loadColors() {
        scope.launch {
            (quelle.allColors() as? Ergebnis.Erfolg)?.data
                ?.let { d -> _state.update { it.copy(partsColors = d) } }
        }
    }

    /** Take over a remembered filter, without loading. */
    fun placeFilterAgain(f: Teilefilter) = _state.update { it.copy(filter = f) }

    /** Sign out: leave nothing of the previous account behind, discard running fetches. */
    fun reset() {
        sequence.abbrechen()
        _state.value = PartsUiState()
    }
}

/** State of the figures list, built like [Teile]. */
internal class Figuren(
    private val scope: CoroutineScope,
    reportError: (Ergebnis.Fehler) -> Unit,
    suchPause: Long = 350,
    private val listen: MinifigsLocal,
) {
    private val _zustand = MutableStateFlow(MinifigsUiState())
    val zustand: StateFlow<MinifigsUiState> = _zustand.asStateFlow()
    private val sequence = Listenfolge(scope, _zustand, reportError, suchPause)

    suspend fun loadMetrics() {
        (listen.metrics() as? Ergebnis.Erfolg)
            ?.let { r -> _zustand.update { it.copy(minifigStats = r.data) } }
    }

    /**
     * Load the figures list. The key figures come along and show the whole
     * stock — not while typing, otherwise every keystroke would recount, with no
     * job that could cancel it.
     */
    fun laden(debounced: Boolean = false) {
        if (!debounced) scope.launch { loadMetrics() }
        sequence.starte(debounced) { sequenceMinifigs() }
    }

    private suspend fun sequenceMinifigs() {
        val st = _zustand.value
        sequence.sequenceAll(listOf(
            sequence.sequence(listen.figuren(st)) { s, l -> s.copy(minifigs = l) },
            sequence.sequence(listen.manualMinifigs(st)) { s, l -> s.copy(manualFigs = l) },
        ))
        _zustand.update { it.copy(minifigsFetch = Laden.Loads) }
        val r = listen.refresh(st)
        sequence.ausgang(r, listen.figuren(st).first().stand,
            { s, stand -> s.copy(minifigsFetch = Laden.Daten(Unit), minifigsOfflineStatus = stand) },
            { s, r -> s.copy(minifigsFetch = loadError(r)) })
    }

    fun setzeSuche(q: String) {
        _zustand.update { it.copy(minifigsQuery = q) }
        laden(debounced = true)
    }

    /** Cards or table; without a reload, the fields are already there. */
    fun setView(wert: ListView) = _zustand.update { it.copy(minifigsView = wert) }

    /** Take over a remembered search and view, without loading. */
    fun placeAgain(suche: String, ansicht: ListView) =
        _zustand.update { it.copy(minifigsQuery = suche, minifigsView = ansicht) }

    fun reset() {
        sequence.abbrechen()
        _zustand.value = MinifigsUiState()
    }
}
