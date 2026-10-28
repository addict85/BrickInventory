package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.GALLERY_DEFAULT_SORT
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.Galerie
import ch.brickinventoryapp.ui.GalleryUiState
import ch.brickinventoryapp.ui.KachelPreis
import ch.brickinventoryapp.ui.kachelPreise
import ch.brickinventoryapp.ui.retryOnNetwork
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Die Sammlung der Sets: Liste, Filter, Kennzahlen.
 *
 * Die Abläufe (Blättern, Entprellen, Generationen) stehen in [Galerie]; dieses
 * ViewModel verbindet sie mit Server, Blickfeld und Bestandssignal. Suche,
 * Thema und Sortierung stehen im [SavedStateHandle].
 */
@HiltViewModel
class GalerieViewModel @Inject constructor(
    dienste: AppDienste,
    private val sets: SetsRepository,
    private val finanzen: FinanzenRepository,
    private val gemerkt: SavedStateHandle,
) : BereichsViewModel(dienste) {

    private val galerie = Galerie(
        scope = viewModelScope,
        holeSeite = { g, seite ->
            retryOnNetwork {
                sets.getSets(scopeFor(ScopeFilter.View.GALLERY),
                    search = g.galleryQuery, theme = g.galleryTheme, sort = g.gallerySort, page = seite,
                    storage = lagerFor(ScopeFilter.View.GALLERY))
            }
        },
        holeKennzahlen = { finanzen.getStats(scopeFor(ScopeFilter.View.GALLERY)) },
        meldeFehler = { _snackbar.value = meldungFuerSnackbar(it) },
        beschreibeFehler = { meldung(it) },
        vergissScroll = { dienste.scrollMemory.vergiss("gallery") },
    )
    val galleryState: StateFlow<GalleryUiState> = galerie.state

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
            val r = finanzen.getPnl(scopeFor(ScopeFilter.View.GALLERY))
            if (r is Result.Success) _preise.value = kachelPreise(r.data.sets)
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
            dienste.blickfeld.ladeMitglieder()
            dienste.blickfeld.ladeLagerorte()
        }
    }

    fun deleteSet(setNumber: String) {
        viewModelScope.launch {
            val (geloescht, satz) = setLoeschen(sets, dienste.texte, setNumber)
            if (geloescht) galerie.entferne(setNumber)
            _snackbar.value = satz
            if (geloescht) dienste.bestand.melde(Aenderung.Sets, Aenderung.Teile, Aenderung.Figuren)
        }
    }

    override fun nachFilter(view: ScopeFilter.View) {
        if (view != ScopeFilter.View.GALLERY) return
        loadSets()
        loadStats()
    }

    override fun beiAenderung(aenderung: Aenderung) {
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

    override fun zuruecksetzen() {
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

/**
 * Ein Set löschen: gelungen, und der Satz für den Meldungskanal. Geteilt mit
 * dem Set-Detail, das denselben Weg anbietet.
 */
internal suspend fun setLoeschen(sets: SetsRepository, texte: Texte, setNumber: String): Pair<Boolean, String?> =
    when (val r = sets.deleteSet(setNumber)) {
        is Result.Success -> true to texte.text(R.string.vm_set_deleted, setNumber)
        is Result.Error -> false to texte.meldungFuerSnackbar(r)
    }
