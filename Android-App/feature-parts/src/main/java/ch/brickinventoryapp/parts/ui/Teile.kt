package ch.brickinventoryapp.parts.ui

import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.model.domain.FigurAnsicht
import ch.brickinventoryapp.model.domain.MinifigsMetricsView
import ch.brickinventoryapp.model.domain.FilterColorView
import ch.brickinventoryapp.model.domain.CategoryView
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.TeilAnsicht
import ch.brickinventoryapp.model.domain.PartsMetricsView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ch.brickinventoryapp.model.ui.ListView

/** Die Abrufe neben der Teileliste: Kennzahlen und Filterwerte; Blickfeld setzt der Aufrufer. */
internal interface PartsSource {
    suspend fun partsMetrics(): Ergebnis<PartsMetricsView?>
    suspend fun filterColors(): Ergebnis<List<FilterColorView>>
    suspend fun kategorien(): Ergebnis<List<CategoryView>>
    suspend fun allColors(): Ergebnis<List<ColorView>>
}

/**
 * Die Listen für einen Filter, und wie sie gefüllt werden — die einzige Quelle der Anzeige
 * wie in der Galerie: die Ablage, wo Konto, Lagerort oder „In Sets“ es verlangen die
 * Kontosicht. Der Abruf füllt nur die Quelle.
 */
internal class PartsLocal(
    val teile: (PartsUiState) -> Flow<Local<TeilAnsicht>>,
    val manuelleTeile: (PartsUiState) -> Flow<Local<ManualPartView>>,
    val refresh: suspend (PartsUiState) -> Ergebnis<Unit>,
)

/** Dasselbe für die Figuren. */
internal class MinifigsLocal(
    val figuren: (MinifigsUiState) -> Flow<Local<FigurAnsicht>>,
    val manualMinifigs: (MinifigsUiState) -> Flow<Local<ManualMinifigView>>,
    val refresh: suspend (MinifigsUiState) -> Ergebnis<Unit>,
    val metrics: suspend () -> Ergebnis<MinifigsMetricsView>,
)

/**
 * Folgt der Ablage und meldet den Abruf — gemeinsam für Teile und Figuren. Ein neuer
 * Auftrag bricht den alten ab: Eine langsame alte Antwort überschriebe sonst eine neuere,
 * und beim Tippen löscht jeder Tastendruck den entprellten vorigen.
 */
internal class Listenfolge<S>(
    private val scope: CoroutineScope,
    private val zustand: MutableStateFlow<S>,
    private val reportError: (Ergebnis.Fehler) -> Unit,
    private val suchPause: Long,
) {
    private var folgen: List<Job> = emptyList()
    private var job: Job? = null

    /** Eine nie geladene Liste (ohne Stand) leert nichts. */
    fun <T> sequence(quelle: Flow<Local<T>>, neu: (S, List<T>) -> S): Job =
        scope.launch { quelle.collect { l -> if (l.stand != null) zustand.update { st -> neu(st, l.liste) } } }

    fun starte(debounced: Boolean, laden: suspend () -> Unit) {
        abbrechen()
        job = scope.launch {
            if (debounced) delay(suchPause)
            laden()
        }
    }

    fun sequenceAll(neu: List<Job>) { folgen = neu }

    /** Ohne Netz bleibt die Ablage mit ihrem Stand; ohne Ablage ist es ein Fehler. */
    fun ausgang(r: Ergebnis<Unit>, stand: Long?, fertig: (S, Long?) -> S, fehler: (S, Ergebnis.Fehler) -> S) {
        when {
            r is Ergebnis.Erfolg -> zustand.update { fertig(it, null) }
            r is Ergebnis.Fehler && r.transient && stand != null -> zustand.update { fertig(it, stand) }
            r is Ergebnis.Fehler -> {
                zustand.update { fehler(it, r) }
                reportError(r)
            }
        }
    }

    fun abbrechen() {
        job?.cancel()
        folgen.forEach { it.cancel() }
    }
}

/**
 * Zustand der Teileliste und wie er sich ändert — wie die Galerie: privater Fluss,
 * benannte Methoden, Quellen von aussen. Die Filter liest jeder Lader aus dem Zustand:
 * So passen Quelle und Abruf immer zu dem, was die Filterchips zeigen.
 */
internal class Teile(
    private val scope: CoroutineScope,
    private val quelle: PartsSource,
    reportError: (Ergebnis.Fehler) -> Unit,
    /** Filterwechsel: Die gemerkte Scrollstelle zeigt auf eine andere Liste. */
    private val vergissScroll: () -> Unit,
    suchPause: Long = 350,
    private val listen: PartsLocal,
    /** Jeder neue Filter, damit der Aufrufer ihn merken kann. */
    private val filterChanged: (Teilefilter) -> Unit = {},
) {
    private val _state = MutableStateFlow(PartsUiState())
    val state: StateFlow<PartsUiState> = _state.asStateFlow()
    private val sequence = Listenfolge(scope, _state, reportError, suchPause)

    /** Alles steht auf einmal da; eine weitere Seite gibt es nicht mehr. */
    fun laden(seite: Int = 1, debounced: Boolean = false) {
        if (seite > 1) return
        sequence.starte(debounced) { loadParts() }
    }

    /** Nach dem Entprellen gelesen: Der zuletzt gestartete Auftrag sieht den neuesten Filter. */
    private suspend fun loadParts() {
        val st = _state.value
        sequence.sequenceAll(listOf(
            sequence.sequence(listen.teile(st)) { s, l ->
                s.copy(parts = sortiert(l, s.filter.order), partsTotal = l.size, partsPage = 1)
            },
            sequence.sequence(listen.manuelleTeile(st)) { s, l -> s.copy(manualParts = l) },
        ))
        _state.update { it.copy(partsFetch = Laden.Loads) }
        val r = listen.refresh(st)
        sequence.ausgang(r, listen.teile(st).first().stand,
            { s, stand -> s.copy(partsFetch = Laden.Daten(Unit), partsOfflineStatus = stand) },
            { s, r -> s.copy(partsFetch = loadError(r)) })
        loadMetrics()
    }

    /** Kennzahlen sind Beiwerk: Ein Fehlschlag lässt die Liste stehen. */
    suspend fun loadMetrics() {
        (quelle.partsMetrics() as? Ergebnis.Erfolg)
            ?.let { s -> _state.update { it.copy(partsStats = s.data) } }
    }

    /**
     * Einen neuen Filter setzen. Ein Klick ist ein fertiger Wunsch; nur das Tippen der Suche
     * wird entprellt. Die Ordnung sortiert nur um: Die ganze Liste liegt schon vor.
     */
    fun setFilter(neu: Teilefilter) {
        val alt = _state.value.filter
        if (alt == neu) return
        if (neu.copy(ansicht = alt.ansicht) != alt) vergissScroll()
        _state.update { it.copy(filter = neu, parts = if (neu.order != alt.order) sortiert(it.parts, neu.order) else it.parts) }
        filterChanged(neu)
        if (neu.copy(order = alt.order) == alt) return
        laden(debounced = neu.suche != alt.suche)
    }

    /**
     * Farb- und Kategorieliste der Filter. Still bei Fehlern: Ein fehlender
     * Filter ist kein Grund, die Liste zurückzuhalten oder zu stören.
     */
    fun loadFilter() {
        scope.launch {
            (quelle.filterColors() as? Ergebnis.Erfolg)?.data
                ?.let { d -> _state.update { it.copy(partsFilterColors = d) } }
            (quelle.kategorien() as? Ergebnis.Erfolg)?.data
                ?.let { d -> _state.update { it.copy(partsCategories = d) } }
        }
    }

    /** Farbauswahl im Erfassungsdialog; fehlt sie, tippt man die Farb-ID. */
    fun loadColors() {
        scope.launch {
            (quelle.allColors() as? Ergebnis.Erfolg)?.data
                ?.let { d -> _state.update { it.copy(partsColors = d) } }
        }
    }

    /** Einen gemerkten Filter übernehmen, ohne zu laden. */
    fun placeFilterAgain(f: Teilefilter) = _state.update { it.copy(filter = f) }

    /** Abmelden: nichts vom vorigen Konto stehen lassen, laufende Abrufe verwerfen. */
    fun reset() {
        sequence.abbrechen()
        _state.value = PartsUiState()
    }
}

/** Zustand der Figurenliste, gebaut wie [Teile]. */
internal class Figuren(
    private val scope: CoroutineScope,
    reportError: (Ergebnis.Fehler) -> Unit,
    suchPause: Long = 350,
    private val listen: MinifigsLocal,
) {
    private val _zustand = MutableStateFlow(MinifigsUiState())
    val zustand: StateFlow<MinifigsUiState> = _zustand.asStateFlow()
    private val sequence = Listenfolge(scope, _zustand, reportError, suchPause)

    suspend fun loadMetrics() {
        (listen.metrics() as? Ergebnis.Erfolg)
            ?.let { r -> _zustand.update { it.copy(minifigStats = r.data) } }
    }

    /**
     * Figurenliste laden. Die Kennzahlen kommen nebenher und zeigen den ganzen
     * Bestand — beim Tippen nicht, sonst zählte jeder Tastendruck neu, ohne
     * Auftrag, der ihn abbrechen könnte.
     */
    fun laden(debounced: Boolean = false) {
        if (!debounced) scope.launch { loadMetrics() }
        sequence.starte(debounced) { sequenceMinifigs() }
    }

    private suspend fun sequenceMinifigs() {
        val st = _zustand.value
        sequence.sequenceAll(listOf(
            sequence.sequence(listen.figuren(st)) { s, l -> s.copy(minifigs = l) },
            sequence.sequence(listen.manualMinifigs(st)) { s, l -> s.copy(manualFigs = l) },
        ))
        _zustand.update { it.copy(minifigsFetch = Laden.Loads) }
        val r = listen.refresh(st)
        sequence.ausgang(r, listen.figuren(st).first().stand,
            { s, stand -> s.copy(minifigsFetch = Laden.Daten(Unit), minifigsOfflineStatus = stand) },
            { s, r -> s.copy(minifigsFetch = loadError(r)) })
    }

    fun setzeSuche(q: String) {
        _zustand.update { it.copy(minifigsQuery = q) }
        laden(debounced = true)
    }

    /** Karten oder Tabelle; ohne Neuladen, die Felder sind schon da. */
    fun setView(wert: ListView) = _zustand.update { it.copy(minifigsView = wert) }

    /** Gemerkte Suche und Ansicht übernehmen, ohne zu laden. */
    fun placeAgain(suche: String, ansicht: ListView) =
        _zustand.update { it.copy(minifigsQuery = suche, minifigsView = ansicht) }

    fun reset() {
        sequence.abbrechen()
        _zustand.value = MinifigsUiState()
    }
}
