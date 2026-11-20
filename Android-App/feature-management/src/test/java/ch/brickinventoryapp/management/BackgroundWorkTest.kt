package ch.brickinventoryapp.management

import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.domain.JobStatus
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.management.ui.screens.jobKindText
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestApi
import ch.brickinventoryapp.testing.text

/**
 * Die Hintergrundarbeiten im Monitoring: laden, abbrechen, wiederholen — das
 * ViewModel gegen einen Testserver mit den Antworten der Auftragstabelle.
 *
 * Gegenproben:
 *   A  in HintergrundAnsichten `abbrechbar` auch für FEHLER → rot „was man mit
 *      einem Auftrag tun darf, steht schon fest“
 *   B  in MonitoringViewModel.afterJob das Neuladen entfernt → rot „Abbrechen
 *      meldet Erfolg und lädt neu“ (nur eine GET-Anfrage)
 *   C  bei Ergebnis.Fehler den Erfolgssatz statt errorMessage → rot „ein 409
 *      zeigt den Satz des Servers“
 *   D  `jobProcessRunning = true` fest → rot „ohne Job-Prozess steht die Warnung an“
 * Gegenprobe: melde()
 *   startet die Aktion, legt den Satz aber nicht in den Kanal → rot „eine Aktion
 *   laeuft im ViewModel …“
 */
class BackgroundWorkTest {

    private val liste = """{"success":true,
        "auftraege":[
          {"id":"17","type":"bilder","status":"laeuft","attempts":1,"max_attempts":5,"due_at":"2026-10-30T10:00:00Z",
           "deadline_at":null,"started_at":"2026-10-30T10:00:05Z","created_at":"2026-10-30T09:59:00Z","updated_at":null,
           "progress":{"erledigt":3,"gesamt":12,"text":"Bilder"},"error_message":null,"user_id":4,"geplant":false,"set_number":"75192-1"},
          {"id":"18","type":"preise","status":"fehler","attempts":3,"max_attempts":3,"due_at":"2026-10-30T11:00:00Z",
           "deadline_at":null,"started_at":null,"created_at":"2026-10-30T09:00:00Z","updated_at":null,
           "progress":null,"error_message":"BrickLink antwortet nicht","user_id":null,"geplant":true,"set_number":null}],
        "zusammenfassung":[{"type":"bilder","status":"laeuft","anzahl":1}],
        "pausen":[{"type":"preise","until_at":"2026-10-30T12:00:00Z","reason":"Kontingent"}],
        "bildbedarf":7,
        "job_prozess":{"lebenszeichen":null,"alter_sekunden":null,"laeuft":false}}"""

    private val paths = PfadServer("/api/v1/admin/auftraege" to liste)
    private val dir = File(System.getProperty("java.io.tmpdir"), "bim-hg-${System.nanoTime()}")
    private val kanal = MeldungsKanal()
    private val vm = TestApi.fuer(paths.server).let { api ->
        MonitoringViewModel(testManagementRepository(api), testAccountRepository(api), kanal)
    }

    @After
    fun zu() {
        paths.server.shutdown()
        dir.deleteRecursively()
    }

    @Test
    fun `was man mit einem Auftrag tun darf, steht schon fest`() = runBlocking {
        vm.loadBackground()
        val a = vm.hintergrund.value.ansicht!!
        val (laeuft, fehler) = a.auftraege
        assertEquals(JobStatus.LAEUFT, laeuft.status)
        assertEquals("3/12 · Bilder", laeuft.progressText)
        assertEquals(R.string.art_bilder, jobKindText(laeuft.art))
        assertTrue(laeuft.abbrechbar); assertFalse(laeuft.retryable)
        assertFalse(fehler.abbrechbar); assertTrue(fehler.retryable)
        assertEquals(7, a.bildbedarf)
        assertEquals("Kontingent", a.pausen.single().grund)
    }

    @Test
    fun `ohne Job-Prozess steht die Warnung an`() = runBlocking {
        vm.loadBackground()
        assertFalse(vm.hintergrund.value.ansicht!!.jobProcessRunning)
    }

    /** Die Aktion läuft im viewModelScope; der Satz kommt über den Meldungskanal, nicht über den Bildschirm. */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `eine Aktion laeuft im ViewModel und meldet ueber den Zustand`() = runBlocking {
        paths.antworten["/api/v1/admin/auftraege/17/abbrechen"] = """{"success":true,"id":"17","status":"abgebrochen"}"""
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            vm.cancelJob("17")
            withTimeout(5_000) { kanal.meldung.first { it != null } }
            assertEquals("t${R.string.hintergrund_abgebrochen_ok}", kanal.text)
        } finally {
            vm.viewModelScope.cancel()
            Dispatchers.resetMain()
        }
    }

    @Test
    fun `Abbrechen meldet Erfolg und lädt neu`() = runBlocking {
        paths.antworten["/api/v1/admin/auftraege/17/abbrechen"] = """{"success":true,"id":"17","status":"abgebrochen"}"""
        vm.loadBackground()
        val satz = vm.abortJobAb("17")
        assertEquals(Meldung.Resource(R.string.hintergrund_abgebrochen_ok), satz)
        assertEquals(listOf("POST /api/v1/admin/auftraege/17/abbrechen"), paths.requestsAn("/abbrechen"))
        assertEquals(2, paths.requestsAn("GET /api/v1/admin/auftraege").size)
    }

    @Test
    fun `ein 409 zeigt den Satz des Servers`() = runBlocking {
        paths.antworten["/api/v1/admin/auftraege/17/wiederholen"] =
            """{"success":false,"code":"auftrag_nicht_aenderbar","error":"Der Auftrag lässt sich nicht mehr ändern."}"""
        paths.codes["/api/v1/admin/auftraege/17/wiederholen"] = 409
        val satz = vm.repeatJob("17")
        assertEquals(Meldung.Text("Der Auftrag lässt sich nicht mehr ändern."), satz)
        assertEquals("Auch nach dem Fehlschlag gilt der Stand des Servers", 1,
            paths.requestsAn("GET /api/v1/admin/auftraege").size)
    }

    @Test
    fun `Leeren meldet die Zahl, Starten den Namen`() = runBlocking {
        paths.antworten["/api/v1/admin/auftraege/art/bilder"] = """{"success":true,"art":"bilder","entfernt":4}"""
        paths.antworten["/api/v1/admin/auftraege/art/preise/jetzt"] = """{"success":true,"art":"preise","gestartet":false}"""
        assertEquals(Meldung.Menge(R.plurals.hintergrund_geleert, 4), vm.emptyJobKind("bilder"))
        assertEquals(Meldung.Resource(R.string.hintergrund_nichts_gestartet, listOf("Preise")), vm.starteAuftragsArt("preise", "Preise"))
        assertEquals(listOf("DELETE /api/v1/admin/auftraege/art/bilder"), paths.requestsAn("DELETE"))
    }
}
