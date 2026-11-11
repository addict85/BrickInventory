package ch.brickinventoryapp.teile.ui

import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.model.data.model.BrickColorsResponse
import ch.brickinventoryapp.model.data.model.FigValuationItem
import ch.brickinventoryapp.model.data.model.ManualFigsResponse
import ch.brickinventoryapp.model.data.model.ManualPartsResponse
import ch.brickinventoryapp.model.data.model.Minifig
import ch.brickinventoryapp.model.data.model.MinifigStatsResponse
import ch.brickinventoryapp.model.data.model.MinifigsResponse
import ch.brickinventoryapp.model.data.model.Part
import ch.brickinventoryapp.model.data.model.PartValuationItem
import ch.brickinventoryapp.model.data.model.PartsCategoriesResponse
import ch.brickinventoryapp.model.data.model.PartsFilterColorsResponse
import ch.brickinventoryapp.model.data.model.PartsResponse
import ch.brickinventoryapp.model.data.model.PartsStatsResponse
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.ui.model.TeilAnsicht
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

/**
 * Eine Seite der Teileliste, wie sie zum Server geht. Leer heisst „kein
 * Filter" — die API erwartet dafür null, nicht "".
 */
internal data class TeileAbfrage(
    val suche: String?, val farbe: String?, val kategorie: String?,
    val ersatzteile: Ersatzteilwahl, val mitSets: Boolean, val seite: Int,
)

/** Die Abrufe der Teile- und Figurenliste; Blickfeld und Lagerort setzt der Aufrufer. */
internal interface TeileQuelle {
    suspend fun seite(abfrage: TeileAbfrage): Ergebnis<PartsResponse>
    suspend fun manuelleTeile(suche: String?): Ergebnis<ManualPartsResponse>
    suspend fun teileKennzahlen(): Ergebnis<PartsStatsResponse>
    suspend fun filterFarben(): Ergebnis<PartsFilterColorsResponse>
    suspend fun kategorien(): Ergebnis<PartsCategoriesResponse>
    suspend fun alleFarben(): Ergebnis<BrickColorsResponse>
    suspend fun figurKennzahlen(): Ergebnis<MinifigStatsResponse>
    suspend fun figuren(suche: String?): Ergebnis<MinifigsResponse>
    suspend fun manuelleFiguren(suche: String?): Ergebnis<ManualFigsResponse>
}

/**
 * Die lokalen Listen (Room) für die Filter eines Zustands, und wie sie gefüllt
 * werden. Wo sie gelten, sind sie die einzige Quelle der Anzeige wie in der
 * Galerie: Der Abruf schreibt nur in die Ablage, offline Erfasstes steht sofort da.
 */
internal class TeileLokal(
    val teile: (PartsUiState) -> Flow<Lokal<Part>>,
    val manuelleTeile: (PartsUiState) -> Flow<Lokal<PartValuationItem>>,
    val figuren: (PartsUiState) -> Flow<Lokal<Minifig>>,
    val manuelleFiguren: (PartsUiState) -> Flow<Lokal<FigValuationItem>>,
    val aktualisiereTeile: suspend () -> Ergebnis<Unit>,
    val aktualisiereFiguren: suspend () -> Ergebnis<Unit>,
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
    private val meldeFehler: (Ergebnis.Error) -> Unit,
    /** Filterwechsel: Die gemerkte Scrollstelle zeigt auf eine andere Liste. */
    private val vergissScroll: () -> Unit,
    private val suchPause: Long = 350,
    /** Der Satz zum Fehler, der in der leeren Liste stehen bleibt (wie in der Galerie). */
    private val beschreibeFehler: (Ergebnis.Error) -> String = { it.message },
    private val lokal: TeileLokal? = null,
    /** Schränken Konto oder Lagerort die Teile bzw. Figuren ein? Dann rechnet nur der Server die Mengen. */
    private val teileEingeschraenkt: () -> Boolean = { true },
    private val figurenEingeschraenkt: () -> Boolean = { true },
) {
    private val _state = MutableStateFlow(PartsUiState())
    val state: StateFlow<PartsUiState> = _state.asStateFlow()

    /** Die Tabelle bestellt „In Sets“ mit; das zählt nur der Server. */
    private fun teileLokal(st: PartsUiState) = lokal?.takeIf { st.partsView != Listenansicht.TABELLE && !teileEingeschraenkt() }
    private fun figurenLokal() = lokal?.takeIf { !figurenEingeschraenkt() }

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

    fun laden(seite: Int = 1, entprellt: Boolean = false) {
        val ablage = teileLokal(_state.value)
        if (ablage != null && seite > 1) return
        teileJob?.cancel()
        teileFolgen.forEach { it.cancel() }
        teileJob = scope.launch {
            if (entprellt) delay(suchPause)
            if (ablage != null) return@launch ladeTeileAusAblage(ablage)
            _state.update { it.copy(partsLoading = true, partsFehler = null) }
            // Nach dem Entprellen gelesen: Der zuletzt gestartete Auftrag soll
            // den NEUESTEN Text sehen.
            val st = _state.value
            val abfrage = TeileAbfrage(
                suche = st.partsQuery.ifBlank { null },
                farbe = st.partsColorFilter.ifBlank { null },
                kategorie = st.partsCategoryFilter.ifBlank { null },
                ersatzteile = st.partsSpare,
                // „In Sets" kostet eine eigene Abfrage; nur die Tabelle zeigt es.
                mitSets = st.partsView == Listenansicht.TABELLE,
                seite = seite,
            )
            when (val r = quelle.seite(abfrage)) {
                is Ergebnis.Success -> {
                    _state.update {
                        it.copy(partsLoading = false,
                            parts = r.data.parts.map { p -> p.alsAnsicht() }.let { neu -> if (seite == 1) neu else anhaengen(it.parts, neu) },
                            partsTotal = r.data.total, partsPage = seite,
                            teileOfflineStand = if (seite == 1) r.stand else it.teileOfflineStand)
                    }
                    if (seite == 1) {
                        // Die manuellen Teile stehen als ein Abschnitt über der
                        // Liste, nicht seitenweise — und unter DEMSELBEN Suchfeld.
                        (quelle.manuelleTeile(abfrage.suche) as? Ergebnis.Success)
                            ?.let { m -> _state.update { it.copy(manualParts = m.data.parts.map { p -> p.alsAnsicht() }) } }
                        // Kennzahlen sind Beiwerk: Ein Fehlschlag lässt die Liste stehen.
                        (quelle.teileKennzahlen() as? Ergebnis.Success)
                            ?.let { s -> _state.update { it.copy(partsStats = s.data.stats?.alsAnsicht()) } }
                    }
                }
                is Ergebnis.Error -> {
                    _state.update { it.copy(partsLoading = false, partsFehler = beschreibeFehler(r),
                        partsFehlerKlasse = fehlerklasse(r)) }
                    meldeFehler(r)
                }
            }
        }
    }

    /** Anzeige aus der Ablage mit den Filtern des Zustands; der Abruf füllt nur die Ablage. */
    private suspend fun ladeTeileAusAblage(ablage: TeileLokal) {
        val st = _state.value
        teileFolgen = listOf(
            folge(ablage.teile(st)) { s, l ->
                s.copy(parts = l.map { it.alsAnsicht() }, partsTotal = l.size, partsPage = 1)
            },
            folge(ablage.manuelleTeile(st)) { s, l -> s.copy(manualParts = l.map { it.alsAnsicht() }) },
        )
        _state.update { it.copy(partsLoading = true, partsFehler = null) }
        val r = ablage.aktualisiereTeile()
        ausgang(r, ablage.teile(st).first().stand,
            { s, stand -> s.copy(partsLoading = false, teileOfflineStand = stand) },
            { s, r -> s.copy(partsLoading = false, partsFehler = beschreibeFehler(r), partsFehlerKlasse = fehlerklasse(r)) })
        (quelle.teileKennzahlen() as? Ergebnis.Success)
            ?.let { s -> _state.update { it.copy(partsStats = s.data.stats?.alsAnsicht()) } }
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
        if (!entprellt) scope.launch {
            (quelle.figurKennzahlen() as? Ergebnis.Success)
                ?.let { r -> _state.update { it.copy(minifigStats = r.data.stats.alsAnsicht()) } }
        }
        figurenJob?.cancel()
        figurenFolgen.forEach { it.cancel() }
        val ablage = figurenLokal()
        figurenJob = scope.launch {
            if (entprellt) delay(suchPause)
            if (ablage != null) return@launch ladeFigurenAusAblage(ablage)
            _state.update { it.copy(minifigsLoading = true, minifigsFehler = null) }
            val suche = _state.value.minifigsQuery.ifBlank { null }
            when (val r = quelle.figuren(suche)) {
                is Ergebnis.Success -> {
                    _state.update { it.copy(minifigs = r.data.figs.map { f -> f.alsAnsicht() }, minifigsLoading = false,
                        figurenOfflineStand = r.stand) }
                    (quelle.manuelleFiguren(suche) as? Ergebnis.Success)
                        ?.let { m -> _state.update { it.copy(manualFigs = m.data.figs.map { f -> f.alsAnsicht() }) } }
                }
                is Ergebnis.Error -> {
                    meldeFehler(r)
                    _state.update { it.copy(minifigsLoading = false, minifigsFehler = beschreibeFehler(r),
                        minifigsFehlerKlasse = fehlerklasse(r)) }
                }
            }
        }
    }

    private suspend fun ladeFigurenAusAblage(ablage: TeileLokal) {
        val st = _state.value
        figurenFolgen = listOf(
            folge(ablage.figuren(st)) { s, l -> s.copy(minifigs = l.map { it.alsAnsicht() }) },
            folge(ablage.manuelleFiguren(st)) { s, l -> s.copy(manualFigs = l.map { it.alsAnsicht() }) },
        )
        _state.update { it.copy(minifigsLoading = true, minifigsFehler = null) }
        val r = ablage.aktualisiereFiguren()
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

/**
 * Eine weitere Seite ohne Zeilen, die schon dastehen: Die lokale Liste kann mehr
 * als Seite 1 halten (frühere Seiten, das Vorwärmen) und zeigt sie dann schon.
 */
internal fun anhaengen(bisher: List<TeilAnsicht>, neu: List<TeilAnsicht>): List<TeilAnsicht> {
    val da = bisher.mapTo(HashSet()) { Triple(it.partNumber, it.colorId, it.isSpare) }
    return bisher + neu.filterNot { Triple(it.partNumber, it.colorId, it.isSpare) in da }
}
