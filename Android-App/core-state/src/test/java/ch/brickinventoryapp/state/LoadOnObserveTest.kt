package ch.brickinventoryapp.state

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.state.ui.viewmodel.Observed
import ch.brickinventoryapp.state.ui.viewmodel.loadPerServer
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
 * Gegenproben (gegenproben/, :core-state:test):
 *   jeserver-ohne-distinct       loadPerServer ohne distinctUntilChanged → rot „loadPerServer lädt je Adresse …“
 *   beobachtet-ruft-jedes-mal    Beobachtet ruft observeOn bei jedem Sammler → rot „Beobachtet zählt …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LoadOnObserveTest {

    private val takt = UnconfinedTestDispatcher()
    private val vm = object : ViewModel() {}
    private val pages = CoroutineScope(takt)

    @Before
    fun auf() = Dispatchers.setMain(takt)

    @After
    fun zu() {
        pages.cancel()
        vm.viewModelScope.cancel()
        Dispatchers.resetMain()
    }

    @Test
    fun `ladeJeServer loads once per address as long as someone observes`() {
        val sitzung = Sitzung()
        val zustand = MutableStateFlow(0)
        var geladen = 0
        vm.loadPerServer(sitzung, zustand) { geladen++ }
        val withoutAddress = pages.launch { zustand.collect {} }
        assertEquals("ohne Adresse nichts", 0, geladen)
        sitzung.anmeldungGeaendert("https://a.example", angemeldet = true)
        assertEquals("die Adresse kommt, während die Seite offen ist", 1, geladen)
        sitzung.anmeldungGeaendert("https://a.example", angemeldet = false)
        assertEquals("eine andere Änderung der Sitzung bei derselben Adresse lädt nicht", 1, geladen)
        sitzung.anmeldungGeaendert("https://b.example", angemeldet = true)
        assertEquals("ein anderer Server lädt neu", 2, geladen)
        withoutAddress.cancel()
        sitzung.anmeldungGeaendert("https://c.example", angemeldet = true)
        assertEquals("ohne Beobachter nichts", 2, geladen)
        pages.launch { zustand.collect {} }
        assertEquals("wer zurückkommt, bekommt frisch", 3, geladen)
    }

    @Test
    fun `Beobachtet counts the observers and reports only the first`() {
        val quelle = MutableStateFlow("x")
        var gemeldet = 0
        val b = Observed(quelle) { gemeldet++ }
        val erster = pages.launch { b.collect {} }
        val zweiter = pages.launch { b.collect {} }
        assertEquals(2, b.observer.value)
        assertEquals(1, gemeldet)
        erster.cancel()
        zweiter.cancel()
        assertEquals(0, b.observer.value)
        pages.launch { b.collect {} }
        assertEquals("nach der Pause wieder", 2, gemeldet)
        assertEquals("x", b.value)
    }
}
