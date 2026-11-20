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
 * Das Galerie-ViewModel, ausgeführt gegen einen PfadServer ohne Netz.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen GalleryViewModel.kt):
 *   A  im init die gemerkte Suche nicht übernommen → rot „Suche, Thema und
 *      Sortierung überstehen …“
 *   B  in afterFilter() die Bedingung umgekehrt → rot „Konto- und Lagerfilter
 *      der Galerie reisen mit …“
 *   C  in SetsRepositoryImpl.deleteSet den Nachzug `SetRemoved` weggelassen → rot
 *      „ein gelöschtes Set verschwindet aus der Ablage …“ (Kachel bleibt)
 *   D  in LocalApplication.sets den Zweig SetSummary entfernt → rot „ein
 *      geänderter Kauf ändert die Kachel, ohne die Liste neu zu holen“
 *   E  im init von GalleryViewModel das Sammeln von `changes.inventoryChanged()` entfernt
 *      → rot „ein erfasstes Teil lädt die Kennzahlen …“ und „ein gelöschtes Set …“
 *   F  vergissScroll auf "parts" statt "gallery" → rot „ein Filterwechsel
 *      vergisst die Rollposition der Galerie und nur sie“
 *   G  tilePrices() ohne kachel_preis/kachel_pnl_pct → rot „die
 *      Kennzahlen bringen Preis und G&V …“ (800,0 statt 812,5)
 *   G  in loadStats() loadPrices() entfernt → rot „die Kennzahlen bringen
 *      Preis und G&V …“
 *   H  in loeschenVormerken() sofort deleteSet() aufgerufen →
 *      rot „vorgemerktes Loeschen …“ und „Rueckgaengig …“ (DELETE schon gesendet)
 *   I  in galleryState das Ausfiltern des vorgemerkten Sets entfernt → rot
 *      „vorgemerktes Loeschen nimmt die Kachel sofort weg …“
 *   J in galleryState die Kennzahlen nicht angepasst
 *      (gegenproben/galerie-kennzahlen-beim-loeschen.patch) → rot „die Kennzahlen
 *      zaehlen das vorgemerkte Set nicht …“ (2 statt 1 Set)
 *   K  in executeDelete() die Prüfung auf [nur] entfernt
 *      (gegenproben/galerie-abgeloestes-loeschen.patch) → rot „die Snackbar eines
 *      abgeloesten Loeschens fuehrt das naechste nicht aus“ (DELETE für 75192-1)
 *   L  in loadIfEmpty() die Prüfung auf eine leere Liste entfernt → rot „beim
 *      Zeigen laedt die Galerie nur, wenn sie leer ist“ (zwei Abrufe)
 *   galerie-laedt-nicht-beim-zeigen  (gegenproben/) loadPerServer der Galerie gestrichen → rot
 *      „wer die Galerie zeigt, stoesst das Laden an …“
 *   K, L und die letzte nur in der CI messbar (Android-Klassen im Testlauf).
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
    fun `die Kennzahlen bringen Preis und G&V fuer die Kacheln mit`() {
        val vm = vm()
        vm.loadStats()
        assertTrue("Preise da", vm.preise.value.containsKey("75192-1"))
        assertEquals(Geld.aus(812.5), vm.preise.value["75192-1"]?.betrag)
        assertEquals(16.1, vm.preise.value["75192-1"]?.pnlPct ?: -1.0, 1e-9)
    }

    @Test
    fun `Suche, Thema und Sortierung ueberstehen einen Prozess-Tod und reisen mit`() {
        val gemerkt = SavedStateHandle()
        val erstes = vm(gemerkt)
        erstes.setGalleryTheme("Technic")
        erstes.setGallerySort(Setsortierung.JAHR)
        erstes.setGalleryQuery("Falke")

        paths.newProcess(io = Dispatchers.Main) { paths, t ->
            val neu = vm(gemerkt, t)
            val g = neu.galleryState.value
            assertEquals(Triple("Falke", "Technic", Setsortierung.JAHR), Triple(g.galleryQuery, g.galleryTheme, g.gallerySort))
            // Die Filter gelten der Ablage; der Abruf füllt sie ganz, ohne Filter.
            neu.loadSets()
            val abruf = fetches(paths).single()
            assertTrue(abruf, "search=" !in abruf && "theme=" !in abruf && "sort=" !in abruf)
        }
    }

    @Test
    fun `Konto- und Lagerfilter der Galerie reisen mit und laden Liste und Kennzahlen`() {
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
    fun `ein geloeschtes Set verschwindet aus der Ablage, und die Kennzahlen kommen neu`() {
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
    fun `vorgemerktes Loeschen nimmt die Kachel sofort weg und fragt den Server erst danach`() {
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
    fun `die Kennzahlen zaehlen das vorgemerkte Set nicht und nach Rueckgaengig wieder`() {
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
    fun `Rueckgaengig holt das Set zurueck, ohne es je zu loeschen`() {
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
    fun `die Snackbar eines abgeloesten Loeschens fuehrt das naechste nicht aus`() {
        val vm = vm()
        vm.loadSets()
        vm.loeschenVormerken("10294-1", "Titanic")
        val erstes = vm.vorgemerkt.value
        // Ein zweites Löschen führt das erste aus und merkt sich das zweite vor.
        vm.loeschenVormerken("75192-1", "Falke")
        assertTrue("erstes gelöscht", paths.requestsAn("DELETE /api/v1/sets/10294-1").isNotEmpty())
        val zweites = vm.vorgemerkt.value
        // Die Snackbar des ersten endet erst jetzt (abgelöst) — sie darf das zweite nicht anfassen.
        vm.executeDelete(erstes)
        vm.rueckgaengig(erstes)
        assertEquals("Falke", vm.vorgemerkt.value?.name)
        assertTrue("zweites noch nicht gelöscht", paths.requestsAn("DELETE /api/v1/sets/75192-1").isEmpty())
        vm.rueckgaengig(zweites)
        assertEquals(null, vm.vorgemerkt.value)
        assertTrue("zweites nie gelöscht", paths.requestsAn("DELETE /api/v1/sets/75192-1").isEmpty())
    }

    @Test
    fun `wer die Galerie zeigt, stoesst das Laden an, je Server einmal`() {
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
    fun `beim Zeigen laedt die Galerie nur, wenn sie leer ist`() {
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
    fun `ein geaenderter Kauf aendert die Kachel, ohne die Liste neu zu holen`() {
        val vm = vm()
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.size == 2)
        val vorher = fetches().size
        // Gezählt ab hier: Die erste Ladung holt die Kennzahlen schon selbst.
        val numbersBefore = paths.requestsAn("GET /api/v1/stats").size

        // So schreibt HouseholdRepository die Antwort des Servers in die Ablage.
        runBlocking { t.ablage.applyAn(FollowUp.SetSummary(Setzusammenfassung(setNumber = "75192-1", zustand = Zustand.GEBRAUCHT, states = listOf(Zustand.GEBRAUCHT), gebraucht = 1,
            highestPurchasePrice = null, purchasePriceCut = null))) }
        assertTrue("Kennzahlen neu", paths.requestsAn("GET /api/v1/stats").size > numbersBefore)
        assertTrue("Kachel geändert", vm.galleryState.value.sets.first { it.setNumber == "75192-1" }.usedCount == 1)
        assertEquals("Die Liste darf nicht neu geholt werden", vorher, fetches().size)
    }

    @Test
    fun `ein erfasstes Teil laedt die Kennzahlen, nicht die Set-Liste`() {
        // Die Galerie zeigt Teile- und Figurenzahl aus den Kennzahlen; ohne
        // Nachladen bliebe sie nach dem Erfassen eines Teils stehen.
        val vm = vm()
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.size == 2)
        val listBefore = fetches().size
        val numbersBefore = paths.requestsAn("GET /api/v1/stats").size

        // So wendet PartsRepository ein erfasstes Teil in der Ablage an.
        runBlocking { t.ablage.applyAn(Editing.TeilErfassen(Teilerfassung(nummer = "3001", farbId = 5, menge = 2))) }
        assertEquals("Kennzahlen nach Teilen", numbersBefore + 1, paths.requestsAn("GET /api/v1/stats").size)
        assertEquals("Ein Teil ändert die Set-Liste nicht", listBefore, fetches().size)
    }

    @Test
    fun `ein Filterwechsel vergisst die Rollposition der Galerie und nur sie`() {
        // Die gemerkte Stelle zeigte sonst auf Sets, die in der neuen Liste
        // woanders oder gar nicht stehen.
        t.scrollMemory.merke("gallery", 40, 3)
        t.scrollMemory.merke("parts", 7, 0)
        val vm = vm()
        vm.setGalleryTheme("Technic")
        assertEquals(0 to 0, t.scrollMemory.lies("gallery"))
        assertEquals(7 to 0, t.scrollMemory.lies("parts"))
    }

    @Test
    fun `nach dem Abmelden ist die Galerie leer und ohne Filter`() {
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
