package ch.brickinventoryapp

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.viewmodel.FinanzViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
 * Das Finanz-ViewModel, ausgeführt gegen einen Testserver.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen FinanzViewModel.kt):
 *   A  in finanzKategorieUmschalten() das Schreiben in den SavedStateHandle
 *      entfernt → rot „Zeilenarten und Zeitraum überstehen …“
 *   B  in beiAenderung() den Nachlade-Zweig auf Unit gesetzt → rot „eine
 *      Änderung am Bestand lädt die Bewertung nach“
 *   C  in nachFilter() die Bedingung auf FINANCE umgekehrt → rot „der
 *      Kontofilter des Reiters reist mit …“
 *   D  in zuruecksetzen() das Leeren des Zustands entfernt → rot „nach dem
 *      Abmelden ist nichts mehr da“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FinanzViewModelTest {

    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    private fun vm(gemerkt: SavedStateHandle = SavedStateHandle()) =
        t.merke(FinanzViewModel(t.dienste, FinanzenRepository(t.api, t.cache), gemerkt))

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        pfade = PfadServer(
            "/api/v1/finance/valuation" to """{"success":true,"currency":"CHF","sets":[
                {"set_number":"75192-1","name":"Falke"}]}""",
            "/api/v1/finance/portfolio-history" to """{"success":true,"period":"month","points":[]}""",
            "/api/v1/finance/parts-valuation" to """{"success":true,"parts":[]}""",
            "/api/v1/finance/minifigs-valuation" to """{"success":true,"figs":[]}""",
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
    fun `Zeilenarten und Zeitraum ueberstehen einen Prozess-Tod`() {
        val gemerkt = SavedStateHandle()
        val erstes = vm(gemerkt)
        erstes.finanzKategorieUmschalten("parts")
        erstes.loadPortfolioHistory("month")
        TestApi.warteBis("Verlauf geladen") { !erstes.financeState.value.historyLoading }

        val neu = vm(gemerkt).financeState.value
        assertEquals(setOf("parts"), neu.kategorien)
        assertEquals("month", neu.historyPeriod)
    }

    @Test
    fun `eine Aenderung am Bestand laedt die Bewertung nach`() {
        val vm = vm()
        t.bestand.melde(Aenderung.Sets)
        TestApi.warteBis("Bewertung geladen") { vm.financeState.value.valuation != null }
        assertEquals("75192-1", vm.financeState.value.valuation?.sets?.single()?.setNumber)
        assertEquals("Die Währung des Kontos gilt für die ganze App", "CHF", t.sitzung.state.value.currency)
    }

    @Test
    fun `der Kontofilter des Reiters reist mit und laedt Bewertung und Verlauf neu`() {
        val vm = vm()
        vm.setScope(ScopeFilter.View.FINANCE, "own")
        TestApi.warteBis("beide Abrufe") {
            pfade.anfragenAn("/finance/valuation").isNotEmpty() && pfade.anfragenAn("/portfolio-history").isNotEmpty()
        }
        assertTrue(pfade.anfragenAn("/finance/valuation").single().contains("accounts=own"))
        assertTrue(pfade.anfragenAn("/portfolio-history").single().contains("accounts=own"))

        // Der Filter einer ANDEREN Ansicht lädt hier nichts.
        TestApi.warteBis("Bewertung vollständig") { pfade.anfragenAn("/finance/pnl").isNotEmpty() }
        Thread.sleep(200)
        val vorher = pfade.anfragen.size
        vm.setScope(ScopeFilter.View.GALLERY, "own")
        Thread.sleep(200)
        assertEquals(vorher, pfade.anfragen.size)
    }

    @Test
    fun `nach dem Abmelden ist nichts mehr da`() {
        val vm = vm()
        vm.loadValuation()
        vm.finanzKategorieUmschalten("sets")
        TestApi.warteBis("Bewertung geladen") { vm.financeState.value.valuation != null }
        t.sitzung.abgemeldet()
        assertNull(vm.financeState.value.valuation)
        assertTrue(vm.financeState.value.kategorien.isEmpty())
    }
}
