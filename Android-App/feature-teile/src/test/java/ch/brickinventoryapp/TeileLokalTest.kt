package ch.brickinventoryapp

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
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.ui.Teile
import ch.brickinventoryapp.ui.TeileAbfrage
import ch.brickinventoryapp.ui.TeileLokal
import ch.brickinventoryapp.ui.TeileQuelle
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Teile und Figuren folgen ohne Filter der lokalen Ablage (Room), wie die
 * Galerie: Was offline erfasst, geändert oder gelöscht wird, steht sofort da.
 * Mit Suchtext oder Konto gilt die Antwort des Servers.
 *
 * Gegenproben:
 *   A  in Teile.init bei den manuellen Teilen die Bedingung `partsQuery.isNotBlank()`
 *      entfernt → rot „mit Suchtext bleibt die Serverantwort stehen“
 *   B  in Teile.folge die Prüfung `l.stand != null` entfernt → rot „eine nie
 *      geladene Liste leert nichts“ ([alt] statt [server])
 *   C  in Teile.init bei den Figuren `figurenEingeschraenkt()` entfernt → rot
 *      „mit Kontofilter folgen die Figuren nicht“
 *   D  in Teile.init die Bedingung `st.partsPage != 1` entfernt → rot „Seite 2 …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeileLokalTest {

    private class Quelle : TeileQuelle {
        override suspend fun seite(abfrage: TeileAbfrage) = Ergebnis.Success(PartsResponse(success = true, total = 1,
            parts = listOf(Part(partNumber = if (abfrage.suche == null) "server-${abfrage.seite}" else "treffer"))))
        override suspend fun manuelleTeile(suche: String?) = Ergebnis.Success(ManualPartsResponse(success = true,
            parts = listOf(PartValuationItem(partNumber = if (suche == null) "server" else "treffer"))))
        override suspend fun teileKennzahlen(): Ergebnis<PartsStatsResponse> = Ergebnis.Error("aus")
        override suspend fun filterFarben() = Ergebnis.Success(PartsFilterColorsResponse(success = true))
        override suspend fun kategorien() = Ergebnis.Success(PartsCategoriesResponse(success = true))
        override suspend fun alleFarben() = Ergebnis.Success(BrickColorsResponse(success = true))
        override suspend fun figurKennzahlen(): Ergebnis<MinifigStatsResponse> = Ergebnis.Error("aus")
        override suspend fun figuren(suche: String?) = Ergebnis.Success(MinifigsResponse(success = true,
            figs = listOf(Minifig(figNumber = "server"))))
        override suspend fun manuelleFiguren(suche: String?) = Ergebnis.Success(ManualFigsResponse(success = true,
            figs = listOf(FigValuationItem(figNumber = "server"))))
    }

    private val teile = MutableStateFlow(Lokal(emptyList<Part>(), null))
    private val manuelleTeile = MutableStateFlow(Lokal(emptyList<PartValuationItem>(), null))
    private val figuren = MutableStateFlow(Lokal(emptyList<Minifig>(), null))
    private val manuelleFiguren = MutableStateFlow(Lokal(emptyList<FigValuationItem>(), null))
    private var konto = false

    private fun TestScope.teile() = Teile(
        scope = backgroundScope, quelle = Quelle(), meldeFehler = {}, vergissScroll = {},
        lokal = TeileLokal(teile, manuelleTeile, figuren, manuelleFiguren),
        teileEingeschraenkt = { konto }, figurenEingeschraenkt = { konto },
    )

    @Test
    fun `ohne Filter folgen Teile und manuelle Teile der Ablage, mit Suchtext bleibt die Serverantwort stehen`() = runTest {
        val t = teile()
        t.laden(); runCurrent()
        assertEquals(listOf("server-1"), t.state.value.parts.map { it.partNumber })

        // Offline gelöscht und ein neues erfasst: Room ändert sich, die Liste folgt.
        manuelleTeile.value = Lokal(listOf(PartValuationItem(partNumber = "neu", quantity = 3)), stand = 1L)
        teile.value = Lokal(listOf(Part(partNumber = "lokal")), stand = 1L)
        runCurrent()
        assertEquals(listOf("neu" to 3), t.state.value.manualParts!!.map { it.partNumber to it.quantity })
        assertEquals(listOf("lokal"), t.state.value.parts.map { it.partNumber })

        t.setzeSuche("3001"); testScheduler.advanceTimeBy(400); runCurrent()
        manuelleTeile.value = Lokal(listOf(PartValuationItem(partNumber = "anders")), stand = 2L)
        teile.value = Lokal(listOf(Part(partNumber = "anders")), stand = 2L)
        runCurrent()
        assertEquals("mit Suchtext bleibt die Serverantwort stehen", listOf("treffer"),
            t.state.value.manualParts!!.map { it.partNumber })
        assertEquals(listOf("treffer"), t.state.value.parts.map { it.partNumber })
    }

    @Test
    fun `Seite 2 wird nicht von der ersten Seite aus der Ablage ersetzt`() = runTest {
        val t = teile()
        t.laden(); runCurrent()
        t.laden(seite = 2); runCurrent()
        teile.value = Lokal(listOf(Part(partNumber = "lokal")), stand = 1L)
        runCurrent()
        assertEquals(listOf("server-1", "server-2"), t.state.value.parts.map { it.partNumber })
    }

    @Test
    fun `Figuren folgen der Ablage, mit Kontofilter nicht`() = runTest {
        val t = teile()
        t.ladeFiguren(); runCurrent()
        figuren.value = Lokal(listOf(Minifig(figNumber = "sw0002")), stand = 1L)
        manuelleFiguren.value = Lokal(emptyList(), stand = 1L)
        runCurrent()
        assertEquals(listOf("sw0002"), t.state.value.minifigs.map { it.figNumber })
        assertEquals("offline gelöscht: die manuelle Liste ist leer", emptyList<String>(),
            t.state.value.manualFigs!!.map { it.figNumber })

        konto = true
        figuren.value = Lokal(listOf(Minifig(figNumber = "fremd")), stand = 2L)
        runCurrent()
        assertEquals("mit Kontofilter folgen die Figuren nicht", listOf("sw0002"),
            t.state.value.minifigs.map { it.figNumber })
    }

    @Test
    fun `eine nie geladene Liste leert nichts`() = runTest {
        val t = teile()
        t.ladeFiguren(); runCurrent()
        // Ohne Stand ist die Ablage nie vom Server gefüllt worden; ihr Inhalt zählt nicht.
        manuelleFiguren.value = Lokal(listOf(FigValuationItem(figNumber = "alt")), stand = null)
        runCurrent()
        assertEquals(listOf("server"), t.state.value.manualFigs!!.map { it.figNumber })
    }
}
