package ch.brickinventoryapp.sammlung

import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import ch.brickinventoryapp.model.ui.model.SetAnsicht
import ch.brickinventoryapp.vertrag.SetItem
import ch.brickinventoryapp.vertrag.StatsResponse
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.sammlung.ui.Galerie
import ch.brickinventoryapp.sammlung.ui.GalerieAnzeige
import ch.brickinventoryapp.sammlung.ui.GalleryUiState
import ch.brickinventoryapp.sammlung.ui.galerieAnzeige
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
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Die Galerie als Ablauf geprüft — ohne ViewModel und Netz. Ihre Quelle ist ein
 * Fluss (im Gerät die Ablage oder die Kontosicht); der Abruf füllt nur die Quelle
 * und schreibt hier mit, wofür er gerufen wurde.
 *
 * Gegenproben (kotlinc gegen Galerie.kt, Dezember-Fassung mit einem Lademodus):
 *   A  in laden() `folgeJob?.cancel()` entfernt → rot „nach einem Filterwechsel zeigt
 *      die Galerie nur die neue Quelle“ (die alte Quelle schreibt weiter hinein)
 *   B  in laden() den Zweig „ohne Netz mit Stand“ entfernt → rot „ohne Netz bleibt
 *      die Quelle stehen, mit ihrem Stand“
 *   C  in laden() `galleryFehler = beschreibeFehler(r)` entfernt → rot „ein
 *      Ladefehler wird zur Fehleranzeige mit Grund“
 *   D  `galleryFehler = null` beim neuen Versuch entfernt → rot „ein
 *      erfolgreicher neuer Versuch raeumt den Fehler weg“
 *   E  in galerieAnzeige() die Zweige FEHLER und LEER vertauscht → rot
 *      „ein Ladefehler …" und „eine leere Sammlung …"
 *   F  in laden() `if (l.stand == null) return@collect` entfernt → rot „eine nie
 *      geladene Quelle leert die Galerie nicht“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GalerieTest {

    private fun set(nr: Int, menge: Int = 1, thema: String? = null) = SetItem(setNumber = "$nr-1", quantity = menge, theme = thema)

    private fun kurz(l: List<SetAnsicht>) = l.map { "${it.setNumber}x${it.quantity}" }

    /** Die Quelle je Thema; [aktualisiert] schreibt mit, für welches Thema gefüllt wurde. */
    private class Quelle(start: Lokal<SetItem> = Lokal(listOf(SetItem("1-1"), SetItem("2-1", theme = "Star Wars")), 1L)) {
        val ablage = MutableStateFlow(start)
        val aktualisiert = mutableListOf<String>()
    }

    /**
     * Im Vordergrund des Takts, damit advanceUntilIdle auch die Abrufe abwartet
     * (backgroundScope zählt dort nicht); als Kind des Hintergrunds endet er mit dem Test.
     */
    private fun TestScope.vordergrund() = CoroutineScope(coroutineContext + Job(backgroundScope.coroutineContext[Job]))

    private fun TestScope.galerie(q: Quelle, ergebnis: () -> Ergebnis<Unit> = { Ergebnis.Success(Unit) }) = Galerie(
        scope = vordergrund(),
        quelle = { st -> q.ablage.map { l -> l.copy(liste = l.liste.filter { st.galleryTheme.isBlank() || it.theme == st.galleryTheme }) } },
        aktualisiere = { st -> q.aktualisiert += st.galleryTheme; delay(10); ergebnis() },
        beschreibeFehler = { "Grund: ${it.message}" },
        holeKennzahlen = { Ergebnis.Success(StatsResponse(success = true)) },
        meldeFehler = {},
        vergissScroll = {},
    )

    @Test
    fun `die Galerie folgt der Quelle, auch wenn sie sich ohne Abruf aendert`() = runTest {
        val q = Quelle()
        val g = galerie(q)
        g.laden(); advanceUntilIdle()
        assertEquals(listOf("1-1x1", "2-1x1"), kurz(g.state.value.sets))
        // Offline +2 auf Set 1 und ein neues Set: Die Ablage ändert sich, die Galerie folgt.
        q.ablage.value = Lokal(listOf(set(3), set(1, 3), set(2, thema = "Star Wars")), 2L)
        runCurrent()
        assertEquals(listOf("3-1x1", "1-1x3", "2-1x1"), kurz(g.state.value.sets))
        assertEquals("ein Abruf je Laden, keiner je Änderung", 1, q.aktualisiert.size)
    }

    @Test
    fun `nach einem Filterwechsel zeigt die Galerie nur die neue Quelle`() = runTest {
        val alt = MutableStateFlow(Lokal(listOf(set(1)), 1L))
        val neu = MutableStateFlow(Lokal(listOf(set(2, thema = "Star Wars")), 1L))
        val g = Galerie(scope = vordergrund(), quelle = { st -> if (st.galleryTheme.isBlank()) alt else neu },
            aktualisiere = { Ergebnis.Success(Unit) }, holeKennzahlen = { Ergebnis.Success(StatsResponse(success = true)) },
            meldeFehler = {}, vergissScroll = {})
        g.laden(); advanceUntilIdle()
        g.setzeThema("Star Wars"); advanceUntilIdle()
        assertEquals(listOf("2-1x1"), kurz(g.state.value.sets))
        alt.value = Lokal(listOf(set(9)), 2L)
        runCurrent()
        assertEquals("die Quelle des alten Filters schreibt nicht mehr hinein", listOf("2-1x1"), kurz(g.state.value.sets))
    }

    @Test
    fun `die Suche wartet die Pause ab und fragt einmal mit dem letzten Text`() = runTest {
        val q = Quelle()
        val g = galerie(q)
        g.setzeSuche("ti"); g.setzeSuche("tit")
        advanceTimeBy(300)
        assertEquals(0, q.aktualisiert.size)
        advanceUntilIdle()
        assertEquals(1, q.aktualisiert.size)
        assertEquals("tit", g.state.value.galleryQuery)
    }

    @Test
    fun `Abmelden raeumt auf, und eine spaete Antwort kommt nicht zurueck`() = runTest {
        val g = galerie(Quelle())
        g.laden(); runCurrent()
        g.zuruecksetzen()
        advanceUntilIdle()
        assertEquals(GalleryUiState(), g.state.value)
    }

    @Test
    fun `ein Ladefehler wird zur Fehleranzeige mit Grund`() = runTest {
        val g = galerie(Quelle(Lokal(emptyList(), null))) { Ergebnis.Error.Server(504, "Zeitüberschreitung") }
        g.laden(); advanceUntilIdle()
        val st = g.state.value
        assertEquals("Grund: Zeitüberschreitung", st.galleryFehler)
        assertEquals(GalerieAnzeige.FEHLER, galerieAnzeige(st, gefiltert = false))
    }

    @Test
    fun `ein erfolgreicher neuer Versuch raeumt den Fehler weg`() = runTest {
        var kaputt = true
        val g = galerie(Quelle()) { if (kaputt) Ergebnis.Error.Server(503, "Netz") else Ergebnis.Success(Unit) }
        g.laden(); advanceUntilIdle()
        kaputt = false
        g.laden(); advanceUntilIdle()
        assertNull(g.state.value.galleryFehler)
        assertEquals(GalerieAnzeige.LISTE, galerieAnzeige(g.state.value, gefiltert = false))
    }

    @Test
    fun `ohne Netz bleibt die Quelle stehen, mit ihrem Stand`() = runTest {
        val g = galerie(Quelle(Lokal(listOf(set(7)), 5L))) { Ergebnis.Error.Netz() }
        g.laden(); advanceUntilIdle()
        assertEquals(listOf("7-1x1"), kurz(g.state.value.sets))
        assertNull("ohne Netz bleibt die Ablage stehen", g.state.value.galleryFehler)
        assertEquals(5L, g.state.value.offlineStand)
    }

    @Test
    fun `eine nie geladene Quelle leert die Galerie nicht`() = runTest {
        val q = Quelle(Lokal(listOf(set(7)), null))
        val g = galerie(q)
        g.laden(); advanceUntilIdle()
        assertEquals(emptyList<String>(), kurz(g.state.value.sets))
        q.ablage.value = Lokal(listOf(set(1)), 9L)
        runCurrent()
        assertEquals(listOf("1-1x1"), kurz(g.state.value.sets))
    }

    @Test
    fun `eine leere Sammlung ist kein Fehler`() {
        assertEquals(GalerieAnzeige.LEER, galerieAnzeige(GalleryUiState(), gefiltert = false))
        assertEquals(GalerieAnzeige.KEINE_TREFFER, galerieAnzeige(GalleryUiState(), gefiltert = true))
        assertEquals(GalerieAnzeige.LAEDT, galerieAnzeige(GalleryUiState(galleryLoading = true), gefiltert = false))
    }

    @Test
    fun `geladene Sets bleiben stehen, auch wenn das Neuladen scheitert`() {
        val st = GalleryUiState(sets = listOf(set(1).alsAnsicht()), galleryFehler = "Netz")
        assertEquals(GalerieAnzeige.LISTE, galerieAnzeige(st, gefiltert = false))
    }
}
