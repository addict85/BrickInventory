package ch.brickinventoryapp.katalog.ui.viewmodel

import ch.brickinventoryapp.model.fach.Katalogsortierung
import ch.brickinventoryapp.zustand.ui.fehlerklasse
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.model.ui.model.KatalogSetAnsicht
import ch.brickinventoryapp.model.ui.model.alsAnsicht
import ch.brickinventoryapp.data.repository.KatalogRepository
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

/**
 * Wie lange die Liste ruhig stehen muss, bevor ihre sichtbaren Seiten geholt werden:
 * 150 ms wie in der Webapp (`_ladeSichtbareSeiten`). Ein Zug über die ganze Leiste
 * fällt so auf einen Abruf zusammen; kürzer als ein Berührungsabstand entprellte nichts.
 */
internal const val SICHTFENSTER_RUHE_MS = 150L

/**
 * Der Katalog als eigenes ViewModel: Suche, Liste und Detail haben Jobs und eine
 * Filter-Generation, die als Felder einer Instanz gehören und nicht prozessweit.
 * Nicht über hiltViewModel(): Liste und Detail sind zwei NavHost-Ziele, und zwei
 * Instanzen sähen das „besitze ich“ des Details nicht in der Liste. Deshalb hält
 * es wie das AppViewModel die Activity.
 */
@HiltViewModel
class CatalogViewModel @Inject constructor(
    private val katalog: KatalogRepository,
    private val meldungen: MeldungsKanal,
    /** Texte in der Sprache der App und Fehlermeldungen wie überall (AppTexte). */
    private val texte: Texte,
) : ViewModel(), KatalogAktionen {

    private val _catalogState = MutableStateFlow(CatalogUiState())
    val state = _catalogState.asStateFlow()

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
                is Ergebnis.Success -> if (r.data.success) _catalogState.update {
                    it.copy(
                        themes = r.data.themes.map { t -> t.alsAnsicht() }, yearMin = r.data.yearMin, yearMax = r.data.yearMax
                    )
                }
                is Ergebnis.Error -> { /* Meta ist optional — Filter bleiben leer, Liste geht trotzdem */ }
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
            _catalogState.update {
                // Auch die gemerkte Position zurücksetzen: Nach einem Filterwechsel
                // zeigte sie auf Sets, die es in der neuen Liste nicht mehr gibt.
                it.copy(isLoading = true, error = null, fehlerKlasse = null,
                        loadedPages = emptyMap(), loadingPages = emptySet(), scrollTo = null,
                        scrollIndex = 0, scrollOffset = 0, jahrVerteilung = emptyList())
            }
            ladeJahrVerteilung(gen)
            val s = _catalogState.value
            // Wiederholt wird im Repository, knapp: Der Fehlerzustand hat einen eigenen Knopf.
            val r = katalog.getCatalogSets(
                q = s.query.ifBlank { null }, themeId = s.themeId,
                yearFrom = s.year, yearTo = s.year, sort = s.sort, page = 1
            )
            if (gen != catalogGeneration) return@launch   // inzwischen neuer Filter
            when (r) {
                is Ergebnis.Success -> {
                    if (r.data.success) _catalogState.update {
                        it.copy(isLoading = false, loadedPages = mapOf(1 to r.data.sets.map { s -> s.alsAnsicht() }),
                                total = r.data.total)
                    } else _catalogState.update { it.copy(isLoading = false, error = r.data.error) }
                }
                is Ergebnis.Error -> {
                    _catalogState.update { it.copy(isLoading = false, error = texte.meldung(r), fehlerKlasse = fehlerklasse(r)) }
                    if (_catalogState.value.loadedPages.isNotEmpty()) meldungen.zeige(texte.meldungFuerSnackbar(r))
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
    private val sichtfenster = Sichtfensterlader(viewModelScope, SICHTFENSTER_RUHE_MS, ::ensureCatalogPage)

    /** Was das Raster gerade zeigt (Seiten, 1-basiert); geladen wird erst, wenn es ruht. */
    override fun catalogSichtbar(ersteSeite: Int, letzteSeite: Int) = sichtfenster.sichtbar(ersteSeite, letzteSeite)

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
                    is Ergebnis.Success ->
                        if (r.data.success) st.copy(loadingPages = ohne,
                            loadedPages = st.loadedPages + (seite to r.data.sets.map { s -> s.alsAnsicht() }),
                            total = if (r.data.total > 0) r.data.total else st.total)
                        else st.copy(loadingPages = ohne)
                    is Ergebnis.Error -> st.copy(loadingPages = ohne)
                }
            }
        }
    }

    /**
     * Die Jahresverteilung zu den aktuellen Filtern holen — vom Server, weil nur er
     * die Filter kennt; einmal je Listenaufbau wie in der Webapp. `gen` verwirft die
     * Antwort, wenn der Filter inzwischen gewechselt hat.
     */
    private fun ladeJahrVerteilung(gen: Int) {
        viewModelScope.launch {
            val s = _catalogState.value
            val r = katalog.getCatalogYearVerteilung(
                q = s.query.ifBlank { null }, themeId = s.themeId, sort = s.sort)
            if (gen != catalogGeneration) return@launch
            if (r is Ergebnis.Success && r.data.success) {
                // Jahrgaenge OHNE Jahr wegwerfen — genau wie die Webapp es tut.
                // Ihre Zahl bleibt in `total` enthalten; siehe
                // CatalogYearMath.jahrAnPosition.
                _catalogState.update { it.copy(jahrVerteilung = r.data.years.filter { j -> j.year != null }.map { j -> j.alsAnsicht() }) }
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

    /**
     * Die Ansicht meldet laufend ihre Rollposition; nur der Zustand wird gesetzt, kein
     * Abruf. Beim Zurückkehren von der Detailseite stellt sie daraus wieder her.
     */
    override fun setCatalogScrollPos(index: Int, offset: Int) {
        _catalogState.update { it.copy(scrollIndex = index, scrollOffset = offset) }
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
    fun loadCatalogDetail(setNumber: String) {
        catalogDetailJob?.cancel()
        catalogDetailJob = viewModelScope.launch {
            _catalogState.update { it.copy(detailLoading = true, detail = null) }
            when (val r = katalog.getCatalogSetDetail(setNumber)) {
                is Ergebnis.Success -> {
                    if (r.data.success && r.data.set != null)
                        _catalogState.update { it.copy(detailLoading = false, detail = r.data.set?.alsAnsicht()) }
                    else {
                        _catalogState.update { it.copy(detailLoading = false) }
                        meldungen.zeige(r.data.error ?: texte.text(R.string.err_set_not_found))
                    }
                }
                is Ergebnis.Error -> {
                    _catalogState.update { it.copy(detailLoading = false) }
                    meldungen.zeige(texte.meldungFuerSnackbar(r))
                }
            }
        }
    }

    /**
     * Ein aufgenommenes Set als „besitze ich“ markieren. Das Aufnehmen gehört der
     * Galerie, das Markieren dem Katalog; der Graph ruft beides nacheinander, damit
     * die Abhängigkeit an der Aufrufstelle steht.
     */
    fun markiereAufgenommen(setNumber: String, quantity: Int) {
        // Das „besitze ich“-Abzeichen sofort setzen, ohne neu zu laden — über alle
        // geladenen Seiten, weil die Kachel auf jeder stehen kann.
        _catalogState.update { st ->
            val markiere: (KatalogSetAnsicht) -> KatalogSetAnsicht = {
                if (it.setNumber == setNumber)
                    it.copy(owned = true, ownedQuantity = it.ownedQuantity + quantity) else it
            }
            st.copy(
                loadedPages = st.loadedPages.mapValues { (_, seite) -> seite.map(markiere) },
                detail = st.detail?.let {
                    if (it.setNumber == setNumber) it.copy(owned = true, ownedQuantity = it.ownedQuantity + quantity) else it
                }
            )
        }
    }
}
