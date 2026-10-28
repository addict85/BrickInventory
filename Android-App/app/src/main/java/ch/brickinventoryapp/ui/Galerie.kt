package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.SetItem
import ch.brickinventoryapp.data.model.SetsResponse
import ch.brickinventoryapp.data.model.StatsResponse
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Der Zustand der Galerie und wie er sich ändert — an EINER Stelle.
 *
 * Vorher war `_galleryState` ein internes Feld des MainViewModel, in das jede
 * Datei des Moduls schreiben konnte (Barcode, Sitzung, Set-Detail …). Jetzt ist
 * der Fluss privat, und wer etwas ändern will, ruft eine benannte Methode.
 * Abrufe kommen als Funktionen herein: So lässt sich das Verhalten ohne
 * ViewModel und Netz prüfen (GalerieTest).
 */
internal class Galerie(
    private val scope: CoroutineScope,
    /** Eine Seite mit den Filtern aus [stand] holen. */
    private val holeSeite: suspend (stand: GalleryUiState, seite: Int) -> Result<SetsResponse>,
    private val holeKennzahlen: suspend () -> Result<StatsResponse>,
    private val meldeFehler: (Result.Error) -> Unit,
    /** Der Satz zum Fehler, der in der leeren Galerie stehen bleibt. */
    private val beschreibeFehler: (Result.Error) -> String = { it.message },
    /** Filterwechsel: Die gemerkte Scrollstelle zeigt auf eine andere Liste. */
    private val vergissScroll: () -> Unit,
    private val suchPause: Long = 350,
) {
    private val _state = MutableStateFlow(GalleryUiState())
    val state: StateFlow<GalleryUiState> = _state.asStateFlow()

    // Filter-Generation: Eine späte Antwort eines alten Filters wird verworfen,
    // sonst hinge sie mit gemischtem Inhalt an der neuen Liste.
    private var galleryGeneration = 0
    private var listJob: Job? = null
    private var suchJob: Job? = null

    /** Erste Seite mit den eingestellten Filtern; gesucht wird auf dem Server. */
    fun laden() {
        val gen = ++galleryGeneration
        listJob?.cancel()
        listJob = scope.launch {
            _state.update { it.copy(galleryLoading = true, galleryLoadingMore = false, galleryPage = 1, galleryFehler = null) }
            val r = holeSeite(_state.value, 1)
            if (gen != galleryGeneration) return@launch
            when (r) {
                is Result.Success -> _state.update {
                    it.copy(sets = r.data.sets, galleryTotal = r.data.total, galleryPage = 1,
                        // Der Server schickt die Themen nur mit Seite 1; eine
                        // leere Liste räumte die Auswahl sonst leer.
                        galleryThemes = if (r.data.themes.isNotEmpty()) r.data.themes else it.galleryThemes,
                        galleryLoading = false, offlineStand = r.stand)
                }
                is Result.Error -> {
                    _state.update { it.copy(galleryLoading = false, galleryFehler = beschreibeFehler(r)) }
                    meldeFehler(r)
                }
            }
        }
    }

    /**
     * Nächste Seite anhängen (Endlos-Scroll).
     *
     * Die Sperre steht VOR dem launch: Zwei Aufrufe im selben Frame lasen sonst
     * beide „frei" und holten dieselbe Seite zweimal — doppelte Schlüssel im
     * Raster und Marcos Sprung auf immer dieselbe Zeile.
     */
    fun mehrLaden() {
        val g = _state.value
        if (g.galleryLoading || g.galleryLoadingMore) return
        if (g.galleryTotal > 0 && g.sets.size >= g.galleryTotal) return
        val gen = galleryGeneration
        _state.update { it.copy(galleryLoadingMore = true) }
        scope.launch {
            val next = g.galleryPage + 1
            val r = holeSeite(g, next)
            if (gen != galleryGeneration) {
                _state.update { it.copy(galleryLoadingMore = false) }
                return@launch
            }
            when (r) {
                is Result.Success -> _state.update {
                    // Auch der Server kann bei gleichen Sortierwerten Überschneidungen liefern.
                    val vorhanden = it.sets.mapTo(HashSet()) { s -> s.setNumber }
                    val neue = r.data.sets.filterNot { s -> s.setNumber in vorhanden }
                    it.copy(galleryLoadingMore = false, sets = it.sets + neue,
                        galleryTotal = r.data.total, galleryPage = next)
                }
                is Result.Error -> _state.update { it.copy(galleryLoadingMore = false) }
            }
        }
    }

    /** Suchtext: entprellt, damit nicht jeder Tastendruck eine Abfrage auslöst. */
    fun setzeSuche(q: String) {
        vergissScroll()
        _state.update { it.copy(galleryQuery = q) }
        suchJob?.cancel()
        suchJob = scope.launch { delay(suchPause); laden() }
    }

    fun setzeThema(theme: String) {
        vergissScroll()
        _state.update { it.copy(galleryTheme = theme) }
        laden()
    }

    fun setzeSortierung(sort: String) {
        vergissScroll()
        _state.update { it.copy(gallerySort = sort) }
        laden()
    }

    /** Kennzahlen im Kopf; ein Fehlschlag bleibt still — sie sind Beiwerk. */
    fun ladeKennzahlen() {
        scope.launch {
            val r = holeKennzahlen()
            if (r is Result.Success) _state.update { it.copy(stats = r.data.stats) }
        }
    }

    /** Sofort aus der Liste nehmen; das Nachladen gleicht danach mit dem Server ab. */
    fun entferne(setNumber: String) =
        _state.update { st -> st.copy(sets = st.sets.filterNot { it.setNumber == setNumber }) }

    /** Ein Set in der geladenen Liste ändern, ohne die Liste neu zu holen. */
    fun aendereSet(setNumber: String, aenderung: (SetItem) -> SetItem) =
        _state.update { st -> st.copy(sets = st.sets.map { if (it.setNumber == setNumber) aenderung(it) else it }) }

    /** Gemerkte Filter übernehmen, ohne zu laden — das tut der Bildschirm beim Betreten. */
    fun stelleFilterWieder(suche: String, thema: String, sortierung: String) =
        _state.update { it.copy(galleryQuery = suche, galleryTheme = thema, gallerySort = sortierung) }

    /** Abmelden: nichts vom vorigen Konto stehen lassen, laufende Abrufe verwerfen. */
    fun zuruecksetzen() {
        galleryGeneration++
        listJob?.cancel()
        suchJob?.cancel()
        _state.value = GalleryUiState()
    }
}

/** Was die Galerie zeigt, wenn noch keine Kachel da ist — oder eben die Liste. */
enum class GalerieAnzeige { LISTE, LAEDT, FEHLER, KEINE_TREFFER, LEER }

/**
 * Ein Ladefehler und eine leere Sammlung verlangen Verschiedenes: das eine
 * „Erneut versuchen", das andere „Set erfassen". Geladene Sets gehen vor —
 * ein gescheitertes Neuladen lässt die alte Liste stehen.
 */
fun galerieAnzeige(g: GalleryUiState, gefiltert: Boolean): GalerieAnzeige = when {
    g.sets.isNotEmpty() -> GalerieAnzeige.LISTE
    g.galleryLoading -> GalerieAnzeige.LAEDT
    g.galleryFehler != null -> GalerieAnzeige.FEHLER
    gefiltert -> GalerieAnzeige.KEINE_TREFFER
    else -> GalerieAnzeige.LEER
}
