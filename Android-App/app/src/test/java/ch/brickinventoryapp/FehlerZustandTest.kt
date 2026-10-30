package ch.brickinventoryapp

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.GutscheineRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.ui.Ladeanzeige
import ch.brickinventoryapp.ui.ladeanzeige
import ch.brickinventoryapp.ui.viewmodel.FinanzViewModel
import ch.brickinventoryapp.ui.viewmodel.GutscheinViewModel
import ch.brickinventoryapp.ui.viewmodel.MerklisteViewModel
import ch.brickinventoryapp.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.ui.viewmodel.TeileViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * Laden, Fehler, Leer und Kein Treffer sind verschiedene Zustände — und jeder
 * Bildschirm mit geladenem Inhalt erfährt den Fehler. Vorher zeigten Merkliste,
 * Finanzen, Teile, Figuren und Gutscheine nach einem Fehler „leer“, das
 * Set-Detail einen Kringel ohne Ende. Ausgeführt gegen einen Testserver, der
 * zuerst 404 antwortet und nach „Erneut versuchen“ Inhalt liefert.
 *
 * Gegenproben (30.10.2026, gemessen):
 *   A  ladeanzeige(): `fehler != null` hinter `gefiltert` → rot „ein Fehler geht
 *      vor Leer und Kein Treffer …“
 *   B  MerklisteViewModel: `fehler = meldung(r)` entfernt → rot „die Merkliste …“
 *   C  FinanzViewModel: `valuationFehler = null` beim Neuladen entfernt → rot
 *      „die Bewertung …“ (der alte Fehler bliebe nach dem Erfolg stehen)
 *   D  Teile: `partsFehler = beschreibeFehler(r)` entfernt → rot „Teile und Figuren …“
 *   E  SetDetailViewModel: `setDetailFehler = meldung(r)` entfernt → rot „das Set-Detail …“
 *   F  GutscheinViewModel: `fehler = texte.meldung(r)` entfernt → rot „die Gutscheine …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FehlerZustandTest {

    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        pfade = PfadServer()
        t = TestDienste(pfade.server)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        pfade.server.shutdown()
    }

    @Test
    fun `ein Fehler geht vor Leer und Kein Treffer, geladener Inhalt vor allem`() {
        assertEquals(Ladeanzeige.FEHLER, ladeanzeige(hatInhalt = false, laedt = false, fehler = "weg", gefiltert = true))
        assertEquals(Ladeanzeige.LAEDT, ladeanzeige(hatInhalt = false, laedt = true, fehler = "weg", gefiltert = false))
        assertEquals(Ladeanzeige.LISTE, ladeanzeige(hatInhalt = true, laedt = false, fehler = "weg", gefiltert = false))
        assertEquals(Ladeanzeige.KEINE_TREFFER, ladeanzeige(hatInhalt = false, laedt = false, fehler = null, gefiltert = true))
        assertEquals(Ladeanzeige.LEER, ladeanzeige(hatInhalt = false, laedt = false, fehler = null, gefiltert = false))
    }

    @Test
    fun `die Merkliste meldet den Fehler und vergisst ihn beim Neuladen`() {
        val vm = t.merke(MerklisteViewModel(t.dienste, SetsRepository(t.api, t.cache), KatalogRepository(t.api, t.cache),
            FinanzenRepository(t.api, t.cache), SavedStateHandle()))
        vm.ladeMerkliste()
        TestApi.warteBis("Fehler") { vm.merklisteState.value.fehler != null }
        assertEquals("fehler", vm.merklisteState.value.fehler)

        pfade.antworten["/api/v1/wanted"] = """{"success":true,"merkposten":[{"set_number":"10294-1","condition":"N","user_id":1}]}"""
        vm.ladeMerkliste()
        TestApi.warteBis("Inhalt") { vm.merklisteState.value.merkposten.isNotEmpty() }
        assertNull(vm.merklisteState.value.fehler)
    }

    @Test
    fun `die Bewertung meldet den Fehler und vergisst ihn beim Neuladen`() {
        val vm = t.merke(FinanzViewModel(t.dienste, FinanzenRepository(t.api, t.cache), SavedStateHandle()))
        vm.loadValuation()
        TestApi.warteBis("Fehler") { vm.financeState.value.valuationFehler != null }

        pfade.antworten["/api/v1/finance/valuation"] = """{"success":true,"currency":"CHF"}"""
        vm.loadValuation()
        TestApi.warteBis("Bewertung") { vm.financeState.value.valuation != null }
        assertNull(vm.financeState.value.valuationFehler)
    }

    @Test
    fun `Teile und Figuren melden den Fehler je fuer sich`() {
        val vm = t.merke(TeileViewModel(t.dienste, TeileRepository(t.api, t.cache), FigurenRepository(t.api, t.cache), SavedStateHandle()))
        vm.loadParts()
        TestApi.warteBis("Teilefehler") { vm.partsState.value.partsFehler != null }
        vm.loadMinifigs()
        TestApi.warteBis("Figurenfehler") { vm.partsState.value.minifigsFehler != null }
        assertEquals("fehler", vm.partsState.value.partsFehler)
    }

    @Test
    fun `das Set-Detail meldet den Fehler statt ewig zu laden`() {
        val leser = object : DateiLeser { override suspend fun lies(uri: Uri): Pair<String?, ByteArray>? = null }
        val vm = t.merke(SetDetailViewModel(t.dienste, SetsRepository(t.api, t.cache), FinanzenRepository(t.api, t.cache),
            HaushaltRepository(t.api, t.cache), leser, SavedStateHandle(mapOf("setNumber" to "75192-1"))))
        vm.loadSetDetail("75192-1")
        TestApi.warteBis("Fehler") { vm.setDetailState.value.setDetailFehler != null }
        assertEquals(false, vm.setDetailState.value.setDetailLoading)
    }

    @Test
    fun `die Gutscheine melden den Fehler`() {
        val vm = GutscheinViewModel(
            repo = GutscheineRepository(t.api, ResponseCache { t.cacheDir }),
            texte = NummernTexte,
            leser = object : DateiLeser { override suspend fun lies(uri: Uri): Pair<String?, ByteArray>? = null },
            meldungen = t.meldungen,
        )
        vm.ladeGutscheine()
        TestApi.warteBis("Fehler") { vm.state.value.fehler != null }
        assertEquals("fehler", vm.state.value.fehler)
    }
}
