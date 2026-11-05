package ch.brickinventoryapp

import ch.brickinventoryapp.data.RechteSignal
import ch.brickinventoryapp.data.SessionExpiredSignal
import ch.brickinventoryapp.data.ZweiterFaktorPflicht
import ch.brickinventoryapp.data.model.AppThemeResponse
import ch.brickinventoryapp.data.model.MeResponse
import ch.brickinventoryapp.data.model.StartupStatus
import ch.brickinventoryapp.data.model.User
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.Abmeldevorgang
import ch.brickinventoryapp.ui.SitzungsDienst
import ch.brickinventoryapp.ui.Vorwaermung
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

/**
 * Der SitzungsDienst ausgeführt: Abmelden bei 401 und zu alter Anmeldung,
 * Rechteentzug, Design und Serverstart. Ohne Netz (FakeApi) und in virtueller
 * Zeit (StandardTestDispatcher), damit „nichts geschieht“ prüfbar ist, ohne zu warten.
 *
 * Gegenproben (05.11.2026, gemessen mit kotlinc lokal):
 *   abmelden-ohne-sitzungspruefung  `isLoggedIn` im 401-Zweig gestrichen → rot „ein 401 …“
 *   rechte-ohne-meldung             die Meldung beim Rechteentzug gestrichen → rot „entzogene …“
 *   design-nicht-gemerkt            der Spiegel nach saveAppTheme gestrichen → rot „das Design …“
 *   serverstart-ohne-ende           `r.data.ready` aus der Abbruchbedingung → rot „der Serverstart …“
 *   abgelaufen-vor-dem-start        der 401-Sammler mit drop(1) → rot „ein 401 vor dem Start …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SitzungsDienstTest {

    private val takt = StandardTestDispatcher()
    private val fake = FakeApi()
    private val ablage = SpeicherSitzungsablage()
    private val abgelaufenSignal = SessionExpiredSignal()
    private val rechte = RechteSignal()
    private lateinit var t: TestDienste
    private var abmeldungen = 0
    private var vorgewaermt = 0

    @Before fun auf() {
        Dispatchers.setMain(takt)
        t = TestDienste(fake.api, io = takt)
    }

    @After fun ab() {
        Dispatchers.resetMain()
        t.cacheDir.deleteRecursively()
    }

    /** Erzeugt und startet den Dienst, führt [block] aus und beendet seine Koroutinen. */
    private fun mitVm(block: suspend TestScope.(SitzungsDienst) -> Unit) = runTest(takt) {
        val bereich = CoroutineScope(SupervisorJob() + takt)
        val dienst = SitzungsDienst(
            konto = KontoRepository(fake.api, t.cache), verwaltung = VerwaltungRepository(fake.api, t.cache), prefs = ablage, sessionExpired = abgelaufenSignal, rechte = rechte,
            meldungen = t.meldungen, texte = NummernTexte, sitzung = t.sitzung, blickfeld = t.blickfeld,
            bestand = t.bestand, zweiterFaktorPflicht = ZweiterFaktorPflicht(),
            abmeldevorgang = Abmeldevorgang {
                abmeldungen++
                ablage.token.value = ""
                t.sitzung.abgemeldet()
                null
            },
            vorwaermen = Vorwaermung { vorgewaermt++ },
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
    fun `ein 401 meldet die angemeldete Sitzung ab, ein zweiter bleibt still`() = mitVm {
        angemeldet()
        advanceUntilIdle()
        assertTrue(t.sitzung.state.value.isLoggedIn)
        assertEquals("Nach dem Anmelden wird vorgewärmt", 1, vorgewaermt)

        abgelaufenSignal.notifyExpired()
        advanceUntilIdle()
        assertEquals(1, abmeldungen)
        assertFalse(t.sitzung.state.value.isLoggedIn)
        assertEquals("t${R.string.vm_session_expired}", t.meldungen.meldung.value)

        t.meldungen.quittiere()
        abgelaufenSignal.notifyExpired()
        advanceUntilIdle()
        assertEquals("Abgemeldet meldet ein 401 nicht noch einmal ab", 1, abmeldungen)
        assertNull(t.meldungen.meldung.value)
    }

    @Test
    fun `eine zu alte Anmeldung meldet ab, ohne das Konto zu laden`() = mitVm {
        ablage.abgelaufen = true
        angemeldet()
        advanceUntilIdle()
        assertEquals(1, abmeldungen)
        assertEquals("t${R.string.vm_anmeldung_zu_alt}", t.meldungen.meldung.value)
        assertEquals(0, fake.aufrufeVon("getMe"))
        assertEquals(0, vorgewaermt)
    }

    @Test
    fun `entzogene Verwalterrechte gelten sofort und werden einmal gemeldet`() = mitVm {
        fake.antworten["getMe"] = MeResponse(success = true, user = User(1, "anna", isAdmin = true))
        angemeldet()
        advanceUntilIdle()
        assertTrue(t.sitzung.state.value.isAdmin)

        fake.antworten["getMe"] = MeResponse(success = true, user = User(1, "anna", isAdmin = false))
        rechte.melde()
        advanceUntilIdle()
        assertFalse(t.sitzung.state.value.isAdmin)
        assertEquals("t${R.string.vm_rechte_entzogen}", t.meldungen.meldung.value)

        t.meldungen.quittiere()
        val abrufe = fake.aufrufeVon("getMe")
        rechte.melde()
        advanceUntilIdle()
        assertEquals("Ohne Verwalterrecht kein weiterer Abruf", abrufe, fake.aufrufeVon("getMe"))
        assertNull(t.meldungen.meldung.value)
    }

    @Test
    fun `das Design des Servers gilt und wird gemerkt, ohne Antwort bleibt das gemerkte`() = mitVm {
        ablage.design.value = "brick"
        ablage.server.value = "https://brick.example"
        fake.codes["getAppTheme"] = 500
        advanceUntilIdle()
        assertEquals("brick", t.sitzung.state.value.appTheme)
        assertEquals("brick", ablage.design.value)

        fake.codes.clear()
        fake.antworten["getAppTheme"] = AppThemeResponse(success = true, theme = "noppe")
        angemeldet()
        advanceUntilIdle()
        assertEquals("noppe", t.sitzung.state.value.appTheme)
        assertEquals("Das Design des Kontos überlebt den Kaltstart", "noppe", ablage.design.value)
    }

    @Test
    fun `der Serverstart wird im Takt verfolgt, bis der Server bereit ist`() = mitVm {
        ablage.server.value = "https://brick.example"
        fake.antworten["getStartupStatus"] = StartupStatus(ready = false, step = "Katalog", progress = 2.0, total = 8)
        runCurrent()
        assertNotNull(t.sitzung.state.value.startupStatus)
        val erste = fake.aufrufeVon("getStartupStatus")
        assertEquals(1, erste)

        advanceTimeBy(2_001)
        assertEquals("Alle zwei Sekunden eine Abfrage", 2, fake.aufrufeVon("getStartupStatus"))

        fake.antworten["getStartupStatus"] = StartupStatus(ready = true)
        advanceTimeBy(2_001)
        assertNull(t.sitzung.state.value.startupStatus)
        advanceTimeBy(60_000)
        assertEquals("Fertig heisst: keine Abfrage mehr", 3, fake.aufrufeVon("getStartupStatus"))
    }

    @Test
    fun `ohne Antwort startet kein Server, die Abfrage hoert auf`() = mitVm {
        ablage.server.value = "https://falsch-getippt.example"
        fake.codes["getStartupStatus"] = 503
        advanceTimeBy(10_000)
        assertNull(t.sitzung.state.value.startupStatus)
        assertEquals(1, fake.aufrufeVon("getStartupStatus"))
    }

    @Test
    fun `eine endgueltig gescheiterte Abmeldung am Server wird einmal gemeldet`() {
        ablage.gescheitert += "https://alt.example"
        mitVm {
            assertEquals("t${R.string.abmeldung_gescheitert_text}", t.meldungen.meldung.value)
            assertTrue(ablage.gescheitert.isEmpty())
        }
    }

    @Test
    fun `ein 401 vor dem Start geht nicht verloren`() {
        angemeldet()
        abgelaufenSignal.notifyExpired()
        mitVm {
            advanceUntilIdle()
            assertEquals(1, abmeldungen)
            assertFalse("quittiert", abgelaufenSignal.abgelaufen.value)
        }
    }
}
