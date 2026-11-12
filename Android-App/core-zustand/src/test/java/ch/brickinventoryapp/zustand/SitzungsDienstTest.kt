package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.data.RechteSignal
import ch.brickinventoryapp.data.SessionExpiredSignal
import ch.brickinventoryapp.data.ZweiterFaktorPflicht
import ch.brickinventoryapp.model.data.model.AppThemeResponse
import ch.brickinventoryapp.model.data.model.SettingsResponse
import ch.brickinventoryapp.model.data.model.UserSettings
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.data.Sitzungsablage
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.sitzung.Kontowerte
import ch.brickinventoryapp.sitzung.Sitzung
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import ch.brickinventoryapp.model.data.model.MeResponse
import ch.brickinventoryapp.model.data.model.StartupStatus
import ch.brickinventoryapp.model.data.model.User
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.sitzung.Abmeldevorgang
import ch.brickinventoryapp.sitzung.SitzungsDienst
import ch.brickinventoryapp.sitzung.Vorwaermung
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
import ch.brickinventoryapp.testing.KontoRepository
import ch.brickinventoryapp.testing.SpeicherSitzungsablage
import ch.brickinventoryapp.testing.TestDienste
import ch.brickinventoryapp.testing.VerwaltungRepository
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
 *   anmeldung-ohne-abbruch          in folgeAnmeldung `collect` statt `collectLatest` und die
 *                                   Schritte in `bereich` statt im Bereich der Anmeldung → rot
 *                                   „eine späte Antwort des alten Kontos …“ (CHF statt USD)
 *   waehrung-zurueckgespiegelt      in starte() wieder `sitzung.state.map { it.currency }…
 *                                   collect { prefs.saveCurrency(it) }` → rot „Währung und Design
 *                                   kommen aus der Ablage …“ (eine Schreibung statt keiner)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SitzungsDienstTest {

    private val takt = StandardTestDispatcher()
    private val fake = FakeApi()
    private val ablage = SpeicherSitzungsablage()
    private var waehrungGeschrieben = 0

    /** Die Ablage, wie der Dienst sie sieht; zählt, ob er die Währung zurückschreibt. */
    private val prefs = object : Sitzungsablage by ablage {
        override suspend fun saveCurrency(cur: Waehrung) { waehrungGeschrieben++; ablage.saveCurrency(cur) }
    }

    /** Währung und Design aus derselben Ablage, wie AblageKontowerte im Gerät. */
    private val sitzung = Sitzung(object : Kontowerte {
        override val waehrung: StateFlow<Waehrung> = ablage.waehrung
        override val design: StateFlow<Design> = ablage.design
        override fun setzeWaehrung(w: Waehrung) { ablage.waehrung.value = w }
        override fun setzeDesign(d: Design) { ablage.design.value = d }
    })

    /** Je Anmeldung eine Antwort auf /settings: Verzögerung und Währung. */
    private val einstellungen = ArrayDeque<Pair<Long, Waehrung>>()
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
        val echt = KontoRepository(fake.api, t.cache)
        val konto = object : KontoRepository by echt {
            override suspend fun getSettings(): Ergebnis<SettingsResponse> {
                val (dauer, waehrung) = einstellungen.removeFirstOrNull() ?: return echt.getSettings()
                delay(dauer)
                return Ergebnis.Success(SettingsResponse(success = true, settings = UserSettings(currency = waehrung)))
            }
        }
        val dienst = SitzungsDienst(
            konto = konto, verwaltung = VerwaltungRepository(fake.api, t.cache), prefs = prefs, sessionExpired = abgelaufenSignal, rechte = rechte,
            meldungen = t.meldungen, sitzung = sitzung, blickfeld = t.blickfeld,
            abgleich = t.abgleich, zweiterFaktorPflicht = ZweiterFaktorPflicht(),
            abmeldevorgang = Abmeldevorgang {
                abmeldungen++
                ablage.token.value = ""
                sitzung.abgemeldet()
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
        assertTrue(sitzung.state.value.isLoggedIn)
        assertEquals("Nach dem Anmelden wird vorgewärmt", 1, vorgewaermt)

        abgelaufenSignal.notifyExpired()
        advanceUntilIdle()
        assertEquals(1, abmeldungen)
        assertFalse(sitzung.state.value.isLoggedIn)
        assertEquals("t${R.string.vm_session_expired}", t.meldungen.text)

        t.meldungen.quittiere()
        abgelaufenSignal.notifyExpired()
        advanceUntilIdle()
        assertEquals("Abgemeldet meldet ein 401 nicht noch einmal ab", 1, abmeldungen)
        assertNull(t.meldungen.text)
    }

    @Test
    fun `eine zu alte Anmeldung meldet ab, ohne das Konto zu laden`() = mitVm {
        ablage.abgelaufen = true
        angemeldet()
        advanceUntilIdle()
        assertEquals(1, abmeldungen)
        assertEquals("t${R.string.vm_anmeldung_zu_alt}", t.meldungen.text)
        assertEquals(0, fake.aufrufeVon("getMe"))
        assertEquals(0, vorgewaermt)
    }

    @Test
    fun `entzogene Verwalterrechte gelten sofort und werden einmal gemeldet`() = mitVm {
        fake.antworten["getMe"] = MeResponse(success = true, user = User(1, "anna", isAdmin = true))
        angemeldet()
        advanceUntilIdle()
        assertTrue(sitzung.state.value.isAdmin)

        fake.antworten["getMe"] = MeResponse(success = true, user = User(1, "anna", isAdmin = false))
        rechte.melde()
        advanceUntilIdle()
        assertFalse(sitzung.state.value.isAdmin)
        assertEquals("t${R.string.vm_rechte_entzogen}", t.meldungen.text)

        t.meldungen.quittiere()
        val abrufe = fake.aufrufeVon("getMe")
        rechte.melde()
        advanceUntilIdle()
        assertEquals("Ohne Verwalterrecht kein weiterer Abruf", abrufe, fake.aufrufeVon("getMe"))
        assertNull(t.meldungen.text)
    }

    @Test
    fun `das Design des Servers gilt und wird gemerkt, ohne Antwort bleibt das gemerkte`() = mitVm {
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
    fun `eine spaete Antwort des alten Kontos schreibt nicht in die neue Sitzung`() = mitVm {
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
    fun `Waehrung und Design kommen aus der Ablage, die Sitzung schreibt nichts zurueck`() = mitVm {
        advanceUntilIdle()
        ablage.waehrung.value = Waehrung.CHF
        ablage.design.value = Design.NOPPE
        advanceUntilIdle()
        assertEquals(Waehrung.CHF, sitzung.state.value.currency)
        assertEquals(Design.NOPPE, sitzung.state.value.appTheme)
        assertEquals("kein Spiegel zurück in die Ablage", 0, waehrungGeschrieben)
    }

    @Test
    fun `der Serverstart wird im Takt verfolgt, bis der Server bereit ist`() = mitVm {
        ablage.server.value = "https://brick.example"
        fake.antworten["getStartupStatus"] = StartupStatus(ready = false, step = "Katalog", progress = 2.0, total = 8)
        runCurrent()
        assertNotNull(sitzung.state.value.startupStatus)
        val erste = fake.aufrufeVon("getStartupStatus")
        assertEquals(1, erste)

        advanceTimeBy(2_001)
        assertEquals("Alle zwei Sekunden eine Abfrage", 2, fake.aufrufeVon("getStartupStatus"))

        fake.antworten["getStartupStatus"] = StartupStatus(ready = true)
        advanceTimeBy(2_001)
        assertNull(sitzung.state.value.startupStatus)
        advanceTimeBy(60_000)
        assertEquals("Fertig heisst: keine Abfrage mehr", 3, fake.aufrufeVon("getStartupStatus"))
    }

    @Test
    fun `ohne Antwort startet kein Server, die Abfrage hoert auf`() = mitVm {
        ablage.server.value = "https://falsch-getippt.example"
        fake.codes["getStartupStatus"] = 503
        advanceTimeBy(10_000)
        assertNull(sitzung.state.value.startupStatus)
        assertEquals(1, fake.aufrufeVon("getStartupStatus"))
    }

    @Test
    fun `eine endgueltig gescheiterte Abmeldung am Server wird einmal gemeldet`() {
        ablage.gescheitert += "https://alt.example"
        mitVm {
            val m = t.meldungen.meldung.value as Meldung.Ressource
            assertEquals(R.string.abmeldung_gescheitert_text, m.id)
            assertTrue("der Server steht im Satz: ${m.werte}", m.werte.single().toString().contains("alt.example"))
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
