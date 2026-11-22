package ch.brickinventoryapp.collection

import ch.brickinventoryapp.model.domain.Merkwunsch
import ch.brickinventoryapp.model.domain.Geld
import kotlinx.coroutines.launch
import kotlinx.coroutines.CoroutineScope
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Merksortierung
import ch.brickinventoryapp.model.domain.Zustand
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import ch.brickinventoryapp.offline.Editing
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.testing.testFinancesRepository
import ch.brickinventoryapp.testing.testCatalogRepository
import ch.brickinventoryapp.collection.ui.viewmodel.MerklisteViewModel
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
 * The wishlist ViewModel, run against a PfadServer without network. The waiting periods
 * (search pause, debounce of the price alert) run on the test clock.
 *
 * Counter-checks (measured 28.10.2026, kotlinc against MerklisteViewModel.kt):
 *   A  in setWantedSearch() the writing to the SavedStateHandle removed
 *      → red “search, condition and sorting survive …”
 *   B  the search pause removed (load immediately) → red “the search waits out the pause
 *      and filters the store with the last text”
 *   C  in LocalApplication.sets the branch WantedItemAdopted removed → red
 *      “a takeover removes the wishlist item from the store and creates the set there”
 *   D  in the price alert the reload of the open item's alerts removed →
 *      red “a price alert on a wishlist item is saved debounced …”
 *   E  in loadWanted the source chosen without the search text → red “the list follows
 *      the store, filtered too” (99999-1 appears under „10294“)
 *   F  wantedState does not look at the source (gegenproben/merkliste-ohne-ablage.patch)
 *      → red “list loaded”: the fetch only writes into the store.
 *   G  deleteWantedItem() deletes immediately on the server again
 *      (gegenproben/merkposten-loeschen-sofort.patch) → red “a deleted wishlist item …”
 *      (“no DELETE yet”)
 *   H  deleteWantedItem() reads the name from the raw list instead of the shown one
 *      (gegenproben/merkposten-name-ohne-ablage.patch) → red “a deleted wishlist item …”
 *      (Titanic expected, 10294-1 received; measurable only in the CI)
 *   merkliste-laedt-nicht-beim-zeigen  (gegenproben/) observeLoadOn of the list removed
 *      → red “list and detail load as soon as someone shows them”
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
    fun `a deleted wishlist item can be restored, deleting happens only afterwards`() {
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
    fun `search, condition and sorting survive a process death and travel along`() {
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
            // The filters apply to the store; the fetch fills it completely.
            assertEquals(listOf(Zustand.GEBRAUCHT), neu.wantedState.value.merkposten.map { it.condition })
            val anfrage = paths.requestsAn("GET /api/v1/wanted").single()
            assertTrue(anfrage, "search=" !in anfrage && "condition=" !in anfrage)
        }
    }

    @Test
    fun `the search waits for the pause and filters the store with the last text`() {
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
    fun `a takeover removes the wishlist item from the store and creates the set there`() {
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
    fun `list and detail load as soon as someone shows them`() {
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
    fun `a price alert in the wishlist item is saved debounced and reloaded`() {
        val vm = vm()
        vm.loadWantedItemDetail("10294-1")
        assertTrue("Detail geladen", !vm.wantedItemDetailState.value.abruf.laedt)
        assertEquals(Geld.aus(500.0), vm.wantedItemDetailState.value.preisalarme.single().schwelle)
        val vorher = paths.requestsAn("GET /api/v1/alerts").size

        vm.setPriceAlert("10294-1", Alarmrichtung.UNTER, "4", Zustand.NEU)
        vm.setPriceAlert("10294-1", Alarmrichtung.UNTER, "450", Zustand.NEU)
        // Saved, the server holds 450; the state reads the store only when loading,
        // without a reload it would stay at 500.
        paths.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[{"set_number":"10294-1","condition":"N","direction":"unter","threshold":450.0}]}"""
        clock.advanceTimeBy(900)
        assertEquals("Nur die letzte Eingabe wird gespeichert", 1, paths.requestsAn("PUT /api/v1/sets/10294-1/alert").size)
        assertTrue("nachgeladen", paths.requestsAn("GET /api/v1/alerts").size > vorher)
        assertEquals("gespeichert und nachgeladen", Geld.aus(450.0), vm.wantedItemDetailState.value.preisalarme.single().schwelle)
        val abgelegt = runBlocking { t.alerts().observeAlerts("10294-1").first().liste }
        assertEquals("in der Ablage", listOf(Geld.aus(450.0)), abgelegt.map { it.schwelle })
    }

    @Test
    fun `the list follows the store, also filtered`() {
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
