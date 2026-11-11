package ch.brickinventoryapp.sammlung.ui.viewmodel

import ch.brickinventoryapp.model.fach.Setsortierung
import ch.brickinventoryapp.zustand.ui.abgeleitet
import ch.brickinventoryapp.model.ui.model.SetAnsicht
import ch.brickinventoryapp.model.ui.model.KennzahlenAnsicht
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.data.repository.Kontosicht
import ch.brickinventoryapp.sammlung.ui.Galerie
import ch.brickinventoryapp.sammlung.ui.GalleryUiState
import ch.brickinventoryapp.sammlung.ui.KachelPreis
import ch.brickinventoryapp.sammlung.ui.kachelPreise
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.zustand.ui.AppUiState
import ch.brickinventoryapp.zustand.ui.Sitzung
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.zustand.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen
import ch.brickinventoryapp.zustand.ui.viewmodel.Texte
import ch.brickinventoryapp.zustand.ui.viewmodel.folgeAbmeldung

/**
 * Die Sammlung der Sets: Liste, Filter, Kennzahlen.
 *
 * Die Abläufe (Entprellen, Quelle wechseln) stehen in [Galerie]; dieses
 * ViewModel wählt die Quelle: die Ablage, über gewählte Konten die Kontosicht.
 * Suche, Thema und Sortierung stehen im [SavedStateHandle].
 */
@HiltViewModel
class GalerieViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val aenderungen: Bestandsabgleich,
    private val scrollMemory: ScrollMemory,
    private val sets: SetsRepository,
    private val kontosicht: Kontosicht,
    private val finanzen: FinanzenRepository,
    private val gemerkt: SavedStateHandle,
) : ViewModel(), Filterwahl by filter {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        folgeAbmeldung(sitzung) { zuruecksetzen() }
        // Die Kennzahlen rechnet der Server über den Bestand; ändert er sich in der Ablage, stimmen sie nicht mehr.
        viewModelScope.launch { aenderungen.bestandGeaendert().collect { loadStats() } }
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

    /** Über gewählte Konten rechnet nur der Server die Mengen; sonst gilt die Ablage. */
    private fun kontoAbfrage(g: GalleryUiState): Kontosicht.SetsAbfrage? =
        filter.kontoFuer(ScopeFilter.View.GALLERY)?.let {
            Kontosicht.SetsAbfrage(it, g.galleryQuery.ifBlank { null }, g.galleryTheme.ifBlank { null }, g.gallerySort,
                filter.lagerFuer(ScopeFilter.View.GALLERY)?.ifBlank { null })
        }

    private val galerie = Galerie(
        scope = viewModelScope,
        quelle = { g ->
            kontoAbfrage(g)?.let { kontosicht.galerie.beobachte(it) }
                ?: sets.beobachteSets(g.galleryQuery, g.galleryTheme, filter.lagerFuer(ScopeFilter.View.GALLERY), g.gallerySort)
        },
        aktualisiere = { g -> kontoAbfrage(g)?.let { kontosicht.galerie.aktualisiere(it) } ?: sets.aktualisiereSets() },
        holeKennzahlen = { finanzen.getStats(filter.kontoFuer(ScopeFilter.View.GALLERY)) },
        meldeFehler = { meldungen.zeige(meldungen.meldungFuerSnackbar(it)) },
        beschreibeFehler = { meldungen.meldung(it) },
        vergissScroll = { scrollMemory.vergiss("gallery") },
    )
    /** Ein gelöschtes Set, das sich noch zurückholen lässt — die Snackbar „Rückgängig“. */
    data class VorgemerktesLoeschen(val setNumber: String, val name: String, val set: SetAnsicht? = null)

    private val _vorgemerkt = MutableStateFlow<VorgemerktesLoeschen?>(null)
    val vorgemerkt: StateFlow<VorgemerktesLoeschen?> = _vorgemerkt.asStateFlow()

    /**
     * Die Galerie ohne das vorgemerkte Set: Die Ablage führt es bis zum Löschen beim
     * Server, und „Rückgängig“ zeigt es so ohne Neuladen wieder.
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
            sortierung = Setsortierung.aus(gemerkt[SORTIERUNG]),
        )
    }

    fun loadSets() = galerie.laden()

    /**
     * Beim Zeigen: laden, wenn die Galerie leer ist und ein Server eingetragen ist.
     * Hier statt im Graphen, damit die Regel geprüft werden kann; ein Fehlschlag beim
     * Start wird so beim nächsten Betreten wiederholt.
     */
    fun ladeWennLeer() {
        val g = galerie.state.value
        if (sitzung.state.value.serverUrl.isBlank() || g.sets.isNotEmpty() || g.galleryLoading) return
        loadSets()
        loadStats()
    }
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

    fun setGallerySort(sort: Setsortierung) {
        gemerkt[SORTIERUNG] = sort.kennung
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
        _vorgemerkt.value = VorgemerktesLoeschen(setNumber, name, set)
    }

    /**
     * Das vorgemerkte Set bleibt; es stand die ganze Zeit in der Ablage.
     * [nur]: nur dieses — die Snackbar eines abgelösten Löschens holt nicht das nächste zurück.
     */
    fun rueckgaengig(nur: VorgemerktesLoeschen? = null) {
        val v = _vorgemerkt.value ?: return
        if (nur != null && v != nur) return
        _vorgemerkt.value = null
    }

    /**
     * [nur]: nur dieses. Endet die Snackbar eines abgelösten Löschens, darf sie das
     * neue nicht ausführen — sonst wäre es ohne „Rückgängig“ gelöscht.
     */
    fun loeschenAusfuehren(nur: VorgemerktesLoeschen? = null) {
        val v = _vorgemerkt.value ?: return
        if (nur != null && v != nur) return
        _vorgemerkt.value = null
        deleteSet(v.setNumber, erfolgMelden = false)
    }

    /** [erfolgMelden] aus, wenn „gelöscht“ schon in der Snackbar mit „Rückgängig“ stand. */
    fun deleteSet(setNumber: String, erfolgMelden: Boolean = true) {
        viewModelScope.launch {
            val (geloescht, satz) = setLoeschen(sets, meldungen, setNumber)
            if (!geloescht || erfolgMelden) meldungen.zeige(satz)
        }
    }

    private fun nachFilter(view: ScopeFilter.View) {
        if (view != ScopeFilter.View.GALLERY) return
        loadSets()
        loadStats()
    }

    private fun zuruecksetzen() {
        galerie.zuruecksetzen()
        _preise.value = emptyMap()
        gemerkt[SUCHE] = ""
        gemerkt[THEMA] = ""
        gemerkt[SORTIERUNG] = Setsortierung.VORGABE.kennung
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
