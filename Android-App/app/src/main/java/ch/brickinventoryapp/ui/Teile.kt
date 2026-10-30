package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.BrickColorsResponse
import ch.brickinventoryapp.data.model.ManualFigsResponse
import ch.brickinventoryapp.data.model.ManualPartsResponse
import ch.brickinventoryapp.data.model.MinifigStatsResponse
import ch.brickinventoryapp.data.model.MinifigsResponse
import ch.brickinventoryapp.data.model.PartsCategoriesResponse
import ch.brickinventoryapp.data.model.PartsFilterColorsResponse
import ch.brickinventoryapp.data.model.PartsResponse
import ch.brickinventoryapp.data.model.PartsStatsResponse
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
) {
    private val _state = MutableStateFlow(PartsUiState())
    val state: StateFlow<PartsUiState> = _state.asStateFlow()

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
                            parts = if (seite == 1) r.data.parts else it.parts + r.data.parts,
                            partsTotal = r.data.total, partsPage = seite,
                            teileOfflineStand = if (seite == 1) r.stand else it.teileOfflineStand)
                    }
                    if (seite == 1) {
                        // Die manuellen Teile stehen als ein Abschnitt über der
                        // Liste, nicht seitenweise — und unter DEMSELBEN Suchfeld.
                        (quelle.manuelleTeile(abfrage.suche) as? Result.Success)
                            ?.let { m -> _state.update { it.copy(manualParts = m.data.parts) } }
                        // Kennzahlen sind Beiwerk: Ein Fehlschlag lässt die Liste stehen.
                        (quelle.teileKennzahlen() as? Result.Success)
                            ?.let { s -> _state.update { it.copy(partsStats = s.data.stats) } }
                    }
                }
                is Result.Error -> {
                    _state.update { it.copy(partsLoading = false, partsFehler = beschreibeFehler(r)) }
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
                ?.let { d -> _state.update { it.copy(partsFilterColors = d.colors) } }
            (quelle.kategorien() as? Result.Success)?.data?.takeIf { it.success }
                ?.let { d -> _state.update { it.copy(partsCategories = d.categories) } }
        }
    }

    /** Farbauswahl im Erfassungsdialog; fehlt sie, tippt man die Farb-ID. */
    fun ladeFarben() {
        scope.launch {
            (quelle.alleFarben() as? Result.Success)?.data?.takeIf { it.success }
                ?.let { d -> _state.update { it.copy(partsColors = d.colors) } }
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
                ?.let { r -> _state.update { it.copy(minifigStats = r.data.stats) } }
        }
        figurenJob?.cancel()
        figurenJob = scope.launch {
            if (entprellt) delay(suchPause)
            _state.update { it.copy(minifigsLoading = true, minifigsFehler = null) }
            val suche = _state.value.minifigsQuery.ifBlank { null }
            when (val r = quelle.figuren(suche)) {
                is Result.Success -> {
                    _state.update { it.copy(minifigs = r.data.figs, minifigsLoading = false,
                        figurenOfflineStand = r.stand) }
                    (quelle.manuelleFiguren(suche) as? Result.Success)
                        ?.let { m -> _state.update { it.copy(manualFigs = m.data.figs) } }
                }
                is Result.Error -> {
                    meldeFehler(r)
                    _state.update { it.copy(minifigsLoading = false, minifigsFehler = beschreibeFehler(r)) }
                }
            }
        }
    }

    fun setzeFigurSuche(q: String) {
        _state.update { it.copy(minifigsQuery = q) }
        ladeFiguren(entprellt = true)
    }

    /** Abmelden: nichts vom vorigen Konto stehen lassen, laufende Abrufe verwerfen. */
    /** Gemerkte Filter und Ansichten übernehmen, ohne zu laden. */
    fun stelleFilterWieder(aenderung: (PartsUiState) -> PartsUiState) = _state.update(aenderung)

    fun zuruecksetzen() {
        teileJob?.cancel()
        figurenJob?.cancel()
        _state.value = PartsUiState()
    }
}

/**
 * Die Farbliste ohne ihren Eintrag für KEINE_FARBE („[No Color/Any Color]“):
 * Die Auswahl führt „keine Farbe“ selbst, in der Sprache der App; sonst stünde
 * dieselbe Wahl zweimal da.
 */
fun ohneKeineFarbe(farben: List<ch.brickinventoryapp.data.model.BrickColor>) =
    farben.filter { it.id != ch.brickinventoryapp.data.model.KEINE_FARBE }

/**
 * Der Name der heutigen Farbe: KEINE_FARBE heisst [keineFarbe], nie „Farbe
 * 9999“; sonst der Name aus der Liste, dann der gespeicherte. Null, wenn
 * keiner bekannt ist — dann nennt die Anzeige die Nummer.
 */
fun farbName(farben: List<ch.brickinventoryapp.data.model.BrickColor>, aktuell: Int,
             aktuellerName: String?, keineFarbe: String): String? =
    if (aktuell == ch.brickinventoryapp.data.model.KEINE_FARBE) keineFarbe
    else farben.firstOrNull { it.id == aktuell }?.name ?: aktuellerName?.takeIf { it.isNotBlank() }
