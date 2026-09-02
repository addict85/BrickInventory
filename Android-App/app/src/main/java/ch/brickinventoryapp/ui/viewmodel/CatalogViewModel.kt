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

// Interaktive Katalog-Calls: schnell scheitern statt still minutenlang
// weiterversuchen — der Fehlerzustand hat einen Retry-Button.
private const val CATALOG_RETRIES = 2
private const val CATALOG_RETRY_DELAY_MS = 500L

/**
 * Der Katalog als eigenes ViewModel.
 *
 * ── Was das behebt, und es ist kein Schoenheitsfehler ──────────────────────
 * Als Erweiterungsfunktionen auf MainViewModel konnten diese zwoelf Funktionen
 * KEINEN Zustand halten — eine Erweiterung hat keine Felder. Die vier Dinge,
 * die sie trotzdem brauchen, standen deshalb auf DATEIEBENE:
 *
 *     private var catalogSearchJob, catalogListJob, catalogDetailJob
 *     private var catalogGeneration
 *
 * Das ist prozessweiter veraenderlicher Zustand. Heute faellt es nicht auf,
 * weil es genau ein MainViewModel je Prozess gibt — die Kommentare in
 * CatalogFeature.kt sagten das sogar ausdruecklich („Job-Referenz prozessweit
 * am VM"). Es stimmt aber nur, solange das so bleibt: Zwei Instanzen wuerden
 * sich Abbruch-Jobs und Filter-Generation teilen, und eine Ladung wuerde die
 * andere abbrechen. Als Felder dieser Klasse ist die Frage weg.
 *
 * ── Warum es NICHT an hiltViewModel() haengt ───────────────────────────────
 * Liste und Detail sind zwei getrennte NavHost-Ziele. `hiltViewModel()` bindet
 * an den Backstack-Eintrag, es gaebe also ZWEI Instanzen: Das Detail setzt
 * „besitze ich", und die Liste bekaeme es nie zu sehen. Beim Monitoring war
 * die Bindung an den Eintrag richtig, hier waere sie ein Fehler.
 *
 * Deshalb wird es wie MainViewModel von der Activity gehalten und
 * hereingereicht. Die Lebensdauer bleibt damit exakt die bisherige — diese
 * Aenderung soll den Aufbau aendern, nicht das Verhalten.
 *
 * ── Meldungen ──────────────────────────────────────────────────────────────
 * Der Katalog fuehrt seinen eigenen Meldungsfluss; der Graph reicht ihn an die
 * eine Snackbar des MainViewModel weiter. Zwei Snackbar-Halter waeren zwei
 * Warteschlangen fuer eine sichtbare Leiste.
 */
@HiltViewModel
class CatalogViewModel @Inject constructor(
    private val repo: BrickRepository,
    @param:ApplicationContext private val ctx: Context,
    meldungen: ch.brickinventoryapp.data.MeldungsKanal,
) : ViewModel() {

    private val _catalogState = MutableStateFlow(CatalogUiState())
    val state = _catalogState.asStateFlow()

    /**
     * Meldungen fuer die Snackbar — jetzt DERSELBE Fluss wie im MainViewModel.
     *
     * Vorher hatte dieses ViewModel einen eigenen, und der Navigationsgraph
     * musste ihn weiterleiten und quittieren: zwei gleichlautende Bloecke in
     * CatalogGraph.kt, einer je Ziel. Wer ein drittes Ziel hinzufuegt und den
     * Block vergisst, verliert die Meldungen dieses Bildschirms lautlos.
     * Begruendung und Muster: MeldungsKanal.kt.
     */
    private val _snackbar = meldungen.fluss

    /**
     * Text in der SPRACHE DER APP — dieselbe Regel wie in MainViewModel.text().
     *
     * `ctx` ist der Application-Context, und den lokalisiert
     * AppCompatDelegate.setApplicationLocales() unterhalb von Android 13
     * nicht. Ein direktes ctx.getString() gab hier die Systemsprache aus —
     * ausgerechnet in meldung(), der Stelle, die es nur gibt, damit
     * Fehlermeldungen in der gewaehlten Sprache erscheinen.
     */
    private fun text(id: Int, vararg args: Any): String {
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
     * Derselbe Satz wie in MainViewModel.meldung(), ueber dieselbe gepruefte
     * Zuordnung fehlerTextId(). Bewusst hier und nicht weitergereicht: Die
     * Zuordnung Ursache -> Text ist die gemeinsame Stelle, nicht diese vier
     * Zeilen. Die Servermeldung hat Vorrang — sie kennt ihren Fall genauer
     * und kommt in der Sprache des Kontos.
     */
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
                        themes = r.data.themes, yearMin = r.data.yearMin, yearMax = r.data.yearMax,
                        yearCounts = r.data.yearCounts.associate { yc -> yc.year to yc.n }
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
                        scrollIndex = 0, scrollOffset = 0)
            }
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
                    if (_catalogState.value.loadedPages.isNotEmpty()) _snackbar.value = meldung(r)
                }
            }
        }
    }

    /**
     * Die Seite laden, auf der ein sichtbar gewordener Platz liegt.
     *
     * Wird von der Ansicht für jede Seite aufgerufen, die gerade ins Bild kommt —
     * beim Scrollen nach unten, nach oben und nach einem Sprung. Bereits geladene
     * oder gerade ladende Seiten werden übersprungen; ohne diese Prüfung löste
     * jeder Scroll-Schritt denselben Abruf mehrfach aus.
     *
     * Antworten einer älteren Filter-Generation werden verworfen — sonst hinge
     * eine späte Seite des ALTEN Filters in der neuen Liste.
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
     * Zum ersten Set eines Jahres springen — OHNE zu filtern.
     *
     * Das ist der Unterschied, auf den es Marco ankam: Ein Filter wirft die
     * anderen Jahre weg, ein Sprung lässt sie stehen. Wohin gesprungen wird,
     * rechnet der Server (GET /api/v1/catalog/year-offset) mit denselben Filtern
     * und derselben Sortierung wie die Liste — die App kennt immer nur die
     * geladenen Seiten und könnte es gar nicht selbst wissen.
     *
     * Die Zielseite wird gleich mitgeladen, damit an der Sprungstelle nicht für
     * einen Moment nur Platzhalter stehen.
     */
    fun jumpToCatalogYear(year: Int) {
        val s = _catalogState.value
        viewModelScope.launch {
            val r = repo.admin.getCatalogYearOffset(
                year = year, q = s.query.ifBlank { null }, themeId = s.themeId, sort = s.sort)
            if (r is Result.Success && r.data.success) {
                ensureCatalogPage(r.data.page)
                _catalogState.update { it.copy(scrollTo = r.data.offset) }
            } else if (r is Result.Error) {
                _snackbar.value = meldung(r)
            }
        }
    }

    /**
     * Die Ansicht meldet ihre Rollposition.
     *
     * Wird beim Scrollen laufend aufgerufen; nur der Zustand wird gesetzt, kein
     * Abruf. Beim Zurückkehren von der Detailseite stellt die Ansicht daraus wieder
     * her.
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
                        _snackbar.value = r.data.error ?: "Set nicht gefunden"
                    }
                }
                is Result.Error -> {
                    _catalogState.update { it.copy(detailLoading = false) }
                    _snackbar.value = meldung(r)
                }
            }
        }
    }

    /**
     * Ein aufgenommenes Set als „besitze ich" markieren.
     *
     * Frueher war das die zweite Haelfte von addCatalogSetToGallery(), die
     * zuerst addSet() aus GalleryFeature rief. Das Aufnehmen gehoert der
     * Galerie, das Markieren dem Katalog — der Graph ruft jetzt beides
     * nacheinander. Damit steht die Abhaengigkeit an der Aufrufstelle statt
     * versteckt in einer Funktion, die zwei Sachgebiete anfasst.
     *
     * Der Eigentuemer (Nachtrag 67) wird im addSet-Aufruf uebergeben; hier
     * spielt er keine Rolle, markiert wird die eigene Ansicht.
     */
    fun markiereAufgenommen(setNumber: String, quantity: Int) {
        // Das „besitze ich"-Abzeichen sofort setzen, ohne die Liste neu zu holen.
        //
        // Seit dem Fensterladen (Nachtrag 86) liegen die Sets nicht mehr in einer
        // flachen Liste, sondern in `loadedPages` je Seite — die Kachel kann auf
        // JEDER geladenen Seite stehen, deshalb wird ueber alle gegangen.
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
