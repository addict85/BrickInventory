package ch.brickinventoryapp.sammlung

import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Merksortierung
import ch.brickinventoryapp.model.fach.Zustand
import kotlinx.coroutines.runBlocking
import ch.brickinventoryapp.vertrag.MerkpostenRequest
import kotlinx.coroutines.flow.first
import ch.brickinventoryapp.offline.Bearbeitung
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.testing.FinanzenRepository
import ch.brickinventoryapp.testing.KatalogRepository
import ch.brickinventoryapp.sammlung.ui.viewmodel.MerklisteViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste

/**
 * Das Merklisten-ViewModel, ausgeführt gegen einen PfadServer ohne Netz. Die Wartezeiten
 * (Suchpause, Ruhezeit des Preisalarms) laufen auf der Testuhr.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen MerklisteViewModel.kt):
 *   A  in setzeMerklisteSuche() das Schreiben in den SavedStateHandle entfernt
 *      → rot „Suche, Zustand und Sortierung überstehen …“
 *   B  die Suchpause entfernt (sofort laden) → rot „die Suche wartet die Pause ab
 *      und filtert die Ablage mit dem letzten Text“
 *   C  in LokaleAnwendung.sets den Zweig MerkpostenUebernommen entfernt → rot
 *      „eine Übernahme nimmt den Merkposten aus der Ablage und legt das Set dort an“
 *   D  im Preisalarm das Nachladen der Alarme des offenen Postens entfernt →
 *      rot „ein Preisalarm im Merkposten wird entprellt gespeichert …“
 *   E  in ladeMerkliste die Quelle ohne Suchtext gewählt → rot „die Liste folgt der
 *      Ablage, auch gefiltert“ (99999-1 erscheint unter „10294“)
 *   F  merklisteState sieht die Quelle nicht an (gegenproben/merkliste-ohne-ablage.patch)
 *      → rot „Liste geladen“: Der Abruf schreibt nur in die Ablage.
 *   G  loescheMerkposten() löscht wieder sofort am Server
 *      (gegenproben/merkposten-loeschen-sofort.patch) → rot „ein geloeschter Merkposten …“
 *      („Noch kein DELETE“)
 *   H  loescheMerkposten() liest den Namen aus der rohen Liste statt aus der gezeigten
 *      (gegenproben/merkposten-name-ohne-ablage.patch) → rot „ein geloeschter Merkposten …“
 *      (Titanic erwartet, 10294-1 bekommen; nur in der CI messbar)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MerklisteViewModelTest {

    private val uhr = TestCoroutineScheduler()
    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    private fun vm(gemerkt: SavedStateHandle = SavedStateHandle(), t: TestDienste = this.t) = t.merke(MerklisteViewModel(t.sitzung, t.filter(), t.hinweise, t.merkliste(), t.alarme(), t.kontosicht,
        KatalogRepository(t.api), FinanzenRepository(t.api), gemerkt))

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher(uhr))
        pfade = PfadServer(
            "/api/v1/wanted" to """{"success":true,"merkposten":[{"set_number":"10294-1","condition":"N","user_id":1}]}""",
            "/api/v1/wanted/10294-1/N/uebernehmen" to """{"success":true,"action":"added","set_number":"10294-1"}""",
            "/api/v1/alerts" to """{"success":true,"alerts":[{"set_number":"10294-1","condition":"N","richtung":"unter","schwelle":500.0}]}""",
            "/api/v1/sets/10294-1/alert" to """{"success":true,"alert":{"set_number":"10294-1","condition":"N","richtung":"unter","schwelle":450.0}}""",
        )
        t = TestDienste(pfade.imTakt(), io = Dispatchers.Main)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        pfade.server.shutdown()
    }

    @Test
    fun `ein geloeschter Merkposten laesst sich zurueckholen, geloescht wird erst danach`() {
        pfade.antworten["/api/v1/wanted"] = """{"success":true,"merkposten":[
            {"set_number":"10294-1","condition":"N","user_id":1,"name":"Titanic"},
            {"set_number":"10305-1","condition":"N","user_id":1,"name":"Lion Knights' Castle"}]}"""
        pfade.antworten["/api/v1/wanted/10294-1/N"] = """{"success":true}"""
        val vm = vm()
        vm.ladeMerkliste()
        assertEquals(2, vm.merklisteState.value.merkposten.size)
        vm.loescheMerkposten("10294-1", Zustand.NEU, 1)
        assertTrue("aus der Liste", vm.merklisteState.value.merkposten.none { it.setNumber == "10294-1" })
        assertEquals("Titanic", vm.vorgemerkt.value?.name)
        assertTrue("Noch kein DELETE", pfade.anfragenAn("DELETE /api/v1/wanted/10294-1").isEmpty())
        vm.merkpostenRueckgaengig()
        assertTrue("wieder da", vm.merklisteState.value.merkposten.any { it.setNumber == "10294-1" })
        assertTrue("nach Rückgängig kein DELETE", pfade.anfragenAn("DELETE /api/v1/wanted/10294-1").isEmpty())
        vm.loescheMerkposten("10294-1", Zustand.NEU, 1)
        vm.merkpostenLoeschenAusfuehren()
        assertTrue("DELETE gesendet", pfade.anfragenAn("DELETE /api/v1/wanted/10294-1").isNotEmpty())
        assertEquals(null, vm.vorgemerkt.value)
    }

    @Test
    fun `Suche, Zustand und Sortierung ueberstehen einen Prozess-Tod und reisen mit`() {
        val gemerkt = SavedStateHandle()
        val erstes = vm(gemerkt)
        erstes.setzeMerklisteSuche("Titanic")
        erstes.setzeMerklisteZustand(Zustand.GEBRAUCHT)
        erstes.setzeMerklisteSortierung(Merksortierung.PREIS_ABSTEIGEND)

        pfade.neuerProzess(io = Dispatchers.Main) { pfade, t ->
            pfade.antworten["/api/v1/wanted"] = """{"success":true,"merkposten":[
                {"set_number":"10294-1","condition":"U","user_id":1,"name":"Titanic"},
                {"set_number":"10294-1","condition":"N","user_id":1,"name":"Titanic"}]}"""
            val neu = vm(gemerkt, t)
            val f = neu.merklisteState.value
            assertEquals(Triple("Titanic", Zustand.GEBRAUCHT, Merksortierung.PREIS_ABSTEIGEND), Triple(f.query, f.zustandFilter, f.sortierung))
            neu.ladeMerkliste()
            // Die Filter gelten der Ablage; der Abruf füllt sie ganz.
            assertEquals(listOf(Zustand.GEBRAUCHT), neu.merklisteState.value.merkposten.map { it.condition })
            val anfrage = pfade.anfragenAn("GET /api/v1/wanted").single()
            assertTrue(anfrage, "search=" !in anfrage && "condition=" !in anfrage)
        }
    }

    @Test
    fun `die Suche wartet die Pause ab und filtert die Ablage mit dem letzten Text`() {
        pfade.antworten["/api/v1/wanted"] = """{"success":true,"merkposten":[
            {"set_number":"10294-1","condition":"N","user_id":1,"name":"Titanic"},
            {"set_number":"21330-1","condition":"N","user_id":1,"name":"Tilt"}]}"""
        val vm = vm()
        vm.setzeMerklisteSuche("Ti")
        vm.setzeMerklisteSuche("Tita")
        uhr.advanceTimeBy(300)
        assertEquals("Vor der Pause darf nichts hinausgehen", 0, pfade.anfragenAn("GET /api/v1/wanted").size)
        uhr.advanceTimeBy(100)
        assertEquals(listOf("10294-1"), vm.merklisteState.value.merkposten.map { it.setNumber })
        assertEquals(1, pfade.anfragenAn("GET /api/v1/wanted").size)
    }

    @Test
    fun `eine Uebernahme nimmt den Merkposten aus der Ablage und legt das Set dort an`() {
        val vm = vm()
        vm.ladeMerkliste()
        assertTrue("Liste geladen", vm.merklisteState.value.merkposten.isNotEmpty())
        vm.uebernimmMerkposten("10294-1", Zustand.NEU, besitzer = 1, kaufpreisRoh = "499,90")
        assertTrue("aus der Merkliste", vm.merklisteState.value.merkposten.isEmpty())
        val galerie = runBlocking { t.sets().beobachteSets().first().liste }
        assertEquals("in der Galerie", listOf("10294-1"), galerie.map { it.setNumber })
        val uebernahme = pfade.anfragenAn("/uebernehmen").single()
        assertTrue(uebernahme, uebernahme.startsWith("POST"))
    }

    @Test
    fun `ein Preisalarm im Merkposten wird entprellt gespeichert und neu geladen`() {
        val vm = vm()
        vm.ladeMerkpostenDetail("10294-1")
        assertTrue("Detail geladen", !vm.merkpostenDetailState.value.laedt)
        assertEquals(500.0, vm.merkpostenDetailState.value.preisalarme.single().schwelle, 0.0)
        val vorher = pfade.anfragenAn("GET /api/v1/alerts").size

        vm.setzePreisalarm("10294-1", Alarmrichtung.UNTER, "4", Zustand.NEU)
        vm.setzePreisalarm("10294-1", Alarmrichtung.UNTER, "450", Zustand.NEU)
        // Gespeichert führt der Server 450; der Zustand liest die Ablage nur beim Laden,
        // ohne Nachladen bliebe er bei 500.
        pfade.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[{"set_number":"10294-1","condition":"N","richtung":"unter","schwelle":450.0}]}"""
        uhr.advanceTimeBy(900)
        assertEquals("Nur die letzte Eingabe wird gespeichert", 1, pfade.anfragenAn("PUT /api/v1/sets/10294-1/alert").size)
        assertTrue("nachgeladen", pfade.anfragenAn("GET /api/v1/alerts").size > vorher)
        assertEquals("gespeichert und nachgeladen", 450.0, vm.merkpostenDetailState.value.preisalarme.single().schwelle, 0.0)
        val abgelegt = runBlocking { t.alarme().beobachteAlarme("10294-1").first().liste }
        assertEquals("in der Ablage", listOf(450.0), abgelegt.map { it.schwelle })
    }

    @Test
    fun `die Liste folgt der Ablage, auch gefiltert`() {
        val ablage = t.ablage
        val vm = vm()
        vm.ladeMerkliste()
        assertTrue("Liste geladen", vm.merklisteState.value.merkposten.isNotEmpty())
        val abrufe = pfade.anfragenAn("GET /api/v1/wanted").size

        runBlocking { ablage.wendeAn(Bearbeitung.MerkpostenLoeschen("10294-1", Zustand.NEU, 1)) }
        assertTrue("offline gelöscht", vm.merklisteState.value.merkposten.isEmpty())
        assertEquals("ohne neuen Abruf", abrufe, pfade.anfragenAn("GET /api/v1/wanted").size)

        vm.setzeMerklisteSuche("10294")
        uhr.advanceTimeBy(400)
        assertTrue("Suche geladen", vm.merklisteState.value.merkposten.isNotEmpty())
        runBlocking { ablage.wendeAn(Bearbeitung.MerkpostenAnlegen(MerkpostenRequest("99999-1", Zustand.NEU, 1))) }
        runBlocking { ablage.wendeAn(Bearbeitung.MerkpostenAnlegen(MerkpostenRequest("10294-1", Zustand.GEBRAUCHT, 1))) }
        uhr.advanceTimeBy(100)
        assertEquals("die Suche filtert auch offline Angelegtes", listOf("10294-1|U", "10294-1|N"),
            vm.merklisteState.value.merkposten.map { "${it.setNumber}|${it.condition.kennung}" })
    }
}
