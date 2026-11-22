package ch.brickinventoryapp.state

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.session.testing.testSession
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
 *   per-server-without-distinct       loadPerServer without distinctUntilChanged → red „loadPerServer lädt je Adresse …“
 *   observed-calls-every-time    Beobachtet calls observeOn on every collector → red „Beobachtet zählt …“
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
        val session = testSession()
        val condition = MutableStateFlow(0)
        var loaded = 0
        vm.loadPerServer(session, condition) { loaded++ }
        val withoutAddress = pages.launch { condition.collect {} }
        assertEquals("without an address nothing", 0, loaded)
        session.loginChanged("https://a.example", loggedIn = true)
        assertEquals("the address arrives while the page is open", 1, loaded)
        session.loginChanged("https://a.example", loggedIn = false)
        assertEquals("another change of the session with the same address does not load", 1, loaded)
        session.loginChanged("https://b.example", loggedIn = true)
        assertEquals("another server reloads", 2, loaded)
        withoutAddress.cancel()
        session.loginChanged("https://c.example", loggedIn = true)
        assertEquals("without observers nothing", 2, loaded)
        pages.launch { condition.collect {} }
        assertEquals("whoever comes back gets fresh data", 3, loaded)
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
        assertEquals("again after the pause", 2, reported)
        assertEquals("x", b.value)
    }
}
