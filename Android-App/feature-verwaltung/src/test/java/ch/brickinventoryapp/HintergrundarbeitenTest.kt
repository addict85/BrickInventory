package ch.brickinventoryapp

import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.BrickRepository
import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.GutscheineRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import ch.brickinventoryapp.ui.model.AuftragStatus
import ch.brickinventoryapp.ui.screens.auftragsArtText
import ch.brickinventoryapp.ui.viewmodel.MonitoringViewModel
import ch.brickinventoryapp.ui.viewmodel.Texte
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

/**
 * Die Hintergrundarbeiten im Monitoring: laden, abbrechen, wiederholen — das
 * ViewModel gegen einen Testserver mit den Antworten der Auftragstabelle.
 *
 * Gegenproben:
 *   A  in HintergrundAnsichten `abbrechbar` auch für FEHLER → rot „was man mit
 *      einem Auftrag tun darf, steht schon fest“
 *   B  in MonitoringViewModel.nachAuftrag das Neuladen entfernt → rot „Abbrechen
 *      meldet Erfolg und lädt neu“ (nur eine GET-Anfrage)
 *   C  bei Result.Error den Erfolgssatz statt texte.meldung → rot „ein 409
 *      zeigt den Satz des Servers“
 *   D  `jobProzessLaeuft = true` fest → rot „ohne Job-Prozess steht die Warnung an“
 * Gegenprobe: melde()
 *   startet die Aktion, legt den Satz aber nicht in den Kanal → rot „eine Aktion
 *   laeuft im ViewModel …“
 */
class HintergrundarbeitenTest {

    private object Saetze : Texte {
        override fun text(id: Int, vararg args: Any?) = "t$id(${args.joinToString()})"
        override fun menge(id: Int, anzahl: Int, vararg args: Any?) = "m$id:$anzahl"
        override fun meldung(fehler: Result.Error) = "Server: ${fehler.message}"
        override fun angemeldet() = true
    }

    private val liste = """{"success":true,
        "auftraege":[
          {"id":"17","art":"bilder","status":"laeuft","versuche":1,"max_versuche":5,"faellig_ab":"2026-10-30T10:00:00Z",
           "frist_bis":null,"gestartet":"2026-10-30T10:00:05Z","erstellt":"2026-10-30T09:59:00Z","aktualisiert":null,
           "fortschritt":{"erledigt":3,"gesamt":12,"text":"Bilder"},"fehler":null,"user_id":4,"geplant":false,"set_number":"75192-1"},
          {"id":"18","art":"preise","status":"fehler","versuche":3,"max_versuche":3,"faellig_ab":"2026-10-30T11:00:00Z",
           "frist_bis":null,"gestartet":null,"erstellt":"2026-10-30T09:00:00Z","aktualisiert":null,
           "fortschritt":null,"fehler":"BrickLink antwortet nicht","user_id":null,"geplant":true,"set_number":null}],
        "zusammenfassung":[{"art":"bilder","status":"laeuft","anzahl":1}],
        "pausen":[{"art":"preise","bis":"2026-10-30T12:00:00Z","grund":"Kontingent"}],
        "bildbedarf":7,
        "job_prozess":{"lebenszeichen":null,"alter_sekunden":null,"laeuft":false}}"""

    private val pfade = PfadServer("/api/v1/admin/auftraege" to liste)
    private val dir = File(System.getProperty("java.io.tmpdir"), "bim-hg-${System.nanoTime()}")
    private val kanal = MeldungsKanal()
    private val vm = TestApi.fuer(pfade.server).let { api ->
        val cache = ResponseCache { dir }
        MonitoringViewModel(BrickRepository(
            sets = SetsRepository(api, cache), teile = TeileRepository(api, cache),
            finanzen = FinanzenRepository(api, cache), haushalt = HaushaltRepository(api, cache),
            figuren = FigurenRepository(api, cache), konto = KontoRepository(api, cache),
            verwaltung = VerwaltungRepository(api, cache), katalog = KatalogRepository(api, cache),
            gutscheine = GutscheineRepository(api, cache), cache = cache,
        ), Saetze, kanal)
    }

    @After
    fun zu() {
        pfade.server.shutdown()
        dir.deleteRecursively()
    }

    @Test
    fun `was man mit einem Auftrag tun darf, steht schon fest`() = runBlocking {
        vm.ladeHintergrund()
        val a = vm.hintergrund.value.ansicht!!
        val (laeuft, fehler) = a.auftraege
        assertEquals(AuftragStatus.LAEUFT, laeuft.status)
        assertEquals("3/12 · Bilder", laeuft.fortschrittText)
        assertEquals(R.string.art_bilder, auftragsArtText(laeuft.art))
        assertTrue(laeuft.abbrechbar); assertFalse(laeuft.wiederholbar)
        assertFalse(fehler.abbrechbar); assertTrue(fehler.wiederholbar)
        assertEquals(7, a.bildbedarf)
        assertEquals("Kontingent", a.pausen.single().grund)
    }

    @Test
    fun `ohne Job-Prozess steht die Warnung an`() = runBlocking {
        vm.ladeHintergrund()
        assertFalse(vm.hintergrund.value.ansicht!!.jobProzessLaeuft)
    }

    /** Die Aktion läuft im viewModelScope; der Satz kommt über den Meldungskanal, nicht über den Bildschirm. */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `eine Aktion laeuft im ViewModel und meldet ueber den Zustand`() = runBlocking {
        pfade.antworten["/api/v1/admin/auftraege/17/abbrechen"] = """{"success":true,"id":"17","status":"abgebrochen"}"""
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            vm.auftragAbbrechen("17")
            val satz = withTimeout(5_000) { kanal.meldung.first { it != null } }
            assertEquals("t${R.string.hintergrund_abgebrochen_ok}()", satz)
        } finally {
            vm.viewModelScope.cancel()
            Dispatchers.resetMain()
        }
    }

    @Test
    fun `Abbrechen meldet Erfolg und lädt neu`() = runBlocking {
        pfade.antworten["/api/v1/admin/auftraege/17/abbrechen"] = """{"success":true,"id":"17","status":"abgebrochen"}"""
        vm.ladeHintergrund()
        val satz = vm.brichAuftragAb("17")
        assertEquals("t${R.string.hintergrund_abgebrochen_ok}()", satz)
        assertEquals(listOf("POST /api/v1/admin/auftraege/17/abbrechen"), pfade.anfragenAn("/abbrechen"))
        assertEquals(2, pfade.anfragenAn("GET /api/v1/admin/auftraege").size)
    }

    @Test
    fun `ein 409 zeigt den Satz des Servers`() = runBlocking {
        pfade.antworten["/api/v1/admin/auftraege/17/wiederholen"] =
            """{"success":false,"code":"auftrag_nicht_aenderbar","error":"Der Auftrag lässt sich nicht mehr ändern."}"""
        pfade.codes["/api/v1/admin/auftraege/17/wiederholen"] = 409
        val satz = vm.wiederholeAuftrag("17")
        assertEquals("Server: Der Auftrag lässt sich nicht mehr ändern.", satz)
        assertEquals("Auch nach dem Fehlschlag gilt der Stand des Servers", 1,
            pfade.anfragenAn("GET /api/v1/admin/auftraege").size)
    }

    @Test
    fun `Leeren meldet die Zahl, Starten den Namen`() = runBlocking {
        pfade.antworten["/api/v1/admin/auftraege/art/bilder"] = """{"success":true,"art":"bilder","entfernt":4}"""
        pfade.antworten["/api/v1/admin/auftraege/art/preise/jetzt"] = """{"success":true,"art":"preise","gestartet":false}"""
        assertEquals("m${R.plurals.hintergrund_geleert}:4", vm.leereAuftragsArt("bilder"))
        assertEquals("t${R.string.hintergrund_nichts_gestartet}(Preise)", vm.starteAuftragsArt("preise", "Preise"))
        assertEquals(listOf("DELETE /api/v1/admin/auftraege/art/bilder"), pfade.anfragenAn("DELETE"))
    }
}
