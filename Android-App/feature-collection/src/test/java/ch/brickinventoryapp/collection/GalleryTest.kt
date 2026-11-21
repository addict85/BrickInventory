package ch.brickinventoryapp.collection

import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.collection.ui.Galerie
import ch.brickinventoryapp.collection.ui.GalleryDisplay
import ch.brickinventoryapp.collection.ui.GalleryUiState
import ch.brickinventoryapp.collection.ui.galleryDisplay
import ch.brickinventoryapp.model.ui.Meldung
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
 *   A  in laden() `sequenceJob?.cancel()` entfernt → rot „nach einem Filterwechsel zeigt
 *      die Galerie nur die neue Quelle“ (die alte Quelle schreibt weiter hinein)
 *   B  in laden() den Zweig „ohne Netz mit Stand“ entfernt → rot „ohne Netz bleibt
 *      die Quelle stehen, mit ihrem Stand“
 *   C  in laden() `galleryFehler = errorMessage(r)` entfernt → rot „ein
 *      Ladefehler wird zur Fehleranzeige mit Grund“
 *   D  `galleryFehler = null` beim neuen Versuch entfernt → rot „ein
 *      erfolgreicher neuer Versuch raeumt den Fehler weg“
 *   E  in galleryDisplay() die Zweige FEHLER und LEER vertauscht → rot
 *      „ein Ladefehler …" und „eine leere Sammlung …"
 *   F  in laden() `if (l.stand == null) return@collect` entfernt → rot „eine nie
 *      geladene Quelle leert die Galerie nicht“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GalleryTest {

    private fun set(nr: Int, menge: Int = 1, thema: String? = null) = SetAnsicht(setNumber = "$nr-1", quantity = menge, theme = thema)

    private fun kurz(l: List<SetAnsicht>) = l.map { "${it.setNumber}x${it.quantity}" }

    /** Die Quelle je Thema; [aktualisiert] schreibt mit, für welches Thema gefüllt wurde. */
    private class Quelle(
        start: Local<SetAnsicht> = Local(
            listOf(SetAnsicht(setNumber = "1-1"), SetAnsicht(setNumber = "2-1", theme = "Star Wars")),
            1L,
        ),
    ) {
        val ablage = MutableStateFlow(start)
        val aktualisiert = mutableListOf<String>()
    }

    /**
     * Im Vordergrund des Takts, damit advanceUntilIdle auch die Abrufe abwartet
     * (backgroundScope zählt dort nicht); als Kind des Hintergrunds endet er mit dem Test.
     */
    private fun TestScope.foreground() = CoroutineScope(coroutineContext + Job(backgroundScope.coroutineContext[Job]))

    private fun TestScope.galerie(q: Quelle, ergebnis: () -> Ergebnis<Unit> = { Ergebnis.Erfolg(Unit) }) = Galerie(
        scope = foreground(),
        quelle = { st -> q.ablage.map { l -> l.copy(liste = l.liste.filter { st.galleryTheme.isBlank() || it.theme == st.galleryTheme }) } },
        refresh = { st -> q.aktualisiert += st.galleryTheme; delay(10); ergebnis() },
        fetchMetrics = { Ergebnis.Erfolg(null) },
        reportError = {},
        vergissScroll = {},
    )

    @Test
    fun `the gallery follows the source, even if it changes without a fetch`() = runTest {
        val q = Quelle()
        val g = galerie(q)
        g.laden(); advanceUntilIdle()
        assertEquals(listOf("1-1x1", "2-1x1"), kurz(g.state.value.sets))
        // Offline +2 auf Set 1 und ein neues Set: Die Ablage ändert sich, die Galerie folgt.
        q.ablage.value = Local(listOf(set(3), set(1, 3), set(2, thema = "Star Wars")), 2L)
        runCurrent()
        assertEquals(listOf("3-1x1", "1-1x3", "2-1x1"), kurz(g.state.value.sets))
        assertEquals("ein Abruf je Laden, keiner je Änderung", 1, q.aktualisiert.size)
    }

    @Test
    fun `after a filter change the gallery shows only the new source`() = runTest {
        val alt = MutableStateFlow(Local(listOf(set(1)), 1L))
        val neu = MutableStateFlow(Local(listOf(set(2, thema = "Star Wars")), 1L))
        val g = Galerie(scope = foreground(), quelle = { st -> if (st.galleryTheme.isBlank()) alt else neu },
            refresh = { Ergebnis.Erfolg(Unit) }, fetchMetrics = { Ergebnis.Erfolg(null) },
            reportError = {}, vergissScroll = {})
        g.laden(); advanceUntilIdle()
        g.setzeThema("Star Wars"); advanceUntilIdle()
        assertEquals(listOf("2-1x1"), kurz(g.state.value.sets))
        alt.value = Local(listOf(set(9)), 2L)
        runCurrent()
        assertEquals("die Quelle des alten Filters schreibt nicht mehr hinein", listOf("2-1x1"), kurz(g.state.value.sets))
    }

    @Test
    fun `the search waits for the pause and asks once with the last text`() = runTest {
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
    fun `sign-out cleans up, and a late response does not come back`() = runTest {
        val g = galerie(Quelle())
        g.laden(); runCurrent()
        g.reset()
        advanceUntilIdle()
        assertEquals(GalleryUiState(), g.state.value)
    }

    @Test
    fun `a loading error becomes the error display with a reason`() = runTest {
        val g = galerie(Quelle(Local(emptyList(), null))) { Ergebnis.Fehler.Server(504, "Zeitüberschreitung") }
        g.laden(); advanceUntilIdle()
        val st = g.state.value
        assertEquals(Meldung.Text("Zeitüberschreitung"), st.abruf.errorMessage)
        assertEquals(GalleryDisplay.FEHLER, galleryDisplay(st, gefiltert = false))
    }

    @Test
    fun `a successful new attempt clears the error`() = runTest {
        var kaputt = true
        val g = galerie(Quelle()) { if (kaputt) Ergebnis.Fehler.Server(503, "Netz") else Ergebnis.Erfolg(Unit) }
        g.laden(); advanceUntilIdle()
        kaputt = false
        g.laden(); advanceUntilIdle()
        assertNull(g.state.value.abruf.errorMessage)
        assertEquals(GalleryDisplay.LISTE, galleryDisplay(g.state.value, gefiltert = false))
    }

    @Test
    fun `without network the source stays, with its state`() = runTest {
        val g = galerie(Quelle(Local(listOf(set(7)), 5L))) { Ergebnis.Fehler.Netz() }
        g.laden(); advanceUntilIdle()
        assertEquals(listOf("7-1x1"), kurz(g.state.value.sets))
        assertNull("ohne Netz bleibt die Ablage stehen", g.state.value.abruf.errorMessage)
        assertEquals(5L, g.state.value.offlineStatus)
    }

    @Test
    fun `a never loaded source does not empty the gallery`() = runTest {
        val q = Quelle(Local(listOf(set(7)), null))
        val g = galerie(q)
        g.laden(); advanceUntilIdle()
        assertEquals(emptyList<String>(), kurz(g.state.value.sets))
        q.ablage.value = Local(listOf(set(1)), 9L)
        runCurrent()
        assertEquals(listOf("1-1x1"), kurz(g.state.value.sets))
    }

    @Test
    fun `an empty collection is not an error`() {
        assertEquals(GalleryDisplay.LEER, galleryDisplay(GalleryUiState(), gefiltert = false))
        assertEquals(GalleryDisplay.NO_HITS, galleryDisplay(GalleryUiState(), gefiltert = true))
        assertEquals(GalleryDisplay.LOADS, galleryDisplay(GalleryUiState(abruf = Laden.Loads), gefiltert = false))
    }

    @Test
    fun `loaded sets stay even if reloading fails`() {
        val st = GalleryUiState(sets = listOf(set(1)), abruf = Laden.Fehler(Fehlerklasse.OFFLINE, Meldung.Text("Netz")))
        assertEquals(GalleryDisplay.LISTE, galleryDisplay(st, gefiltert = false))
    }
}
