package ch.brickinventoryapp.katalog.ui.viewmodel

import ch.brickinventoryapp.model.fach.Katalogsortierung
import ch.brickinventoryapp.zustand.ui.loadError
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.zustand.ui.viewmodel.observeLoadOn
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.model.fach.KatalogSetAnsicht
import ch.brickinventoryapp.data.repository.CatalogRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.katalog.ui.CatalogUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.zustand.ui.viewmodel.Texte
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.data.repository.WantedRepository
import ch.brickinventoryapp.katalog.ui.KatalogZiel
import ch.brickinventoryapp.katalog.ui.Merkwunsch
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.model.fach.WantedItemView
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Wie lange die Liste ruhig stehen muss, bevor ihre sichtbaren Seiten geholt werden:
 * 150 ms wie in der Webapp (`_ladeSichtbareSeiten`). Ein Zug über die ganze Leiste
 * fällt so auf einen Abruf zusammen; kürzer als ein Berührungsabstand entprellte nichts.
 */
internal const val VIEWPORT_REST_MS = 150L

/**
 * Der Katalog als eigenes ViewModel: Suche, Liste und Detail haben Jobs und eine
 * Filter-Generation, die als Felder einer Instanz gehören und nicht prozessweit.
 * Nicht über hiltViewModel(): Liste und Detail sind zwei NavHost-Ziele, und zwei
 * Instanzen sähen das „besitze ich“ des Details nicht in der Liste. Deshalb hält
 * es wie das AppViewModel die Activity.
 */
@HiltViewModel
class CatalogViewModel @Inject constructor(
    private val katalog: CatalogRepository,
    private val meldungen: MeldungsKanal,
    /** Texte in der Sprache der App und Fehlermeldungen wie überall (AppTexte). */
    private val texts: Texte,
    /** Merkliste und Preisalarm: Das Detail zeigt den Posten und legt ihn an, ohne die Sammlung zu kennen. */
    private val merkliste: WantedRepository,
    private val alerts: AlarmRepository,
    private val rollgedaechtnis: ScrollMemory,
) : ViewModel(), KatalogAktionen {

    private val _catalogState = MutableStateFlow(CatalogUiState())
    val state = _catalogState.asStateFlow()

    init {
        // Erst wer den Katalog sieht, lädt ihn; ein Zurückkehren lädt nur, was noch fehlt.
        observeLoadOn(_catalogState) {
            val s = _catalogState.value
            if (s.loadedPages.isEmpty() && !s.abruf.laedt) { loadCatalogMeta(); loadCatalogSets() }
        }
    }

    // Entprellte Suche: pro Tastendruck wird der vorherige Lade-Job
    // abgebrochen, geladen wird erst 350ms nach dem letzten.
    private var catalogSearchJob: Job? = null

    // Aktiver Listen-/Seiten-Lade-Job: Ein Filterwechsel bricht die laufende
    // Ladung SOFORT ab — inklusive ihrer Retry-Wartezeiten. Ohne das
    // blockierte ein haengender Request (z.B. wenn parallele CDN-Bilddownloads
    // die Verbindung saettigen und API-Calls in Timeouts laufen) ueber
    // isLoading minutenlang jede weitere Interaktion im Katalog.
    private var catalogListJob: Job? = null
    private var catalogDetailJob: Job? = null

    // Filter-Generation: Antworten einer aelteren Generation werden verworfen —
    // verhindert, dass eine spaete Seite-2-Antwort des ALTEN Filters an die
    // neue Liste angehaengt wird (gemischte Inhalte + doppelte LazyGrid-Keys).
    private var catalogGeneration = 0

    override fun loadCatalogMeta() {
        viewModelScope.launch {
            when (val r = katalog.getCatalogMeta()) {
                is Ergebnis.Erfolg -> _catalogState.update {
                    it.copy(themes = r.data.themen, yearMin = r.data.jahrMin, yearMax = r.data.jahrMax)
                }
                is Ergebnis.Fehler -> { /* Meta ist optional — Filter bleiben leer, Liste geht trotzdem */ }
            }
        }
    }

    /**
     * Erste Seite mit den aktuellen Filtern laden (ersetzt alles Geladene).
     * Bricht eine laufende Ladung ab (cancel-and-replace).
     */
    override fun loadCatalogSets() {
        val gen = ++catalogGeneration
        catalogListJob?.cancel()
        catalogListJob = viewModelScope.launch {
            // Auch die gemerkte Stelle vergessen: Nach einem Filterwechsel zeigte sie auf
            // Sets, die es in der neuen Liste nicht mehr gibt.
            rollgedaechtnis.vergiss(KatalogZiel.Catalog.rollSchluessel)
            _catalogState.update {
                it.copy(abruf = Laden.Loads,
                        loadedPages = emptyMap(), loadingPages = emptySet(), scrollTo = null,
                        yearDistribution = emptyList())
            }
            loadYearDistribution(gen)
            val s = _catalogState.value
            // Wiederholt wird im Repository, knapp: Der Fehlerzustand hat einen eigenen Knopf.
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
     * Die Seite laden, auf der ein sichtbar gewordener Platz liegt — beim Scrollen in
     * beide Richtungen und nach einem Sprung. Geladene oder ladende Seiten werden
     * übersprungen; Antworten einer älteren Filter-Generation verworfen, sonst hinge
     * eine späte Seite des alten Filters in der neuen Liste.
     */
    private val viewport = Sichtfensterlader(viewModelScope, VIEWPORT_REST_MS, ::ensureCatalogPage)

    /** Was das Raster gerade zeigt (Seiten, 1-basiert); geladen wird erst, wenn es ruht. */
    override fun catalogVisible(firstPage: Int, lastPage: Int) = viewport.sichtbar(firstPage, lastPage)

    fun ensureCatalogPage(seite: Int) {
        if (seite < 1) return
        val s = _catalogState.value
        if (s.loadedPages.containsKey(seite) || s.loadingPages.contains(seite)) return
        val gen = catalogGeneration
        _catalogState.update { it.copy(loadingPages = it.loadingPages + seite) }
        viewModelScope.launch {
            // Wiederholt wird im Repository, knapp: Der Fehlerzustand hat einen eigenen Knopf.
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
     * Die Jahresverteilung zu den aktuellen Filtern holen — vom Server, weil nur er
     * die Filter kennt; einmal je Listenaufbau wie in der Webapp. `gen` verwirft die
     * Antwort, wenn der Filter inzwischen gewechselt hat.
     */
    private fun loadYearDistribution(gen: Int) {
        viewModelScope.launch {
            val s = _catalogState.value
            val r = katalog.getCatalogYearVerteilung(
                q = s.query.ifBlank { null }, themeId = s.themeId, sort = s.sort)
            if (gen != catalogGeneration) return@launch
            if (r is Ergebnis.Erfolg) {
                // Jahrgaenge OHNE Jahr wegwerfen — genau wie die Webapp es tut.
                // Ihre Zahl bleibt in `total` enthalten; siehe
                // CatalogYearMath.yearAnPosition.
                _catalogState.update { it.copy(yearDistribution = r.data.filter { j -> j.year != null }) }
            }
        }
    }

    /**
     * Die Leiste rechts rollt die Liste an eine Stelle. Die Nummer geht über den
     * Zustand an die Ansicht, weil dort gerollt wird; catalogScrollConsumed() setzt
     * sie zurück, sonst liesse sich dieselbe Stelle kein zweites Mal anfahren.
     */
    override fun scrollCatalogTo(nummer: Int) {
        _catalogState.update { it.copy(scrollTo = nummer) }
    }

    /** Die Ansicht meldet, dass sie gesprungen ist. */
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
    /** Der Merkposten zu [setNumber] aus der Ablage der Merkliste; null, solange das Set nicht darauf steht. */
    fun gemerkt(setNumber: String): Flow<WantedItemView?> =
        merkliste.observeWanted().map { l -> l.liste.firstOrNull { it.setNumber == setNumber } }

    /** Merken und, wenn eine Schwelle dasteht, den Preisalarm gleich mit. */
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
            // Die Merkliste in die Ablage, damit [gemerkt] den Posten kennt; still, das Detail zählt.
            launch { merkliste.refreshWanted() }
            _catalogState.update { it.copy(detail = Laden.Loads) }
            // Der Fehler gehört in den Zustand, nicht in eine Snackbar: Der Bildschirm hat
            // ohne Detail nichts zu zeigen und braucht einen Grund und „Erneut versuchen“.
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
     * Ein aufgenommenes Set als „besitze ich“ markieren. Das Aufnehmen gehört der
     * Galerie, das Markieren dem Katalog; der Graph ruft beides nacheinander, damit
     * die Abhängigkeit an der Aufrufstelle steht.
     */
    fun markCaptured(setNumber: String, quantity: Int) {
        // Das „besitze ich“-Abzeichen sofort setzen, ohne neu zu laden — über alle
        // geladenen Seiten, weil die Kachel auf jeder stehen kann.
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
