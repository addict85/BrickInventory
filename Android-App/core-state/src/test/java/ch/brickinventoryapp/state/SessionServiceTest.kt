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
 * Der SitzungsDienst ausgeführt: Abmelden bei 401 und zu alter Anmeldung,
 * Rechteentzug, Design und Serverstart. Ohne Netz (FakeApi) und in virtueller
 * Zeit (StandardTestDispatcher), damit „nichts geschieht“ prüfbar ist, ohne zu warten.
 *
 * Gegenproben:
 *   abmelden-ohne-sitzungspruefung  `isLoggedIn` im 401-Zweig gestrichen → rot „ein 401 …“
 *   rechte-ohne-meldung             die Meldung beim Rechteentzug gestrichen → rot „entzogene …“
 *   design-nicht-gemerkt            der Spiegel nach saveAppTheme gestrichen → rot „das Design …“
 *   serverstart-ohne-ende           `r.data.ready` aus der Abbruchbedingung → rot „der Serverstart …“
 *   abgelaufen-vor-dem-start        der 401-Sammler mit drop(1) → rot „ein 401 vor dem Start …“
 *   anmeldung-ohne-abbruch          in sequenceLogin `collect` statt `collectLatest` und die
 *                                   Schritte in `bereich` statt im Bereich der Anmeldung → rot
 *                                   „eine späte Antwort des alten Kontos …“ (CHF statt USD)
 *   waehrung-zurueckgespiegelt      in starte() wieder `sitzung.state.map { it.currency }…
 *                                   collect { prefs.saveCurrency(it) }` → rot „Währung und Design
 *                                   kommen aus der Ablage …“ (eine Schreibung statt keiner)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SessionServiceTest {

    private val takt = StandardTestDispatcher()
    private val fake = FakeApi()
    private val ablage = StorageSessionStore()
    private var currencyWritten = 0

    /** Die Ablage, wie der Dienst sie sieht; zählt, ob er die Währung zurückschreibt. */
    private val prefs = object : Sitzungsablage by ablage {
        override suspend fun saveCurrency(cur: Waehrung) { currencyWritten++; ablage.saveCurrency(cur) }
    }

    /** Währung und Design aus derselben Ablage, wie StoreAccountValues im Gerät. */
    private val sitzung = Sitzung(object : Kontowerte {
        override val waehrung: StateFlow<Waehrung> = ablage.waehrung
        override val design: StateFlow<Design> = ablage.design
        override fun setCurrency(w: Waehrung) { ablage.waehrung.value = w }
        override fun setzeDesign(d: Design) { ablage.design.value = d }
    })

    /** Je Anmeldung eine Antwort auf /settings: Verzögerung und Währung. */
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

    /** Erzeugt und startet den Dienst, führt [block] aus und beendet seine Koroutinen. */
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
    fun `ein 401 meldet die angemeldete Sitzung ab, ein zweiter bleibt still`() = withVm {
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
    fun `eine zu alte Anmeldung meldet ab, ohne das Konto zu laden`() = withVm {
        ablage.abgelaufen = true
        angemeldet()
        advanceUntilIdle()
        assertEquals(1, signOuts)
        assertEquals("t${R.string.vm_anmeldung_zu_alt}", t.meldungen.text)
        assertEquals(0, fake.callsOf("getMe"))
        assertEquals(0, vorgewaermt)
    }

    @Test
    fun `entzogene Verwalterrechte gelten sofort und werden einmal gemeldet`() = withVm {
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
    fun `das Design des Servers gilt und wird gemerkt, ohne Antwort bleibt das gemerkte`() = withVm {
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
    fun `eine spaete Antwort des alten Kontos schreibt nicht in die neue Sitzung`() = withVm {
        einstellungen.addLast(1_000L to Waehrung.CHF)
        einstellungen.addLast(10L to Waehrung("USD"))
        angemeldet()
        runCurrent()
        advanceTimeBy(100)
        // Ein anderes Konto meldet sich an, bevor das alte seine Einstellungen bekam.
        ablage.token.value = "anderes"
        advanceUntilIdle()
        assertEquals(Waehrung("USD"), sitzung.state.value.currency)
        assertEquals("die Ablage hält die Währung des neuen Kontos", Waehrung("USD"), ablage.waehrung.value)
    }

    @Test
    fun `Waehrung und Design kommen aus der Ablage, die Sitzung schreibt nichts zurueck`() = withVm {
        advanceUntilIdle()
        ablage.waehrung.value = Waehrung.CHF
        ablage.design.value = Design.NOPPE
        advanceUntilIdle()
        assertEquals(Waehrung.CHF, sitzung.state.value.currency)
        assertEquals(Design.NOPPE, sitzung.state.value.appTheme)
        assertEquals("kein Spiegel zurück in die Ablage", 0, currencyWritten)
    }

    @Test
    fun `der Serverstart wird im Takt verfolgt, bis der Server bereit ist`() = withVm {
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
    fun `ohne Antwort startet kein Server, die Abfrage hoert auf`() = withVm {
        ablage.server.value = "https://falsch-getippt.example"
        fake.codes["getStartupStatus"] = 503
        advanceTimeBy(10_000)
        assertNull(sitzung.state.value.startupStatus)
        assertEquals(1, fake.callsOf("getStartupStatus"))
    }

    @Test
    fun `eine endgueltig gescheiterte Abmeldung am Server wird einmal gemeldet`() {
        ablage.gescheitert += "https://alt.example"
        withVm {
            val m = t.meldungen.meldung.value as Meldung.Resource
            assertEquals(R.string.abmeldung_gescheitert_text, m.id)
            assertTrue("der Server steht im Satz: ${m.werte}", m.werte.single().toString().contains("alt.example"))
            assertTrue(ablage.gescheitert.isEmpty())
        }
    }

    @Test
    fun `ein 401 vor dem Start geht nicht verloren`() {
        angemeldet()
        expiredSignal.notifyExpired()
        withVm {
            advanceUntilIdle()
            assertEquals(1, signOuts)
            assertFalse("quittiert", expiredSignal.abgelaufen.value)
        }
    }
}
