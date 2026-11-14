package ch.brickinventoryapp.sammlung.ui

import ch.brickinventoryapp.model.fach.Setsortierung
import ch.brickinventoryapp.vertrag.SetItem
import ch.brickinventoryapp.vertrag.StatsResponse
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
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
import ch.brickinventoryapp.ui.Ladeanzeige
import ch.brickinventoryapp.ui.ladeanzeige
import ch.brickinventoryapp.zustand.ui.fehlerklasse

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
    private val quelle: (GalleryUiState) -> Flow<Lokal<SetItem>>,
    /** Füllt die Quelle des Zustands; die Antwort selbst zeigt niemand. */
    private val aktualisiere: suspend (GalleryUiState) -> Ergebnis<Unit>,
    private val holeKennzahlen: suspend () -> Ergebnis<StatsResponse>,
    private val meldeFehler: (Ergebnis.Error) -> Unit,
    /** Der Satz zum Fehler, der in der leeren Galerie stehen bleibt. */
    private val beschreibeFehler: (Ergebnis.Error) -> String = { it.message },
    /** Filterwechsel: Die gemerkte Scrollstelle zeigt auf eine andere Liste. */
    private val vergissScroll: () -> Unit,
    private val suchPause: Long = 350,
) {
    private val _state = MutableStateFlow(GalleryUiState())
    val state: StateFlow<GalleryUiState> = _state.asStateFlow()

    // Ein neuer Auftrag bricht den alten ab: Eine späte Antwort eines alten
    // Filters landete sonst mit gemischtem Inhalt in der neuen Liste.
    private var folgeJob: Job? = null
    private var listJob: Job? = null
    private var suchJob: Job? = null

    /**
     * Mit den eingestellten Filtern: der Quelle folgen und sie füllen. Ohne Netz
     * bleibt die abgelegte Liste stehen, mit ihrem Stand.
     */
    fun laden() {
        listJob?.cancel()
        folgeJob?.cancel()
        val st = _state.value
        val liste = quelle(st)
        folgeJob = scope.launch {
            liste.collect { l ->
                if (l.stand == null) return@collect
                _state.update {
                    it.copy(sets = l.liste.map { s -> s.alsAnsicht() }, galleryTotal = l.liste.size,
                        galleryThemes = if (it.galleryQuery.isBlank() && it.galleryTheme.isBlank()) themenAus(l.liste) else it.galleryThemes)
                }
            }
        }
        listJob = scope.launch {
            _state.update { it.copy(galleryLoading = true, galleryFehler = null) }
            val r = aktualisiere(st)
            // Ohne Netz zählt, was die Quelle schon hält; sie hat sich durch den Fehlschlag nicht geändert.
            val stand = if (r is Ergebnis.Error && r.transient) liste.first().stand else null
            when {
                r is Ergebnis.Success -> _state.update { it.copy(galleryLoading = false, offlineStand = null) }
                r is Ergebnis.Error && r.transient && stand != null ->
                    _state.update { it.copy(galleryLoading = false, offlineStand = stand) }
                r is Ergebnis.Error -> {
                    _state.update { it.copy(galleryLoading = false, galleryFehler = beschreibeFehler(r),
                        galleryFehlerKlasse = fehlerklasse(r)) }
                    meldeFehler(r)
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
    fun ladeKennzahlen() {
        scope.launch {
            val r = holeKennzahlen()
            if (r is Ergebnis.Success) _state.update { it.copy(stats = r.data.stats?.alsAnsicht()) }
        }
    }

    /** Gemerkte Filter übernehmen, ohne zu laden — das tut der Bildschirm beim Betreten. */
    fun stelleFilterWieder(suche: String, thema: String, sortierung: Setsortierung) =
        _state.update { it.copy(galleryQuery = suche, galleryTheme = thema, gallerySort = sortierung) }

    /** Abmelden: nichts vom vorigen Konto stehen lassen, laufende Abrufe verwerfen. */
    fun zuruecksetzen() {
        listJob?.cancel()
        folgeJob?.cancel()
        suchJob?.cancel()
        _state.value = GalleryUiState()
    }
}

/** Die Themen der abgelegten Sets für den Filter; der Server schickt sie sonst mit Seite 1. */
private fun themenAus(sets: List<SetItem>): List<String> =
    sets.mapNotNull { it.theme?.takeIf(String::isNotBlank) }.distinct().sorted()

/** Was die Galerie zeigt, wenn noch keine Kachel da ist — oder eben die Liste. */
internal typealias GalerieAnzeige = Ladeanzeige

/**
 * Ein Ladefehler und eine leere Sammlung verlangen Verschiedenes: das eine
 * „Erneut versuchen", das andere „Set erfassen". Geladene Sets gehen vor —
 * ein gescheitertes Neuladen lässt die alte Liste stehen.
 */
internal fun galerieAnzeige(g: GalleryUiState, gefiltert: Boolean): GalerieAnzeige =
    ladeanzeige(g.sets.isNotEmpty(), g.galleryLoading, g.galleryFehler, gefiltert)
