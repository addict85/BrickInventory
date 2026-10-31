package ch.brickinventoryapp

import ch.brickinventoryapp.data.lokal.Lokal
import ch.brickinventoryapp.data.model.SetItem
import ch.brickinventoryapp.data.model.SetsResponse
import ch.brickinventoryapp.data.model.StatsResponse
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.Galerie
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Ohne Filter zeigt die Galerie die lokale Liste (Room): Was offline geändert
 * wird, erscheint sofort. Mit Filter gilt die Antwort des Servers.
 *
 * Gegenproben (30.10.2026, gemessen):
 *   A  in Galerie.init die Bedingung `ungefiltert(g)` entfernt → rot „mit Filter
 *      bleibt die Serverantwort stehen“
 *   B  die Bedingung `l.stand != null` entfernt → rot „eine nie geladene Liste
 *      leert die Galerie nicht“
 */
class GalerieLokalTest {

    private fun set(nr: Int, menge: Int = 1) = SetItem(setNumber = "$nr-1", quantity = menge)

    private fun kurz(l: List<SetItem>) = l.map { "${it.setNumber}x${it.quantity}" }

    @Test
    fun `ohne Filter folgt die Galerie der lokalen Liste, mit Filter nicht`() = runTest {
        val lokal = MutableStateFlow(Lokal(listOf(set(1), set(2)), stand = 1L))
        val g = Galerie(
            scope = backgroundScope,
            holeSeite = { st, _ ->
                Result.Success(SetsResponse(success = true, total = 2,
                    sets = if (st.galleryTheme.isBlank()) listOf(set(1), set(2)) else listOf(set(9))))
            },
            holeKennzahlen = { Result.Success(StatsResponse(success = true)) },
            meldeFehler = {},
            vergissScroll = {},
            lokal = lokal,
            ungefiltert = { it.galleryTheme.isBlank() },
        )
        g.laden(); runCurrent()
        assertEquals(listOf("1-1x1", "2-1x1"), kurz(g.state.value.sets))

        // Offline +2 auf Set 1 und ein neues Set: Room ändert sich, die Galerie folgt.
        lokal.value = Lokal(listOf(set(3), set(1, 3), set(2)), stand = 1L)
        runCurrent()
        assertEquals(listOf("3-1x1", "1-1x3", "2-1x1"), kurz(g.state.value.sets))

        g.setzeThema("Star Wars"); runCurrent()
        lokal.value = Lokal(listOf(set(4)), stand = 2L)
        runCurrent()
        assertEquals("mit Filter bleibt die Serverantwort stehen", listOf("9-1x1"), kurz(g.state.value.sets))
    }

    @Test
    fun `eine nie geladene Liste leert die Galerie nicht`() = runTest {
        val lokal = MutableStateFlow(Lokal(listOf(set(7)), stand = null))
        val g = Galerie(
            scope = backgroundScope,
            holeSeite = { _, _ -> Result.Success(SetsResponse(success = true, total = 1, sets = listOf(set(1)))) },
            holeKennzahlen = { Result.Success(StatsResponse(success = true)) },
            meldeFehler = {},
            vergissScroll = {},
            lokal = lokal,
            ungefiltert = { true },
        )
        g.laden(); runCurrent()
        lokal.value = Lokal(emptyList(), stand = null)
        runCurrent()
        assertEquals(listOf("1-1x1"), kurz(g.state.value.sets))
    }
}
