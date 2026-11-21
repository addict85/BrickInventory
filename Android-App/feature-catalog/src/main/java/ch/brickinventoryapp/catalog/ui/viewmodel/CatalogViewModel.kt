package ch.brickinventoryapp.catalog.ui.viewmodel

import ch.brickinventoryapp.model.domain.Katalogsortierung
import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.state.ui.viewmodel.observeLoadOn
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.model.domain.KatalogSetAnsicht
import ch.brickinventoryapp.data.repository.CatalogRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.catalog.ui.CatalogUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.state.ui.viewmodel.Texte
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.data.repository.WantedRepository
import ch.brickinventoryapp.catalog.ui.KatalogZiel
import ch.brickinventoryapp.catalog.ui.Merkwunsch
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.model.domain.WantedItemView
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * How long the list must stay still before its visible pages are fetched:
 * 150 ms as in the web app (`_ladeSichtbareSeiten`). A drag across the whole bar
 * thus collapses into one fetch; shorter than a touch interval wouldn't debounce anything.
 */
internal const val VIEWPORT_REST_MS = 150L

/**
 * The catalog as its own ViewModel: search, list and detail have jobs and a
 * filter generation, which belong as fields of one instance, not process-wide.
 * Not via hiltViewModel(): list and detail are two NavHost destinations, and two
 * instances wouldn't see the detail's "I own this" in the list. That's why
 * it, like AppViewModel, is held by the Activity.
 */
@HiltViewModel
class CatalogViewModel @Inject constructor(
    private val katalog: CatalogRepository,
    private val meldungen: MeldungsKanal,
    /** Texts in the app's language and error messages like everywhere else (AppTexte). */
    private val texts: Texte,
    /** Watchlist and price alert: the detail shows the item and creates it, without knowing the collection. */
    private val merkliste: WantedRepository,
    private val alerts: AlarmRepository,
    private val rollgedaechtnis: ScrollMemory,
) : ViewModel(), KatalogAktionen {

    private val _catalogState = MutableStateFlow(CatalogUiState())
    val state = _catalogState.asStateFlow()

    init {
        // Only whoever sees the catalog loads it; returning only loads what's still missing.
        observeLoadOn(_catalogState) {
            val s = _catalogState.value
            if (s.loadedPages.isEmpty() && !s.abruf.laedt) { loadCatalogMeta(); loadCatalogSets() }
        }
    }

    // Debounced search: each keypress cancels the previous load
    // job, loading only starts 350 ms after the last one.
    private var catalogSearchJob: Job? = null

    // Active list/page load job: a filter change cancels the running
    // load IMMEDIATELY — including its retry wait times. Without that,
    // a hanging request (e.g. when parallel CDN image downloads
    // saturate the connection and API calls run into timeouts) would block
    // every further interaction in the catalog for minutes via
    // isLoading.
    private var catalogListJob: Job? = null
    private var catalogDetailJob: Job? = null

    // Filter generation: responses from an older generation are discarded —
    // prevents a late page-2 response of the OLD filter from being
    // appended to the new list (mixed content + duplicate LazyGrid keys).
    private var catalogGeneration = 0

    override fun loadCatalogMeta() {
        viewModelScope.launch {
            when (val r = katalog.getCatalogMeta()) {
                is Ergebnis.Erfolg -> _catalogState.update {
                    it.copy(themes = r.data.themen, yearMin = r.data.jahrMin, yearMax = r.data.jahrMax)
                }
                is Ergebnis.Fehler -> { /* Meta is optional — filters stay empty, the list still works */ }
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
            rollgedaechtnis.vergiss(KatalogZiel.Catalog.rollSchluessel)
            _catalogState.update {
                it.copy(abruf = Laden.Loads,
                        loadedPages = emptyMap(), loadingPages = emptySet(), scrollTo = null,
                        yearDistribution = emptyList())
            }
            loadYearDistribution(gen)
            val s = _catalogState.value
            // Retrying happens in the repository, briefly: the error state has its own button.
            val r = katalog.getCatalogSets(
                q = s.query.ifBlank { null }, themeId = s.themeId,
                yearFrom = s.year, yearTo = s.year, sort = s.sort, page = 1
            )
            if (gen != catalogGeneration) return@launch   // inzwischen neuer Filter
            when (r) {
                is Ergebnis.Erfolg -> {
                    _catalogState.update {
                        it.copy(abruf = Laden.Daten(Unit), loadedPages = mapOf(1 to r.data.sets), total = r.data.gesamt)
                    }
                }
                is Ergebnis.Fehler -> {
                    _catalogState.update { it.copy(abruf = loadError(r)) }
                    if (_catalogState.value.loadedPages.isNotEmpty()) meldungen.zeige(texts.meldungFuerSnackbar(r))
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
    private val viewport = Sichtfensterlader(viewModelScope, VIEWPORT_REST_MS, ::ensureCatalogPage)

    /** What the grid currently shows (pages, 1-based); only loaded once it's still. */
    override fun catalogVisible(firstPage: Int, lastPage: Int) = viewport.sichtbar(firstPage, lastPage)

    fun ensureCatalogPage(seite: Int) {
        if (seite < 1) return
        val s = _catalogState.value
        if (s.loadedPages.containsKey(seite) || s.loadingPages.contains(seite)) return
        val gen = catalogGeneration
        _catalogState.update { it.copy(loadingPages = it.loadingPages + seite) }
        viewModelScope.launch {
            // Retrying happens in the repository, briefly: the error state has its own button.
            val r = katalog.getCatalogSets(
                q = s.query.ifBlank { null }, themeId = s.themeId,
                yearFrom = s.year, yearTo = s.year, sort = s.sort, page = seite
            )
            if (gen != catalogGeneration) return@launch
            _catalogState.update { st ->
                val ohne = st.loadingPages - seite
                when (r) {
                    is Ergebnis.Erfolg ->
                        st.copy(loadingPages = ohne, loadedPages = st.loadedPages + (seite to r.data.sets),
                            total = if (r.data.gesamt > 0) r.data.gesamt else st.total)
                    is Ergebnis.Fehler -> st.copy(loadingPages = ohne)
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
            val r = katalog.getCatalogYearVerteilung(
                q = s.query.ifBlank { null }, themeId = s.themeId, sort = s.sort)
            if (gen != catalogGeneration) return@launch
            if (r is Ergebnis.Erfolg) {
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
    override fun scrollCatalogTo(nummer: Int) {
        _catalogState.update { it.copy(scrollTo = nummer) }
    }

    /** The view reports that it has jumped. */
    override fun catalogScrollConsumed() {
        _catalogState.update { it.copy(scrollTo = null) }
    }

    override fun setCatalogQuery(q: String) {
        _catalogState.update { it.copy(query = q) }
        catalogSearchJob?.cancel()
        catalogSearchJob = viewModelScope.launch {
            delay(350)
            loadCatalogSets()
        }
    }

    override fun setCatalogTheme(themeId: Int?) {
        _catalogState.update { it.copy(themeId = themeId) }
        loadCatalogSets()
    }

    override fun setCatalogYear(year: Int?) {
        _catalogState.update { it.copy(year = year) }
        loadCatalogSets()
    }

    override fun setCatalogSort(sort: Katalogsortierung) {
        _catalogState.update { it.copy(sort = sort) }
        loadCatalogSets()
    }

    // ── Detail ────────────────────────────────────────────────────────────────────
    /** The watchlist item for [setNumber] from the watchlist cache; null as long as the set isn't on it. */
    fun gemerkt(setNumber: String): Flow<WantedItemView?> =
        merkliste.observeWanted().map { l -> l.liste.firstOrNull { it.setNumber == setNumber } }

    /** Watchlist, and if a threshold is given, the price alert right along with it. */
    fun merke(w: Merkwunsch) {
        viewModelScope.launch {
            when (val r = merkliste.legeMerkpostenAn(w.setNumber, w.zustand, w.konto)) {
                is Ergebnis.Fehler ->
                    meldungen.zeige(texts.meldungFuerSnackbar(r)?.let { Meldung.Resource(R.string.vm_error, listOf(it)) })
                is Ergebnis.Erfolg -> {
                    Alarmeingabe.zahl(w.thresholdRaw)?.let { alerts.setPreisalarm(w.setNumber, w.richtung, it, w.zustand) }
                    meldungen.zeige(Meldung.Resource(if (r.data) R.string.wanted_added else R.string.wanted_already))
                }
            }
        }
    }

    fun loadCatalogDetail(setNumber: String) {
        catalogDetailJob?.cancel()
        catalogDetailJob = viewModelScope.launch {
            // The watchlist into the cache, so [gemerkt] knows the item; silent, the detail counts.
            launch { merkliste.refreshWanted() }
            _catalogState.update { it.copy(detail = Laden.Loads) }
            // The error belongs in the state, not in a snackbar: the screen has
            // nothing to show without the detail and needs a reason and "Try again".
            when (val r = katalog.getCatalogSetDetail(setNumber)) {
                is Ergebnis.Erfolg -> {
                    val detail = r.data
                    val geladen = if (detail != null) Laden.Daten(detail)
                    else Laden.Fehler(Fehlerklasse.UNBEKANNT, Meldung.Resource(R.string.err_set_not_found))
                    _catalogState.update { it.copy(detail = geladen) }
                }
                is Ergebnis.Fehler -> _catalogState.update { it.copy(detail = loadError(r)) }
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
            val mark: (KatalogSetAnsicht) -> KatalogSetAnsicht = {
                if (it.setNumber == setNumber)
                    it.copy(owned = true, ownedQuantity = it.ownedQuantity + quantity) else it
            }
            st.copy(
                loadedPages = st.loadedPages.mapValues { (_, seite) -> seite.map(mark) },
                detail = st.detail.let {
                    if (it is Laden.Daten && it.wert.setNumber == setNumber)
                        Laden.Daten(it.wert.copy(owned = true, ownedQuantity = it.wert.ownedQuantity + quantity)) else it
                }
            )
        }
    }
}
