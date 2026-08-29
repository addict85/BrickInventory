package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.model.CatalogSetItem
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Katalog: Rebrickable-Set-Katalog browsen, suchen, filtern.
 *
 * Feature-Modul des MainViewModel (Muster wie GalleryFeature/PartsFeature):
 * Extension-Functions, die über internal-Sichtbarkeit auf die geteilten
 * Flows zugreifen. Daten kommen von den /api/v1/catalog-Endpunkten —
 * serverseitig
 * paginiert (~25k Sets), das Scrollen lädt seitenweise nach.
 */

// Entprellte Suche: Job-Referenz prozessweit am VM — pro Tastendruck wird der
// vorherige Lade-Job abgebrochen, geladen wird erst 350ms nach dem letzten.
private var catalogSearchJob: Job? = null

// Aktiver Listen-/Seiten-Lade-Job (Muster wie partsJob im MainViewModel):
// Ein Filterwechsel bricht die laufende Ladung SOFORT ab — inklusive ihrer
// Retry-Wartezeiten. Ohne das blockierte ein hängender Request (z.B. wenn
// parallele CDN-Bilddownloads die Verbindung sättigen und API-Calls in
// Timeouts laufen) über isLoading minutenlang jede weitere
// Interaktion im Katalog.
private var catalogListJob: Job? = null
private var catalogDetailJob: Job? = null

// Filter-Generation: Antworten einer älteren Generation werden verworfen —
// verhindert, dass eine späte Seite-2-Antwort des ALTEN Filters an die neue
// Liste angehängt wird (gemischte Inhalte + doppelte LazyGrid-Keys).
private var catalogGeneration = 0

// Interaktive Katalog-Calls: schnell scheitern statt still minutenlang
// weiterversuchen — der Fehlerzustand hat einen Retry-Button.
private const val CATALOG_RETRIES = 2
private const val CATALOG_RETRY_DELAY_MS = 500L

internal fun MainViewModel.loadCatalogMeta() {
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
internal fun MainViewModel.loadCatalogSets() {
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
internal fun MainViewModel.ensureCatalogPage(seite: Int) {
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
internal fun MainViewModel.jumpToCatalogYear(year: Int) {
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
internal fun MainViewModel.setCatalogScrollPos(index: Int, offset: Int) {
    _catalogState.update { it.copy(scrollIndex = index, scrollOffset = offset) }
}

/** Die Ansicht meldet, dass sie gesprungen ist. */
internal fun MainViewModel.catalogScrollConsumed() {
    _catalogState.update { it.copy(scrollTo = null) }
}

internal fun MainViewModel.setCatalogQuery(q: String) {
    _catalogState.update { it.copy(query = q) }
    catalogSearchJob?.cancel()
    catalogSearchJob = viewModelScope.launch {
        delay(350)
        loadCatalogSets()
    }
}

internal fun MainViewModel.setCatalogTheme(themeId: Int?) {
    _catalogState.update { it.copy(themeId = themeId) }
    loadCatalogSets()
}

internal fun MainViewModel.setCatalogYear(year: Int?) {
    _catalogState.update { it.copy(year = year) }
    loadCatalogSets()
}

internal fun MainViewModel.setCatalogSort(sort: String) {
    _catalogState.update { it.copy(sort = sort) }
    loadCatalogSets()
}

// ── Detail ────────────────────────────────────────────────────────────────────
internal fun MainViewModel.loadCatalogDetail(setNumber: String) {
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
 * Set aus dem Katalog in die Galerie aufnehmen — nutzt den bestehenden
 * addSet-Flow (GalleryFeature) und aktualisiert danach owned-Flags
 * in Katalog-Liste und -Detail lokal, ohne die Seite neu zu laden.
 */
/**
 * Aus dem Katalog in die Galerie aufnehmen — mit Kontowahl (Nachtrag 67).
 *
 * Der Katalog war der VIERTE Erfassungsweg und trug den Eigentümer als
 * einziger nirgends: nicht im Dialog, nicht in der Signatur, nicht im Aufruf.
 * Folge: Ein aus dem Katalog aufgenommenes Set landete IMMER beim eigenen
 * Konto, ohne Hinweis. In der Webapp war es dieselbe Lücke (Nachtrag 66).
 */
internal fun MainViewModel.addCatalogSetToGallery(setNumber: String, quantity: Int, purchasePrice: Double?,
                                                  condition: String?, ownerUserId: Int? = null) {
    addSet(setNumber, quantity, purchasePrice, condition, ownerUserId)
    // Das „besitze ich"-Abzeichen sofort setzen, ohne die Liste neu zu holen.
    //
    // Seit dem Fensterladen (Nachtrag 86) liegen die Sets nicht mehr in einer
    // flachen Liste, sondern in `loadedPages` je Seite — die Kachel kann auf
    // JEDER geladenen Seite stehen, deshalb wird über alle gegangen. Vorher
    // stand hier `st.sets`, was es nicht mehr gibt.
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
