package ch.brickinventoryapp

import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.viewmodel.KaeufeViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Das Käufe-ViewModel (Sets, manuelle Teile und Figuren), ausgeführt gegen
 * einen Testserver.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen KaeufeViewModel.kt):
 *   A  in setGeaendert() immer Aenderung.Sets melden statt der Zusammenfassung
 *      → rot „ein geänderter Kauf eines Sets meldet seine Zusammenfassung …“
 *   B  bei einer abgelehnten Datumsänderung nicht neu laden → rot „eine
 *      abgelehnte Datumsänderung lädt die Liste neu“
 *   C  im Besitzerwechsel die Zahlen der Antwort durch 0 ersetzt → rot „ein
 *      Besitzerwechsel meldet die mitgewanderten Teile …“
 *   D  in lade() den Verlauf eines anderen Eintrags stehen gelassen → rot
 *      „der Preisverlauf eines anderen Eintrags bleibt nicht stehen“
 *   E  in UpdateAcquisitionRequest.fuerStueck() `purchasePrice = preis` statt
 *      `unitPrice = preis` → rot „ein Set schickt purchase_price, Teile und
 *      Figuren unit_price“ (Teil)
 *   F  in HaushaltRepository.updateAcquisition() fuerStueck statt fuerSet →
 *      rot an derselben Stelle (Set)
 *   G  in updateManualAcquisition() den Rumpf von Hand gebaut,
 *      `UpdateAcquisitionRequest(purchasePrice = unitPrice, …)` → rot an
 *      derselben Stelle (Teil)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class KaeufeViewModelTest {

    private val uhr = TestCoroutineScheduler()
    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    private fun vm() = t.merke(KaeufeViewModel(t.dienste, HaushaltRepository(t.api, t.cache),
        FinanzenRepository(t.api, t.cache), TeileRepository(t.api, t.cache)))

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher(uhr))
        pfade = PfadServer(
            "/api/v1/sets/75192-1/acquisitions" to """{"success":true,"acquisitions":[{"id":7,"quantity":1}]}""",
            "/api/v1/sets/75192-1/acquisitions/7" to """{"success":true,"set":{"set_number":"75192-1","used_count":1},
                "parts":12,"minifigs":2}""",
            "/api/v1/parts/3001/5/acquisitions" to """{"success":true,"acquisitions":[{"id":9,"quantity":4}]}""",
            "/api/v1/parts/3001/5/price-history" to """{"success":true,"set_number":"3001"}""",
            "/api/v1/parts/3002/5/acquisitions" to """{"success":true,"acquisitions":[]}""",
        )
        t = TestDienste(pfade.server)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        pfade.server.shutdown()
    }

    @Test
    fun `ein geaenderter Kauf eines Sets meldet seine Zusammenfassung und laedt die Liste neu`() {
        val vm = vm()
        vm.loadAcquisitions("75192-1")
        TestApi.warteBis("Liste geladen") { vm.manDetailState.value.acquisitions.isNotEmpty() }
        val vorher = pfade.anfragenAn("GET /api/v1/sets/75192-1/acquisitions").size
        val liste = t.gemeldet(1) {
            vm.updateAcquisition("75192-1", 7, purchasePrice = 499.0)
            TestApi.warteBis("neu geladen") {
                pfade.anfragenAn("GET /api/v1/sets/75192-1/acquisitions").size > vorher
            }
        }
        val z = liste.single() as Aenderung.SetZusammenfassung
        assertEquals("75192-1", z.agg.setNumber)
        assertEquals(1, z.agg.usedCount)
    }

    @Test
    fun `eine abgelehnte Datumsaenderung laedt die Liste neu`() {
        pfade.codes["/api/v1/parts/3001/5/acquisitions/9"] = 409
        val vm = vm()
        vm.loadManualAcquisitions("part", "3001", 5)
        TestApi.warteBis("Liste geladen") { vm.manDetailState.value.acquisitions.isNotEmpty() }
        val vorher = pfade.anfragenAn("GET /api/v1/parts/3001/5/acquisitions").size
        vm.updateManualAcquisition("part", "3001", 5, 9, date = "2020-01-01")
        TestApi.warteBis("neu geladen") {
            pfade.anfragenAn("GET /api/v1/parts/3001/5/acquisitions").size > vorher
        }
        assertEquals("fehler", t.meldungen.meldung.value)
    }

    @Test
    fun `ein Besitzerwechsel meldet die mitgewanderten Teile und Figuren`() {
        val vm = vm()
        var ergebnis: Triple<String?, Int, Int>? = null
        val liste = t.gemeldet(3) {
            vm.changeAcquisitionOwner("set", "75192-1", 0, 7, toUserId = 4) { f, teile, figuren ->
                ergebnis = Triple(f, teile, figuren)
            }
            TestApi.warteBis("Antwort") { ergebnis != null }
        }
        assertEquals(Triple(null, 12, 2), ergebnis)
        assertEquals(listOf(Aenderung.Sets, Aenderung.Teile, Aenderung.Figuren), liste)
        assertTrue(pfade.anfragenAn("PUT /api/v1/sets/75192-1/acquisitions/7").isNotEmpty())
    }

    /** Der Rumpf der ersten Anfrage, deren Zeile [anfrage] enthält. */
    private fun rumpf(anfrage: String): String {
        TestApi.warteBis(anfrage) {
            synchronized(pfade.anfragen) {
                val i = pfade.anfragen.indexOfFirst { anfrage in it }
                i >= 0 && pfade.koerper.size > i
            }
        }
        return synchronized(pfade.anfragen) { pfade.koerper[pfade.anfragen.indexOfFirst { anfrage in it }] }
    }

    /** ApiJson schreibt null mit; „gesetzt“ heisst: das Feld trägt eine Zahl. */
    private fun gesetzt(feld: String, json: String) = Regex("\"$feld\":[0-9]").containsMatchIn(json)

    @Test
    fun `ein Set schickt purchase_price, Teile und Figuren unit_price`() {
        // Der Server liest das Preisfeld unter dem Namen seiner Spalte; unter
        // dem falschen Namen lässt er den Preis still stehen.
        val vm = vm()
        vm.updateAcquisition("75192-1", 7, purchasePrice = 499.0)
        val set = rumpf("PUT /api/v1/sets/75192-1/acquisitions/7")
        assertTrue("Set: $set", "\"purchase_price\":499.0" in set && !gesetzt("unit_price", set))

        vm.updateManualAcquisition("part", "3001", 5, 9, unitPrice = 0.25)
        val teil = rumpf("PUT /api/v1/parts/3001/5/acquisitions/9")
        assertTrue("Teil: $teil", "\"unit_price\":0.25" in teil && !gesetzt("purchase_price", teil))

        vm.updateManualAcquisition("fig", "sw0001", 0, 3, unitPrice = 12.0)
        val figur = rumpf("PUT /api/v1/minifigs/sw0001/acquisitions/3")
        assertTrue("Figur: $figur", "\"unit_price\":12.0" in figur && !gesetzt("purchase_price", figur))
    }

    @Test
    fun `der Preisverlauf eines anderen Eintrags bleibt nicht stehen`() {
        val vm = vm()
        vm.loadManualAcquisitions("part", "3001", 5)
        TestApi.warteBis("Verlauf geladen") { vm.manDetailState.value.priceHistory != null }
        // 3002 hat keinen Verlauf auf dem Testserver: Er bleibt leer, statt den
        // von 3001 weiter zu zeigen.
        vm.loadManualAcquisitions("part", "3002", 5)
        TestApi.warteBis("Liste von 3002") {
            vm.manDetailState.value.itemId == "3002" && !vm.manDetailState.value.isLoading &&
                !vm.manDetailState.value.priceHistoryLoading
        }
        assertNull(vm.manDetailState.value.priceHistory)
    }
}
