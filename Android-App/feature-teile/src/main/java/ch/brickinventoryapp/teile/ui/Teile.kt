package ch.brickinventoryapp.teile.ui

import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.model.data.model.BrickColorsResponse
import ch.brickinventoryapp.model.data.model.FigValuationItem
import ch.brickinventoryapp.model.data.model.Minifig
import ch.brickinventoryapp.model.data.model.MinifigStatsResponse
import ch.brickinventoryapp.model.data.model.Part
import ch.brickinventoryapp.model.data.model.PartValuationItem
import ch.brickinventoryapp.model.data.model.PartsCategoriesResponse
import ch.brickinventoryapp.model.data.model.PartsFilterColorsResponse
import ch.brickinventoryapp.model.data.model.PartsStatsResponse
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.ui.model.alsAnsicht
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
import ch.brickinventoryapp.zustand.ui.fehlerklasse
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.ui.Listenansicht

/** Die Abrufe neben den Listen: Kennzahlen und Filterwerte; Blickfeld setzt der Aufrufer. */
internal interface TeileQuelle {
    suspend fun teileKennzahlen(): Ergebnis<PartsStatsResponse>
    suspend fun filterFarben(): Ergebnis<PartsFilterColorsResponse>
    suspend fun kategorien(): Ergebnis<PartsCategoriesResponse>
    suspend fun alleFarben(): Ergebnis<BrickColorsResponse>
    suspend fun figurKennzahlen(): Ergebnis<MinifigStatsResponse>
}

/**
 * Die Listen für die Filter eines Zustands, und wie sie gefüllt werden — die
 * einzige Quelle der Anzeige wie in der Galerie: die Ablage, wo Konto, Lagerort
 * oder „In Sets“ es verlangen die Kontosicht. Der Abruf füllt nur die Quelle.
 */
internal class TeileLokal(
    val teile: (PartsUiState) -> Flow<Lokal<Part>>,
    val manuelleTeile: (PartsUiState) -> Flow<Lokal<PartValuationItem>>,
    val figuren: (PartsUiState) -> Flow<Lokal<Minifig>>,
    val manuelleFiguren: (PartsUiState) -> Flow<Lokal<FigValuationItem>>,
    val aktualisiereTeile: suspend (PartsUiState) -> Ergebnis<Unit>,
    val aktualisiereFiguren: suspend (PartsUiState) -> Ergebnis<Unit>,
)

/**
 * Zustand der Teile- und Figurenliste und wie er sich ändert — wie die Galerie:
 * privater Fluss, benannte Methoden, Quellen von aussen. Die Filter liest jeder
 * Lader aus dem Zustand, nie als Parameter: So passen Quelle und Abruf immer zu
 * dem, was die Filterchips zeigen.
 */
internal class Teile(
    private val scope: CoroutineScope,
    private val quelle: TeileQuelle,
    private val meldeFehler: (Ergebnis.Error) -> Unit,
    /** Filterwechsel: Die gemerkte Scrollstelle zeigt auf eine andere Liste. */
    private val vergissScroll: () -> Unit,
    private val suchPause: Long = 350,
    /** Der Satz zum Fehler, der in der leeren Liste stehen bleibt (wie in der Galerie). */
    private val beschreibeFehler: (Ergebnis.Error) -> String = { it.message },
    private val listen: TeileLokal,
) {
    private val _state = MutableStateFlow(PartsUiState())
    val state: StateFlow<PartsUiState> = _state.asStateFlow()

    private var teileFolgen: List<Job> = emptyList()
    private var figurenFolgen: List<Job> = emptyList()

    /** Eine nie geladene Liste (ohne Stand) leert nichts. */
    private fun <T> folge(quelle: Flow<Lokal<T>>, neu: (PartsUiState, List<T>) -> PartsUiState): Job =
        scope.launch {
            quelle.collect { l -> if (l.stand != null) _state.update { st -> neu(st, l.liste) } }
        }

    /** Ohne Netz bleibt die Ablage mit ihrem Stand; ohne Ablage ist es ein Fehler wie bisher. */
    private fun ausgang(r: Ergebnis<Unit>, stand: Long?, fertig: (PartsUiState, Long?) -> PartsUiState,
                        fehler: (PartsUiState, Ergebnis.Error) -> PartsUiState) {
        when {
            r is Ergebnis.Success -> _state.update { fertig(it, null) }
            r is Ergebnis.Error && r.transient && stand != null -> _state.update { fertig(it, stand) }
            r is Ergebnis.Error -> {
                _state.update { fehler(it, r) }
                meldeFehler(r)
            }
        }
    }

    // Ein neuer Auftrag bricht den alten ab: Eine langsame alte Antwort
    // überschriebe sonst eine neuere, und beim Tippen löscht jeder Tastendruck
    // den entprellten vorigen.
    private var teileJob: Job? = null
    private var figurenJob: Job? = null

    /** Alles steht auf einmal da; eine weitere Seite gibt es nicht mehr. */
    fun laden(seite: Int = 1, entprellt: Boolean = false) {
        if (seite > 1) return
        teileJob?.cancel()
        teileFolgen.forEach { it.cancel() }
        teileJob = scope.launch {
            if (entprellt) delay(suchPause)
            ladeTeile(listen)
        }
    }

    /** Nach dem Entprellen gelesen: Der zuletzt gestartete Auftrag sieht den neuesten Text. */
    private suspend fun ladeTeile(ablage: TeileLokal) {
        val st = _state.value
        teileFolgen = listOf(
            folge(ablage.teile(st)) { s, l ->
                s.copy(parts = sortiert(l.map { it.alsAnsicht() }, s.partsOrdnung), partsTotal = l.size, partsPage = 1)
            },
            folge(ablage.manuelleTeile(st)) { s, l -> s.copy(manualParts = l.map { it.alsAnsicht() }) },
        )
        _state.update { it.copy(partsLoading = true, partsFehler = null) }
        val r = ablage.aktualisiereTeile(st)
        ausgang(r, ablage.teile(st).first().stand,
            { s, stand -> s.copy(partsLoading = false, teileOfflineStand = stand) },
            { s, r -> s.copy(partsLoading = false, partsFehler = beschreibeFehler(r), partsFehlerKlasse = fehlerklasse(r)) })
        ladeKennzahlen()
    }

    /** Kennzahlen sind Beiwerk: Ein Fehlschlag lässt die Liste stehen. */
    suspend fun ladeKennzahlen() {
        (quelle.teileKennzahlen() as? Ergebnis.Success)
            ?.let { s -> _state.update { it.copy(partsStats = s.data.stats?.alsAnsicht()) } }
    }

    suspend fun ladeFigurKennzahlen() {
        (quelle.figurKennzahlen() as? Ergebnis.Success)
            ?.let { r -> _state.update { it.copy(minifigStats = r.data.stats.alsAnsicht()) } }
    }

    fun setzeSuche(q: String) {
        vergissScroll()
        _state.update { it.copy(partsQuery = q) }
        laden(entprellt = true)
    }

    /** Ein Klick ist ein fertiger Wunsch: nicht entprellt. */
    fun setzeErsatzteile(wert: Ersatzteilwahl) {
        vergissScroll()
        _state.update { it.copy(partsSpare = wert) }
        laden()
    }

    /** Nur umsortieren: Die ganze Liste liegt schon vor, ein Abruf brächte nichts Neues. */
    fun setzeOrdnung(wert: PartsUiState.Ordnung) {
        if (_state.value.partsOrdnung == wert) return
        vergissScroll()
        _state.update { it.copy(partsOrdnung = wert, parts = sortiert(it.parts, wert)) }
    }

    /** Karten oder Tabelle; neu laden, weil die Tabelle „In Sets" mitbestellt. */
    fun setzeAnsicht(wert: Listenansicht) {
        if (_state.value.partsView == wert) return
        _state.update { it.copy(partsView = wert) }
        laden()
    }

    fun setzeFarbe(wert: String) {
        if (_state.value.partsColorFilter == wert) return
        vergissScroll()
        _state.update { it.copy(partsColorFilter = wert) }
        laden()
    }

    fun setzeKategorie(wert: String) {
        if (_state.value.partsCategoryFilter == wert) return
        vergissScroll()
        _state.update { it.copy(partsCategoryFilter = wert) }
        laden()
    }

    /**
     * Farb- und Kategorieliste der Filter. Still bei Fehlern: Ein fehlender
     * Filter ist kein Grund, die Liste zurückzuhalten oder zu stören.
     */
    fun ladeFilter() {
        scope.launch {
            (quelle.filterFarben() as? Ergebnis.Success)?.data?.takeIf { it.success }
                ?.let { d -> _state.update { it.copy(partsFilterColors = d.colors.map { c -> c.alsAnsicht() }) } }
            (quelle.kategorien() as? Ergebnis.Success)?.data?.takeIf { it.success }
                ?.let { d -> _state.update { it.copy(partsCategories = d.categories.map { c -> c.alsAnsicht() }) } }
        }
    }

    /** Farbauswahl im Erfassungsdialog; fehlt sie, tippt man die Farb-ID. */
    fun ladeFarben() {
        scope.launch {
            (quelle.alleFarben() as? Ergebnis.Success)?.data?.takeIf { it.success }
                ?.let { d -> _state.update { it.copy(partsColors = d.colors.map { c -> c.alsAnsicht() }) } }
        }
    }

    /** Karten oder Tabelle der Figuren; ohne Neuladen, die Felder sind schon da. */
    fun setzeFigurAnsicht(wert: Listenansicht) = _state.update { it.copy(minifigsView = wert) }

    /**
     * Figurenliste laden. Die Kennzahlen kommen nebenher und zeigen den ganzen
     * Bestand — beim Tippen nicht, sonst zählte jeder Tastendruck neu, ohne
     * Auftrag, der ihn abbrechen könnte.
     */
    fun ladeFiguren(entprellt: Boolean = false) {
        if (!entprellt) scope.launch { ladeFigurKennzahlen() }
        figurenJob?.cancel()
        figurenFolgen.forEach { it.cancel() }
        figurenJob = scope.launch {
            if (entprellt) delay(suchPause)
            folgeFiguren(listen)
        }
    }

    private suspend fun folgeFiguren(ablage: TeileLokal) {
        val st = _state.value
        figurenFolgen = listOf(
            folge(ablage.figuren(st)) { s, l -> s.copy(minifigs = l.map { it.alsAnsicht() }) },
            folge(ablage.manuelleFiguren(st)) { s, l -> s.copy(manualFigs = l.map { it.alsAnsicht() }) },
        )
        _state.update { it.copy(minifigsLoading = true, minifigsFehler = null) }
        val r = ablage.aktualisiereFiguren(st)
        ausgang(r, ablage.figuren(st).first().stand,
            { s, stand -> s.copy(minifigsLoading = false, figurenOfflineStand = stand) },
            { s, r -> s.copy(minifigsLoading = false, minifigsFehler = beschreibeFehler(r), minifigsFehlerKlasse = fehlerklasse(r)) })
    }

    fun setzeFigurSuche(q: String) {
        _state.update { it.copy(minifigsQuery = q) }
        ladeFiguren(entprellt = true)
    }

    /** Gemerkte Filter und Ansichten übernehmen, ohne zu laden. */
    fun stelleFilterWieder(aenderung: (PartsUiState) -> PartsUiState) = _state.update(aenderung)

    /** Abmelden: nichts vom vorigen Konto stehen lassen, laufende Abrufe verwerfen. */
    fun zuruecksetzen() {
        teileJob?.cancel()
        figurenJob?.cancel()
        (teileFolgen + figurenFolgen).forEach { it.cancel() }
        _state.value = PartsUiState()
    }
}
