package ch.brickinventoryapp.collection.ui.viewmodel

import ch.brickinventoryapp.state.ui.viewmodel.Observed
import ch.brickinventoryapp.state.ui.viewmodel.loadPerServer
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.domain.Setsortierung
import ch.brickinventoryapp.session.abgeleitet
import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.model.domain.MetricsView
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.FinancesRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.data.repository.Kontosicht
import ch.brickinventoryapp.collection.ui.Galerie
import ch.brickinventoryapp.collection.ui.GalleryUiState
import ch.brickinventoryapp.collection.ui.TilePrice
import ch.brickinventoryapp.collection.ui.tilePrices
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.state.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.state.ui.viewmodel.Meldungen
import ch.brickinventoryapp.state.ui.viewmodel.Texte
import ch.brickinventoryapp.state.ui.viewmodel.sequenceSignOut

/**
 * Die Sammlung der Sets: Liste, Filter, Kennzahlen.
 *
 * Die Abläufe (Entprellen, Quelle wechseln) stehen in [Galerie]; dieses
 * ViewModel wählt die Quelle: die Ablage, über gewählte Konten die Kontosicht.
 * Suche, Thema und Sortierung stehen im [SavedStateHandle].
 */
@HiltViewModel
class GalleryViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val changes: Bestandsabgleich,
    private val scrollMemory: ScrollMemory,
    private val sets: SetsRepository,
    private val kontosicht: Kontosicht,
    private val finanzen: FinancesRepository,
    private val gemerkt: SavedStateHandle,
) : ViewModel(), Filterwahl by filter {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        sequenceSignOut(sitzung) { reset() }
        // Die Kennzahlen rechnet der Server über den Bestand; ändert er sich in der Ablage, stimmen sie nicht mehr.
        viewModelScope.launch { changes.inventoryChanged().collect { loadStats() } }
    }

    override fun setScope(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setAccount(view, value)
            afterFilter(view)
        }
    }

    override fun setStorageFilter(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setzeLager(view, value)
            afterFilter(view)
        }
    }

    /** Über gewählte Konten rechnet nur der Server die Mengen; sonst gilt die Ablage. */
    private fun accountQuery(g: GalleryUiState): Kontosicht.SetsQuery? =
        filter.accountFor(ScopeFilter.View.GALLERY)?.let {
            Kontosicht.SetsQuery(it, g.galleryQuery.ifBlank { null }, g.galleryTheme.ifBlank { null }, g.gallerySort,
                filter.storageFor(ScopeFilter.View.GALLERY)?.ifBlank { null })
        }

    private val galerie = Galerie(
        scope = viewModelScope,
        quelle = { g ->
            accountQuery(g)?.let { kontosicht.galerie.observe(it) }
                ?: sets.observeSets(g.galleryQuery, g.galleryTheme, filter.storageFor(ScopeFilter.View.GALLERY), g.gallerySort)
        },
        refresh = { g -> accountQuery(g)?.let { kontosicht.galerie.refresh(it) } ?: sets.aktualisiereSets() },
        fetchMetrics = { finanzen.getStats(filter.accountFor(ScopeFilter.View.GALLERY)) },
        reportError = { meldungen.zeige(meldungen.meldungFuerSnackbar(it)) },
        vergissScroll = { scrollMemory.vergiss("gallery") },
    )
    /** Ein gelöschtes Set, das sich noch zurückholen lässt — die Snackbar „Rückgängig“. */
    data class ReservedDelete(val setNumber: String, val name: String, val set: SetAnsicht? = null)

    private val _reserved = MutableStateFlow<ReservedDelete?>(null)
    val vorgemerkt: StateFlow<ReservedDelete?> = _reserved.asStateFlow()

    /**
     * Die Galerie ohne das vorgemerkte Set: Die Ablage führt es bis zum Löschen beim
     * Server, und „Rückgängig“ zeigt es so ohne Neuladen wieder.
     */
    private val galleryObserved = Observed(galerie.state
        .abgeleitet(_reserved) { st, v ->
            // Die Kennzahlen ebenso: Neben zwei Kacheln stand sonst noch „3 Sets“.
            if (v == null) st else st.copy(sets = st.sets.filterNot { it.setNumber == v.setNumber },
                stats = st.stats?.let { k -> v.set?.let { withoutSet(k, it) } ?: k })
        })
    val galleryState: StateFlow<GalleryUiState> = galleryObserved

    private val _prices = MutableStateFlow<Map<String, TilePrice>>(emptyMap())
    /** Marktpreis und G&V je Set; eigener Fluss, weil er nach der Liste kommt. */
    val preise: StateFlow<Map<String, TilePrice>> = _prices.asStateFlow()

    init {
        galerie.placeFilterAgain(
            suche = gemerkt[SEARCH] ?: "",
            thema = gemerkt[THEME] ?: "",
            sorting = Setsortierung.aus(gemerkt[SORTING]),
        )
        loadPerServer(sitzung, galleryObserved) { loadIfEmpty() }
    }

    fun loadSets() = galerie.laden()

    /**
     * Beim Zeigen (loadPerServer): laden, wenn die Galerie leer ist und ein Server
     * eingetragen ist; ein Fehlschlag beim Start wird so beim nächsten Betreten wiederholt.
     */
    fun loadIfEmpty() {
        val g = galerie.state.value
        if (sitzung.state.value.serverUrl.isBlank() || g.sets.isNotEmpty() || g.abruf.laedt) return
        loadSets()
        loadStats()
    }
    fun loadStats() {
        galerie.loadMetrics()
        loadPrices()
    }

    /**
     * Preis und G&V für die Kacheln. Scheitert der Abruf, bleiben die alten
     * Werte stehen und die Kachel fällt auf den Kaufpreis zurück; der Fehler
     * des Reiters kommt aus der Liste, nicht aus dieser Zugabe.
     */
    private fun loadPrices() {
        viewModelScope.launch {
            val r = finanzen.getPnl(filter.accountFor(ScopeFilter.View.GALLERY))
            if (r is Ergebnis.Erfolg) _prices.value = tilePrices(r.data.sets)
        }
    }

    fun setGalleryQuery(q: String) {
        gemerkt[SEARCH] = q
        galerie.setzeSuche(q)
    }

    fun setGalleryTheme(theme: String) {
        gemerkt[THEME] = theme
        galerie.setzeThema(theme)
    }

    fun setGallerySort(sort: Setsortierung) {
        gemerkt[SORTING] = sort.kennung
        galerie.setzeSortierung(sort)
    }

    /**
     * Herunterziehen: Liste, Kennzahlen und die Filterlisten. Scheiterte deren
     * einziger Abruf beim Start, fehlten Konto- und Lagerfilter sonst bis zum
     * nächsten Start.
     */
    fun aktualisieren() {
        loadSets()
        loadStats()
        viewModelScope.launch {
            filter.loadMembers()
            filter.ladeLagerorte()
        }
    }

    /**
     * Löschen mit „Rückgängig“: Die Kachel verschwindet sofort, der Server erfährt
     * davon erst mit [executeDelete] — eine Rückfrage allein schützte nicht vor
     * dem falschen Set. Ein noch offenes früheres Löschen wird zuerst ausgeführt.
     */
    fun loeschenVormerken(setNumber: String, name: String) {
        executeDelete()
        val set = galerie.state.value.sets.firstOrNull { it.setNumber == setNumber }
        _reserved.value = ReservedDelete(setNumber, name, set)
    }

    /**
     * Das vorgemerkte Set bleibt; es stand die ganze Zeit in der Ablage.
     * [nur]: nur dieses — die Snackbar eines abgelösten Löschens holt nicht das nächste zurück.
     */
    fun rueckgaengig(nur: ReservedDelete? = null) {
        val v = _reserved.value ?: return
        if (nur != null && v != nur) return
        _reserved.value = null
    }

    /**
     * [nur]: nur dieses. Endet die Snackbar eines abgelösten Löschens, darf sie das
     * neue nicht ausführen — sonst wäre es ohne „Rückgängig“ gelöscht.
     */
    fun executeDelete(nur: ReservedDelete? = null) {
        val v = _reserved.value ?: return
        if (nur != null && v != nur) return
        _reserved.value = null
        deleteSet(v.setNumber, successReport = false)
    }

    /** [successReport] aus, wenn „gelöscht“ schon in der Snackbar mit „Rückgängig“ stand. */
    fun deleteSet(setNumber: String, successReport: Boolean = true) {
        viewModelScope.launch {
            val (geloescht, satz) = setLoeschen(sets, meldungen, setNumber)
            if (!geloescht || successReport) meldungen.zeige(satz)
        }
    }

    private fun afterFilter(view: ScopeFilter.View) {
        if (view != ScopeFilter.View.GALLERY) return
        loadSets()
        loadStats()
    }

    private fun reset() {
        galerie.reset()
        _prices.value = emptyMap()
        gemerkt[SEARCH] = ""
        gemerkt[THEME] = ""
        gemerkt[SORTING] = Setsortierung.DEFAULT.kennung
    }

    private companion object {
        const val SEARCH = "galerie_suche"
        const val THEME = "galerie_thema"
        const val SORTING = "galerie_sortierung"
    }
}

/** Die Kennzahlen ohne [set] — solange sein Löschen vorgemerkt ist. */
internal fun withoutSet(k: MetricsView, set: SetAnsicht): MetricsView {
    val teile = (set.pieces ?: 0) * set.quantity
    return k.copy(
        totalSets = (k.totalSets - 1).coerceAtLeast(0),
        totalQuantity = (k.totalQuantity - set.quantity).coerceAtLeast(0),
        totalParts = (k.totalParts - teile).coerceAtLeast(0),
        partsFromSets = k.partsFromSets?.let { (it - teile).coerceAtLeast(0) },
        totalMinifigs = (k.totalMinifigs - (set.minifigs ?: 0) * set.quantity).coerceAtLeast(0),
        totalInstructions = (k.totalInstructions - set.instructions.size).coerceAtLeast(0),
    )
}

/**
 * Ein Set löschen: gelungen, und der Satz für den Meldungskanal. Geteilt mit
 * dem Set-Detail, das denselben Weg anbietet.
 */
internal suspend fun setLoeschen(sets: SetsRepository, texts: Texte, setNumber: String, name: String = setNumber): Pair<Boolean, String?> =
    when (val r = sets.deleteSet(setNumber)) {
        is Ergebnis.Erfolg -> true to texts.text(R.string.vm_set_deleted, name)
        is Ergebnis.Fehler -> false to texts.meldungFuerSnackbar(r)
    }
