package ch.brickinventoryapp.sammlung

import ch.brickinventoryapp.model.fach.Merkwunsch
import ch.brickinventoryapp.model.fach.Geld
import kotlinx.coroutines.launch
import kotlinx.coroutines.CoroutineScope
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Merksortierung
import ch.brickinventoryapp.model.fach.Zustand
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import ch.brickinventoryapp.offline.Editing
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.testing.testFinancesRepository
import ch.brickinventoryapp.testing.testCatalogRepository
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
 *   A  in setWantedSearch() das Schreiben in den SavedStateHandle entfernt
 *      → rot „Suche, Zustand und Sortierung überstehen …“
 *   B  die Suchpause entfernt (sofort laden) → rot „die Suche wartet die Pause ab
 *      und filtert die Ablage mit dem letzten Text“
 *   C  in LocalApplication.sets den Zweig WantedItemAdopted entfernt → rot
 *      „eine Übernahme nimmt den Merkposten aus der Ablage und legt das Set dort an“
 *   D  im Preisalarm das Nachladen der Alarme des offenen Postens entfernt →
 *      rot „ein Preisalarm im Merkposten wird entprellt gespeichert …“
 *   E  in loadWanted die Quelle ohne Suchtext gewählt → rot „die Liste folgt der
 *      Ablage, auch gefiltert“ (99999-1 erscheint unter „10294“)
 *   F  wantedState sieht die Quelle nicht an (gegenproben/merkliste-ohne-ablage.patch)
 *      → rot „Liste geladen“: Der Abruf schreibt nur in die Ablage.
 *   G  deleteWantedItem() löscht wieder sofort am Server
 *      (gegenproben/merkposten-loeschen-sofort.patch) → rot „ein geloeschter Merkposten …“
 *      („Noch kein DELETE“)
 *   H  deleteWantedItem() liest den Namen aus der rohen Liste statt aus der gezeigten
 *      (gegenproben/merkposten-name-ohne-ablage.patch) → rot „ein geloeschter Merkposten …“
 *      (Titanic erwartet, 10294-1 bekommen; nur in der CI messbar)
 *   merkliste-laedt-nicht-beim-zeigen  (gegenproben/) observeLoadOn der Liste gestrichen
 *      → rot „Liste und Detail laden, sobald jemand sie zeigt“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WantedViewModelTest {

    private val clock = TestCoroutineScheduler()
    private lateinit var paths: PfadServer
    private lateinit var t: TestDienste

    private fun vm(gemerkt: SavedStateHandle = SavedStateHandle(), t: TestDienste = this.t) = t.merke(MerklisteViewModel(t.sitzung, t.filter(), t.hinweise, t.merkliste(), t.alerts(), t.kontosicht,
        testCatalogRepository(t.api), testFinancesRepository(t.api), gemerkt))

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher(clock))
        paths = PfadServer(
            "/api/v1/wanted" to """{"success":true,"merkposten":[{"set_number":"10294-1","condition":"N","user_id":1}]}""",
            "/api/v1/wanted/10294-1/N/uebernehmen" to """{"success":true,"action":"added","set_number":"10294-1"}""",
            "/api/v1/alerts" to """{"success":true,"alerts":[{"set_number":"10294-1","condition":"N","direction":"unter","threshold":500.0}]}""",
            "/api/v1/sets/10294-1/alert" to """{"success":true,"alert":{"set_number":"10294-1","condition":"N","direction":"unter","threshold":450.0}}""",
        )
        t = TestDienste(paths.imTakt(), io = Dispatchers.Main)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `ein geloeschter Merkposten laesst sich zurueckholen, geloescht wird erst danach`() {
        paths.antworten["/api/v1/wanted"] = """{"success":true,"merkposten":[
            {"set_number":"10294-1","condition":"N","user_id":1,"name":"Titanic"},
            {"set_number":"10305-1","condition":"N","user_id":1,"name":"Lion Knights' Castle"}]}"""
        paths.antworten["/api/v1/wanted/10294-1/N"] = """{"success":true}"""
        val vm = vm()
        vm.loadWanted()
        assertEquals(2, vm.wantedState.value.merkposten.size)
        vm.deleteWantedItem("10294-1", Zustand.NEU, 1)
        assertTrue("aus der Liste", vm.wantedState.value.merkposten.none { it.setNumber == "10294-1" })
        assertEquals("Titanic", vm.vorgemerkt.value?.name)
        assertTrue("Noch kein DELETE", paths.requestsAn("DELETE /api/v1/wanted/10294-1").isEmpty())
        vm.wantedItemUndo()
        assertTrue("wieder da", vm.wantedState.value.merkposten.any { it.setNumber == "10294-1" })
        assertTrue("nach Rückgängig kein DELETE", paths.requestsAn("DELETE /api/v1/wanted/10294-1").isEmpty())
        vm.deleteWantedItem("10294-1", Zustand.NEU, 1)
        vm.executeWantedItemDelete()
        assertTrue("DELETE gesendet", paths.requestsAn("DELETE /api/v1/wanted/10294-1").isNotEmpty())
        assertEquals(null, vm.vorgemerkt.value)
    }

    @Test
    fun `Suche, Zustand und Sortierung ueberstehen einen Prozess-Tod und reisen mit`() {
        val gemerkt = SavedStateHandle()
        val erstes = vm(gemerkt)
        erstes.setWantedSearch("Titanic")
        erstes.setWantedState(Zustand.GEBRAUCHT)
        erstes.setWantedSorting(Merksortierung.PREIS_ABSTEIGEND)

        paths.newProcess(io = Dispatchers.Main) { paths, t ->
            paths.antworten["/api/v1/wanted"] = """{"success":true,"merkposten":[
                {"set_number":"10294-1","condition":"U","user_id":1,"name":"Titanic"},
                {"set_number":"10294-1","condition":"N","user_id":1,"name":"Titanic"}]}"""
            val neu = vm(gemerkt, t)
            val f = neu.wantedState.value
            assertEquals(Triple("Titanic", Zustand.GEBRAUCHT, Merksortierung.PREIS_ABSTEIGEND), Triple(f.query, f.stateFilter, f.sorting))
            neu.loadWanted()
            // Die Filter gelten der Ablage; der Abruf füllt sie ganz.
            assertEquals(listOf(Zustand.GEBRAUCHT), neu.wantedState.value.merkposten.map { it.condition })
            val anfrage = paths.requestsAn("GET /api/v1/wanted").single()
            assertTrue(anfrage, "search=" !in anfrage && "condition=" !in anfrage)
        }
    }

    @Test
    fun `die Suche wartet die Pause ab und filtert die Ablage mit dem letzten Text`() {
        paths.antworten["/api/v1/wanted"] = """{"success":true,"merkposten":[
            {"set_number":"10294-1","condition":"N","user_id":1,"name":"Titanic"},
            {"set_number":"21330-1","condition":"N","user_id":1,"name":"Tilt"}]}"""
        val vm = vm()
        vm.setWantedSearch("Ti")
        vm.setWantedSearch("Tita")
        clock.advanceTimeBy(300)
        assertEquals("Vor der Pause darf nichts hinausgehen", 0, paths.requestsAn("GET /api/v1/wanted").size)
        clock.advanceTimeBy(100)
        assertEquals(listOf("10294-1"), vm.wantedState.value.merkposten.map { it.setNumber })
        assertEquals(1, paths.requestsAn("GET /api/v1/wanted").size)
    }

    @Test
    fun `eine Uebernahme nimmt den Merkposten aus der Ablage und legt das Set dort an`() {
        val vm = vm()
        vm.loadWanted()
        assertTrue("Liste geladen", vm.wantedState.value.merkposten.isNotEmpty())
        vm.adoptWantedItem("10294-1", Zustand.NEU, besitzer = 1, purchasePriceRaw = "499,90")
        assertTrue("aus der Merkliste", vm.wantedState.value.merkposten.isEmpty())
        val galerie = runBlocking { t.sets().observeSets().first().liste }
        assertEquals("in der Galerie", listOf("10294-1"), galerie.map { it.setNumber })
        val takeover = paths.requestsAn("/uebernehmen").single()
        assertTrue(takeover, takeover.startsWith("POST"))
    }

    @Test
    fun `Liste und Detail laden, sobald jemand sie zeigt`() {
        val vm = vm()
        assertTrue("ohne Beobachter kein Abruf", paths.requestsAn("GET /api/v1/wanted").isEmpty())
        val liste = CoroutineScope(Dispatchers.Main).launch { vm.wantedState.collect {} }
        assertEquals(listOf("10294-1"), vm.wantedState.value.merkposten.map { it.setNumber })
        liste.cancel()
        val detail = vm.wantedItemDetailOf("10294-1")
        val seite = CoroutineScope(Dispatchers.Main).launch { detail.collect {} }
        assertEquals("10294-1", detail.value.setNumber)
        assertTrue("Alarme des Postens geholt", paths.requestsAn("GET /api/v1/alerts").isNotEmpty())
        seite.cancel()
    }

    @Test
    fun `ein Preisalarm im Merkposten wird entprellt gespeichert und neu geladen`() {
        val vm = vm()
        vm.loadWantedItemDetail("10294-1")
        assertTrue("Detail geladen", !vm.wantedItemDetailState.value.abruf.laedt)
        assertEquals(Geld.aus(500.0), vm.wantedItemDetailState.value.preisalarme.single().schwelle)
        val vorher = paths.requestsAn("GET /api/v1/alerts").size

        vm.setPriceAlert("10294-1", Alarmrichtung.UNTER, "4", Zustand.NEU)
        vm.setPriceAlert("10294-1", Alarmrichtung.UNTER, "450", Zustand.NEU)
        // Gespeichert führt der Server 450; der Zustand liest die Ablage nur beim Laden,
        // ohne Nachladen bliebe er bei 500.
        paths.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[{"set_number":"10294-1","condition":"N","direction":"unter","threshold":450.0}]}"""
        clock.advanceTimeBy(900)
        assertEquals("Nur die letzte Eingabe wird gespeichert", 1, paths.requestsAn("PUT /api/v1/sets/10294-1/alert").size)
        assertTrue("nachgeladen", paths.requestsAn("GET /api/v1/alerts").size > vorher)
        assertEquals("gespeichert und nachgeladen", Geld.aus(450.0), vm.wantedItemDetailState.value.preisalarme.single().schwelle)
        val abgelegt = runBlocking { t.alerts().observeAlerts("10294-1").first().liste }
        assertEquals("in der Ablage", listOf(Geld.aus(450.0)), abgelegt.map { it.schwelle })
    }

    @Test
    fun `die Liste folgt der Ablage, auch gefiltert`() {
        val ablage = t.ablage
        val vm = vm()
        vm.loadWanted()
        assertTrue("Liste geladen", vm.wantedState.value.merkposten.isNotEmpty())
        val fetches = paths.requestsAn("GET /api/v1/wanted").size

        runBlocking { ablage.applyAn(Editing.MerkpostenLoeschen("10294-1", Zustand.NEU, 1)) }
        assertTrue("offline gelöscht", vm.wantedState.value.merkposten.isEmpty())
        assertEquals("ohne neuen Abruf", fetches, paths.requestsAn("GET /api/v1/wanted").size)

        vm.setWantedSearch("10294")
        clock.advanceTimeBy(400)
        assertTrue("Suche geladen", vm.wantedState.value.merkposten.isNotEmpty())
        runBlocking { ablage.applyAn(Editing.MerkpostenAnlegen(Merkwunsch("99999-1", Zustand.NEU, 1))) }
        runBlocking { ablage.applyAn(Editing.MerkpostenAnlegen(Merkwunsch("10294-1", Zustand.GEBRAUCHT, 1))) }
        clock.advanceTimeBy(100)
        assertEquals("die Suche filtert auch offline Angelegtes", listOf("10294-1|U", "10294-1|N"),
            vm.wantedState.value.merkposten.map { "${it.setNumber}|${it.condition.kennung}" })
    }
}
