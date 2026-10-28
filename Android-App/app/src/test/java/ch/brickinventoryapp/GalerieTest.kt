package ch.brickinventoryapp

import ch.brickinventoryapp.data.model.SetItem
import ch.brickinventoryapp.data.model.SetsResponse
import ch.brickinventoryapp.data.model.StatsResponse
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.Galerie
import ch.brickinventoryapp.ui.GalerieAnzeige
import ch.brickinventoryapp.ui.GalleryUiState
import ch.brickinventoryapp.ui.galerieAnzeige
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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
 *
 * Gegenproben Fehler/leer (am 28.10. gemessen, kotlinc gegen Galerie.kt;
 * Result und Fehlerart dafür wörtlich aus BrickRepository.kt herausgeschnitten,
 * weil die Datei Retrofit braucht):
 *   D  in laden() `galleryFehler = beschreibeFehler(r)` entfernt → rot „ein
 *      Ladefehler wird zur Fehleranzeige mit Grund"
 *   E  `galleryFehler = null` beim neuen Versuch entfernt → rot „ein
 *      erfolgreicher neuer Versuch raeumt den Fehler weg"
 *   F  in galerieAnzeige() die Zweige FEHLER und LEER vertauscht → rot
 *      „ein Ladefehler …" und „eine leere Sammlung …"
 */
class GalerieTest {

    private fun set(n: Int) = SetItem(setNumber = "$n-1")

    /** Abruf-Attrappe: Seite 1 = Sets 1..2, Seite 2 = Sets [seite2]; Gesamtzahl 4. */
    private class Abruf(val seite2: List<Int> = listOf(3, 4), val dauer: (Int) -> Long = { 10 }) {
        val bestellt = mutableListOf<Pair<Int, String>>()   // Seite, Thema
    }

    private fun TestScope.galerie(a: Abruf, fehler: () -> Result.Error? = { null }) = Galerie(
        scope = this,
        holeSeite = { g: GalleryUiState, seite: Int ->
            a.bestellt += seite to g.galleryTheme
            delay(a.dauer(seite))
            val nummern = if (seite == 1) listOf(1, 2) else a.seite2
            fehler() ?: Result.Success(SetsResponse(success = true, sets = nummern.map { SetItem(setNumber = "$it-1") }, total = 4))
        },
        beschreibeFehler = { "Grund: ${it.message}" },
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

    @Test
    fun `ein Ladefehler wird zur Fehleranzeige mit Grund`() = runTest {
        val g = galerie(Abruf()) { Result.Error("Zeitüberschreitung") }
        g.laden(); advanceUntilIdle()
        val st = g.state.value
        assertEquals("Grund: Zeitüberschreitung", st.galleryFehler)
        assertEquals(GalerieAnzeige.FEHLER, galerieAnzeige(st, gefiltert = false))
    }

    @Test
    fun `ein erfolgreicher neuer Versuch raeumt den Fehler weg`() = runTest {
        var kaputt = true
        val g = galerie(Abruf()) { if (kaputt) Result.Error("Netz") else null }
        g.laden(); advanceUntilIdle()
        kaputt = false
        g.laden(); advanceUntilIdle()
        assertNull(g.state.value.galleryFehler)
        assertEquals(GalerieAnzeige.LISTE, galerieAnzeige(g.state.value, gefiltert = false))
    }

    @Test
    fun `eine leere Sammlung ist kein Fehler`() {
        assertEquals(GalerieAnzeige.LEER, galerieAnzeige(GalleryUiState(), gefiltert = false))
        assertEquals(GalerieAnzeige.KEINE_TREFFER, galerieAnzeige(GalleryUiState(), gefiltert = true))
        assertEquals(GalerieAnzeige.LAEDT, galerieAnzeige(GalleryUiState(galleryLoading = true), gefiltert = false))
    }

    @Test
    fun `geladene Sets bleiben stehen, auch wenn das Neuladen scheitert`() {
        val st = GalleryUiState(sets = listOf(set(1)), galleryFehler = "Netz")
        assertEquals(GalerieAnzeige.LISTE, galerieAnzeige(st, gefiltert = false))
    }
}
