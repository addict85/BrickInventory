package ch.brickinventoryapp.sammlung

import ch.brickinventoryapp.model.fach.Setsortierung
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.data.model.SetAggregate
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.testing.FinanzenRepository
import ch.brickinventoryapp.model.data.model.AddPartRequest
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.sammlung.ui.viewmodel.GalerieViewModel
import kotlinx.coroutines.Dispatchers
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
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen GalerieViewModel.kt):
 *   A  im init die gemerkte Suche nicht übernommen → rot „Suche, Thema und
 *      Sortierung überstehen …“
 *   B  in nachFilter() die Bedingung umgekehrt → rot „Konto- und Lagerfilter
 *      der Galerie reisen mit …“
 *   C  in SetsRepositoryImpl.deleteSet den Nachzug `SetEntfernt` weggelassen → rot
 *      „ein gelöschtes Set verschwindet aus der Ablage …“ (Kachel bleibt)
 *   D  in LokaleAnwendung.sets den Zweig SetZusammenfassung entfernt → rot „ein
 *      geänderter Kauf ändert die Kachel, ohne die Liste neu zu holen“
 *   E  im init von GalerieViewModel das Sammeln von `aenderungen.bestandGeaendert()` entfernt
 *      → rot „ein erfasstes Teil lädt die Kennzahlen …“ und „ein gelöschtes Set …“
 *   F  vergissScroll auf "parts" statt "gallery" → rot „ein Filterwechsel
 *      vergisst die Rollposition der Galerie und nur sie“
 *   G  kachelPreise() ohne kachel_preis/kachel_pnl_pct → rot „die
 *      Kennzahlen bringen Preis und G&V …“ (800,0 statt 812,5)
 *   G  in loadStats() ladePreise() entfernt → rot „die Kennzahlen bringen
 *      Preis und G&V …“
 *   H  in loeschenVormerken() sofort deleteSet() aufgerufen →
 *      rot „vorgemerktes Loeschen …“ und „Rueckgaengig …“ (DELETE schon gesendet)
 *   I  in galleryState das Ausfiltern des vorgemerkten Sets entfernt → rot
 *      „vorgemerktes Loeschen nimmt die Kachel sofort weg …“
 *   J in galleryState die Kennzahlen nicht angepasst
 *      (gegenproben/galerie-kennzahlen-beim-loeschen.patch) → rot „die Kennzahlen
 *      zaehlen das vorgemerkte Set nicht …“ (2 statt 1 Set)
 *   K  in loeschenAusfuehren() die Prüfung auf [nur] entfernt
 *      (gegenproben/galerie-abgeloestes-loeschen.patch) → rot „die Snackbar eines
 *      abgeloesten Loeschens fuehrt das naechste nicht aus“ (DELETE für 75192-1)
 *   L  in ladeWennLeer() die Prüfung auf eine leere Liste entfernt → rot „beim
 *      Zeigen laedt die Galerie nur, wenn sie leer ist“ (zwei Abrufe)
 *   K und L nur in der CI messbar (Android-Klassen im Testlauf).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GalerieViewModelTest {

    private val uhr = TestCoroutineScheduler()
    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    private fun vm(gemerkt: SavedStateHandle = SavedStateHandle(), t: TestDienste = this.t) = t.merke(GalerieViewModel(t.sitzung, t.filter(), t.hinweise, t.aenderungen, t.scrollMemory, t.sets(),
        t.kontosicht, FinanzenRepository(t.api, t.cache), gemerkt))

    private fun abrufe(pfade: PfadServer = this.pfade) =
        pfade.anfragenAn("GET /api/v1/sets?") + pfade.anfragenAn("GET /api/v1/sets ")

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher(uhr))
        pfade = PfadServer(
            "/api/v1/sets" to """{"success":true,"total":2,"sets":[
                {"set_number":"75192-1","name":"Falke","used_count":0},{"set_number":"10294-1","name":"Titanic"}]}""",
            "/api/v1/stats" to """{"success":true,"stats":{"total_sets":2,"total_quantity":2,"total_pieces":0,"total_instructions":0,"total_parts":0,"total_minifigs":0}}""",
            "/api/v1/finance/pnl" to """{"success":true,"currency":"CHF","totals":{"purchase":"0.00","current":"0.00"},"sets":[
                {"set_number":"75192-1","quantity":1,"current_price":800,"baseline_price":700,"pnl_pct":"14.3","baseline_pnl_pct":"14.3",
                 "kachel_preis":812.5,"kachel_pnl_pct":16.1}]}""",
            "/api/v1/sets/10294-1" to """{"success":true}""",
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
    fun `die Kennzahlen bringen Preis und G&V fuer die Kacheln mit`() {
        val vm = vm()
        vm.loadStats()
        assertTrue("Preise da", vm.preise.value.containsKey("75192-1"))
        assertEquals(812.5, vm.preise.value["75192-1"]?.betrag ?: -1.0, 1e-9)
        assertEquals(16.1, vm.preise.value["75192-1"]?.pnlPct ?: -1.0, 1e-9)
    }

    @Test
    fun `Suche, Thema und Sortierung ueberstehen einen Prozess-Tod und reisen mit`() {
        val gemerkt = SavedStateHandle()
        val erstes = vm(gemerkt)
        erstes.setGalleryTheme("Technic")
        erstes.setGallerySort(Setsortierung.JAHR)
        erstes.setGalleryQuery("Falke")

        pfade.neuerProzess(io = Dispatchers.Main) { pfade, t ->
            val neu = vm(gemerkt, t)
            val g = neu.galleryState.value
            assertEquals(Triple("Falke", "Technic", Setsortierung.JAHR), Triple(g.galleryQuery, g.galleryTheme, g.gallerySort))
            // Die Filter gelten der Ablage; der Abruf füllt sie ganz, ohne Filter.
            neu.loadSets()
            val abruf = abrufe(pfade).single()
            assertTrue(abruf, "search=" !in abruf && "theme=" !in abruf && "sort=" !in abruf)
        }
    }

    @Test
    fun `Konto- und Lagerfilter der Galerie reisen mit und laden Liste und Kennzahlen`() {
        val vm = vm()
        vm.setScope(ScopeFilter.View.GALLERY, "own")
        assertTrue("Liste und Kennzahlen", vm.galleryState.value.sets.isNotEmpty() && vm.galleryState.value.stats != null)
        assertTrue("accounts=own" in abrufe().last())
        assertTrue("accounts=own" in pfade.anfragenAn("GET /api/v1/stats").last())

        vm.setLagerFilter(ScopeFilter.View.GALLERY, "Regal")
        assertTrue("neu geladen", abrufe().size >= 2)
        assertTrue(abrufe().last(), "storage=Regal" in abrufe().last())
    }

    @Test
    fun `ein geloeschtes Set verschwindet aus der Ablage, und die Kennzahlen kommen neu`() {
        val vm = vm()
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.size == 2)
        val liste = abrufe().size
        val zahlen = pfade.anfragenAn("GET /api/v1/stats").size
        vm.deleteSet("10294-1")
        assertTrue(pfade.anfragenAn("DELETE /api/v1/sets/10294-1").isNotEmpty())
        assertTrue("Liste ohne das Set", vm.galleryState.value.sets.none { it.setNumber == "10294-1" })
        assertEquals("die Liste kommt aus der Ablage, nicht neu vom Server", liste, abrufe().size)
        assertTrue("Kennzahlen neu", pfade.anfragenAn("GET /api/v1/stats").size > zahlen)
    }

    @Test
    fun `vorgemerktes Loeschen nimmt die Kachel sofort weg und fragt den Server erst danach`() {
        val vm = vm()
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.size == 2)
        vm.loeschenVormerken("10294-1", "Titanic")
        assertTrue(vm.galleryState.value.sets.none { it.setNumber == "10294-1" })
        assertEquals("Titanic", vm.vorgemerkt.value?.name)
        assertTrue("Noch kein DELETE", pfade.anfragenAn("DELETE /api/v1/sets/10294-1").isEmpty())
        vm.loeschenAusfuehren()
        assertTrue("DELETE gesendet", pfade.anfragenAn("DELETE /api/v1/sets/10294-1").isNotEmpty())
        assertEquals(null, vm.vorgemerkt.value)
    }

    @Test
    fun `die Kennzahlen zaehlen das vorgemerkte Set nicht und nach Rueckgaengig wieder`() {
        pfade.antworten["/api/v1/sets"] = """{"success":true,"total":2,"sets":[
            {"set_number":"75192-1","name":"Falke","pieces":7541,"minifigs":7,"quantity":1},
            {"set_number":"10294-1","name":"Titanic","pieces":9090,"minifigs":0,"quantity":2}]}"""
        pfade.antworten["/api/v1/stats"] = """{"success":true,"stats":{"total_sets":2,"total_quantity":3,"total_pieces":25721,
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
        assertTrue("Kein DELETE", pfade.anfragenAn("DELETE /api/v1/sets/10294-1").isEmpty())
        vm.loeschenAusfuehren()
        assertTrue("Nach Rückgängig gibt es nichts mehr auszuführen", pfade.anfragenAn("DELETE /api/v1/sets/10294-1").isEmpty())
    }

    @Test
    fun `die Snackbar eines abgeloesten Loeschens fuehrt das naechste nicht aus`() {
        val vm = vm()
        vm.loadSets()
        vm.loeschenVormerken("10294-1", "Titanic")
        val erstes = vm.vorgemerkt.value
        // Ein zweites Löschen führt das erste aus und merkt sich das zweite vor.
        vm.loeschenVormerken("75192-1", "Falke")
        assertTrue("erstes gelöscht", pfade.anfragenAn("DELETE /api/v1/sets/10294-1").isNotEmpty())
        val zweites = vm.vorgemerkt.value
        // Die Snackbar des ersten endet erst jetzt (abgelöst) — sie darf das zweite nicht anfassen.
        vm.loeschenAusfuehren(erstes)
        vm.rueckgaengig(erstes)
        assertEquals("Falke", vm.vorgemerkt.value?.name)
        assertTrue("zweites noch nicht gelöscht", pfade.anfragenAn("DELETE /api/v1/sets/75192-1").isEmpty())
        vm.rueckgaengig(zweites)
        assertEquals(null, vm.vorgemerkt.value)
        assertTrue("zweites nie gelöscht", pfade.anfragenAn("DELETE /api/v1/sets/75192-1").isEmpty())
    }

    @Test
    fun `beim Zeigen laedt die Galerie nur, wenn sie leer ist`() {
        val vm = vm()
        vm.ladeWennLeer()
        assertTrue("ohne Server kein Abruf", abrufe().isEmpty())
        t.sitzung.anmeldungGeaendert(pfade.server.url("/").toString(), angemeldet = true)
        vm.ladeWennLeer()
        assertEquals("leer: einmal geladen", 1, abrufe().size)
        assertTrue("Kennzahlen mit", pfade.anfragenAn("GET /api/v1/stats").isNotEmpty())
        vm.ladeWennLeer()
        assertEquals("schon da: nicht noch einmal", 1, abrufe().size)
    }

    @Test
    fun `ein geaenderter Kauf aendert die Kachel, ohne die Liste neu zu holen`() {
        val vm = vm()
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.size == 2)
        val vorher = abrufe().size
        // Gezählt ab hier: Die erste Ladung holt die Kennzahlen schon selbst.
        val zahlenVorher = pfade.anfragenAn("GET /api/v1/stats").size

        // So schreibt KaeufeViewModel die Antwort des Servers in die Ablage.
        runBlocking { t.sets().uebernimmZusammenfassung(SetAggregate(setNumber = "75192-1", usedCount = 1)) }
        assertTrue("Kennzahlen neu", pfade.anfragenAn("GET /api/v1/stats").size > zahlenVorher)
        assertTrue("Kachel geändert", vm.galleryState.value.sets.first { it.setNumber == "75192-1" }.usedCount == 1)
        assertEquals("Die Liste darf nicht neu geholt werden", vorher, abrufe().size)
    }

    @Test
    fun `ein erfasstes Teil laedt die Kennzahlen, nicht die Set-Liste`() {
        // Die Galerie zeigt Teile- und Figurenzahl aus den Kennzahlen; ohne
        // Nachladen bliebe sie nach dem Erfassen eines Teils stehen.
        val vm = vm()
        vm.loadSets()
        assertTrue("Liste geladen", vm.galleryState.value.sets.size == 2)
        val listeVorher = abrufe().size
        val zahlenVorher = pfade.anfragenAn("GET /api/v1/stats").size

        // So wendet TeileRepository ein erfasstes Teil in der Ablage an.
        runBlocking { t.ablage.wendeAn(Bearbeitung.TeilErfassen(AddPartRequest("3001", colorId = 5, quantity = 2))) }
        assertEquals("Kennzahlen nach Teilen", zahlenVorher + 1, pfade.anfragenAn("GET /api/v1/stats").size)
        assertEquals("Ein Teil ändert die Set-Liste nicht", listeVorher, abrufe().size)
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
