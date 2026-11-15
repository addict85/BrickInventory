package ch.brickinventoryapp.zustand

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.zustand.ui.viewmodel.Beobachtet
import ch.brickinventoryapp.zustand.ui.viewmodel.ladeJeServer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

/**
 * Laden beim Beobachten statt per LaunchedEffect: Wer den Zustand zeigt, stösst den Abruf an,
 * je Serveradresse einmal und nach einer Pause ohne Beobachter wieder.
 *
 * Gegenproben (gegenproben/, :core-zustand:test):
 *   jeserver-ohne-distinct       ladeJeServer ohne distinctUntilChanged → rot „ladeJeServer lädt je Adresse …“
 *   beobachtet-ruft-jedes-mal    Beobachtet ruft beimBeobachten bei jedem Sammler → rot „Beobachtet zählt …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LadenBeimBeobachtenTest {

    private val takt = UnconfinedTestDispatcher()
    private val vm = object : ViewModel() {}
    private val seiten = CoroutineScope(takt)

    @Before
    fun auf() = Dispatchers.setMain(takt)

    @After
    fun zu() {
        seiten.cancel()
        vm.viewModelScope.cancel()
        Dispatchers.resetMain()
    }

    @Test
    fun `ladeJeServer laedt je Adresse einmal, solange jemand beobachtet`() {
        val sitzung = Sitzung()
        val zustand = MutableStateFlow(0)
        var geladen = 0
        vm.ladeJeServer(sitzung, zustand) { geladen++ }
        val ohneAdresse = seiten.launch { zustand.collect {} }
        assertEquals("ohne Adresse nichts", 0, geladen)
        sitzung.anmeldungGeaendert("https://a.example", angemeldet = true)
        assertEquals("die Adresse kommt, während die Seite offen ist", 1, geladen)
        sitzung.anmeldungGeaendert("https://a.example", angemeldet = false)
        assertEquals("eine andere Änderung der Sitzung bei derselben Adresse lädt nicht", 1, geladen)
        sitzung.anmeldungGeaendert("https://b.example", angemeldet = true)
        assertEquals("ein anderer Server lädt neu", 2, geladen)
        ohneAdresse.cancel()
        sitzung.anmeldungGeaendert("https://c.example", angemeldet = true)
        assertEquals("ohne Beobachter nichts", 2, geladen)
        seiten.launch { zustand.collect {} }
        assertEquals("wer zurückkommt, bekommt frisch", 3, geladen)
    }

    @Test
    fun `Beobachtet zaehlt die Beobachter und meldet nur den ersten`() {
        val quelle = MutableStateFlow("x")
        var gemeldet = 0
        val b = Beobachtet(quelle) { gemeldet++ }
        val erster = seiten.launch { b.collect {} }
        val zweiter = seiten.launch { b.collect {} }
        assertEquals(2, b.beobachter.value)
        assertEquals(1, gemeldet)
        erster.cancel()
        zweiter.cancel()
        assertEquals(0, b.beobachter.value)
        seiten.launch { b.collect {} }
        assertEquals("nach der Pause wieder", 2, gemeldet)
        assertEquals("x", b.value)
    }
}
