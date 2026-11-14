package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.testing.FigurenRepository
import ch.brickinventoryapp.testing.FinanzenRepository
import ch.brickinventoryapp.testing.HaushaltRepository
import ch.brickinventoryapp.testing.TeileRepository
import ch.brickinventoryapp.model.data.model.SetItem
import ch.brickinventoryapp.offline.Faecher
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import ch.brickinventoryapp.zustand.ui.viewmodel.KaeufeViewModel
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
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste
import ch.brickinventoryapp.testing.text

/**
 * Das Käufe-ViewModel (Sets, manuelle Teile und Figuren), ausgeführt gegen
 * einen PfadServer ohne Netz.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen KaeufeViewModel.kt):
 *   A  in setGeaendert() die Zusammenfassung nicht übernommen (immer den ganzen Bestand
 *      holen) → rot „ein geänderter Kauf eines Sets schreibt seine Zusammenfassung …“
 *   B  bei einer abgelehnten Datumsänderung nicht neu laden → rot „eine
 *      abgelehnte Datumsänderung lädt die Liste neu“
 *   C  im Besitzerwechsel die Zahlen der Antwort durch 0 ersetzt, oder das Nachziehen
 *      der Ablage entfernt → rot „ein Besitzerwechsel meldet die mitgewanderten Teile …“
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
 *   H  in loadManualPriceHistory() immer getPartPriceHistory
 *      (gegenproben/kaeufe-verlauf-nur-teile.patch) → rot „der Preisverlauf kommt für
 *      Teile und Figuren …“ (Figur ohne Verlauf; nur in der CI messbar)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class KaeufeViewModelTest {

    private val uhr = TestCoroutineScheduler()
    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    private fun vm() = t.merke(KaeufeViewModel(t.sitzung, t.filter(), t.hinweise, t.aenderungen, HaushaltRepository(t.api, t.cache), t.sets(),
        FinanzenRepository(t.api, t.cache), TeileRepository(t.api, t.cache), FigurenRepository(t.api, t.cache)))

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher(uhr))
        pfade = PfadServer(
            "/api/v1/sets/75192-1/acquisitions" to """{"success":true,"acquisitions":[{"id":7,"quantity":1}]}""",
            "/api/v1/sets/75192-1/acquisitions/7" to """{"success":true,"set":{"set_number":"75192-1","used_count":1},
                "parts":12,"minifigs":2}""",
            "/api/v1/parts/3001/5/acquisitions" to """{"success":true,"acquisitions":[{"id":9,"quantity":4}]}""",
            "/api/v1/parts/3001/5/price-history" to """{"success":true,"set_number":"3001"}""",
            "/api/v1/minifigs/sw0001/price-history" to """{"success":true,"set_number":"sw0001"}""",
            "/api/v1/parts/3002/5/acquisitions" to """{"success":true,"acquisitions":[]}""",
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
    fun `ein geaenderter Kauf eines Sets schreibt seine Zusammenfassung in die Ablage und laedt die Liste neu`() {
        runBlocking { t.ablage.uebernimm(Faecher.SETS, listOf(SetItem("75192-1", usedCount = 0))) }
        val vm = vm()
        vm.loadAcquisitions("75192-1")
        assertTrue("Liste geladen", vm.manDetailState.value.acquisitions.isNotEmpty())
        val vorher = pfade.anfragenAn("GET /api/v1/sets/75192-1/acquisitions").size
        vm.updateAcquisition("75192-1", 7, purchasePrice = 499.0)
        assertTrue("neu geladen", pfade.anfragenAn("GET /api/v1/sets/75192-1/acquisitions").size > vorher)
        val kachel = runBlocking { t.sets().beobachteSets().first().liste.single() }
        assertEquals("die Kachel der Galerie liest die Zusammenfassung", 1, kachel.usedCount)
        assertTrue("ohne den ganzen Bestand neu zu holen", pfade.anfragenAn("GET /api/v1/sets?").isEmpty())
    }

    @Test
    fun `eine abgelehnte Datumsaenderung laedt die Liste neu`() {
        pfade.codes["/api/v1/parts/3001/5/acquisitions/9"] = 409
        val vm = vm()
        vm.loadManualAcquisitions(Postenart.PART, "3001", 5)
        assertTrue("Liste geladen", vm.manDetailState.value.acquisitions.isNotEmpty())
        val vorher = pfade.anfragenAn("GET /api/v1/parts/3001/5/acquisitions").size
        vm.updateManualAcquisition(Postenart.PART, "3001", 5, 9, date = "2020-01-01")
        assertTrue("neu geladen", pfade.anfragenAn("GET /api/v1/parts/3001/5/acquisitions").size > vorher)
        assertEquals("fehler", t.meldungen.text)
    }

    @Test
    fun `ein Besitzerwechsel meldet die mitgewanderten Teile und Figuren`() {
        val vm = vm()
        var ergebnis: Triple<String?, Int, Int>? = null
        vm.changeAcquisitionOwner(Postenart.SET, "75192-1", 0, 7, toUserId = 4) { f, teile, figuren ->
            ergebnis = Triple(f, teile, figuren)
        }
        assertTrue("Antwort", ergebnis != null)
        assertEquals(Triple(null, 12, 2), ergebnis)
        // Mitgewandert: Den Stand aller drei Listen holt die Ablage vom Server.
        for (pfad in listOf("GET /api/v1/sets?", "GET /api/v1/parts?", "GET /api/v1/minifigs?")) {
            assertTrue(pfad, pfade.anfragenAn(pfad).isNotEmpty())
        }
        assertTrue(pfade.anfragenAn("PUT /api/v1/sets/75192-1/acquisitions/7").isNotEmpty())
    }

    /** Der Rumpf der ersten Anfrage, deren Zeile [anfrage] enthält. */
    private fun rumpf(anfrage: String): String {
        val i = pfade.anfragen.indexOfFirst { anfrage in it }
        assertTrue(anfrage, i >= 0)
        return pfade.koerper[i]
    }

    /** BrickJson schreibt null mit; „gesetzt“ heisst: das Feld trägt eine Zahl. */
    private fun gesetzt(feld: String, json: String) = Regex("\"$feld\":[0-9]").containsMatchIn(json)

    @Test
    fun `ein Set schickt purchase_price, Teile und Figuren unit_price`() {
        // Der Server liest das Preisfeld unter dem Namen seiner Spalte; unter
        // dem falschen Namen lässt er den Preis still stehen.
        val vm = vm()
        vm.updateAcquisition("75192-1", 7, purchasePrice = 499.0)
        val set = rumpf("PUT /api/v1/sets/75192-1/acquisitions/7")
        assertTrue("Set: $set", "\"purchase_price\":499.0" in set && !gesetzt("unit_price", set))

        vm.updateManualAcquisition(Postenart.PART, "3001", 5, 9, unitPrice = 0.25)
        val teil = rumpf("PUT /api/v1/parts/3001/5/acquisitions/9")
        assertTrue("Teil: $teil", "\"unit_price\":0.25" in teil && !gesetzt("purchase_price", teil))

        vm.updateManualAcquisition(Postenart.FIG, "sw0001", 0, 3, unitPrice = 12.0)
        val figur = rumpf("PUT /api/v1/minifigs/sw0001/acquisitions/3")
        assertTrue("Figur: $figur", "\"unit_price\":12.0" in figur && !gesetzt("purchase_price", figur))
    }

    @Test
    fun `der Preisverlauf eines anderen Eintrags bleibt nicht stehen`() {
        val vm = vm()
        vm.loadManualAcquisitions(Postenart.PART, "3001", 5)
        assertTrue("Verlauf geladen", vm.manDetailState.value.priceHistory != null)
        // 3002 hat keinen Verlauf auf dem Testserver: Er bleibt leer, statt den
        // von 3001 weiter zu zeigen.
        vm.loadManualAcquisitions(Postenart.PART, "3002", 5)
        assertTrue("Liste von 3002", vm.manDetailState.value.itemId == "3002" && !vm.manDetailState.value.isLoading && !vm.manDetailState.value.priceHistoryLoading)
        assertNull(vm.manDetailState.value.priceHistory)
    }

    @Test
    fun `der Preisverlauf kommt fuer Teile und Figuren vom passenden Pfad`() {
        val vm = vm()
        vm.loadManualPriceHistory(Postenart.FIG, "sw0001")
        assertTrue("Figur ohne Verlauf", vm.manDetailState.value.priceHistory != null)
        vm.loadManualPriceHistory(Postenart.PART, "3001", 5)
        assertTrue("Teil ohne Verlauf", vm.manDetailState.value.priceHistory != null)
        assertEquals(1, pfade.anfragenAn("/api/v1/minifigs/sw0001/price-history").size)
        assertEquals(1, pfade.anfragenAn("/api/v1/parts/3001/5/price-history").size)
    }
}
