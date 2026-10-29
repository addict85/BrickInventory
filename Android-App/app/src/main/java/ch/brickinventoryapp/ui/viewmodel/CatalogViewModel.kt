package ch.brickinventoryapp.ui.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.model.CatalogSetItem
import ch.brickinventoryapp.data.repository.BrickRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.CatalogUiState
import ch.brickinventoryapp.ui.fehlerTextBrauchtCode
import ch.brickinventoryapp.ui.fehlerTextId
import ch.brickinventoryapp.ui.retryOnNetwork
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.R

// Interaktive Katalog-Calls: schnell scheitern statt still minutenlang
// weiterversuchen — der Fehlerzustand hat einen Retry-Button.
private const val CATALOG_RETRIES = 2
private const val CATALOG_RETRY_DELAY_MS = 500L

/**
 * Der Katalog als eigenes ViewModel: Suche, Liste und Detail haben Jobs und eine
 * Filter-Generation, die als Felder einer Instanz gehören und nicht prozessweit.
 * Nicht über hiltViewModel(): Liste und Detail sind zwei NavHost-Ziele, und zwei
 * Instanzen sähen das „besitze ich“ des Details nicht in der Liste. Deshalb hält
 * es wie das AppViewModel die Activity.
 */
@HiltViewModel
class CatalogViewModel @Inject constructor(
    private val repo: BrickRepository,
    @param:ApplicationContext private val ctx: Context,
    meldungen: ch.brickinventoryapp.data.MeldungsKanal,
    // Nur fuer die EINE Frage „liegt ein Token vor?“ — siehe
    // meldungFuerSnackbar() weiter unten.
    private val prefs: ch.brickinventoryapp.data.PreferencesManager,
) : ViewModel() {

    private val _catalogState = MutableStateFlow(CatalogUiState())
    val state = _catalogState.asStateFlow()

    /**
     * Meldungen für die Snackbar — derselbe Fluss wie in allen ViewModels
     * (MeldungsKanal.kt), damit kein Ziel des Graphen sie weiterleiten muss.
     */
    private val _snackbar = meldungen.fluss

    /**
     * Text in der Sprache der App, wie AppTexte.text(): Den Application-Context
     * lokalisiert setApplicationLocales() unter Android 13 nicht, ctx.getString() gäbe
     * die Systemsprache aus.
     */
    private fun text(id: Int, vararg args: Any?): String {
        val c = ch.brickinventoryapp.util.LanguageManager.localizedContext(ctx)
        return if (args.isEmpty()) c.getString(id) else c.getString(id, *args)
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

    /**
     * Derselbe Satz wie in AppTexte.meldung(), über dieselbe Zuordnung fehlerTextId().
     * Die Servermeldung hat Vorrang — sie kennt ihren Fall genauer und kommt in der
     * Sprache des Kontos.
     */
    /**
     * Wie Texte.meldungFuerSnackbar() — null heisst: Der Kanal schweigt. Ein 401 ist
     * hier schon von der Sitzungsschicht behandelt (util/Abgewiesen.kt). „Angemeldet“
     * heisst: Es liegt ein Token vor — dieselbe Quelle, die der Interceptor liest,
     * nicht ein Flag der Oberfläche, das beim Anmelden zu früh wahr ist.
     */
    private fun meldungFuerSnackbar(fehler: Result.Error): String? =
        if (ch.brickinventoryapp.util.meldetDieSitzungsschicht(
                fehler.unauthorized,
                prefs.authTokenState.value?.isNotBlank() == true)) null
        else meldung(fehler)

    private fun meldung(fehler: Result.Error): String {
        if (fehler.message.isNotBlank()) return fehler.message
        val id = fehlerTextId(fehler.art)
        return if (fehlerTextBrauchtCode(fehler.art)) text(id, fehler.httpCode ?: 0)
        else text(id)
    }

    fun loadCatalogMeta() {
        viewModelScope.launch {
            when (val r = retryOnNetwork { repo.admin.getCatalogMeta() }) {
                is Result.Success -> if (r.data.success) _catalogState.update {
                    it.copy(
                        themes = r.data.themes, yearMin = r.data.yearMin, yearMax = r.data.yearMax
                    )
                }
                is Result.Error -> { /* Meta ist optional — Filter bleiben leer, Liste geht trotzdem */ }
            }
        }
    }

    /**
     * Erste Seite mit den aktuellen Filtern laden (ersetzt alles Geladene).
     * Bricht eine laufende Ladung ab (cancel-and-replace).
     */
    fun loadCatalogSets() {
        val gen = ++catalogGeneration
        catalogListJob?.cancel()
        catalogListJob = viewModelScope.launch {
            _catalogState.update {
                // Auch die gemerkte Position zurücksetzen: Nach einem Filterwechsel
                // zeigte sie auf Sets, die es in der neuen Liste nicht mehr gibt.
                it.copy(isLoading = true, error = null,
                        loadedPages = emptyMap(), loadingPages = emptySet(), scrollTo = null,
                        scrollIndex = 0, scrollOffset = 0, jahrVerteilung = emptyList())
            }
            ladeJahrVerteilung(gen)
            val s = _catalogState.value
            val r = retryOnNetwork(maxAttempts = CATALOG_RETRIES, delayMs = CATALOG_RETRY_DELAY_MS) {
                repo.admin.getCatalogSets(
                    q = s.query.ifBlank { null }, themeId = s.themeId,
                    yearFrom = s.year, yearTo = s.year, sort = s.sort, page = 1
                )
            }
            if (gen != catalogGeneration) return@launch   // inzwischen neuer Filter
            when (r) {
                is Result.Success -> {
                    if (r.data.success) _catalogState.update {
                        it.copy(isLoading = false, loadedPages = mapOf(1 to r.data.sets),
                                total = r.data.total)
                    } else _catalogState.update { it.copy(isLoading = false, error = r.data.error) }
                }
                is Result.Error -> {
                    _catalogState.update { it.copy(isLoading = false, error = meldung(r)) }
                    if (_catalogState.value.loadedPages.isNotEmpty()) _snackbar.value = meldungFuerSnackbar(r)
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
    fun ensureCatalogPage(seite: Int) {
        if (seite < 1) return
        val s = _catalogState.value
        if (s.loadedPages.containsKey(seite) || s.loadingPages.contains(seite)) return
        val gen = catalogGeneration
        _catalogState.update { it.copy(loadingPages = it.loadingPages + seite) }
        viewModelScope.launch {
            val r = retryOnNetwork(maxAttempts = CATALOG_RETRIES, delayMs = CATALOG_RETRY_DELAY_MS) {
                repo.admin.getCatalogSets(
                    q = s.query.ifBlank { null }, themeId = s.themeId,
                    yearFrom = s.year, yearTo = s.year, sort = s.sort, page = seite
                )
            }
            if (gen != catalogGeneration) return@launch
            _catalogState.update { st ->
                val ohne = st.loadingPages - seite
                when (r) {
                    is Result.Success ->
                        if (r.data.success) st.copy(loadingPages = ohne,
                            loadedPages = st.loadedPages + (seite to r.data.sets),
                            total = if (r.data.total > 0) r.data.total else st.total)
                        else st.copy(loadingPages = ohne)
                    is Result.Error -> st.copy(loadingPages = ohne)
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
            val r = repo.admin.getCatalogYearVerteilung(
                q = s.query.ifBlank { null }, themeId = s.themeId, sort = s.sort)
            if (gen != catalogGeneration) return@launch
            if (r is Result.Success && r.data.success) {
                // Jahrgaenge OHNE Jahr wegwerfen — genau wie die Webapp es tut.
                // Ihre Zahl bleibt in `total` enthalten; siehe
                // CatalogYearMath.jahrAnPosition.
                _catalogState.update { it.copy(jahrVerteilung = r.data.years.filter { j -> j.year != null }) }
            }
        }
    }

    /**
     * Die Leiste rechts rollt die Liste an eine Stelle. Die Nummer geht über den
     * Zustand an die Ansicht, weil dort gerollt wird; catalogScrollConsumed() setzt
     * sie zurück, sonst liesse sich dieselbe Stelle kein zweites Mal anfahren.
     */
    fun scrollCatalogTo(nummer: Int) {
        _catalogState.update { it.copy(scrollTo = nummer) }
    }

    /**
     * Die Ansicht meldet laufend ihre Rollposition; nur der Zustand wird gesetzt, kein
     * Abruf. Beim Zurückkehren von der Detailseite stellt sie daraus wieder her.
     */
    fun setCatalogScrollPos(index: Int, offset: Int) {
        _catalogState.update { it.copy(scrollIndex = index, scrollOffset = offset) }
    }

    /** Die Ansicht meldet, dass sie gesprungen ist. */
    fun catalogScrollConsumed() {
        _catalogState.update { it.copy(scrollTo = null) }
    }

    fun setCatalogQuery(q: String) {
        _catalogState.update { it.copy(query = q) }
        catalogSearchJob?.cancel()
        catalogSearchJob = viewModelScope.launch {
            delay(350)
            loadCatalogSets()
        }
    }

    fun setCatalogTheme(themeId: Int?) {
        _catalogState.update { it.copy(themeId = themeId) }
        loadCatalogSets()
    }

    fun setCatalogYear(year: Int?) {
        _catalogState.update { it.copy(year = year) }
        loadCatalogSets()
    }

    fun setCatalogSort(sort: String) {
        _catalogState.update { it.copy(sort = sort) }
        loadCatalogSets()
    }

    // ── Detail ────────────────────────────────────────────────────────────────────
    fun loadCatalogDetail(setNumber: String) {
        catalogDetailJob?.cancel()
        catalogDetailJob = viewModelScope.launch {
            _catalogState.update { it.copy(detailLoading = true, detail = null) }
            when (val r = retryOnNetwork(maxAttempts = CATALOG_RETRIES, delayMs = CATALOG_RETRY_DELAY_MS) { repo.admin.getCatalogSetDetail(setNumber) }) {
                is Result.Success -> {
                    if (r.data.success && r.data.set != null)
                        _catalogState.update { it.copy(detailLoading = false, detail = r.data.set) }
                    else {
                        _catalogState.update { it.copy(detailLoading = false) }
                        _snackbar.value = r.data.error ?: text(R.string.err_set_not_found)
                    }
                }
                is Result.Error -> {
                    _catalogState.update { it.copy(detailLoading = false) }
                    _snackbar.value = meldungFuerSnackbar(r)
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
            val markiere: (CatalogSetItem) -> CatalogSetItem = {
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
