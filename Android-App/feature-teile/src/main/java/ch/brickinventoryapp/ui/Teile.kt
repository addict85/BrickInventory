package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.lokal.Lokal
import ch.brickinventoryapp.data.model.BrickColorsResponse
import ch.brickinventoryapp.data.model.FigValuationItem
import ch.brickinventoryapp.data.model.ManualFigsResponse
import ch.brickinventoryapp.data.model.ManualPartsResponse
import ch.brickinventoryapp.data.model.Minifig
import ch.brickinventoryapp.data.model.MinifigStatsResponse
import ch.brickinventoryapp.data.model.MinifigsResponse
import ch.brickinventoryapp.data.model.Part
import ch.brickinventoryapp.data.model.PartValuationItem
import ch.brickinventoryapp.data.model.PartsCategoriesResponse
import ch.brickinventoryapp.data.model.PartsFilterColorsResponse
import ch.brickinventoryapp.data.model.PartsResponse
import ch.brickinventoryapp.data.model.PartsStatsResponse
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.model.alsAnsicht
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Eine Seite der Teileliste, wie sie zum Server geht. Leer heisst „kein
 * Filter" — die API erwartet dafür null, nicht "".
 */
internal data class TeileAbfrage(
    val suche: String?, val farbe: String?, val kategorie: String?,
    val ersatzteile: String?, val mitSets: String?, val seite: Int,
)

/** Die Abrufe der Teile- und Figurenliste; Blickfeld und Lagerort setzt der Aufrufer. */
internal interface TeileQuelle {
    suspend fun seite(abfrage: TeileAbfrage): Result<PartsResponse>
    suspend fun manuelleTeile(suche: String?): Result<ManualPartsResponse>
    suspend fun teileKennzahlen(): Result<PartsStatsResponse>
    suspend fun filterFarben(): Result<PartsFilterColorsResponse>
    suspend fun kategorien(): Result<PartsCategoriesResponse>
    suspend fun alleFarben(): Result<BrickColorsResponse>
    suspend fun figurKennzahlen(): Result<MinifigStatsResponse>
    suspend fun figuren(suche: String?): Result<MinifigsResponse>
    suspend fun manuelleFiguren(suche: String?): Result<ManualFigsResponse>
}

/**
 * Die lokalen Listen (Room) der vier ungefilterten Abrufe. Ohne Filter sind sie
 * die Wahrheit der Anzeige wie in der Galerie: Was offline erfasst, geändert
 * oder gelöscht wird, erscheint sofort.
 */
internal class TeileLokal(
    val teile: Flow<Lokal<Part>>,
    val manuelleTeile: Flow<Lokal<PartValuationItem>>,
    val figuren: Flow<Lokal<Minifig>>,
    val manuelleFiguren: Flow<Lokal<FigValuationItem>>,
)

/**
 * Zustand der Teile- und Figurenliste und wie er sich ändert — wie [Galerie]:
 * privater Fluss, benannte Methoden, Abrufe von aussen. Die Filter liest jeder
 * Lader aus dem Zustand, nie als Parameter: Sonst holte das Nachladen von
 * Seite 2 eine ungefilterte Seite und hängte sie an eine gefilterte.
 */
internal class Teile(
    private val scope: CoroutineScope,
    private val quelle: TeileQuelle,
    private val meldeFehler: (Result.Error) -> Unit,
    /** Filterwechsel: Die gemerkte Scrollstelle zeigt auf eine andere Liste. */
    private val vergissScroll: () -> Unit,
    private val suchPause: Long = 350,
    /** Der Satz zum Fehler, der in der leeren Liste stehen bleibt (wie in der Galerie). */
    private val beschreibeFehler: (Result.Error) -> String = { it.message },
    private val lokal: TeileLokal? = null,
    /** Schränken Konto oder Lagerort die Teile bzw. Figuren ein? Dann gilt nur der Server. */
    private val teileEingeschraenkt: () -> Boolean = { true },
    private val figurenEingeschraenkt: () -> Boolean = { true },
) {
    private val _state = MutableStateFlow(PartsUiState())
    val state: StateFlow<PartsUiState> = _state.asStateFlow()

    init {
        // Nur was Room für genau diese Ansicht hält, und nicht während einer
        // Ladung: deren Antwort setzt die Liste ohnehin (wie Galerie.init).
        if (lokal != null) {
            folge(lokal.teile) { st, l ->
                if (st.partsLoading || st.partsPage != 1 || !teileUngefiltert(st)) null
                else st.copy(parts = l.map { it.alsAnsicht() })
            }
            folge(lokal.manuelleTeile) { st, l ->
                if (st.partsQuery.isNotBlank() || teileEingeschraenkt()) null
                else st.copy(manualParts = l.map { it.alsAnsicht() })
            }
            folge(lokal.figuren) { st, l ->
                if (st.minifigsLoading || st.minifigsQuery.isNotBlank() || figurenEingeschraenkt()) null
                else st.copy(minifigs = l.map { it.alsAnsicht() })
            }
            folge(lokal.manuelleFiguren) { st, l ->
                if (st.minifigsQuery.isNotBlank() || figurenEingeschraenkt()) null
                else st.copy(manualFigs = l.map { it.alsAnsicht() })
            }
        }
    }

    /** Eine nie geladene Liste (ohne Stand) leert nichts; null heisst: diese Ansicht nicht. */
    private fun <T> folge(quelle: Flow<Lokal<T>>, neu: (PartsUiState, List<T>) -> PartsUiState?) {
        scope.launch {
            quelle.collect { l -> if (l.stand != null) _state.update { st -> neu(st, l.liste) ?: st } }
        }
    }

    private fun teileUngefiltert(st: PartsUiState) =
        st.partsQuery.isBlank() && st.partsColorFilter.isBlank() && st.partsCategoryFilter.isBlank() &&
            st.partsSpare.isBlank() && st.partsView != "table" && !teileEingeschraenkt()

    // Ein neuer Auftrag bricht den alten ab: Eine langsame alte Antwort
    // überschriebe sonst eine neuere, und beim Tippen löscht jeder Tastendruck
    // den entprellten vorigen.
    private var teileJob: Job? = null
    private var figurenJob: Job? = null

    fun laden(seite: Int = 1, entprellt: Boolean = false) {
        teileJob?.cancel()
        teileJob = scope.launch {
            if (entprellt) delay(suchPause)
            _state.update { it.copy(partsLoading = true, partsFehler = null) }
            // Nach dem Entprellen gelesen: Der zuletzt gestartete Auftrag soll
            // den NEUESTEN Text sehen.
            val st = _state.value
            val abfrage = TeileAbfrage(
                suche = st.partsQuery.ifBlank { null },
                farbe = st.partsColorFilter.ifBlank { null },
                kategorie = st.partsCategoryFilter.ifBlank { null },
                ersatzteile = st.partsSpare.ifBlank { null },
                // „In Sets" kostet eine eigene Abfrage; nur die Tabelle zeigt es.
                mitSets = if (st.partsView == "table") "1" else null,
                seite = seite,
            )
            when (val r = quelle.seite(abfrage)) {
                is Result.Success -> {
                    _state.update {
                        it.copy(partsLoading = false,
                            parts = r.data.parts.map { p -> p.alsAnsicht() }.let { neu -> if (seite == 1) neu else it.parts + neu },
                            partsTotal = r.data.total, partsPage = seite,
                            teileOfflineStand = if (seite == 1) r.stand else it.teileOfflineStand)
                    }
                    if (seite == 1) {
                        // Die manuellen Teile stehen als ein Abschnitt über der
                        // Liste, nicht seitenweise — und unter DEMSELBEN Suchfeld.
                        (quelle.manuelleTeile(abfrage.suche) as? Result.Success)
                            ?.let { m -> _state.update { it.copy(manualParts = m.data.parts.map { p -> p.alsAnsicht() }) } }
                        // Kennzahlen sind Beiwerk: Ein Fehlschlag lässt die Liste stehen.
                        (quelle.teileKennzahlen() as? Result.Success)
                            ?.let { s -> _state.update { it.copy(partsStats = s.data.stats?.alsAnsicht()) } }
                    }
                }
                is Result.Error -> {
                    _state.update { it.copy(partsLoading = false, partsFehler = beschreibeFehler(r),
                        partsFehlerKlasse = fehlerklasse(r)) }
                    meldeFehler(r)
                }
            }
        }
    }

    fun setzeSuche(q: String) {
        vergissScroll()
        _state.update { it.copy(partsQuery = q) }
        laden(entprellt = true)
    }

    /** "" alle, "0" ohne, "1" nur Ersatzteile. Ein Klick ist ein fertiger Wunsch: nicht entprellt. */
    fun setzeErsatzteile(wert: String) {
        vergissScroll()
        _state.update { it.copy(partsSpare = wert) }
        laden()
    }

    /** Karten oder Tabelle; neu laden, weil die Tabelle „In Sets" mitbestellt. */
    fun setzeAnsicht(wert: String) {
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
            (quelle.filterFarben() as? Result.Success)?.data?.takeIf { it.success }
                ?.let { d -> _state.update { it.copy(partsFilterColors = d.colors.map { c -> c.alsAnsicht() }) } }
            (quelle.kategorien() as? Result.Success)?.data?.takeIf { it.success }
                ?.let { d -> _state.update { it.copy(partsCategories = d.categories.map { c -> c.alsAnsicht() }) } }
        }
    }

    /** Farbauswahl im Erfassungsdialog; fehlt sie, tippt man die Farb-ID. */
    fun ladeFarben() {
        scope.launch {
            (quelle.alleFarben() as? Result.Success)?.data?.takeIf { it.success }
                ?.let { d -> _state.update { it.copy(partsColors = d.colors.map { c -> c.alsAnsicht() }) } }
        }
    }

    /** Karten oder Tabelle der Figuren; ohne Neuladen, die Felder sind schon da. */
    fun setzeFigurAnsicht(wert: String) = _state.update { it.copy(minifigsView = wert) }

    /**
     * Figurenliste laden. Die Kennzahlen kommen nebenher und zeigen den ganzen
     * Bestand — beim Tippen nicht, sonst zählte jeder Tastendruck neu, ohne
     * Auftrag, der ihn abbrechen könnte.
     */
    fun ladeFiguren(entprellt: Boolean = false) {
        if (!entprellt) scope.launch {
            (quelle.figurKennzahlen() as? Result.Success)
                ?.let { r -> _state.update { it.copy(minifigStats = r.data.stats.alsAnsicht()) } }
        }
        figurenJob?.cancel()
        figurenJob = scope.launch {
            if (entprellt) delay(suchPause)
            _state.update { it.copy(minifigsLoading = true, minifigsFehler = null) }
            val suche = _state.value.minifigsQuery.ifBlank { null }
            when (val r = quelle.figuren(suche)) {
                is Result.Success -> {
                    _state.update { it.copy(minifigs = r.data.figs.map { f -> f.alsAnsicht() }, minifigsLoading = false,
                        figurenOfflineStand = r.stand) }
                    (quelle.manuelleFiguren(suche) as? Result.Success)
                        ?.let { m -> _state.update { it.copy(manualFigs = m.data.figs.map { f -> f.alsAnsicht() }) } }
                }
                is Result.Error -> {
                    meldeFehler(r)
                    _state.update { it.copy(minifigsLoading = false, minifigsFehler = beschreibeFehler(r),
                        minifigsFehlerKlasse = fehlerklasse(r)) }
                }
            }
        }
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
        _state.value = PartsUiState()
    }
}
