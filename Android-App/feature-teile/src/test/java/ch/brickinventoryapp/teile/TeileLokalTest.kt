package ch.brickinventoryapp.teile

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
import ch.brickinventoryapp.teile.ui.Teile
import ch.brickinventoryapp.teile.ui.TeileAbfrage
import ch.brickinventoryapp.teile.ui.TeileLokal
import ch.brickinventoryapp.teile.ui.TeileQuelle
import ch.brickinventoryapp.model.ui.Listenansicht
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Ohne Konto- und Lagerfilter ist die Ablage (Room) die einzige Quelle von Teilen
 * und Figuren, wie in der Galerie: Der Abruf füllt nur die Ablage, Suche und Filter
 * gelten der Ablage, offline Erfasstes steht sofort da. Mit Kontofilter und in der
 * Tabelle (sie zählt „In Sets“) gilt die Antwort des Servers.
 *
 * Gegenproben (gemessen mit kotlinc und JUnit, ohne Gradle):
 *   teile-ablage-trotz-konto     Teile.teileLokal übergeht teileEingeschraenkt() → rot „ohne
 *                                Kontofilter folgen die Teile …“ („mit Kontofilter gilt die
 *                                Antwort des Servers“)
 *   teile-tabelle-aus-ablage     Teile.teileLokal übergeht die Tabelle → rot „die Tabelle …“
 *   figuren-offline-ohne-stand   ausgang() ohne den Zweig „ohne Netz mit Stand“ → rot
 *                                „ohne Netz bleiben die Figuren stehen“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeileLokalTest {

    private class Quelle : TeileQuelle {
        val seiten = mutableListOf<TeileAbfrage>()
        override suspend fun seite(abfrage: TeileAbfrage) = Ergebnis.Success(PartsResponse(success = true, total = 1,
            parts = listOf(Part(partNumber = "server")))).also { seiten += abfrage }
        override suspend fun manuelleTeile(suche: String?) = Ergebnis.Success(ManualPartsResponse(success = true,
            parts = listOf(PartValuationItem(partNumber = "server"))))
        override suspend fun teileKennzahlen(): Ergebnis<PartsStatsResponse> = Ergebnis.Error.Server(503, "aus")
        override suspend fun filterFarben() = Ergebnis.Success(PartsFilterColorsResponse(success = true))
        override suspend fun kategorien() = Ergebnis.Success(PartsCategoriesResponse(success = true))
        override suspend fun alleFarben() = Ergebnis.Success(BrickColorsResponse(success = true))
        override suspend fun figurKennzahlen(): Ergebnis<MinifigStatsResponse> = Ergebnis.Error.Server(503, "aus")
        override suspend fun figuren(suche: String?) = Ergebnis.Success(MinifigsResponse(success = true,
            figs = listOf(Minifig(figNumber = "server"))))
        override suspend fun manuelleFiguren(suche: String?) = Ergebnis.Success(ManualFigsResponse(success = true,
            figs = listOf(FigValuationItem(figNumber = "server"))))
    }

    private val quelle = Quelle()
    private val teile = MutableStateFlow(Lokal(listOf(Part(partNumber = "3001", partName = "Brick"),
        Part(partNumber = "3023", partName = "Plate")), stand = 1L))
    private val manuelleTeile = MutableStateFlow(Lokal(emptyList<PartValuationItem>(), 1L))
    private val figuren = MutableStateFlow(Lokal(listOf(Minifig(figNumber = "sw0001")), 4L))
    private val manuelleFiguren = MutableStateFlow(Lokal(emptyList<FigValuationItem>(), 4L))
    private var konto = false
    private var abrufe = 0
    private var figurenAntwort: Ergebnis<Unit> = Ergebnis.Success(Unit)

    // Wie die Filterspalten in Room: Der Suchtext trifft Nummer oder Name.
    private fun TestScope.teile() = Teile(
        scope = backgroundScope, quelle = quelle, meldeFehler = {}, vergissScroll = {},
        lokal = TeileLokal(
            teile = { st -> teile.map { l -> l.copy(liste = l.liste.filter { st.partsQuery.isBlank() ||
                it.partNumber.contains(st.partsQuery) || it.partName.orEmpty().contains(st.partsQuery) }) } },
            manuelleTeile = { manuelleTeile },
            figuren = { figuren },
            manuelleFiguren = { manuelleFiguren },
            aktualisiereTeile = { abrufe++; Ergebnis.Success(Unit) },
            aktualisiereFiguren = { figurenAntwort },
        ),
        teileEingeschraenkt = { konto }, figurenEingeschraenkt = { konto },
    )

    @Test
    fun `ohne Kontofilter folgen die Teile der Ablage, mit Kontofilter dem Server`() = runTest {
        val t = teile()
        t.laden(); runCurrent()
        assertEquals(listOf("3001", "3023"), t.state.value.parts.map { it.partNumber })
        assertEquals("der Abruf füllt nur die Ablage", 1 to 0, abrufe to quelle.seiten.size)

        // Offline erfasst: Room ändert sich, die Liste folgt.
        manuelleTeile.value = Lokal(listOf(PartValuationItem(partNumber = "neu", quantity = 3)), stand = 2L)
        runCurrent()
        assertEquals(listOf("neu" to 3), t.state.value.manualParts!!.map { it.partNumber to it.quantity })

        t.setzeSuche("Plate"); testScheduler.advanceTimeBy(400); runCurrent()
        assertEquals("die Suche gilt der Ablage", listOf("3023"), t.state.value.parts.map { it.partNumber })
        t.laden(seite = 2); runCurrent()
        assertEquals("aus der Ablage wird nicht geblättert", 0, quelle.seiten.size)

        konto = true
        t.laden(); runCurrent()
        teile.value = Lokal(listOf(Part(partNumber = "fremd")), stand = 3L)
        runCurrent()
        assertEquals("mit Kontofilter gilt die Antwort des Servers", listOf("server"), t.state.value.parts.map { it.partNumber })
    }

    @Test
    fun `die Tabelle zaehlt In Sets und fragt deshalb den Server`() = runTest {
        val t = teile()
        t.setzeAnsicht(Listenansicht.TABELLE); runCurrent()
        assertEquals("die Tabelle fragt den Server", listOf("server"), t.state.value.parts.map { it.partNumber })
        assertTrue(quelle.seiten.single().mitSets)
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
    fun `eine nie geladene Ablage zeigt nichts und leert nichts`() = runTest {
        figuren.value = Lokal(listOf(Minifig(figNumber = "alt")), stand = null)
        val t = teile()
        t.ladeFiguren(); runCurrent()
        assertEquals(emptyList<String>(), t.state.value.minifigs.map { it.figNumber })
        figuren.value = Lokal(listOf(Minifig(figNumber = "sw0002")), stand = 5L)
        runCurrent()
        assertEquals(listOf("sw0002"), t.state.value.minifigs.map { it.figNumber })
    }
}
