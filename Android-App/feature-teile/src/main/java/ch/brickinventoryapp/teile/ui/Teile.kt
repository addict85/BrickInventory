package ch.brickinventoryapp.teile.ui

import ch.brickinventoryapp.model.fach.Kategoriewahl
import ch.brickinventoryapp.model.fach.Farbwahl
import ch.brickinventoryapp.zustand.ui.ladefehler
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.fach.FarbeAnsicht
import ch.brickinventoryapp.model.fach.FigurAnsicht
import ch.brickinventoryapp.model.fach.FigurenKennzahlenAnsicht
import ch.brickinventoryapp.model.fach.FilterFarbeAnsicht
import ch.brickinventoryapp.model.fach.KategorieAnsicht
import ch.brickinventoryapp.model.fach.ManuelleFigurAnsicht
import ch.brickinventoryapp.model.fach.ManuellesTeilAnsicht
import ch.brickinventoryapp.model.fach.TeilAnsicht
import ch.brickinventoryapp.model.fach.TeileKennzahlenAnsicht
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
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.ui.Listenansicht

/** Die Abrufe neben den Listen: Kennzahlen und Filterwerte; Blickfeld setzt der Aufrufer. */
internal interface TeileQuelle {
    suspend fun teileKennzahlen(): Ergebnis<TeileKennzahlenAnsicht?>
    suspend fun filterFarben(): Ergebnis<List<FilterFarbeAnsicht>>
    suspend fun kategorien(): Ergebnis<List<KategorieAnsicht>>
    suspend fun alleFarben(): Ergebnis<List<FarbeAnsicht>>
    suspend fun figurKennzahlen(): Ergebnis<FigurenKennzahlenAnsicht>
}

/**
 * Die Listen für die Filter eines Zustands, und wie sie gefüllt werden — die
 * einzige Quelle der Anzeige wie in der Galerie: die Ablage, wo Konto, Lagerort
 * oder „In Sets“ es verlangen die Kontosicht. Der Abruf füllt nur die Quelle.
 */
internal class TeileLokal(
    val teile: (PartsUiState) -> Flow<Lokal<TeilAnsicht>>,
    val manuelleTeile: (PartsUiState) -> Flow<Lokal<ManuellesTeilAnsicht>>,
    val figuren: (PartsUiState) -> Flow<Lokal<FigurAnsicht>>,
    val manuelleFiguren: (PartsUiState) -> Flow<Lokal<ManuelleFigurAnsicht>>,
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
                s.copy(parts = sortiert(l, s.partsOrdnung), partsTotal = l.size, partsPage = 1)
            },
            folge(ablage.manuelleTeile(st)) { s, l -> s.copy(manualParts = l) },
        )
        _state.update { it.copy(teileAbruf = Laden.Laedt) }
        val r = ablage.aktualisiereTeile(st)
        ausgang(r, ablage.teile(st).first().stand,
            { s, stand -> s.copy(teileAbruf = Laden.Daten(Unit), teileOfflineStand = stand) },
            { s, r -> s.copy(teileAbruf = ladefehler(r)) })
        ladeKennzahlen()
    }

    /** Kennzahlen sind Beiwerk: Ein Fehlschlag lässt die Liste stehen. */
    suspend fun ladeKennzahlen() {
        (quelle.teileKennzahlen() as? Ergebnis.Success)
            ?.let { s -> _state.update { it.copy(partsStats = s.data) } }
    }

    suspend fun ladeFigurKennzahlen() {
        (quelle.figurKennzahlen() as? Ergebnis.Success)
            ?.let { r -> _state.update { it.copy(minifigStats = r.data) } }
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

    fun setzeFarbe(wert: Farbwahl) {
        if (_state.value.partsColorFilter == wert) return
        vergissScroll()
        _state.update { it.copy(partsColorFilter = wert) }
        laden()
    }

    fun setzeKategorie(wert: Kategoriewahl) {
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
            (quelle.filterFarben() as? Ergebnis.Success)?.data
                ?.let { d -> _state.update { it.copy(partsFilterColors = d) } }
            (quelle.kategorien() as? Ergebnis.Success)?.data
                ?.let { d -> _state.update { it.copy(partsCategories = d) } }
        }
    }

    /** Farbauswahl im Erfassungsdialog; fehlt sie, tippt man die Farb-ID. */
    fun ladeFarben() {
        scope.launch {
            (quelle.alleFarben() as? Ergebnis.Success)?.data
                ?.let { d -> _state.update { it.copy(partsColors = d) } }
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
            folge(ablage.figuren(st)) { s, l -> s.copy(minifigs = l) },
            folge(ablage.manuelleFiguren(st)) { s, l -> s.copy(manualFigs = l) },
        )
        _state.update { it.copy(figurenAbruf = Laden.Laedt) }
        val r = ablage.aktualisiereFiguren(st)
        ausgang(r, ablage.figuren(st).first().stand,
            { s, stand -> s.copy(figurenAbruf = Laden.Daten(Unit), figurenOfflineStand = stand) },
            { s, r -> s.copy(figurenAbruf = ladefehler(r)) })
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
