package ch.brickinventoryapp.app

import ch.brickinventoryapp.parts.ui.viewmodel.MinifigsViewModel
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.errorKind
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.testing.testMinifigsRepository
import ch.brickinventoryapp.testing.testFinancesRepository
import ch.brickinventoryapp.testing.testVouchersRepository
import ch.brickinventoryapp.testing.testHouseholdRepository
import ch.brickinventoryapp.testing.testCatalogRepository
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.LoadingIndicator
import ch.brickinventoryapp.ui.loadingIndicator
import ch.brickinventoryapp.finances.ui.viewmodel.FinanceViewModel
import ch.brickinventoryapp.finances.ui.viewmodel.GutscheinViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.MerklisteViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.testing.NumbersTexts
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste

/**
 * Laden, Fehler, Leer und Kein Treffer sind verschiedene Zustände — und jeder
 * Bildschirm mit geladenem Inhalt erfährt den Fehler. Vorher zeigten Merkliste,
 * Finanzen, Teile, Figuren und Gutscheine nach einem Fehler „leer“, das
 * Set-Detail einen Kringel ohne Ende. Ausgeführt gegen einen PfadServer ohne Netz, der
 * zuerst 404 antwortet und nach „Erneut versuchen“ Inhalt liefert.
 *
 * Gegenproben:
 *   A  ladeanzeige(): `fehler != null` hinter `gefiltert` → rot „ein Fehler geht
 *      vor Leer und Kein Treffer …“
 *   B  MerklisteViewModel: `fehler = meldung(r)` entfernt → rot „die Merkliste …“
 *   C  FinanceViewModel: `valuationFehler = null` beim Neuladen entfernt → rot
 *      „die Bewertung …“ (der alte Fehler bliebe nach dem Erfolg stehen)
 *   D  Teile: `partsFehler = beschreibeFehler(r)` entfernt → rot „Teile und Figuren …“
 *   E  SetDetailViewModel: `setDetailFehler = meldung(r)` entfernt → rot „das Set-Detail …“
 *   F  GutscheinViewModel: `fehler = texts.meldung(r)` entfernt → rot „die Gutscheine …“
 * Gegenproben: in FinanceViewModel `valuationFehlerKlasse = …`
 *   entfernt → rot „die Bewertung …“; in Teile.kt `minifigsFehlerKlasse = …`
 *   entfernt → rot „Teile und Figuren …“.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ErrorStateTest {

    private lateinit var paths: PfadServer
    private lateinit var t: TestDienste

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        paths = PfadServer()
        t = TestDienste(paths.imTakt(), io = Dispatchers.Main)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `an error comes before Empty and No hit, loaded content before everything`() {
        assertEquals(LoadingIndicator.FEHLER, loadingIndicator(hatContent = false, laedt = false, fehler = "weg", gefiltert = true))
        assertEquals(LoadingIndicator.LOADS, loadingIndicator(hatContent = false, laedt = true, fehler = "weg", gefiltert = false))
        assertEquals(LoadingIndicator.LISTE, loadingIndicator(hatContent = true, laedt = false, fehler = "weg", gefiltert = false))
        assertEquals(LoadingIndicator.NO_HITS, loadingIndicator(hatContent = false, laedt = false, fehler = null, gefiltert = true))
        assertEquals(LoadingIndicator.LEER, loadingIndicator(hatContent = false, laedt = false, fehler = null, gefiltert = false))
    }

    @Test
    fun `the wishlist reports the error and forgets it on reload`() {
        val vm = t.merke(MerklisteViewModel(t.sitzung, t.filter(), t.hinweise, t.merkliste(), t.alerts(), t.kontosicht,
            testCatalogRepository(t.api), testFinancesRepository(t.api), SavedStateHandle()))
        vm.loadWanted()
        assertTrue("Fehler", vm.wantedState.value.abruf.errorMessage != null)
        // Kein fertiger Satz im Zustand: die Ressource zur Art samt HTTP-Status.
        assertEquals(Meldung.Resource(R.string.err_server, listOf(404)), vm.wantedState.value.abruf.errorMessage)
        assertEquals("404 ohne Rumpf ist ein Serverfehler", Fehlerklasse.SERVER, vm.wantedState.value.abruf.errorKind)

        paths.antworten["/api/v1/wanted"] = """{"success":true,"merkposten":[{"set_number":"10294-1","condition":"N","user_id":1}]}"""
        vm.loadWanted()
        assertTrue("Inhalt", vm.wantedState.value.merkposten.isNotEmpty())
        assertNull(vm.wantedState.value.abruf.errorMessage)
    }

    @Test
    fun `the valuation reports the error and forgets it on reload`() {
        val vm = t.merke(FinanceViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, testFinancesRepository(t.api), SavedStateHandle()))
        vm.loadValuation()
        assertTrue("Fehler", vm.financeState.value.bewertung is Laden.Fehler)
        assertEquals(Fehlerklasse.SERVER, vm.financeState.value.bewertung.errorKind)

        paths.antworten["/api/v1/finance/valuation"] = """{"success":true,"currency":"CHF"}"""
        vm.loadValuation()
        assertTrue("Bewertung", vm.financeState.value.valuation != null)
        assertNull(vm.financeState.value.bewertung.errorMessage)
    }

    @Test
    fun `parts and figures report the error each on their own`() {
        val vm = t.merke(PartsViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, t.scrollMemory, testPartsRepository(t.api), t.kontosicht, SavedStateHandle()))
        vm.loadParts()
        assertTrue("Teilefehler", vm.teileState.value.partsFetch is Laden.Fehler)
        val fig = t.merke(MinifigsViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, testMinifigsRepository(t.api), t.kontosicht, SavedStateHandle()))
        fig.loadMinifigs()
        assertTrue("Figurenfehler", fig.minifigsState.value.minifigsFetch is Laden.Fehler)
        assertTrue(vm.teileState.value.partsFetch.errorMessage != null)
        assertEquals(Fehlerklasse.SERVER, vm.teileState.value.partsFetch.errorKind)
        assertEquals(Fehlerklasse.SERVER, fig.minifigsState.value.minifigsFetch.errorKind)
    }

    @Test
    fun `the set detail reports the error instead of loading forever`() {
        val reader = object : FileReader { override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null }
        val vm = t.merke(SetDetailViewModel(t.sitzung, t.filter(), t.hinweise, t.sets(), t.setCatalog(), t.alerts(), t.setFiles(),
            testFinancesRepository(t.api), testHouseholdRepository(t.api), reader,
            SavedStateHandle(mapOf("setNumber" to "75192-1"))))
        assertTrue("Fehler", vm.setDetailState.value.detailFetch is Laden.Fehler)
        assertEquals(false, vm.setDetailState.value.detailFetch.laedt)
        assertEquals(Fehlerklasse.SERVER, vm.setDetailState.value.detailFetch.errorKind)
    }

    @Test
    fun `the vouchers report the error`() {
        val vm = GutscheinViewModel(
            repo = testVouchersRepository(t.api),
            texts = NumbersTexts,
            reader = object : FileReader { override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null },
            meldungen = t.meldungen,
        )
        vm.loadVouchers()
        assertTrue("Fehler", vm.state.value.abruf is Laden.Fehler)
        assertEquals(Fehlerklasse.SERVER, vm.state.value.abruf.errorKind)
    }
}
