package ch.brickinventoryapp

import ch.brickinventoryapp.data.model.SetItem
import ch.brickinventoryapp.data.model.SetsResponse
import ch.brickinventoryapp.data.model.StatsResponse
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.Galerie
import ch.brickinventoryapp.ui.GalleryUiState
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * Die Galerie als Ablauf geprüft — ohne ViewModel und Netz, mit einem
 * nachgebauten Abruf, der mitschreibt, was bestellt wird.
 *
 * Ersetzt GalleryLoadMoreRaceTest, der dieselben Regeln am Quelltext las
 * („steht die Sperre vor dem launch?"). Hier zählt, was passiert.
 *
 * Gegenproben (am 27.10. gemessen, kotlinc gegen Galerie.kt):
 *   A  in mehrLaden() die Sperre in die Koroutine verschoben → rot:
 *      „zwei Nachlade-Aufrufe im selben Takt holen Seite 2 nur einmal"
 *   B  die Generationsprüfung in mehrLaden() entfernt → rot: „eine Antwort
 *      des alten Filters wird verworfen und gibt die Sperre frei"
 *   C  das Aussieben bekannter Schlüssel entfernt → rot: „beim Anhängen
 *      werden doppelte Sets ausgesiebt"
 */
class GalerieTest {

    private fun set(n: Int) = SetItem(setNumber = "$n-1")

    /** Abruf-Attrappe: Seite 1 = Sets 1..2, Seite 2 = Sets [seite2]; Gesamtzahl 4. */
    private class Abruf(val seite2: List<Int> = listOf(3, 4), val dauer: (Int) -> Long = { 10 }) {
        val bestellt = mutableListOf<Pair<Int, String>>()   // Seite, Thema
    }

    private fun TestScope.galerie(a: Abruf) = Galerie(
        scope = this,
        holeSeite = { g: GalleryUiState, seite: Int ->
            a.bestellt += seite to g.galleryTheme
            delay(a.dauer(seite))
            val nummern = if (seite == 1) listOf(1, 2) else a.seite2
            Result.Success(SetsResponse(success = true, sets = nummern.map { SetItem(setNumber = "$it-1") }, total = 4))
        },
        holeKennzahlen = { Result.Success(StatsResponse(success = true)) },
        meldeFehler = {},
        vergissScroll = {},
    )

    @Test
    fun `zwei Nachlade-Aufrufe im selben Takt holen Seite 2 nur einmal`() = runTest {
        val a = Abruf()
        val g = galerie(a)
        g.laden(); advanceUntilIdle()
        g.mehrLaden(); g.mehrLaden()
        advanceUntilIdle()
        assertEquals(1, a.bestellt.count { it.first == 2 })
        assertEquals(listOf("1-1", "2-1", "3-1", "4-1"), g.state.value.sets.map { it.setNumber })
    }

    @Test
    fun `eine Antwort des alten Filters wird verworfen und gibt die Sperre frei`() = runTest {
        val a = Abruf(dauer = { if (it == 2) 100 else 10 })
        val g = galerie(a)
        g.laden(); advanceUntilIdle()
        g.mehrLaden(); runCurrent()
        g.setzeThema("Technic")
        advanceUntilIdle()
        val st = g.state.value
        assertFalse("Die Sperre bleibt stehen — der Endlos-Scroll lädt nie wieder", st.galleryLoadingMore)
        assertEquals("Seite 2 des alten Filters hängt an der neuen Liste",
            listOf("1-1", "2-1"), st.sets.map { it.setNumber })
        assertEquals("Technic", a.bestellt.last().second)
    }

    @Test
    fun `beim Anhaengen werden doppelte Sets ausgesiebt`() = runTest {
        val g = galerie(Abruf(seite2 = listOf(2, 3)))
        g.laden(); advanceUntilIdle()
        g.mehrLaden(); advanceUntilIdle()
        assertEquals(listOf("1-1", "2-1", "3-1"), g.state.value.sets.map { it.setNumber })
    }

    @Test
    fun `die Suche wartet die Pause ab und fragt einmal mit dem letzten Text`() = runTest {
        val a = Abruf()
        val g = galerie(a)
        g.setzeSuche("ti"); g.setzeSuche("tit")
        advanceTimeBy(300)
        assertEquals(0, a.bestellt.size)
        advanceUntilIdle()
        assertEquals(1, a.bestellt.size)
        assertEquals("tit", g.state.value.galleryQuery)
    }

    @Test
    fun `Abmelden raeumt auf, und eine spaete Antwort kommt nicht zurueck`() = runTest {
        val g = galerie(Abruf(dauer = { 100 }))
        g.laden(); runCurrent()
        g.zuruecksetzen()
        advanceUntilIdle()
        assertEquals(GalleryUiState(), g.state.value)
    }
}
