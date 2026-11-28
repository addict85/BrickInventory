package ch.brickinventoryapp.state

import ch.brickinventoryapp.contract.TokenInfo
import ch.brickinventoryapp.contract.User
import ch.brickinventoryapp.contract.testing.testAppThemeResponse
import ch.brickinventoryapp.contract.testing.testMeResponse
import ch.brickinventoryapp.contract.testing.testStartupStatus
import ch.brickinventoryapp.data.RightsSignal
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.data.SessionExpiredSignal
import ch.brickinventoryapp.data.SessionStore
import ch.brickinventoryapp.data.account.AccountRepository
import ch.brickinventoryapp.data.testing.FakeApi
import ch.brickinventoryapp.data.testing.StorageSessionStore
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testManagementRepository
import ch.brickinventoryapp.data.testing.text
import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.domain.AccountSettings
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.model.text.Message
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AccountValues
import ch.brickinventoryapp.session.LogoutProcess
import ch.brickinventoryapp.session.SessionService
import ch.brickinventoryapp.session.WarmUp
import ch.brickinventoryapp.session.testing.testSession
import ch.brickinventoryapp.session.tokenEndsSoon
import ch.brickinventoryapp.state.testing.TestServices
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Instant

/**
 * SessionService put to the test: signing out on 401 and on a too-old sign-in,
 * right revocation, theme and server startup. Without a network (FakeApi) and in virtual
 * time (StandardTestDispatcher), so „nothing happens“ is testable without waiting.
 *
 * Counter-checks:
 *   logout-without-session-check  `isLoggedIn` removed from the 401 branch → red „ein 401 …“
 *   permissions-without-message             the notification on right revocation removed → red „entzogene …“
 *   theme-not-remembered            the mirror after saveAppTheme removed → red „das Design …“
 *   server-start-endless           `r.data.ready` removed from the stop condition → red „der Serverstart …“
 *   expired-before-start        the 401 collector with drop(1) → red „ein 401 vor dem Start …“
 *   login-without-cancel          in sequenceLogin `collect` instead of `collectLatest` and the
 *                                   steps in `area` instead of the sign-in's own scope → red
 *                                   „eine späte Antwort des alten Kontos …“ (CHF instead of USD)
 *   currency-mirrored-back      in launch() restored `session.state.map { it.currency }…
 *                                   collect { prefs.saveCurrency(it) }` → red „Währung und Design kommen aus der Ablage …“ (one write instead of none)
 *   ablauf-ohne-hinweis             the loginExpiresSoon() check in login() removed → red
 *                                   „a sign-in near its end asks …“ (no notification)
 *   server-ende-ignoriert           tokenEndsSoon(…) removed from that check → red „a server end within a week …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SessionServiceTest {

    private val tick = StandardTestDispatcher()
    private val fake = FakeApi()
    private val store = StorageSessionStore()
    private var currencyWritten = 0

    /** The store, as the service sees it; counts whether it writes the currency back. */
    private val prefs = object : SessionStore by store {
        override suspend fun saveCurrency(cur: CurrencyCode) { currencyWritten++; store.saveCurrency(cur) }
    }

    /** Currency and theme from the same store, like StoreAccountValues on the device. */
    private val session = testSession(object : AccountValues {
        override val currency: StateFlow<CurrencyCode> = store.currencyState
        override val design: StateFlow<Design> = store.design
        override fun setCurrency(w: CurrencyCode) { store.currencyState.value = w }
        override fun setDesign(d: Design) { store.design.value = d }
    })

    /** One response to /settings per sign-in: delay and currency. */
    private val settings = ArrayDeque<Pair<Long, CurrencyCode>>()
    private val expiredSignal = SessionExpiredSignal()
    private val rights = RightsSignal()
    private lateinit var t: TestServices
    private var logouts = 0
    private var prewarmed = 0

    @Before fun setUp() {
        Dispatchers.setMain(tick)
        t = TestServices(fake.api, io = tick)
    }

    @After fun ab() {
        Dispatchers.resetMain()
    }

    /** Creates and starts the service, runs [block], and ends its coroutines. */
    private fun withVm(block: suspend TestScope.(SessionService) -> Unit) = runTest(tick) {
        val area = CoroutineScope(SupervisorJob() + tick)
        val real = testAccountRepository(fake.api)
        val account = object : AccountRepository by real {
            override suspend fun getSettings(): Outcome<AccountSettings> {
                val (duration, currency) = settings.removeFirstOrNull() ?: return real.getSettings()
                delay(duration)
                return Outcome.Success(AccountSettings(currency, Condition.NEW, Condition.NEW, Condition.NEW))
            }
        }
        val service = SessionService(
            account = account, admin = testManagementRepository(fake.api), prefs = prefs, sessionExpired = expiredSignal, rights = rights,
            messages = t.messages, session = session, viewport = t.viewport,
            sync = t.sync, secondFactorRequired = SecondFactorRequired(),
            logoutProcess = LogoutProcess {
                logouts++
                store.token.value = ""
                session.loggedOut()
                null
            },
            prewarm = WarmUp { prewarmed++ },
            area = area,
        )
        try {
            service.launch()
            block(service)
        } finally {
            area.cancel()
        }
    }

    private fun loggedIn() {
        store.server.value = "https://brick.example"
        store.token.value = "token"
    }

    @Test
    fun `a 401 signs out the signed-in session, a second one stays silent`() = withVm {
        loggedIn()
        advanceUntilIdle()
        assertTrue(session.state.value.isLoggedIn)
        assertEquals("after signing in it is warmed up", 1, prewarmed)

        expiredSignal.notifyExpired()
        advanceUntilIdle()
        assertEquals(1, logouts)
        assertFalse(session.state.value.isLoggedIn)
        assertEquals("t${R.string.vm_session_expired}", t.messages.text)

        t.messages.acknowledge()
        expiredSignal.notifyExpired()
        advanceUntilIdle()
        assertEquals("signed out, a 401 does not sign out once more", 1, logouts)
        assertNull(t.messages.text)
    }

    @Test
    fun `a too old sign-in signs out without loading the account`() = withVm {
        store.expired = true
        loggedIn()
        advanceUntilIdle()
        assertEquals(1, logouts)
        assertEquals("t${R.string.vm_login_too_old}", t.messages.text)
        assertEquals(0, fake.callsOf("getMe"))
        assertEquals(0, prewarmed)
    }

    @Test
    fun `a sign-in near its end asks for a new one and keeps loading`() = withVm {
        store.expiresSoon = true
        loggedIn()
        advanceUntilIdle()
        assertEquals(0, logouts)
        assertEquals("t${R.string.vm_login_running_ab}", t.messages.text)
        assertEquals("the account loads anyway", 1, fake.callsOf("getMe"))
    }

    @Test
    fun `a server end within a week asks for a new sign-in, a later one does not`() = withVm {
        val tag = 24L * 60 * 60 * 1000
        val soon = Instant.ofEpochMilli(System.currentTimeMillis() + 3 * tag).toString()
        fake.responses["getMe"] = testMeResponse(success = true, user = User(id = 1, username = "anna"),
            tokenInfo = TokenInfo(scope = "app", hardExpiresAt = soon, neverExpires = false))
        loggedIn()
        advanceUntilIdle()
        assertEquals(0, logouts)
        assertEquals("t${R.string.vm_login_running_ab}", t.messages.text)
        val now = System.currentTimeMillis()
        assertTrue(tokenEndsSoon(Instant.ofEpochMilli(now + 3 * tag), now))
        assertFalse(tokenEndsSoon(Instant.ofEpochMilli(now + 30 * tag), now))
        assertFalse("without information it says nothing", tokenEndsSoon(null, now))
    }

    @Test
    fun `revoked admin rights apply immediately and are reported once`() = withVm {
        fake.responses["getMe"] = testMeResponse(success = true, user = User(id = 1, username = "anna", isAdmin = true))
        loggedIn()
        advanceUntilIdle()
        assertTrue(session.state.value.isAdmin)

        fake.responses["getMe"] = testMeResponse(success = true, user = User(id = 1, username = "anna", isAdmin = false))
        rights.report()
        advanceUntilIdle()
        assertFalse(session.state.value.isAdmin)
        assertEquals("t${R.string.vm_rights_revoked}", t.messages.text)

        t.messages.acknowledge()
        val fetches = fake.callsOf("getMe")
        rights.report()
        advanceUntilIdle()
        assertEquals("without admin rights no further fetch", fetches, fake.callsOf("getMe"))
        assertNull(t.messages.text)
    }

    @Test
    fun `the server's design applies and is remembered, without a response the remembered one stays`() = withVm {
        store.design.value = Design.BRICK
        store.server.value = "https://brick.example"
        fake.codes["getAppTheme"] = 500
        advanceUntilIdle()
        assertEquals(Design.BRICK, session.state.value.appTheme)
        assertEquals(Design.BRICK, store.design.value)

        fake.codes.clear()
        fake.responses["getAppTheme"] = testAppThemeResponse(success = true, theme = Design.STUD)
        loggedIn()
        advanceUntilIdle()
        assertEquals(Design.STUD, session.state.value.appTheme)
        assertEquals("the account's design survives the cold start", Design.STUD, store.design.value)
    }

    @Test
    fun `a late response of the old account does not write into the new session`() = withVm {
        settings.addLast(1_000L to CurrencyCode.CHF)
        settings.addLast(10L to CurrencyCode("USD"))
        loggedIn()
        runCurrent()
        advanceTimeBy(100)
        // A different account signs in before the old one got its settings.
        store.token.value = "anderes"
        advanceUntilIdle()
        assertEquals(CurrencyCode("USD"), session.state.value.currency)
        assertEquals("the store holds the new account's currency", CurrencyCode("USD"), store.currencyState.value)
    }

    @Test
    fun `currency and design come from the store, the session writes nothing back`() = withVm {
        advanceUntilIdle()
        store.currencyState.value = CurrencyCode.CHF
        store.design.value = Design.STUD
        advanceUntilIdle()
        assertEquals(CurrencyCode.CHF, session.state.value.currency)
        assertEquals(Design.STUD, session.state.value.appTheme)
        assertEquals("no mirror back into the store", 0, currencyWritten)
    }

    @Test
    fun `the server start is followed at intervals until the server is ready`() = withVm {
        store.server.value = "https://brick.example"
        fake.responses["getStartupStatus"] = testStartupStatus(ready = false, step = "Katalog", progress = 2.0, total = 8)
        runCurrent()
        assertNotNull(session.state.value.startupStatus)
        val first = fake.callsOf("getStartupStatus")
        assertEquals(1, first)

        advanceTimeBy(2_001)
        assertEquals("a query every two seconds", 2, fake.callsOf("getStartupStatus"))

        fake.responses["getStartupStatus"] = testStartupStatus(ready = true)
        advanceTimeBy(2_001)
        assertNull(session.state.value.startupStatus)
        advanceTimeBy(60_000)
        assertEquals("done means: no more queries", 3, fake.callsOf("getStartupStatus"))
    }

    @Test
    fun `without a response no server starts, the polling stops`() = withVm {
        store.server.value = "https://falsch-getippt.example"
        fake.codes["getStartupStatus"] = 503
        advanceTimeBy(10_000)
        assertNull(session.state.value.startupStatus)
        assertEquals(1, fake.callsOf("getStartupStatus"))
    }

    @Test
    fun `a finally failed sign-out at the server is reported once`() {
        store.failed += "https://alt.example"
        withVm {
            val m = t.messages.message.value as Message.Resource
            assertEquals(R.string.logout_failed_text, m.id)
            assertTrue("the server stands in the sentence: ${m.values}", m.values.single().toString().contains("alt.example"))
            assertTrue(store.failed.isEmpty())
        }
    }

    @Test
    fun `a 401 before the start is not lost`() {
        loggedIn()
        expiredSignal.notifyExpired()
        withVm {
            advanceUntilIdle()
            assertEquals(1, logouts)
            assertFalse("acknowledged", expiredSignal.expired.value)
        }
    }
}
