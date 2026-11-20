package ch.brickinventoryapp.collection.ui

import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.domain.Setsortierung
import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.model.domain.MetricsView
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.local.Local
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ch.brickinventoryapp.ui.LoadingIndicator
import ch.brickinventoryapp.ui.loadingIndicator

/**
 * Der Zustand der Galerie und wie er sich ändert — an EINER Stelle.
 * Der Fluss ist privat, Änderungen gehen über benannte Methoden: So schreibt nicht jede Datei des
 * Moduls hinein.
 */
internal class Galerie(
    private val scope: CoroutineScope,
    /**
     * Die Liste für die Filter eines Zustands — die einzige Quelle der Anzeige: die
     * Ablage, über gewählte Konten die Kontosicht. Was offline geändert wird, steht
     * so sofort da.
     */
    private val quelle: (GalleryUiState) -> Flow<Local<SetAnsicht>>,
    /** Füllt die Quelle des Zustands; die Antwort selbst zeigt niemand. */
    private val refresh: suspend (GalleryUiState) -> Ergebnis<Unit>,
    private val fetchMetrics: suspend () -> Ergebnis<MetricsView?>,
    private val reportError: (Ergebnis.Fehler) -> Unit,
    /** Filterwechsel: Die gemerkte Scrollstelle zeigt auf eine andere Liste. */
    private val vergissScroll: () -> Unit,
    private val suchPause: Long = 350,
) {
    private val _state = MutableStateFlow(GalleryUiState())
    val state: StateFlow<GalleryUiState> = _state.asStateFlow()

    // Ein neuer Auftrag bricht den alten ab: Eine späte Antwort eines alten
    // Filters landete sonst mit gemischtem Inhalt in der neuen Liste.
    private var sequenceJob: Job? = null
    private var listJob: Job? = null
    private var suchJob: Job? = null

    /**
     * Mit den eingestellten Filtern: der Quelle folgen und sie füllen. Ohne Netz
     * bleibt die abgelegte Liste stehen, mit ihrem Stand.
     */
    fun laden() {
        listJob?.cancel()
        sequenceJob?.cancel()
        val st = _state.value
        val liste = quelle(st)
        sequenceJob = scope.launch {
            liste.collect { l ->
                if (l.stand == null) return@collect
                _state.update {
                    it.copy(sets = l.liste, galleryTotal = l.liste.size,
                        galleryThemes = if (it.galleryQuery.isBlank() && it.galleryTheme.isBlank()) themesFrom(l.liste) else it.galleryThemes)
                }
            }
        }
        listJob = scope.launch {
            _state.update { it.copy(abruf = Laden.Loads) }
            val r = refresh(st)
            // Ohne Netz zählt, was die Quelle schon hält; sie hat sich durch den Fehlschlag nicht geändert.
            val stand = if (r is Ergebnis.Fehler && r.transient) liste.first().stand else null
            when {
                r is Ergebnis.Erfolg -> _state.update { it.copy(abruf = Laden.Daten(Unit), offlineStatus = null) }
                r is Ergebnis.Fehler && r.transient && stand != null ->
                    _state.update { it.copy(abruf = Laden.Daten(Unit), offlineStatus = stand) }
                r is Ergebnis.Fehler -> {
                    _state.update { it.copy(abruf = loadError(r)) }
                    reportError(r)
                }
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

    fun setzeSortierung(sort: Setsortierung) {
        vergissScroll()
        _state.update { it.copy(gallerySort = sort) }
        laden()
    }

    /** Kennzahlen im Kopf; ein Fehlschlag bleibt still — sie sind Beiwerk. */
    fun loadMetrics() {
        scope.launch {
            val r = fetchMetrics()
            if (r is Ergebnis.Erfolg) _state.update { it.copy(stats = r.data) }
        }
    }

    /** Gemerkte Filter übernehmen, ohne zu laden — das tut der Bildschirm beim Betreten. */
    fun placeFilterAgain(suche: String, thema: String, sorting: Setsortierung) =
        _state.update { it.copy(galleryQuery = suche, galleryTheme = thema, gallerySort = sorting) }

    /** Abmelden: nichts vom vorigen Konto stehen lassen, laufende Abrufe verwerfen. */
    fun reset() {
        listJob?.cancel()
        sequenceJob?.cancel()
        suchJob?.cancel()
        _state.value = GalleryUiState()
    }
}

/** Die Themen der abgelegten Sets für den Filter; der Server schickt sie sonst mit Seite 1. */
private fun themesFrom(sets: List<SetAnsicht>): List<String> =
    sets.mapNotNull { it.theme?.takeIf(String::isNotBlank) }.distinct().sorted()

/** Was die Galerie zeigt, wenn noch keine Kachel da ist — oder eben die Liste. */
internal typealias GalleryDisplay = LoadingIndicator

/**
 * Ein Ladefehler und eine leere Sammlung verlangen Verschiedenes: das eine
 * „Erneut versuchen", das andere „Set erfassen". Geladene Sets gehen vor —
 * ein gescheitertes Neuladen lässt die alte Liste stehen.
 */
internal fun galleryDisplay(g: GalleryUiState, gefiltert: Boolean): GalleryDisplay =
    loadingIndicator(g.sets.isNotEmpty(), g.abruf.laedt, g.abruf is Laden.Fehler, gefiltert)
