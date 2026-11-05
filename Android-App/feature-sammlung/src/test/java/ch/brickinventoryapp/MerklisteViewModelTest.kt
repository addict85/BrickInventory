package ch.brickinventoryapp

import kotlinx.coroutines.runBlocking
import ch.brickinventoryapp.data.model.MerkpostenRequest
import ch.brickinventoryapp.data.lokal.Offlineablage
import ch.brickinventoryapp.data.lokal.Bearbeitung
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.viewmodel.MerklisteViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Das Merklisten-ViewModel, ausgeführt gegen einen PfadServer ohne Netz. Die Wartezeiten
 * (Suchpause, Ruhezeit des Preisalarms) laufen auf der Testuhr.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen MerklisteViewModel.kt):
 *   A  in setzeMerklisteSuche() das Schreiben in den SavedStateHandle entfernt
 *      → rot „Suche, Zustand und Sortierung überstehen …“
 *   B  die Suchpause entfernt (sofort laden) → rot „die Suche fragt einmal,
 *      nach der Pause, mit dem letzten Text“
 *   C  in uebernimmMerkposten() nur Merkliste melden, nicht Sets → rot „eine
 *      Übernahme meldet Merkliste und Sets“
 *   D  im Preisalarm das Nachladen der Alarme des offenen Postens entfernt →
 *      rot „ein Preisalarm im Merkposten wird entprellt gespeichert …“
 *   E  (31.10.2026) im init-Sammler die Bedingung `ungefiltert(f)` entfernt →
 *      rot „mit Suchtext bleibt die Serverantwort stehen“
 *   F  (31.10.2026) den init-Sammler entfernt → rot „offline gelöscht“ (Zeitüberschreitung)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MerklisteViewModelTest {

    private val uhr = TestCoroutineScheduler()
    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    private fun vm(gemerkt: SavedStateHandle = SavedStateHandle(), t: TestDienste = this.t) = t.merke(MerklisteViewModel(
        t.sitzung, t.filter(), t.hinweise, t.bestand, SetsRepository(t.api, t.cache), KatalogRepository(t.api, t.cache),
        FinanzenRepository(t.api, t.cache), gemerkt))

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher(uhr))
        pfade = PfadServer(
            "/api/v1/wanted" to """{"success":true,"merkposten":[{"set_number":"10294-1","condition":"N","user_id":1}]}""",
            "/api/v1/wanted/10294-1/N/uebernehmen" to """{"success":true,"action":"added","set_number":"10294-1"}""",
            "/api/v1/sets/10294-1/alert" to """{"success":true,"alerts":[{"set_number":"10294-1","condition":"N","richtung":"unter","schwelle":500.0}]}""",
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
    fun `Suche, Zustand und Sortierung ueberstehen einen Prozess-Tod und reisen mit`() {
        val gemerkt = SavedStateHandle()
        val erstes = vm(gemerkt)
        erstes.setzeMerklisteSuche("Titanic")
        erstes.setzeMerklisteZustand("U")
        erstes.setzeMerklisteSortierung("price_desc")

        pfade.neuerProzess(io = Dispatchers.Main) { pfade, t ->
            val neu = vm(gemerkt, t)
            val f = neu.merklisteState.value
            assertEquals(Triple("Titanic", "U", "price_desc"), Triple(f.query, f.zustandFilter, f.sortierung))
            neu.ladeMerkliste()
            assertTrue("Liste geladen", neu.merklisteState.value.merkposten.isNotEmpty())
            val anfrage = pfade.anfragenAn("GET /api/v1/wanted").single()
            assertTrue(anfrage, "search=Titanic" in anfrage && "condition=U" in anfrage && "sort=price_desc" in anfrage)
        }
    }

    @Test
    fun `die Suche fragt einmal, nach der Pause, mit dem letzten Text`() {
        val vm = vm()
        vm.setzeMerklisteSuche("Ti")
        vm.setzeMerklisteSuche("Tita")
        uhr.advanceTimeBy(300)
        assertEquals("Vor der Pause darf nichts hinausgehen", 0, pfade.anfragenAn("GET /api/v1/wanted").size)
        uhr.advanceTimeBy(100)
        assertTrue("Liste geladen", vm.merklisteState.value.merkposten.isNotEmpty())
        val abrufe = pfade.anfragenAn("GET /api/v1/wanted")
        assertEquals(1, abrufe.size)
        assertTrue(abrufe.single(), "search=Tita" in abrufe.single() && "search=Ti&" !in abrufe.single())
    }

    @Test
    fun `eine Uebernahme meldet Merkliste und Sets und die Liste laedt neu`() {
        val vm = vm()
        val gemeldet = mutableListOf<Aenderung>()
        val sammler = kotlinx.coroutines.CoroutineScope(Dispatchers.Main).launch { t.bestand.aenderungen.toList(gemeldet) }
        vm.uebernimmMerkposten("10294-1", "N", besitzer = null, kaufpreisRoh = "499,90")
        assertTrue("Liste nachgeladen", vm.merklisteState.value.merkposten.isNotEmpty())
        sammler.cancel()
        assertEquals(listOf(Aenderung.Merkliste, Aenderung.Sets), gemeldet)
        val uebernahme = pfade.anfragenAn("/uebernehmen").single()
        assertTrue(uebernahme, uebernahme.startsWith("POST"))
    }

    @Test
    fun `ein Preisalarm im Merkposten wird entprellt gespeichert und neu geladen`() {
        val vm = vm()
        vm.ladeMerkpostenDetail("10294-1")
        assertTrue("Detail geladen", !vm.merkpostenDetailState.value.laedt)
        val vorher = pfade.anfragenAn("GET /api/v1/sets/10294-1/alert").size

        vm.setzePreisalarm("10294-1", "unter", "4", "N")
        vm.setzePreisalarm("10294-1", "unter", "450", "N")
        uhr.advanceTimeBy(900)
        assertTrue("gespeichert und nachgeladen", pfade.anfragenAn("GET /api/v1/sets/10294-1/alert").size > vorher)
        assertEquals("Nur die letzte Eingabe wird gespeichert", 1, pfade.anfragenAn("PUT /api/v1/sets/10294-1/alert").size)
        assertEquals(500.0, vm.merkpostenDetailState.value.preisalarme.single().schwelle, 0.0)
    }

    @Test
    fun `ohne Filter folgt die Liste der Ablage, mit Suchtext nicht`() {
        val ablage = Offlineablage.fluechtig()
        val vm = t.merke(MerklisteViewModel(t.sitzung, t.filter(), t.hinweise, t.bestand, SetsRepository(t.api, t.cache, ablage),
            KatalogRepository(t.api, t.cache), FinanzenRepository(t.api, t.cache), SavedStateHandle()))
        vm.ladeMerkliste()
        assertTrue("Liste geladen", vm.merklisteState.value.merkposten.isNotEmpty())
        val abrufe = pfade.anfragenAn("GET /api/v1/wanted").size

        runBlocking { ablage.wendeAn(Bearbeitung.MerkpostenLoeschen("10294-1", "N", 1)) }
        assertTrue("offline gelöscht", vm.merklisteState.value.merkposten.isEmpty())
        assertEquals("ohne neuen Abruf", abrufe, pfade.anfragenAn("GET /api/v1/wanted").size)

        vm.setzeMerklisteSuche("10294")
        uhr.advanceTimeBy(400)
        assertTrue("Suche geladen", vm.merklisteState.value.merkposten.isNotEmpty())
        runBlocking { ablage.wendeAn(Bearbeitung.MerkpostenAnlegen(MerkpostenRequest("99999-1", "N", 1))) }
        uhr.advanceTimeBy(100)
        assertEquals("mit Suchtext bleibt die Serverantwort stehen", listOf("10294-1"),
            vm.merklisteState.value.merkposten.map { it.setNumber })
    }
}
