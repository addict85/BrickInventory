package ch.brickinventoryapp.finanzen

import kotlinx.coroutines.launch
import kotlinx.coroutines.CoroutineScope
import ch.brickinventoryapp.model.ui.laedt
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.testing.testFinanzenRepository
import kotlinx.coroutines.runBlocking
import ch.brickinventoryapp.finanzen.ui.viewmodel.FinanzViewModel
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
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste

/**
 * Das Finanz-ViewModel, ausgeführt gegen einen PfadServer ohne Netz.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen FinanzViewModel.kt):
 *   A  in finanzKategorieUmschalten() das Schreiben in den SavedStateHandle
 *      entfernt → rot „Zeilenarten und Zeitraum überstehen …“
 *   B  im init das Sammeln von `aenderungen.bestandGeaendert()` entfernt → rot „eine Änderung
 *      am Bestand in der Ablage lädt die Bewertung nach“
 *   C  in nachFilter() die Bedingung auf FINANCE umgekehrt → rot „der
 *      Kontofilter des Reiters reist mit …“
 *   D  in zuruecksetzen() das Leeren des Zustands entfernt → rot „nach dem
 *      Abmelden ist nichts mehr da“
 *   finanzen-laden-ohne-verlauf  beim Beobachten nur die Bewertung geladen → rot „wer die
 *      Finanzen sieht …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FinanzViewModelTest {

    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    private fun vm(gemerkt: SavedStateHandle = SavedStateHandle()) =
        t.merke(FinanzViewModel(t.sitzung, t.filter(), t.hinweise, t.aenderungen, testFinanzenRepository(t.api), gemerkt))

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        pfade = PfadServer(
            "/api/v1/finance/valuation" to """{"success":true,"currency":"CHF","sets":[
                {"set_number":"75192-1","name":"Falke"}]}""",
            "/api/v1/finance/portfolio-history" to """{"success":true,"period":"month","points":[]}""",
            // Vollständig nach DTO: Wirft das Einlesen, reicht Retrofit den Fehler über
            // Dispatchers.Default weiter, und der Test läuft nicht mehr im Takt.
            "/api/v1/finance/parts-valuation" to """{"success":true,"total_value":"0.00","parts":[]}""",
            "/api/v1/finance/minifigs-valuation" to """{"success":true,"total_value":"0.00","figs":[]}""",
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
    fun `Zeilenarten und Zeitraum ueberstehen einen Prozess-Tod`() {
        val gemerkt = SavedStateHandle()
        val erstes = vm(gemerkt)
        erstes.finanzKategorieUmschalten("parts")
        erstes.loadPortfolioHistory("month")
        assertTrue("Verlauf geladen", !erstes.financeState.value.verlauf.laedt)

        val neu = vm(gemerkt).financeState.value
        assertEquals(setOf("parts"), neu.kategorien)
        assertEquals("month", neu.historyPeriod)
    }

    @Test
    fun `wer die Finanzen sieht, laedt Bewertung und Verlauf, die Bewertung einmal`() {
        val vm = vm()
        assertTrue("Ohne Beobachter wird nichts geholt", pfade.anfragenAn("/finance/").isEmpty())
        val sicht = CoroutineScope(Dispatchers.Main).launch { vm.financeState.collect {} }
        sicht.cancel()
        CoroutineScope(Dispatchers.Main).launch { vm.financeState.collect {} }.cancel()
        assertEquals(1, pfade.anfragenAn("/finance/valuation").size)
        assertTrue("Der Verlauf kommt mit", pfade.anfragenAn("/finance/portfolio-history").isNotEmpty())
    }

    @Test
    fun `eine Aenderung am Bestand in der Ablage laedt die Bewertung nach`() {
        pfade.antworten["/api/v1/sets"] = """{"success":true,"total":1,"sets":[{"set_number":"75192-1","name":"Falke"}]}"""
        val vm = vm()
        // Ein anderer Bereich holt die Sets in die Ablage; die Bewertung folgt ihr.
        runBlocking { t.sets().aktualisiereSets() }
        assertTrue("Bewertung geladen", vm.financeState.value.valuation != null)
        assertEquals("75192-1", vm.financeState.value.valuation?.sets?.single()?.setNumber)
        assertEquals("Die Währung des Kontos gilt für die ganze App", Waehrung.CHF, t.sitzung.state.value.currency)
    }

    @Test
    fun `der Kontofilter des Reiters reist mit und laedt Bewertung und Verlauf neu`() {
        val vm = vm()
        vm.setScope(ScopeFilter.View.FINANCE, "own")
        assertTrue("beide Abrufe", pfade.anfragenAn("/finance/valuation").isNotEmpty() && pfade.anfragenAn("/portfolio-history").isNotEmpty())
        assertTrue(pfade.anfragenAn("/finance/valuation").single().contains("accounts=own"))
        assertTrue(pfade.anfragenAn("/portfolio-history").single().contains("accounts=own"))

        // Der Filter einer ANDEREN Ansicht lädt hier nichts.
        assertTrue("Bewertung vollständig", pfade.anfragenAn("/finance/pnl").isNotEmpty())
        val vorher = pfade.anfragen.size
        vm.setScope(ScopeFilter.View.GALLERY, "own")
        assertEquals(vorher, pfade.anfragen.size)
    }

    @Test
    fun `nach dem Abmelden ist nichts mehr da`() {
        val vm = vm()
        vm.loadValuation()
        vm.finanzKategorieUmschalten("sets")
        assertTrue("Bewertung geladen", vm.financeState.value.valuation != null)
        t.sitzung.abgemeldet()
        assertNull(vm.financeState.value.valuation)
        assertTrue(vm.financeState.value.kategorien.isEmpty())
    }
}
