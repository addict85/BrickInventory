package ch.brickinventoryapp.teile

import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.vertrag.BrickColorsResponse
import ch.brickinventoryapp.vertrag.FigValuationItem
import ch.brickinventoryapp.vertrag.Minifig
import ch.brickinventoryapp.model.ui.model.FigurenKennzahlenAnsicht
import ch.brickinventoryapp.vertrag.MinifigStatsResponse
import ch.brickinventoryapp.vertrag.Part
import ch.brickinventoryapp.vertrag.PartValuationItem
import ch.brickinventoryapp.vertrag.PartsCategoriesResponse
import ch.brickinventoryapp.vertrag.PartsFilterColorsResponse
import ch.brickinventoryapp.vertrag.PartsStatsResponse
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.teile.ui.PartsUiState
import ch.brickinventoryapp.teile.ui.Teile
import ch.brickinventoryapp.teile.ui.TeileLokal
import ch.brickinventoryapp.teile.ui.TeileQuelle
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
import ch.brickinventoryapp.model.ui.Listenansicht

/**
 * Teile- und Figurenliste als Ablauf geprüft. Ihre Quellen sind Flüsse (im Gerät
 * die Ablage oder die Kontosicht, das wählt das ViewModel); der Abruf füllt nur
 * die Quelle und schreibt hier mit, für welchen Zustand er gerufen wurde.
 *
 * Gegenproben (kotlinc gegen Teile.kt, Fassung mit einem Lademodus):
 *   A  in ladeTeile() den Zustand vor dem Entprellen gelesen → rot „die Filter des
 *      Zustands erreichen Quelle und Abruf“ (Suche fehlt)
 *   B  vergissScroll() in setzeFarbe() entfernt → rot „ein Filterwechsel vergisst
 *      die Scrollstelle“
 *   C  die Figurenkennzahlen in denselben Auftrag wie die Liste gelegt → rot „die
 *      Figurenliste wartet nicht auf die Kennzahlen“
 *   D  in laden() `teileFolgen.forEach { it.cancel() }` entfernt → rot „nach einem
 *      Filterwechsel schreibt die alte Quelle nicht mehr hinein“
 *   E  in ausgang() den Zweig „ohne Netz mit Stand“ entfernt → rot „ohne Netz
 *      bleiben die Figuren stehen“
 *   F  in folge() die Prüfung auf den Stand entfernt → rot „eine nie geladene
 *      Quelle zeigt nichts und leert nichts“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeileTest {

    private class Kennzahlen : TeileQuelle {
        var figurAbrufe = 0
        var figurDauer = 0L
        override suspend fun teileKennzahlen(): Ergebnis<PartsStatsResponse> = Ergebnis.Error.Server(503, "aus")
        override suspend fun filterFarben() = Ergebnis.Success(PartsFilterColorsResponse(success = true))
        override suspend fun kategorien() = Ergebnis.Success(PartsCategoriesResponse(success = true))
        override suspend fun alleFarben() = Ergebnis.Success(BrickColorsResponse(success = true))
        override suspend fun figurKennzahlen(): Ergebnis<MinifigStatsResponse> {
            figurAbrufe++
            delay(figurDauer)
            return Ergebnis.Error.Server(500, "Zählung gescheitert")
        }
    }

    private val kennzahlen = Kennzahlen()
    private val teile = MutableStateFlow(Lokal(listOf(Part(partNumber = "3001", partName = "Brick", colorName = "Red"),
        Part(partNumber = "3023", partName = "Plate", colorName = "Blue")), 1L))
    private val manuelleTeile = MutableStateFlow(Lokal(emptyList<PartValuationItem>(), 1L))
    private val figuren = MutableStateFlow(Lokal(listOf(Minifig(figNumber = "sw0001")), 4L))
    private val manuelleFiguren = MutableStateFlow(Lokal(emptyList<FigValuationItem>(), 4L))
    private val teileAbrufe = mutableListOf<PartsUiState>()
    private val manuelleSuchen = mutableListOf<String>()
    private val figurAbrufe = mutableListOf<String>()
    private var figurenAntwort: Ergebnis<Unit> = Ergebnis.Success(Unit)
    private var vergessen = 0

    /**
     * Im Vordergrund des Takts, damit advanceUntilIdle auch die Abrufe abwartet
     * (backgroundScope zählt dort nicht); als Kind des Hintergrunds endet er mit dem Test.
     */
    private fun TestScope.vordergrund() = CoroutineScope(coroutineContext + Job(backgroundScope.coroutineContext[Job]))

    // Wie die Filterspalten in Room: Der Suchtext trifft Nummer oder Name, die Farbe den Farbnamen.
    private fun TestScope.teile() = Teile(
        scope = vordergrund(), quelle = kennzahlen, meldeFehler = {}, vergissScroll = { vergessen++ },
        listen = TeileLokal(
            teile = { st -> teile.map { l -> l.copy(liste = l.liste.filter {
                (st.partsQuery.isBlank() || it.partNumber.contains(st.partsQuery) || it.partName.orEmpty().contains(st.partsQuery)) &&
                    (st.partsColorFilter.isBlank() || it.colorName == st.partsColorFilter) }) } },
            manuelleTeile = { st -> manuelleSuchen += st.partsQuery; manuelleTeile },
            figuren = { figuren },
            manuelleFiguren = { manuelleFiguren },
            aktualisiereTeile = { st -> teileAbrufe += st; Ergebnis.Success(Unit) },
            aktualisiereFiguren = { st -> figurAbrufe += st.minifigsQuery; figurenAntwort },
        ),
    )

    @Test
    fun `die Filter des Zustands erreichen Quelle und Abruf`() = runTest {
        val t = teile()
        t.setzeFarbe("Red"); t.setzeKategorie("11"); t.setzeErsatzteile(Ersatzteilwahl.OHNE); t.setzeAnsicht(Listenansicht.TABELLE)
        t.setzeSuche("30")
        advanceUntilIdle()
        val st = teileAbrufe.last()
        assertEquals(listOf("30", "Red", "11"), listOf(st.partsQuery, st.partsColorFilter, st.partsCategoryFilter))
        assertEquals(Ersatzteilwahl.OHNE to Listenansicht.TABELLE, st.partsSpare to st.partsView)
        assertEquals(listOf("3001"), t.state.value.parts.map { it.partNumber })
        assertEquals("die manuellen Teile unter demselben Suchtext", "30", manuelleSuchen.last())
    }

    @Test
    fun `ein Filterwechsel vergisst die Scrollstelle`() = runTest {
        val t = teile()
        t.setzeFarbe("5"); t.setzeKategorie("11"); t.setzeErsatzteile(Ersatzteilwahl.NUR); t.setzeSuche("stein")
        assertEquals(4, vergessen)
        t.setzeFarbe("5")
        assertEquals("Dieselbe Farbe noch einmal ist kein Wechsel", 4, vergessen)
        advanceUntilIdle()
    }

    @Test
    fun `die Liste folgt der Quelle, auch ohne Abruf`() = runTest {
        val t = teile()
        t.laden(); runCurrent()
        assertEquals(listOf("3001", "3023"), t.state.value.parts.map { it.partNumber })
        // Offline erfasst: Die Ablage ändert sich, die Liste folgt.
        manuelleTeile.value = Lokal(listOf(PartValuationItem(partNumber = "neu", quantity = 3)), 2L)
        runCurrent()
        assertEquals(listOf("neu" to 3), t.state.value.manualParts!!.map { it.partNumber to it.quantity })
        t.laden(seite = 2); runCurrent()
        assertEquals("geblättert wird nicht mehr: Die Quelle hält alles", 1, teileAbrufe.size)
    }

    @Test
    fun `nach einem Filterwechsel schreibt die alte Quelle nicht mehr hinein`() = runTest {
        val alt = MutableStateFlow(Lokal(listOf(Part(partNumber = "alt")), 1L))
        val neu = MutableStateFlow(Lokal(listOf(Part(partNumber = "neu")), 1L))
        val t = Teile(scope = vordergrund(), quelle = kennzahlen, meldeFehler = {}, vergissScroll = {},
            listen = TeileLokal(teile = { st -> if (st.partsColorFilter.isBlank()) alt else neu },
                manuelleTeile = { manuelleTeile }, figuren = { figuren }, manuelleFiguren = { manuelleFiguren },
                aktualisiereTeile = { Ergebnis.Success(Unit) }, aktualisiereFiguren = { Ergebnis.Success(Unit) }))
        t.laden(); runCurrent()
        t.setzeFarbe("Red"); runCurrent()
        alt.value = Lokal(listOf(Part(partNumber = "spaet")), 2L)
        runCurrent()
        assertEquals(listOf("neu"), t.state.value.parts.map { it.partNumber })
    }

    @Test
    fun `die Figurenliste wartet nicht auf die Kennzahlen und ein Fehlschlag laesst sie stehen`() = runTest {
        kennzahlen.figurDauer = 5_000
        val t = teile()
        t.ladeFiguren()
        advanceTimeBy(10); runCurrent()
        assertEquals(listOf("sw0001"), t.state.value.minifigs.map { it.figNumber })
        assertFalse(t.state.value.minifigsLoading)
        advanceUntilIdle()
        assertEquals(listOf("sw0001"), t.state.value.minifigs.map { it.figNumber })
        assertEquals(FigurenKennzahlenAnsicht(), t.state.value.minifigStats)
    }

    @Test
    fun `beim Tippen fragt die Figurenliste einmal und zaehlt nicht neu`() = runTest {
        val t = teile()
        t.setzeFigurSuche("lu"); t.setzeFigurSuche("luk"); t.setzeFigurSuche("luke")
        advanceUntilIdle()
        assertEquals(listOf("luke"), figurAbrufe)
        assertEquals(0, kennzahlen.figurAbrufe)
    }

    @Test
    fun `ohne Netz bleiben die Figuren stehen, mit ihrem Stand`() = runTest {
        figurenAntwort = Ergebnis.Error.Netz()
        val t = teile()
        t.ladeFiguren(); runCurrent()
        assertEquals(listOf("sw0001"), t.state.value.minifigs.map { it.figNumber })
        assertNull("ohne Netz bleiben die Figuren stehen", t.state.value.minifigsFehler)
        assertEquals(4L, t.state.value.figurenOfflineStand)
    }

    @Test
    fun `eine nie geladene Quelle zeigt nichts und leert nichts`() = runTest {
        figuren.value = Lokal(listOf(Minifig(figNumber = "alt")), null)
        val t = teile()
        t.ladeFiguren(); runCurrent()
        assertEquals(emptyList<String>(), t.state.value.minifigs.map { it.figNumber })
        figuren.value = Lokal(listOf(Minifig(figNumber = "sw0002")), 5L)
        runCurrent()
        assertEquals(listOf("sw0002"), t.state.value.minifigs.map { it.figNumber })
    }

    @Test
    fun `Abmelden raeumt auf, und eine spaete Antwort kommt nicht zurueck`() = runTest {
        val t = teile()
        t.setzeFarbe("Red"); runCurrent()
        t.zuruecksetzen()
        advanceUntilIdle()
        assertEquals(PartsUiState(), t.state.value)
    }
}
