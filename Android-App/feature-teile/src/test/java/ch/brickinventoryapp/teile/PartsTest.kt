package ch.brickinventoryapp.teile

import ch.brickinventoryapp.model.fach.Kategoriewahl
import ch.brickinventoryapp.model.fach.ColorPicker
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.lokal.Local
import ch.brickinventoryapp.model.fach.FigurAnsicht
import ch.brickinventoryapp.model.fach.MinifigsMetricsView
import ch.brickinventoryapp.model.fach.ManualMinifigView
import ch.brickinventoryapp.model.fach.ManualPartView
import ch.brickinventoryapp.model.fach.TeilAnsicht
import ch.brickinventoryapp.model.fach.PartsMetricsView
import ch.brickinventoryapp.model.fach.ColorView
import ch.brickinventoryapp.model.fach.FilterColorView
import ch.brickinventoryapp.model.fach.CategoryView
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.teile.ui.Figuren
import ch.brickinventoryapp.teile.ui.MinifigsLocal
import ch.brickinventoryapp.teile.ui.Teile
import ch.brickinventoryapp.teile.ui.Teilefilter
import ch.brickinventoryapp.teile.ui.PartsLocal
import ch.brickinventoryapp.teile.ui.PartsUiState
import ch.brickinventoryapp.teile.ui.PartsSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.ui.ListView

/**
 * Teile- und Figurenliste als Ablauf geprüft. Ihre Quellen sind Flüsse (im Gerät
 * die Ablage oder die Kontosicht, das wählt das ViewModel); der Abruf füllt nur
 * die Quelle und schreibt hier mit, für welchen Zustand er gerufen wurde.
 *
 * Gegenproben (kotlinc gegen Teile.kt, Fassung mit einem Lademodus):
 *   A  in loadParts() den Zustand vor dem Entprellen gelesen → rot „die Filter des
 *      Zustands erreichen Quelle und Abruf“ (Suche fehlt)
 *   B  vergissScroll() in setFilter() entfernt → rot „ein Filterwechsel vergisst
 *      die Scrollstelle“
 *   C  die Figurenkennzahlen in denselben Auftrag wie die Liste gelegt → rot „die
 *      Figurenliste wartet nicht auf die Kennzahlen“
 *   D  in Listenfolge.abbrechen() `folgen.forEach { it.cancel() }` entfernt → rot „nach
 *      einem Filterwechsel schreibt die alte Quelle nicht mehr hinein“
 *   E  in ausgang() den Zweig „ohne Netz mit Stand“ entfernt → rot „ohne Netz
 *      bleiben die Figuren stehen“
 *   F  in folge() die Prüfung auf den Stand entfernt → rot „eine nie geladene
 *      Quelle zeigt nichts und leert nichts“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PartsTest {

    private class Kennzahlen : PartsSource {
        var minifigFetches = 0
        var minifigDuration = 0L
        override suspend fun partsMetrics(): Ergebnis<PartsMetricsView?> = Ergebnis.Fehler.Server(503, "aus")
        override suspend fun filterColors() = Ergebnis.Erfolg(emptyList<FilterColorView>())
        override suspend fun kategorien() = Ergebnis.Erfolg(emptyList<CategoryView>())
        override suspend fun allColors() = Ergebnis.Erfolg(emptyList<ColorView>())
        suspend fun minifigMetrics(): Ergebnis<MinifigsMetricsView> {
            minifigFetches++
            delay(minifigDuration)
            return Ergebnis.Fehler.Server(500, "Zählung gescheitert")
        }
    }

    private val metrics = Kennzahlen()
    private val teile = MutableStateFlow(Local(listOf(TeilAnsicht(partNumber = "3001", partName = "Brick", colorName = "Red"),
        TeilAnsicht(partNumber = "3023", partName = "Plate", colorName = "Blue")), 1L))
    private val manuelleTeile = MutableStateFlow(Local(emptyList<ManualPartView>(), 1L))
    private val figuren = MutableStateFlow(Local(listOf(FigurAnsicht(figNumber = "sw0001")), 4L))
    private val manualMinifigs = MutableStateFlow(Local(emptyList<ManualMinifigView>(), 4L))
    private val partsFetches = mutableListOf<PartsUiState>()
    private val searchManual = mutableListOf<String>()
    private val minifigFetches = mutableListOf<String>()
    private var minifigsResponse: Ergebnis<Unit> = Ergebnis.Erfolg(Unit)
    private var vergessen = 0

    /**
     * Im Vordergrund des Takts, damit advanceUntilIdle auch die Abrufe abwartet
     * (backgroundScope zählt dort nicht); als Kind des Hintergrunds endet er mit dem Test.
     */
    private fun TestScope.foreground() = CoroutineScope(coroutineContext + Job(backgroundScope.coroutineContext[Job]))

    // Wie die Filterspalten in Room: Der Suchtext trifft Nummer oder Name, die Farbe den Farbnamen.
    private fun TestScope.teile() = Teile(
        scope = foreground(), quelle = metrics, reportError = {}, vergissScroll = { vergessen++ },
        listen = PartsLocal(
            teile = { st -> val f = st.filter; teile.map { l -> l.copy(liste = l.liste.filter {
                (f.suche.isBlank() || it.partNumber.contains(f.suche) || it.partName.orEmpty().contains(f.suche)) &&
                    (f.farbe == ColorPicker.Alle || it.colorName == f.farbe.wert) }) } },
            manuelleTeile = { st -> searchManual += st.filter.suche; manuelleTeile },
            refresh = { st -> partsFetches += st; Ergebnis.Erfolg(Unit) },
        ),
    )

    private fun TestScope.figurenliste() = Figuren(
        scope = foreground(), reportError = {},
        listen = MinifigsLocal(
            figuren = { figuren },
            manualMinifigs = { manualMinifigs },
            refresh = { st -> minifigFetches += st.minifigsQuery; minifigsResponse },
            metrics = { metrics.minifigMetrics() },
        ),
    )

    private fun Teile.filtere(aenderung: (Teilefilter) -> Teilefilter) = setFilter(aenderung(state.value.filter))

    @Test
    fun `die Filter des Zustands erreichen Quelle und Abruf`() = runTest {
        val t = teile()
        t.filtere { it.copy(farbe = ColorPicker.Farbe("Red")) }; t.filtere { it.copy(kategorie = Kategoriewahl.Kategorie("11")) }
        t.filtere { it.copy(ersatz = Ersatzteilwahl.OHNE) }; t.filtere { it.copy(ansicht = ListView.TABLE) }
        t.filtere { it.copy(suche = "30") }
        advanceUntilIdle()
        val st = partsFetches.last().filter
        assertEquals(listOf("30", "Red", "11"), listOf(st.suche, st.farbe.wert, st.kategorie.wert))
        assertEquals(Ersatzteilwahl.OHNE to ListView.TABLE, st.ersatz to st.ansicht)
        assertEquals(listOf("3001"), t.state.value.parts.map { it.partNumber })
        assertEquals("die manuellen Teile unter demselben Suchtext", "30", searchManual.last())
    }

    @Test
    fun `ein Filterwechsel vergisst die Scrollstelle`() = runTest {
        val t = teile()
        t.filtere { it.copy(farbe = ColorPicker.Farbe("5")) }; t.filtere { it.copy(kategorie = Kategoriewahl.Kategorie("11")) }
        t.filtere { it.copy(ersatz = Ersatzteilwahl.NUR) }; t.filtere { it.copy(suche = "stein") }
        assertEquals(4, vergessen)
        t.filtere { it.copy(farbe = ColorPicker.Farbe("5")) }
        assertEquals("Dieselbe Farbe noch einmal ist kein Wechsel", 4, vergessen)
        advanceUntilIdle()
    }

    @Test
    fun `die Liste folgt der Quelle, auch ohne Abruf`() = runTest {
        val t = teile()
        t.laden(); runCurrent()
        // Vorgabe ist „nach Farbe“ (TeileOrdnung): Blue vor Red, nicht die Reihenfolge der Quelle.
        assertEquals(listOf("3023", "3001"), t.state.value.parts.map { it.partNumber })
        // Offline erfasst: Die Ablage ändert sich, die Liste folgt.
        manuelleTeile.value = Local(listOf(ManualPartView(partNumber = "neu", quantity = 3)), 2L)
        runCurrent()
        assertEquals(listOf("neu" to 3), t.state.value.manualParts!!.map { it.partNumber to it.quantity })
        t.laden(seite = 2); runCurrent()
        assertEquals("geblättert wird nicht mehr: Die Quelle hält alles", 1, partsFetches.size)
    }

    @Test
    fun `nach einem Filterwechsel schreibt die alte Quelle nicht mehr hinein`() = runTest {
        val alt = MutableStateFlow(Local(listOf(TeilAnsicht(partNumber = "alt")), 1L))
        val neu = MutableStateFlow(Local(listOf(TeilAnsicht(partNumber = "neu")), 1L))
        val t = Teile(scope = foreground(), quelle = metrics, reportError = {}, vergissScroll = {},
            listen = PartsLocal(teile = { st -> if (st.filter.farbe == ColorPicker.Alle) alt else neu },
                manuelleTeile = { manuelleTeile }, refresh = { Ergebnis.Erfolg(Unit) }))
        t.laden(); runCurrent()
        t.filtere { it.copy(farbe = ColorPicker.Farbe("Red")) }; runCurrent()
        alt.value = Local(listOf(TeilAnsicht(partNumber = "spaet")), 2L)
        runCurrent()
        assertEquals(listOf("neu"), t.state.value.parts.map { it.partNumber })
    }

    @Test
    fun `die Figurenliste wartet nicht auf die Kennzahlen und ein Fehlschlag laesst sie stehen`() = runTest {
        metrics.minifigDuration = 5_000
        val t = figurenliste()
        t.laden()
        advanceTimeBy(10); runCurrent()
        assertEquals(listOf("sw0001"), t.zustand.value.minifigs.map { it.figNumber })
        assertFalse(t.zustand.value.minifigsFetch.laedt)
        advanceUntilIdle()
        assertEquals(listOf("sw0001"), t.zustand.value.minifigs.map { it.figNumber })
        assertEquals(MinifigsMetricsView(), t.zustand.value.minifigStats)
    }

    @Test
    fun `beim Tippen fragt die Figurenliste einmal und zaehlt nicht neu`() = runTest {
        val t = figurenliste()
        t.setzeSuche("lu"); t.setzeSuche("luk"); t.setzeSuche("luke")
        advanceUntilIdle()
        assertEquals(listOf("luke"), minifigFetches)
        assertEquals(0, metrics.minifigFetches)
    }

    @Test
    fun `ohne Netz bleiben die Figuren stehen, mit ihrem Stand`() = runTest {
        minifigsResponse = Ergebnis.Fehler.Netz()
        val t = figurenliste()
        t.laden(); runCurrent()
        assertEquals(listOf("sw0001"), t.zustand.value.minifigs.map { it.figNumber })
        assertNull("ohne Netz bleiben die Figuren stehen", t.zustand.value.minifigsFetch.errorMessage)
        assertEquals(4L, t.zustand.value.minifigsOfflineStatus)
    }

    @Test
    fun `eine nie geladene Quelle zeigt nichts und leert nichts`() = runTest {
        figuren.value = Local(listOf(FigurAnsicht(figNumber = "alt")), null)
        val t = figurenliste()
        t.laden(); runCurrent()
        assertEquals(emptyList<String>(), t.zustand.value.minifigs.map { it.figNumber })
        figuren.value = Local(listOf(FigurAnsicht(figNumber = "sw0002")), 5L)
        runCurrent()
        assertEquals(listOf("sw0002"), t.zustand.value.minifigs.map { it.figNumber })
    }

    @Test
    fun `Abmelden raeumt auf, und eine spaete Antwort kommt nicht zurueck`() = runTest {
        val t = teile()
        t.filtere { it.copy(farbe = ColorPicker.Farbe("Red")) }; runCurrent()
        t.reset()
        advanceUntilIdle()
        assertEquals(PartsUiState(), t.state.value)
    }
}
