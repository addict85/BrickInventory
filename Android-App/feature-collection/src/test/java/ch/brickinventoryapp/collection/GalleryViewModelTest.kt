package ch.brickinventoryapp.collection

import ch.brickinventoryapp.model.domain.PartEntry
import ch.brickinventoryapp.model.domain.SetTotals
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.offline.OfflineStore.FollowUp
import ch.brickinventoryapp.model.domain.SetSort
import ch.brickinventoryapp.model.domain.Condition
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.testing.testFinancesRepository
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.collection.ui.viewmodel.GalleryViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import ch.brickinventoryapp.testing.PathServer
import ch.brickinventoryapp.testing.TestServices

/**
 * The gallery ViewModel, run against a PathServer without network.
 *
 * Counter-checks (measured 28.10.2026, kotlinc against GalleryViewModel.kt):
 *   A  in init the remembered search not taken over → red “search, theme and
 *      sorting survive …”
 *   B  in afterFilter() the condition reversed → red “account and storage filters
 *      of the gallery travel along …”
 *   C  in SetsRepositoryImpl.deleteSet the follow-up `SetRemoved` left out → red
 *      “a deleted set disappears from the store …” (tile remains)
 *   D  in LocalApplication.sets the branch SetSummary removed → red “a
 *      changed purchase changes the tile, without fetching the list anew”
 *   E  in the init of GalleryViewModel the collecting of `changes.inventoryChanged()` removed
 *      → red “an added part loads the key figures …” and “a deleted set …”
 *   F  forgetScroll on "parts" instead of "gallery" → red “a filter change
 *      forgets the scroll position of the gallery and only that one”
 *   G  tilePrices() without kachel_preis/kachel_pnl_pct → red “the
 *      key figures bring price and P&L …” (800.0 instead of 812.5)
 *   G  in loadStats() loadPrices() removed → red “the key figures bring
 *      price and P&L …”
 *   H  in markForDeletion() deleteSet() called immediately →
 *      red “pending deletion …” and “undo …” (DELETE already sent)
 *   I  in galleryState the filtering out of the pending set removed → red
 *      “pending deletion removes the tile right away …”
 *   J in galleryState the key figures not adjusted
 *      (counter-checks/galerie-kennzahlen-beim-loeschen.patch) → red “the key figures
 *      do not count the pending set …” (2 instead of 1 set)
 *   K  in executeDelete() the check for [only] removed
 *      (counter-checks/galerie-abgeloestes-loeschen.patch) → red “the snackbar of a
 *      superseded deletion does not carry out the next one” (DELETE for 75192-1)
 *   L  in loadIfEmpty() the check for an empty list removed → red “on
 *      show the gallery only loads if it is empty” (two fetches)
 *   galerie-laedt-nicht-beim-zeigen  (counter-checks/) loadPerServer of the gallery removed → red
 *      “whoever shows the gallery triggers the loading …”
 *   K, L and the last only measurable in the CI (Android classes in the test run).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GalleryViewModelTest {

    private val clock = TestCoroutineScheduler()
    private lateinit var paths: PathServer
    private lateinit var t: TestServices

    private fun vm(wanted: SavedStateHandle = SavedStateHandle(), t: TestServices = this.t) = t.track(GalleryViewModel(t.session, t.filter(), t.hints, t.changes, t.scrollMemory, t.sets(),
        t.accountView, testFinancesRepository(t.api), wanted))

    private fun fetches(paths: PathServer = this.paths) =
        paths.requestsTo("GET /api/v1/sets?") + paths.requestsTo("GET /api/v1/sets ")

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher(clock))
        paths = PathServer(
            "/api/v1/sets" to """{"success":true,"total":2,"sets":[
                {"set_number":"75192-1","name":"Falke","used_count":0},{"set_number":"10294-1","name":"Titanic"}]}""",
            "/api/v1/stats" to """{"success":true,"stats":{"total_sets":2,"total_quantity":2,"total_pieces":0,"total_instructions":0,"total_parts":0,"total_minifigs":0}}""",
            "/api/v1/finance/pnl" to """{"success":true,"currency":"CHF","totals":{"purchase":"0.00","current":"0.00"},"sets":[
                {"set_number":"75192-1","quantity":1,"current_price":800,"baseline_price":700,"pnl_pct":"14.3","baseline_pnl_pct":"14.3",
                 "kachel_preis":812.5,"kachel_pnl_pct":16.1}]}""",
            "/api/v1/sets/10294-1" to """{"success":true}""",
        )
        t = TestServices(paths.onTick(), io = Dispatchers.Main)
    }

    @After
    fun tearDown() {
        t.cleanUp()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `the key figures bring price and P&L for the tiles along`() {
        val vm = vm()
        vm.loadStats()
        assertTrue("Preise da", vm.prices.value.containsKey("75192-1"))
        assertEquals(Money.from(812.5), vm.prices.value["75192-1"]?.amount)
        assertEquals(16.1, vm.prices.value["75192-1"]?.pnlPct ?: -1.0, 1e-9)
    }

    @Test
    fun `search, theme and sorting survive a process death and travel along`() {
        val wanted = SavedStateHandle()
        val first = vm(wanted)
        first.setGalleryTheme("Technic")
        first.setGallerySort(SetSort.YEAR)
        first.setGalleryQuery("Falke")

        paths.newProcess(io = Dispatchers.Main) { paths, t ->
            val newValue = vm(wanted, t)
            val g = newValue.galleryState.value
            assertEquals(Triple("Falke", "Technic", SetSort.YEAR), Triple(g.galleryQuery, g.galleryTheme, g.gallerySort))
            // The filters apply to the store; the fetch fills it completely, without filters.
            newValue.loadSets()
            val fetch = fetches(paths).single()
            assertTrue(fetch, "search=" !in fetch && "theme=" !in fetch && "sort=" !in fetch)
        }
    }

    @Test
    fun `account and storage filters of the gallery travel along and load list and key figures`() {
        val vm = vm()
        vm.setScope(ScopeFilter.View.GALLERY, "own")
        assertTrue("Liste und Kennzahlen", vm.galleryState.value.sets.isNotEmpty() && vm.galleryState.value.stats != null)
        assertTrue("accounts=own" in fetches().last())
        assertTrue("accounts=own" in paths.requestsTo("GET /api/v1/stats").last())

        vm.setStorageFilter(ScopeFilter.View.GALLERY, "Regal")
        assertTrue("neu geladen", fetches().size >= 2)
        assertTrue(fetches().last(), "storage=Regal" in fetches().last())
    }

    @Test
    fun `a deleted set disappears from the store, and the key figures come anew`() {
        val vm = vm()
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.size == 2)
        val list = fetches().size
        val numbers = paths.requestsTo("GET /api/v1/stats").size
        vm.deleteSet("10294-1")
        assertTrue(paths.requestsTo("DELETE /api/v1/sets/10294-1").isNotEmpty())
        assertTrue("Liste ohne das Set", vm.galleryState.value.sets.none { it.setNumber == "10294-1" })
        assertEquals("die Liste kommt aus der Ablage, nicht neu vom Server", list, fetches().size)
        assertTrue("Kennzahlen neu", paths.requestsTo("GET /api/v1/stats").size > numbers)
    }

    @Test
    fun `pending deletion removes the tile immediately and asks the server only afterwards`() {
        val vm = vm()
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.size == 2)
        vm.markForDeletion("10294-1", "Titanic")
        assertTrue(vm.galleryState.value.sets.none { it.setNumber == "10294-1" })
        assertEquals("Titanic", vm.marked.value?.name)
        assertTrue("Noch kein DELETE", paths.requestsTo("DELETE /api/v1/sets/10294-1").isEmpty())
        vm.executeDelete()
        assertTrue("DELETE gesendet", paths.requestsTo("DELETE /api/v1/sets/10294-1").isNotEmpty())
        assertEquals(null, vm.marked.value)
    }

    @Test
    fun `the key figures do not count the pending set and count it again after undo`() {
        paths.responses["/api/v1/sets"] = """{"success":true,"total":2,"sets":[
            {"set_number":"75192-1","name":"Falke","pieces":7541,"minifigs":7,"quantity":1},
            {"set_number":"10294-1","name":"Titanic","pieces":9090,"minifigs":0,"quantity":2}]}"""
        paths.responses["/api/v1/stats"] = """{"success":true,"stats":{"total_sets":2,"total_quantity":3,"total_pieces":25721,
            "total_instructions":0,"total_parts":25721,"total_minifigs":7}}"""
        val vm = vm()
        vm.loadSets(); vm.loadStats()
        assertEquals(2, vm.galleryState.value.stats?.totalSets)
        vm.markForDeletion("10294-1", "Titanic")
        val k = vm.galleryState.value.stats
        assertEquals("Sets", 1, k?.totalSets)
        assertEquals("Exemplare", 1, k?.totalQuantity)
        assertEquals("Teile", 7541, k?.totalParts)
        assertEquals("Figuren", 7, k?.totalMinifigs)
        vm.undo()
        assertEquals("nach Rückgängig wieder vollständig", 2, vm.galleryState.value.stats?.totalSets)
        assertEquals(3, vm.galleryState.value.stats?.totalQuantity)
    }

    @Test
    fun `undo brings the set back without ever deleting it`() {
        val vm = vm()
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.size == 2)
        vm.markForDeletion("10294-1", "Titanic")
        vm.undo()
        assertTrue("Set wieder da", vm.galleryState.value.sets.any { it.setNumber == "10294-1" })
        assertTrue("Kein DELETE", paths.requestsTo("DELETE /api/v1/sets/10294-1").isEmpty())
        vm.executeDelete()
        assertTrue("Nach Rückgängig gibt es nichts mehr auszuführen", paths.requestsTo("DELETE /api/v1/sets/10294-1").isEmpty())
    }

    @Test
    fun `the snackbar of a superseded deletion does not execute the next one`() {
        val vm = vm()
        vm.loadSets()
        vm.markForDeletion("10294-1", "Titanic")
        val first = vm.marked.value
        // A second deletion carries out the first and marks the second as pending.
        vm.markForDeletion("75192-1", "Falke")
        assertTrue("erstes gelöscht", paths.requestsTo("DELETE /api/v1/sets/10294-1").isNotEmpty())
        val second = vm.marked.value
        // The first one's snackbar only ends now (superseded) — it must not touch the second.
        vm.executeDelete(first)
        vm.undo(first)
        assertEquals("Falke", vm.marked.value?.name)
        assertTrue("zweites noch nicht gelöscht", paths.requestsTo("DELETE /api/v1/sets/75192-1").isEmpty())
        vm.undo(second)
        assertEquals(null, vm.marked.value)
        assertTrue("zweites nie gelöscht", paths.requestsTo("DELETE /api/v1/sets/75192-1").isEmpty())
    }

    @Test
    fun `whoever shows the gallery triggers loading, once per server`() {
        val vm = vm()
        t.session.loginChanged(paths.server.url("/").toString(), loggedIn = true)
        assertTrue("ohne Beobachter kein Abruf", fetches().isEmpty())
        val page = CoroutineScope(Dispatchers.Main).launch { vm.galleryState.collect {} }
        assertEquals("beim Zeigen geladen", 1, fetches().size)
        page.cancel()
        CoroutineScope(Dispatchers.Main).launch { vm.galleryState.collect {} }.cancel()
        assertEquals("schon da: beim Wiederkommen nicht noch einmal", 1, fetches().size)
    }

    @Test
    fun `when shown the gallery loads only if it is empty`() {
        val vm = vm()
        vm.loadIfEmpty()
        assertTrue("ohne Server kein Abruf", fetches().isEmpty())
        t.session.loginChanged(paths.server.url("/").toString(), loggedIn = true)
        vm.loadIfEmpty()
        assertEquals("leer: einmal geladen", 1, fetches().size)
        assertTrue("Kennzahlen mit", paths.requestsTo("GET /api/v1/stats").isNotEmpty())
        vm.loadIfEmpty()
        assertEquals("schon da: nicht noch einmal", 1, fetches().size)
    }

    @Test
    fun `a changed purchase changes the tile without fetching the list again`() {
        val vm = vm()
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.size == 2)
        val before = fetches().size
        // Counted from here: the first load already fetches the key figures itself.
        val numbersBefore = paths.requestsTo("GET /api/v1/stats").size

        // This is how HouseholdRepository writes the server's answer into the store.
        runBlocking { t.store.applyChange(FollowUp.SetSummary(SetTotals(setNumber = "75192-1", condition = Condition.USED, states = listOf(Condition.USED), used = 1,
            highestPurchasePrice = null, purchasePriceCut = null))) }
        assertTrue("Kennzahlen neu", paths.requestsTo("GET /api/v1/stats").size > numbersBefore)
        assertTrue("Kachel geändert", vm.galleryState.value.sets.first { it.setNumber == "75192-1" }.usedCount == 1)
        assertEquals("Die Liste darf nicht neu geholt werden", before, fetches().size)
    }

    @Test
    fun `an added part loads the key figures, not the set list`() {
        // The gallery shows the part and minifigure count from the key figures; without
        // a reload it would stay unchanged after adding a part.
        val vm = vm()
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.size == 2)
        val listBefore = fetches().size
        val numbersBefore = paths.requestsTo("GET /api/v1/stats").size

        // This is how PartsRepository applies an added part in the store.
        runBlocking { t.store.applyChange(Editing.RecordPart(PartEntry(number = "3001", colorId = 5, quantity = 2))) }
        assertEquals("Kennzahlen nach Teilen", numbersBefore + 1, paths.requestsTo("GET /api/v1/stats").size)
        assertEquals("Ein Teil ändert die Set-Liste nicht", listBefore, fetches().size)
    }

    @Test
    fun `a filter change forgets the scroll position of the gallery and only that`() {
        // The remembered position otherwise pointed at sets that stand
        // elsewhere or not at all in the new list.
        t.scrollMemory.track("gallery", 40, 3)
        t.scrollMemory.track("parts", 7, 0)
        val vm = vm()
        vm.setGalleryTheme("Technic")
        assertEquals(0 to 0, t.scrollMemory.read("gallery"))
        assertEquals(7 to 0, t.scrollMemory.read("parts"))
    }

    @Test
    fun `after sign-out the gallery is empty and without filters`() {
        val wanted = SavedStateHandle()
        val vm = vm(wanted)
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.isNotEmpty())
        vm.setGalleryTheme("Technic")
        t.session.loggedOut()
        assertTrue(vm.galleryState.value.sets.isEmpty())
        assertEquals("", vm.galleryState.value.galleryTheme)
        assertEquals("", vm(wanted).galleryState.value.galleryTheme)
    }
}
