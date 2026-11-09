package ch.brickinventoryapp.sammlung.ui.viewmodel

import ch.brickinventoryapp.zustand.ui.abgeleitet
import ch.brickinventoryapp.model.ui.model.SetAnsicht
import ch.brickinventoryapp.model.ui.model.KennzahlenAnsicht
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.GALLERY_DEFAULT_SORT
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.zustand.ui.Aenderung
import ch.brickinventoryapp.sammlung.ui.Galerie
import ch.brickinventoryapp.sammlung.ui.GalleryUiState
import ch.brickinventoryapp.sammlung.ui.KachelPreis
import ch.brickinventoryapp.sammlung.ui.kachelPreise
import ch.brickinventoryapp.zustand.ui.retryOnNetwork
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.zustand.ui.AppUiState
import ch.brickinventoryapp.zustand.ui.Sitzung
import ch.brickinventoryapp.zustand.ui.Bestandssignal
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.zustand.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen
import ch.brickinventoryapp.zustand.ui.viewmodel.Texte
import ch.brickinventoryapp.zustand.ui.viewmodel.folgeAbmeldung
import ch.brickinventoryapp.zustand.ui.viewmodel.folgeBestand

/**
 * Die Sammlung der Sets: Liste, Filter, Kennzahlen.
 *
 * Die Abläufe (Blättern, Entprellen, Generationen) stehen in [Galerie]; dieses
 * ViewModel verbindet sie mit Server, Blickfeld und Bestandssignal. Suche,
 * Thema und Sortierung stehen im [SavedStateHandle].
 */
@HiltViewModel
class GalerieViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val bestand: Bestandssignal,
    private val scrollMemory: ScrollMemory,
    private val sets: SetsRepository,
    private val finanzen: FinanzenRepository,
    private val gemerkt: SavedStateHandle,
) : ViewModel(), Filterwahl by filter {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        folgeAbmeldung(sitzung) { zuruecksetzen() }
        folgeBestand(bestand) { beiAenderung(it) }
    }

    override fun setScope(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setzeKonto(view, value)
            nachFilter(view)
        }
    }

    override fun setLagerFilter(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setzeLager(view, value)
            nachFilter(view)
        }
    }

    private val galerie = Galerie(
        scope = viewModelScope,
        holeSeite = { g, seite ->
            retryOnNetwork {
                sets.getSets(filter.kontoFuer(ScopeFilter.View.GALLERY),
                    search = g.galleryQuery, theme = g.galleryTheme, sort = g.gallerySort, page = seite,
                    storage = filter.lagerFuer(ScopeFilter.View.GALLERY))
            }
        },
        holeKennzahlen = { finanzen.getStats(filter.kontoFuer(ScopeFilter.View.GALLERY)) },
        meldeFehler = { meldungen.zeige(meldungen.meldungFuerSnackbar(it)) },
        beschreibeFehler = { meldungen.meldung(it) },
        vergissScroll = { scrollMemory.vergiss("gallery") },
        lokal = sets.beobachteSets(),
        ungefiltert = { g ->
            g.galleryQuery.isBlank() && g.galleryTheme.isBlank() && g.gallerySort == GALLERY_DEFAULT_SORT &&
                filter.kontoFuer(ScopeFilter.View.GALLERY) == null && filter.lagerFuer(ScopeFilter.View.GALLERY).isNullOrBlank()
        },
    )
    /** Ein gelöschtes Set, das sich noch zurückholen lässt — die Snackbar „Rückgängig“. */
    data class VorgemerktesLoeschen(val setNumber: String, val name: String, val set: SetAnsicht? = null)

    private val _vorgemerkt = MutableStateFlow<VorgemerktesLoeschen?>(null)
    val vorgemerkt: StateFlow<VorgemerktesLoeschen?> = _vorgemerkt.asStateFlow()

    /**
     * Die Galerie ohne das vorgemerkte Set: Kommt die Liste während der Snackbar neu
     * (Signal, Ziehen zum Neuladen), stünde es sonst wieder da, obwohl es gleich
     * gelöscht wird.
     */
    val galleryState: StateFlow<GalleryUiState> = galerie.state
        .abgeleitet(_vorgemerkt) { st, v ->
            // Die Kennzahlen ebenso: Neben zwei Kacheln stand sonst noch „3 Sets“.
            if (v == null) st else st.copy(sets = st.sets.filterNot { it.setNumber == v.setNumber },
                stats = st.stats?.let { k -> v.set?.let { ohneSet(k, it) } ?: k })
        }

    private val _preise = MutableStateFlow<Map<String, KachelPreis>>(emptyMap())
    /** Marktpreis und G&V je Set; eigener Fluss, weil er nach der Liste kommt. */
    val preise: StateFlow<Map<String, KachelPreis>> = _preise.asStateFlow()

    init {
        galerie.stelleFilterWieder(
            suche = gemerkt[SUCHE] ?: "",
            thema = gemerkt[THEMA] ?: "",
            sortierung = gemerkt[SORTIERUNG] ?: GALLERY_DEFAULT_SORT,
        )
    }

    fun loadSets() = galerie.laden()
    fun loadMoreSets() = galerie.mehrLaden()
    fun loadStats() {
        galerie.ladeKennzahlen()
        ladePreise()
    }

    /**
     * Preis und G&V für die Kacheln. Scheitert der Abruf, bleiben die alten
     * Werte stehen und die Kachel fällt auf den Kaufpreis zurück; der Fehler
     * des Reiters kommt aus der Liste, nicht aus dieser Zugabe.
     */
    private fun ladePreise() {
        viewModelScope.launch {
            val r = finanzen.getPnl(filter.kontoFuer(ScopeFilter.View.GALLERY))
            if (r is Ergebnis.Success) _preise.value = kachelPreise(r.data.sets)
        }
    }

    fun setGalleryQuery(q: String) {
        gemerkt[SUCHE] = q
        galerie.setzeSuche(q)
    }

    fun setGalleryTheme(theme: String) {
        gemerkt[THEMA] = theme
        galerie.setzeThema(theme)
    }

    fun setGallerySort(sort: String) {
        gemerkt[SORTIERUNG] = sort
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
            filter.ladeMitglieder()
            filter.ladeLagerorte()
        }
    }

    /**
     * Löschen mit „Rückgängig“: Die Kachel verschwindet sofort, der Server erfährt
     * davon erst mit [loeschenAusfuehren] — eine Rückfrage allein schützte nicht vor
     * dem falschen Set. Ein noch offenes früheres Löschen wird zuerst ausgeführt.
     */
    fun loeschenVormerken(setNumber: String, name: String) {
        loeschenAusfuehren()
        val set = galerie.state.value.sets.firstOrNull { it.setNumber == setNumber }
        galerie.entferne(setNumber)
        _vorgemerkt.value = VorgemerktesLoeschen(setNumber, name, set)
    }

    /** Das vorgemerkte Set bleibt; die Liste kommt neu vom Server, auf dem es nie fehlte. */
    fun rueckgaengig() {
        if (_vorgemerkt.value == null) return
        _vorgemerkt.value = null
        loadSets()
    }

    fun loeschenAusfuehren() {
        val v = _vorgemerkt.value ?: return
        _vorgemerkt.value = null
        deleteSet(v.setNumber, erfolgMelden = false)
    }

    /** [erfolgMelden] aus, wenn „gelöscht“ schon in der Snackbar mit „Rückgängig“ stand. */
    fun deleteSet(setNumber: String, erfolgMelden: Boolean = true) {
        viewModelScope.launch {
            val (geloescht, satz) = setLoeschen(sets, meldungen, setNumber)
            if (geloescht) galerie.entferne(setNumber)
            if (!geloescht || erfolgMelden) meldungen.zeige(satz)
            if (geloescht) bestand.melde(Aenderung.Sets, Aenderung.Teile, Aenderung.Figuren)
        }
    }

    private fun nachFilter(view: ScopeFilter.View) {
        if (view != ScopeFilter.View.GALLERY) return
        loadSets()
        loadStats()
    }

    private fun beiAenderung(aenderung: Aenderung) {
        when (aenderung) {
            Aenderung.Sets -> { loadSets(); loadStats() }
            Aenderung.Teile, Aenderung.Figuren -> loadStats()
            // Ein geänderter Kauf ändert die Kachel, nicht die Liste — kein
            // Neuladen, das die Rollposition verschiebt.
            is Aenderung.SetZusammenfassung -> {
                val agg = aenderung.agg
                galerie.aendereSet(agg.setNumber) { s ->
                    s.copy(
                        condition        = agg.condition ?: s.condition,
                        conditions       = agg.conditions.ifEmpty { s.conditions },
                        usedCount        = agg.usedCount ?: s.usedCount,
                        maxPurchasePrice = agg.maxPurchasePrice ?: s.maxPurchasePrice,
                        avgPurchasePrice = agg.avgPurchasePrice ?: s.avgPurchasePrice,
                    )
                }
                loadStats()
            }
            Aenderung.Merkliste, Aenderung.Alarme -> Unit
        }
    }

    private fun zuruecksetzen() {
        galerie.zuruecksetzen()
        _preise.value = emptyMap()
        gemerkt[SUCHE] = ""
        gemerkt[THEMA] = ""
        gemerkt[SORTIERUNG] = GALLERY_DEFAULT_SORT
    }

    private companion object {
        const val SUCHE = "galerie_suche"
        const val THEMA = "galerie_thema"
        const val SORTIERUNG = "galerie_sortierung"
    }
}

/** Die Kennzahlen ohne [set] — solange sein Löschen vorgemerkt ist. */
internal fun ohneSet(k: KennzahlenAnsicht, set: SetAnsicht): KennzahlenAnsicht {
    val teile = (set.pieces ?: 0) * set.quantity
    return k.copy(
        totalSets = (k.totalSets - 1).coerceAtLeast(0),
        totalQuantity = (k.totalQuantity - set.quantity).coerceAtLeast(0),
        totalParts = (k.totalParts - teile).coerceAtLeast(0),
        teileAusSets = k.teileAusSets?.let { (it - teile).coerceAtLeast(0) },
        totalMinifigs = (k.totalMinifigs - (set.minifigs ?: 0) * set.quantity).coerceAtLeast(0),
        totalInstructions = (k.totalInstructions - set.instructions.size).coerceAtLeast(0),
    )
}

/**
 * Ein Set löschen: gelungen, und der Satz für den Meldungskanal. Geteilt mit
 * dem Set-Detail, das denselben Weg anbietet.
 */
internal suspend fun setLoeschen(sets: SetsRepository, texte: Texte, setNumber: String, name: String = setNumber): Pair<Boolean, String?> =
    when (val r = sets.deleteSet(setNumber)) {
        is Ergebnis.Success -> true to texte.text(R.string.vm_set_deleted, name)
        is Ergebnis.Error -> false to texte.meldungFuerSnackbar(r)
    }
