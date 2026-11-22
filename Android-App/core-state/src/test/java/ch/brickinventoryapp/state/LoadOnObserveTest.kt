package ch.brickinventoryapp.state

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.session.Session
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
 * Loading on observation instead of via LaunchedEffect: whoever displays the state triggers the fetch,
 * once per server address and again after a pause without an observer.
 *
 * Counter-checks (counter-checks/, :core-state:test):
 *   jeserver-ohne-distinct       loadPerServer without distinctUntilChanged → red „loadPerServer lädt je Adresse …“
 *   beobachtet-ruft-jedes-mal    Beobachtet calls observeOn on every collector → red „Beobachtet zählt …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LoadOnObserveTest {

    private val tick = UnconfinedTestDispatcher()
    private val vm = object : ViewModel() {}
    private val pages = CoroutineScope(tick)

    @Before
    fun setUp() = Dispatchers.setMain(tick)

    @After
    fun tearDown() {
        pages.cancel()
        vm.viewModelScope.cancel()
        Dispatchers.resetMain()
    }

    @Test
    fun `loadJeServer loads once per address as long as someone observes`() {
        val session = Session()
        val condition = MutableStateFlow(0)
        var loaded = 0
        vm.loadPerServer(session, condition) { loaded++ }
        val withoutAddress = pages.launch { condition.collect {} }
        assertEquals("ohne Adresse nichts", 0, loaded)
        session.loginChanged("https://a.example", loggedIn = true)
        assertEquals("die Adresse kommt, während die Seite offen ist", 1, loaded)
        session.loginChanged("https://a.example", loggedIn = false)
        assertEquals("eine andere Änderung der Sitzung bei derselben Adresse lädt nicht", 1, loaded)
        session.loginChanged("https://b.example", loggedIn = true)
        assertEquals("ein anderer Server lädt neu", 2, loaded)
        withoutAddress.cancel()
        session.loginChanged("https://c.example", loggedIn = true)
        assertEquals("ohne Beobachter nichts", 2, loaded)
        pages.launch { condition.collect {} }
        assertEquals("wer zurückkommt, bekommt frisch", 3, loaded)
    }

    @Test
    fun `Observed counts the observers and reports only the first`() {
        val source = MutableStateFlow("x")
        var reported = 0
        val b = Observed(source) { reported++ }
        val first = pages.launch { b.collect {} }
        val second = pages.launch { b.collect {} }
        assertEquals(2, b.observer.value)
        assertEquals(1, reported)
        first.cancel()
        second.cancel()
        assertEquals(0, b.observer.value)
        pages.launch { b.collect {} }
        assertEquals("nach der Pause wieder", 2, reported)
        assertEquals("x", b.value)
    }
}
