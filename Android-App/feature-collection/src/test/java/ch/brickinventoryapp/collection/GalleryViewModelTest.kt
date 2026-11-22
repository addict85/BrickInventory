package ch.brickinventoryapp.collection

import ch.brickinventoryapp.model.domain.Teilerfassung
import ch.brickinventoryapp.model.domain.Setzusammenfassung
import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.offline.Offlineablage.FollowUp
import ch.brickinventoryapp.model.domain.Setsortierung
import ch.brickinventoryapp.model.domain.Zustand
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
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste

/**
 * The gallery ViewModel, run against a PfadServer without network.
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
 *   F  vergissScroll on "parts" instead of "gallery" → red “a filter change
 *      forgets the scroll position of the gallery and only that one”
 *   G  tilePrices() without kachel_preis/kachel_pnl_pct → red “the
 *      key figures bring price and P&L …” (800.0 instead of 812.5)
 *   G  in loadStats() loadPrices() removed → red “the key figures bring
 *      price and P&L …”
 *   H  in loeschenVormerken() deleteSet() called immediately →
 *      red “pending deletion …” and “undo …” (DELETE already sent)
 *   I  in galleryState the filtering out of the pending set removed → red
 *      “pending deletion removes the tile right away …”
 *   J in galleryState the key figures not adjusted
 *      (gegenproben/galerie-kennzahlen-beim-loeschen.patch) → red “the key figures
 *      do not count the pending set …” (2 instead of 1 set)
 *   K  in executeDelete() the check for [nur] removed
 *      (gegenproben/galerie-abgeloestes-loeschen.patch) → red “the snackbar of a
 *      superseded deletion does not carry out the next one” (DELETE for 75192-1)
 *   L  in loadIfEmpty() the check for an empty list removed → red “on
 *      show the gallery only loads if it is empty” (two fetches)
 *   galerie-laedt-nicht-beim-zeigen  (gegenproben/) loadPerServer of the gallery removed → red
 *      “whoever shows the gallery triggers the loading …”
 *   K, L and the last only measurable in the CI (Android classes in the test run).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GalleryViewModelTest {

    private val clock = TestCoroutineScheduler()
    private lateinit var paths: PfadServer
    private lateinit var t: TestDienste

    private fun vm(gemerkt: SavedStateHandle = SavedStateHandle(), t: TestDienste = this.t) = t.merke(GalleryViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, t.scrollMemory, t.sets(),
        t.kontosicht, testFinancesRepository(t.api), gemerkt))

    private fun fetches(paths: PfadServer = this.paths) =
        paths.requestsAn("GET /api/v1/sets?") + paths.requestsAn("GET /api/v1/sets ")

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher(clock))
        paths = PfadServer(
            "/api/v1/sets" to """{"success":true,"total":2,"sets":[
                {"set_number":"75192-1","name":"Falke","used_count":0},{"set_number":"10294-1","name":"Titanic"}]}""",
            "/api/v1/stats" to """{"success":true,"stats":{"total_sets":2,"total_quantity":2,"total_pieces":0,"total_instructions":0,"total_parts":0,"total_minifigs":0}}""",
            "/api/v1/finance/pnl" to """{"success":true,"currency":"CHF","totals":{"purchase":"0.00","current":"0.00"},"sets":[
                {"set_number":"75192-1","quantity":1,"current_price":800,"baseline_price":700,"pnl_pct":"14.3","baseline_pnl_pct":"14.3",
                 "kachel_preis":812.5,"kachel_pnl_pct":16.1}]}""",
            "/api/v1/sets/10294-1" to """{"success":true}""",
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
    fun `the key figures bring price and P&L for the tiles along`() {
        val vm = vm()
        vm.loadStats()
        assertTrue("Preise da", vm.preise.value.containsKey("75192-1"))
        assertEquals(Geld.aus(812.5), vm.preise.value["75192-1"]?.betrag)
        assertEquals(16.1, vm.preise.value["75192-1"]?.pnlPct ?: -1.0, 1e-9)
    }

    @Test
    fun `search, theme and sorting survive a process death and travel along`() {
        val gemerkt = SavedStateHandle()
        val erstes = vm(gemerkt)
        erstes.setGalleryTheme("Technic")
        erstes.setGallerySort(Setsortierung.JAHR)
        erstes.setGalleryQuery("Falke")

        paths.newProcess(io = Dispatchers.Main) { paths, t ->
            val neu = vm(gemerkt, t)
            val g = neu.galleryState.value
            assertEquals(Triple("Falke", "Technic", Setsortierung.JAHR), Triple(g.galleryQuery, g.galleryTheme, g.gallerySort))
            // The filters apply to the store; the fetch fills it completely, without filters.
            neu.loadSets()
            val abruf = fetches(paths).single()
            assertTrue(abruf, "search=" !in abruf && "theme=" !in abruf && "sort=" !in abruf)
        }
    }

    @Test
    fun `account and storage filters of the gallery travel along and load list and key figures`() {
        val vm = vm()
        vm.setScope(ScopeFilter.View.GALLERY, "own")
        assertTrue("Liste und Kennzahlen", vm.galleryState.value.sets.isNotEmpty() && vm.galleryState.value.stats != null)
        assertTrue("accounts=own" in fetches().last())
        assertTrue("accounts=own" in paths.requestsAn("GET /api/v1/stats").last())

        vm.setStorageFilter(ScopeFilter.View.GALLERY, "Regal")
        assertTrue("neu geladen", fetches().size >= 2)
        assertTrue(fetches().last(), "storage=Regal" in fetches().last())
    }

    @Test
    fun `a deleted set disappears from the store, and the key figures come anew`() {
        val vm = vm()
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.size == 2)
        val liste = fetches().size
        val zahlen = paths.requestsAn("GET /api/v1/stats").size
        vm.deleteSet("10294-1")
        assertTrue(paths.requestsAn("DELETE /api/v1/sets/10294-1").isNotEmpty())
        assertTrue("Liste ohne das Set", vm.galleryState.value.sets.none { it.setNumber == "10294-1" })
        assertEquals("die Liste kommt aus der Ablage, nicht neu vom Server", liste, fetches().size)
        assertTrue("Kennzahlen neu", paths.requestsAn("GET /api/v1/stats").size > zahlen)
    }

    @Test
    fun `pending deletion removes the tile immediately and asks the server only afterwards`() {
        val vm = vm()
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.size == 2)
        vm.loeschenVormerken("10294-1", "Titanic")
        assertTrue(vm.galleryState.value.sets.none { it.setNumber == "10294-1" })
        assertEquals("Titanic", vm.vorgemerkt.value?.name)
        assertTrue("Noch kein DELETE", paths.requestsAn("DELETE /api/v1/sets/10294-1").isEmpty())
        vm.executeDelete()
        assertTrue("DELETE gesendet", paths.requestsAn("DELETE /api/v1/sets/10294-1").isNotEmpty())
        assertEquals(null, vm.vorgemerkt.value)
    }

    @Test
    fun `the key figures do not count the pending set and count it again after undo`() {
        paths.antworten["/api/v1/sets"] = """{"success":true,"total":2,"sets":[
            {"set_number":"75192-1","name":"Falke","pieces":7541,"minifigs":7,"quantity":1},
            {"set_number":"10294-1","name":"Titanic","pieces":9090,"minifigs":0,"quantity":2}]}"""
        paths.antworten["/api/v1/stats"] = """{"success":true,"stats":{"total_sets":2,"total_quantity":3,"total_pieces":25721,
            "total_instructions":0,"total_parts":25721,"total_minifigs":7}}"""
        val vm = vm()
        vm.loadSets(); vm.loadStats()
        assertEquals(2, vm.galleryState.value.stats?.totalSets)
        vm.loeschenVormerken("10294-1", "Titanic")
        val k = vm.galleryState.value.stats
        assertEquals("Sets", 1, k?.totalSets)
        assertEquals("Exemplare", 1, k?.totalQuantity)
        assertEquals("Teile", 7541, k?.totalParts)
        assertEquals("Figuren", 7, k?.totalMinifigs)
        vm.rueckgaengig()
        assertEquals("nach Rückgängig wieder vollständig", 2, vm.galleryState.value.stats?.totalSets)
        assertEquals(3, vm.galleryState.value.stats?.totalQuantity)
    }

    @Test
    fun `undo brings the set back without ever deleting it`() {
        val vm = vm()
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.size == 2)
        vm.loeschenVormerken("10294-1", "Titanic")
        vm.rueckgaengig()
        assertTrue("Set wieder da", vm.galleryState.value.sets.any { it.setNumber == "10294-1" })
        assertTrue("Kein DELETE", paths.requestsAn("DELETE /api/v1/sets/10294-1").isEmpty())
        vm.executeDelete()
        assertTrue("Nach Rückgängig gibt es nichts mehr auszuführen", paths.requestsAn("DELETE /api/v1/sets/10294-1").isEmpty())
    }

    @Test
    fun `the snackbar of a superseded deletion does not execute the next one`() {
        val vm = vm()
        vm.loadSets()
        vm.loeschenVormerken("10294-1", "Titanic")
        val erstes = vm.vorgemerkt.value
        // A second deletion carries out the first and marks the second as pending.
        vm.loeschenVormerken("75192-1", "Falke")
        assertTrue("erstes gelöscht", paths.requestsAn("DELETE /api/v1/sets/10294-1").isNotEmpty())
        val zweites = vm.vorgemerkt.value
        // The first one's snackbar only ends now (superseded) — it must not touch the second.
        vm.executeDelete(erstes)
        vm.rueckgaengig(erstes)
        assertEquals("Falke", vm.vorgemerkt.value?.name)
        assertTrue("zweites noch nicht gelöscht", paths.requestsAn("DELETE /api/v1/sets/75192-1").isEmpty())
        vm.rueckgaengig(zweites)
        assertEquals(null, vm.vorgemerkt.value)
        assertTrue("zweites nie gelöscht", paths.requestsAn("DELETE /api/v1/sets/75192-1").isEmpty())
    }

    @Test
    fun `whoever shows the gallery triggers loading, once per server`() {
        val vm = vm()
        t.sitzung.anmeldungGeaendert(paths.server.url("/").toString(), angemeldet = true)
        assertTrue("ohne Beobachter kein Abruf", fetches().isEmpty())
        val seite = CoroutineScope(Dispatchers.Main).launch { vm.galleryState.collect {} }
        assertEquals("beim Zeigen geladen", 1, fetches().size)
        seite.cancel()
        CoroutineScope(Dispatchers.Main).launch { vm.galleryState.collect {} }.cancel()
        assertEquals("schon da: beim Wiederkommen nicht noch einmal", 1, fetches().size)
    }

    @Test
    fun `when shown the gallery loads only if it is empty`() {
        val vm = vm()
        vm.loadIfEmpty()
        assertTrue("ohne Server kein Abruf", fetches().isEmpty())
        t.sitzung.anmeldungGeaendert(paths.server.url("/").toString(), angemeldet = true)
        vm.loadIfEmpty()
        assertEquals("leer: einmal geladen", 1, fetches().size)
        assertTrue("Kennzahlen mit", paths.requestsAn("GET /api/v1/stats").isNotEmpty())
        vm.loadIfEmpty()
        assertEquals("schon da: nicht noch einmal", 1, fetches().size)
    }

    @Test
    fun `a changed purchase changes the tile without fetching the list again`() {
        val vm = vm()
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.size == 2)
        val vorher = fetches().size
        // Counted from here: the first load already fetches the key figures itself.
        val numbersBefore = paths.requestsAn("GET /api/v1/stats").size

        // This is how HouseholdRepository writes the server's answer into the store.
        runBlocking { t.ablage.applyAn(FollowUp.SetSummary(Setzusammenfassung(setNumber = "75192-1", zustand = Zustand.GEBRAUCHT, states = listOf(Zustand.GEBRAUCHT), gebraucht = 1,
            highestPurchasePrice = null, purchasePriceCut = null))) }
        assertTrue("Kennzahlen neu", paths.requestsAn("GET /api/v1/stats").size > numbersBefore)
        assertTrue("Kachel geändert", vm.galleryState.value.sets.first { it.setNumber == "75192-1" }.usedCount == 1)
        assertEquals("Die Liste darf nicht neu geholt werden", vorher, fetches().size)
    }

    @Test
    fun `an added part loads the key figures, not the set list`() {
        // The gallery shows the part and minifigure count from the key figures; without
        // a reload it would stay unchanged after adding a part.
        val vm = vm()
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.size == 2)
        val listBefore = fetches().size
        val numbersBefore = paths.requestsAn("GET /api/v1/stats").size

        // This is how PartsRepository applies an added part in the store.
        runBlocking { t.ablage.applyAn(Editing.TeilErfassen(Teilerfassung(nummer = "3001", farbId = 5, menge = 2))) }
        assertEquals("Kennzahlen nach Teilen", numbersBefore + 1, paths.requestsAn("GET /api/v1/stats").size)
        assertEquals("Ein Teil ändert die Set-Liste nicht", listBefore, fetches().size)
    }

    @Test
    fun `a filter change forgets the scroll position of the gallery and only that`() {
        // The remembered position otherwise pointed at sets that stand
        // elsewhere or not at all in the new list.
        t.scrollMemory.merke("gallery", 40, 3)
        t.scrollMemory.merke("parts", 7, 0)
        val vm = vm()
        vm.setGalleryTheme("Technic")
        assertEquals(0 to 0, t.scrollMemory.lies("gallery"))
        assertEquals(7 to 0, t.scrollMemory.lies("parts"))
    }

    @Test
    fun `after sign-out the gallery is empty and without filters`() {
        val gemerkt = SavedStateHandle()
        val vm = vm(gemerkt)
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.isNotEmpty())
        vm.setGalleryTheme("Technic")
        t.sitzung.abgemeldet()
        assertTrue(vm.galleryState.value.sets.isEmpty())
        assertEquals("", vm.galleryState.value.galleryTheme)
        assertEquals("", vm(gemerkt).galleryState.value.galleryTheme)
    }
}
