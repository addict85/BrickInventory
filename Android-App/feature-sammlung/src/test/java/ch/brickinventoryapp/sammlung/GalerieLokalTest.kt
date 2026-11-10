package ch.brickinventoryapp.sammlung

import kotlinx.coroutines.ExperimentalCoroutinesApi
import ch.brickinventoryapp.model.ui.model.SetAnsicht
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.model.data.model.SetItem
import ch.brickinventoryapp.model.data.model.SetsResponse
import ch.brickinventoryapp.model.data.model.StatsResponse
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.sammlung.ui.Galerie
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Ohne Kontofilter ist die Ablage (Room) die einzige Quelle der Galerie: Der Abruf
 * füllt nur die Ablage, Suche und Thema filtern lokal, und was offline geändert
 * wird, erscheint sofort. Mit Kontofilter gilt die Antwort des Servers.
 *
 * Gegenproben (gemessen mit kotlinc und JUnit, ohne Gradle):
 *   A  in Galerie.laden `lokalGilt(...)` übergangen (immer die Ablage) → rot „mit
 *      Kontofilter gilt die Antwort des Servers“
 *   B  in Galerie.ladenLokal den Zweig „ohne Netz mit Stand“ entfernt → rot „ohne Netz
 *      bleibt die Ablage stehen“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GalerieLokalTest {

    private fun set(nr: Int, menge: Int = 1, thema: String? = null) = SetItem(setNumber = "$nr-1", quantity = menge, theme = thema)

    private fun kurz(l: List<SetAnsicht>) = l.map { "${it.setNumber}x${it.quantity}" }

    @Test
    fun `ohne Kontofilter folgt die Galerie der Ablage, mit Kontofilter dem Server`() = runTest {
        val ablage = MutableStateFlow(Lokal(listOf(set(1), set(2, thema = "Star Wars")), stand = 1L))
        var konto = false
        var abrufe = 0
        var seiten = 0
        val g = Galerie(
            scope = backgroundScope,
            holeSeite = { _, _ -> seiten++; Ergebnis.Success(SetsResponse(success = true, total = 1, sets = listOf(set(9)))) },
            holeKennzahlen = { Ergebnis.Success(StatsResponse(success = true)) },
            meldeFehler = {},
            vergissScroll = {},
            lokal = { st -> ablage.map { l -> l.copy(liste = l.liste.filter { st.galleryTheme.isBlank() || it.theme == st.galleryTheme }) } },
            lokalGilt = { !konto },
            aktualisiere = { abrufe++; Ergebnis.Success(Unit) },
        )
        g.laden(); runCurrent()
        assertEquals(listOf("1-1x1", "2-1x1"), kurz(g.state.value.sets))
        assertEquals("der Abruf füllt nur die Ablage", listOf(1, 0), listOf(abrufe, seiten))

        // Offline +2 auf Set 1 und ein neues Set: Room ändert sich, die Galerie folgt.
        ablage.value = Lokal(listOf(set(3), set(1, 3), set(2, thema = "Star Wars")), stand = 2L)
        runCurrent()
        assertEquals(listOf("3-1x1", "1-1x3", "2-1x1"), kurz(g.state.value.sets))

        g.setzeThema("Star Wars"); runCurrent()
        assertEquals("das Thema filtert die Ablage", listOf("2-1x1"), kurz(g.state.value.sets))
        assertEquals(0, seiten)

        konto = true
        g.laden(); runCurrent()
        ablage.value = Lokal(listOf(set(4, thema = "Star Wars")), stand = 3L)
        runCurrent()
        assertEquals("mit Kontofilter gilt die Antwort des Servers", listOf("9-1x1"), kurz(g.state.value.sets))
    }

    @Test
    fun `ohne Netz bleibt die Ablage stehen, mit ihrem Stand`() = runTest {
        val ablage = MutableStateFlow(Lokal(listOf(set(7)), stand = 5L))
        val g = Galerie(
            scope = backgroundScope,
            holeSeite = { _, _ -> error("ohne Kontofilter fragt die Galerie den Server nicht nach Seiten") },
            holeKennzahlen = { Ergebnis.Success(StatsResponse(success = true)) },
            meldeFehler = {},
            vergissScroll = {},
            lokal = { ablage },
            lokalGilt = { true },
            aktualisiere = { Ergebnis.Error.Netz() },
        )
        g.laden(); runCurrent()
        assertEquals(listOf("7-1x1"), kurz(g.state.value.sets))
        assertNull("ohne Netz bleibt die Ablage stehen", g.state.value.galleryFehler)
        assertEquals(5L, g.state.value.offlineStand)
    }

    @Test
    fun `eine nie geladene Ablage leert die Galerie nicht`() = runTest {
        val ablage = MutableStateFlow(Lokal(listOf(set(7)), stand = null))
        val g = Galerie(
            scope = backgroundScope,
            holeSeite = { _, _ -> error("nicht gefragt") },
            holeKennzahlen = { Ergebnis.Success(StatsResponse(success = true)) },
            meldeFehler = {},
            vergissScroll = {},
            lokal = { ablage },
            lokalGilt = { true },
        )
        g.laden(); runCurrent()
        assertEquals(emptyList<String>(), kurz(g.state.value.sets))
        ablage.value = Lokal(listOf(set(1)), stand = 9L)
        runCurrent()
        assertEquals(listOf("1-1x1"), kurz(g.state.value.sets))
    }
}
