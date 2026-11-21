package ch.brickinventoryapp.state

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.data.RightsSignal
import ch.brickinventoryapp.data.SessionExpiredSignal
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.contract.AppThemeResponse
import ch.brickinventoryapp.model.domain.AccountSettings
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.data.Sitzungsablage
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.session.Kontowerte
import ch.brickinventoryapp.session.Sitzung
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import ch.brickinventoryapp.contract.MeResponse
import ch.brickinventoryapp.contract.StartupStatus
import ch.brickinventoryapp.contract.User
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.Abmeldevorgang
import ch.brickinventoryapp.session.SitzungsDienst
import ch.brickinventoryapp.session.WarmUp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
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
import ch.brickinventoryapp.testing.FakeApi
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.StorageSessionStore
import ch.brickinventoryapp.testing.TestDienste
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.testing.text
import ch.brickinventoryapp.model.ui.Meldung

/**
 * SitzungsDienst put to the test: signing out on 401 and on a too-old sign-in,
 * right revocation, theme and server startup. Without a network (FakeApi) and in virtual
 * time (StandardTestDispatcher), so „nothing happens“ is testable without waiting.
 *
 * Counter-checks:
 *   abmelden-ohne-sitzungspruefung  `isLoggedIn` removed from the 401 branch → red „ein 401 …“
 *   rechte-ohne-meldung             the notification on right revocation removed → red „entzogene …“
 *   design-nicht-gemerkt            the mirror after saveAppTheme removed → red „das Design …“
 *   serverstart-ohne-ende           `r.data.ready` removed from the stop condition → red „der Serverstart …“
 *   abgelaufen-vor-dem-start        the 401 collector with drop(1) → red „ein 401 vor dem Start …“
 *   anmeldung-ohne-abbruch          in sequenceLogin `collect` instead of `collectLatest` and the
 *                                   steps in `bereich` instead of the sign-in's own scope → red
 *                                   „eine späte Antwort des alten Kontos …“ (CHF instead of USD)
 *   waehrung-zurueckgespiegelt      in starte() restored `sitzung.state.map { it.currency }…
 *                                   collect { prefs.saveCurrency(it) }` → red „Währung und Design
 *                                   kommen aus der Ablage …“ (one write instead of none)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SessionServiceTest {

    private val takt = StandardTestDispatcher()
    private val fake = FakeApi()
    private val ablage = StorageSessionStore()
    private var currencyWritten = 0

    /** The store, as the service sees it; counts whether it writes the currency back. */
    private val prefs = object : Sitzungsablage by ablage {
        override suspend fun saveCurrency(cur: Waehrung) { currencyWritten++; ablage.saveCurrency(cur) }
    }

    /** Currency and theme from the same store, like StoreAccountValues on the device. */
    private val sitzung = Sitzung(object : Kontowerte {
        override val waehrung: StateFlow<Waehrung> = ablage.waehrung
        override val design: StateFlow<Design> = ablage.design
        override fun setCurrency(w: Waehrung) { ablage.waehrung.value = w }
        override fun setzeDesign(d: Design) { ablage.design.value = d }
    })

    /** One response to /settings per sign-in: delay and currency. */
    private val einstellungen = ArrayDeque<Pair<Long, Waehrung>>()
    private val expiredSignal = SessionExpiredSignal()
    private val rights = RightsSignal()
    private lateinit var t: TestDienste
    private var signOuts = 0
    private var vorgewaermt = 0

    @Before fun auf() {
        Dispatchers.setMain(takt)
        t = TestDienste(fake.api, io = takt)
    }

    @After fun ab() {
        Dispatchers.resetMain()
    }

    /** Creates and starts the service, runs [block], and ends its coroutines. */
    private fun withVm(block: suspend TestScope.(SitzungsDienst) -> Unit) = runTest(takt) {
        val bereich = CoroutineScope(SupervisorJob() + takt)
        val echt = testAccountRepository(fake.api)
        val konto = object : AccountRepository by echt {
            override suspend fun getSettings(): Ergebnis<AccountSettings> {
                val (dauer, waehrung) = einstellungen.removeFirstOrNull() ?: return echt.getSettings()
                delay(dauer)
                return Ergebnis.Erfolg(AccountSettings(waehrung, Zustand.NEU, Zustand.NEU, Zustand.NEU))
            }
        }
        val dienst = SitzungsDienst(
            konto = konto, verwaltung = testManagementRepository(fake.api), prefs = prefs, sessionExpired = expiredSignal, rights = rights,
            meldungen = t.meldungen, sitzung = sitzung, blickfeld = t.blickfeld,
            sync = t.sync, zweiterFaktorPflicht = SecondFactorRequired(),
            abmeldevorgang = Abmeldevorgang {
                signOuts++
                ablage.token.value = ""
                sitzung.abgemeldet()
                null
            },
            vorwaermen = WarmUp { vorgewaermt++ },
            bereich = bereich,
        )
        try {
            dienst.starte()
            block(dienst)
        } finally {
            bereich.cancel()
        }
    }

    private fun angemeldet() {
        ablage.server.value = "https://brick.example"
        ablage.token.value = "token"
    }

    @Test
    fun `a 401 signs out the signed-in session, a second one stays silent`() = withVm {
        angemeldet()
        advanceUntilIdle()
        assertTrue(sitzung.state.value.isLoggedIn)
        assertEquals("Nach dem Anmelden wird vorgewärmt", 1, vorgewaermt)

        expiredSignal.notifyExpired()
        advanceUntilIdle()
        assertEquals(1, signOuts)
        assertFalse(sitzung.state.value.isLoggedIn)
        assertEquals("t${R.string.vm_session_expired}", t.meldungen.text)

        t.meldungen.acknowledge()
        expiredSignal.notifyExpired()
        advanceUntilIdle()
        assertEquals("Abgemeldet meldet ein 401 nicht noch einmal ab", 1, signOuts)
        assertNull(t.meldungen.text)
    }

    @Test
    fun `a too old sign-in signs out without loading the account`() = withVm {
        ablage.abgelaufen = true
        angemeldet()
        advanceUntilIdle()
        assertEquals(1, signOuts)
        assertEquals("t${R.string.vm_anmeldung_zu_alt}", t.meldungen.text)
        assertEquals(0, fake.callsOf("getMe"))
        assertEquals(0, vorgewaermt)
    }

    @Test
    fun `revoked admin rights apply immediately and are reported once`() = withVm {
        fake.antworten["getMe"] = MeResponse(success = true, user = User(id = 1, username = "anna", isAdmin = true))
        angemeldet()
        advanceUntilIdle()
        assertTrue(sitzung.state.value.isAdmin)

        fake.antworten["getMe"] = MeResponse(success = true, user = User(id = 1, username = "anna", isAdmin = false))
        rights.melde()
        advanceUntilIdle()
        assertFalse(sitzung.state.value.isAdmin)
        assertEquals("t${R.string.vm_rechte_entzogen}", t.meldungen.text)

        t.meldungen.acknowledge()
        val fetches = fake.callsOf("getMe")
        rights.melde()
        advanceUntilIdle()
        assertEquals("Ohne Verwalterrecht kein weiterer Abruf", fetches, fake.callsOf("getMe"))
        assertNull(t.meldungen.text)
    }

    @Test
    fun `the server's design applies and is remembered, without a response the remembered one stays`() = withVm {
        ablage.design.value = Design.BRICK
        ablage.server.value = "https://brick.example"
        fake.codes["getAppTheme"] = 500
        advanceUntilIdle()
        assertEquals(Design.BRICK, sitzung.state.value.appTheme)
        assertEquals(Design.BRICK, ablage.design.value)

        fake.codes.clear()
        fake.antworten["getAppTheme"] = AppThemeResponse(success = true, theme = Design.NOPPE)
        angemeldet()
        advanceUntilIdle()
        assertEquals(Design.NOPPE, sitzung.state.value.appTheme)
        assertEquals("Das Design des Kontos überlebt den Kaltstart", Design.NOPPE, ablage.design.value)
    }

    @Test
    fun `a late response of the old account does not write into the new session`() = withVm {
        einstellungen.addLast(1_000L to Waehrung.CHF)
        einstellungen.addLast(10L to Waehrung("USD"))
        angemeldet()
        runCurrent()
        advanceTimeBy(100)
        // A different account signs in before the old one got its settings.
        ablage.token.value = "anderes"
        advanceUntilIdle()
        assertEquals(Waehrung("USD"), sitzung.state.value.currency)
        assertEquals("die Ablage hält die Währung des neuen Kontos", Waehrung("USD"), ablage.waehrung.value)
    }

    @Test
    fun `currency and design come from the store, the session writes nothing back`() = withVm {
        advanceUntilIdle()
        ablage.waehrung.value = Waehrung.CHF
        ablage.design.value = Design.NOPPE
        advanceUntilIdle()
        assertEquals(Waehrung.CHF, sitzung.state.value.currency)
        assertEquals(Design.NOPPE, sitzung.state.value.appTheme)
        assertEquals("kein Spiegel zurück in die Ablage", 0, currencyWritten)
    }

    @Test
    fun `the server start is followed at intervals until the server is ready`() = withVm {
        ablage.server.value = "https://brick.example"
        fake.antworten["getStartupStatus"] = StartupStatus(ready = false, step = "Katalog", progress = 2.0, total = 8)
        runCurrent()
        assertNotNull(sitzung.state.value.startupStatus)
        val erste = fake.callsOf("getStartupStatus")
        assertEquals(1, erste)

        advanceTimeBy(2_001)
        assertEquals("Alle zwei Sekunden eine Abfrage", 2, fake.callsOf("getStartupStatus"))

        fake.antworten["getStartupStatus"] = StartupStatus(ready = true)
        advanceTimeBy(2_001)
        assertNull(sitzung.state.value.startupStatus)
        advanceTimeBy(60_000)
        assertEquals("Fertig heisst: keine Abfrage mehr", 3, fake.callsOf("getStartupStatus"))
    }

    @Test
    fun `without a response no server starts, the polling stops`() = withVm {
        ablage.server.value = "https://falsch-getippt.example"
        fake.codes["getStartupStatus"] = 503
        advanceTimeBy(10_000)
        assertNull(sitzung.state.value.startupStatus)
        assertEquals(1, fake.callsOf("getStartupStatus"))
    }

    @Test
    fun `a finally failed sign-out at the server is reported once`() {
        ablage.gescheitert += "https://alt.example"
        withVm {
            val m = t.meldungen.meldung.value as Meldung.Resource
            assertEquals(R.string.abmeldung_gescheitert_text, m.id)
            assertTrue("der Server steht im Satz: ${m.werte}", m.werte.single().toString().contains("alt.example"))
            assertTrue(ablage.gescheitert.isEmpty())
        }
    }

    @Test
    fun `a 401 before the start is not lost`() {
        angemeldet()
        expiredSignal.notifyExpired()
        withVm {
            advanceUntilIdle()
            assertEquals(1, signOuts)
            assertFalse("quittiert", expiredSignal.abgelaufen.value)
        }
    }
}
