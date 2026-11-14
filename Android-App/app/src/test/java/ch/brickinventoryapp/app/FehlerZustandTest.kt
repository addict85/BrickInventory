package ch.brickinventoryapp.app

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.testing.FigurenRepository
import ch.brickinventoryapp.testing.FinanzenRepository
import ch.brickinventoryapp.testing.GutscheineRepository
import ch.brickinventoryapp.testing.HaushaltRepository
import ch.brickinventoryapp.testing.KatalogRepository
import ch.brickinventoryapp.testing.TeileRepository
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiRef
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.GutscheineRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.Ladeanzeige
import ch.brickinventoryapp.ui.ladeanzeige
import ch.brickinventoryapp.finanzen.ui.viewmodel.FinanzViewModel
import ch.brickinventoryapp.finanzen.ui.viewmodel.GutscheinViewModel
import ch.brickinventoryapp.sammlung.ui.viewmodel.MerklisteViewModel
import ch.brickinventoryapp.sammlung.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.teile.ui.viewmodel.TeileViewModel
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
import ch.brickinventoryapp.testing.NummernTexte
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
 *   C  FinanzViewModel: `valuationFehler = null` beim Neuladen entfernt → rot
 *      „die Bewertung …“ (der alte Fehler bliebe nach dem Erfolg stehen)
 *   D  Teile: `partsFehler = beschreibeFehler(r)` entfernt → rot „Teile und Figuren …“
 *   E  SetDetailViewModel: `setDetailFehler = meldung(r)` entfernt → rot „das Set-Detail …“
 *   F  GutscheinViewModel: `fehler = texte.meldung(r)` entfernt → rot „die Gutscheine …“
 * Gegenproben: in FinanzViewModel `valuationFehlerKlasse = …`
 *   entfernt → rot „die Bewertung …“; in Teile.kt `minifigsFehlerKlasse = …`
 *   entfernt → rot „Teile und Figuren …“.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FehlerZustandTest {

    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        pfade = PfadServer()
        t = TestDienste(pfade.imTakt(), io = Dispatchers.Main)
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
        val vm = t.merke(MerklisteViewModel(t.sitzung, t.filter(), t.hinweise, t.merkliste(), t.alarme(), t.kontosicht,
            KatalogRepository(t.api), FinanzenRepository(t.api), SavedStateHandle()))
        vm.ladeMerkliste()
        assertTrue("Fehler", vm.merklisteState.value.fehler != null)
        // Kein fertiger Satz im Zustand: die Ressource zur Art samt HTTP-Status.
        assertEquals(Meldung.Ressource(R.string.err_server, listOf(404)), vm.merklisteState.value.fehler)
        assertEquals("404 ohne Rumpf ist ein Serverfehler", Fehlerklasse.SERVER, vm.merklisteState.value.fehlerKlasse)

        pfade.antworten["/api/v1/wanted"] = """{"success":true,"merkposten":[{"set_number":"10294-1","condition":"N","user_id":1}]}"""
        vm.ladeMerkliste()
        assertTrue("Inhalt", vm.merklisteState.value.merkposten.isNotEmpty())
        assertNull(vm.merklisteState.value.fehler)
    }

    @Test
    fun `die Bewertung meldet den Fehler und vergisst ihn beim Neuladen`() {
        val vm = t.merke(FinanzViewModel(t.sitzung, t.filter(), t.hinweise, t.aenderungen, FinanzenRepository(t.api), SavedStateHandle()))
        vm.loadValuation()
        assertTrue("Fehler", vm.financeState.value.valuationFehler != null)
        assertEquals(Fehlerklasse.SERVER, vm.financeState.value.valuationFehlerKlasse)

        pfade.antworten["/api/v1/finance/valuation"] = """{"success":true,"currency":"CHF"}"""
        vm.loadValuation()
        assertTrue("Bewertung", vm.financeState.value.valuation != null)
        assertNull(vm.financeState.value.valuationFehler)
    }

    @Test
    fun `Teile und Figuren melden den Fehler je fuer sich`() {
        val vm = t.merke(TeileViewModel(t.sitzung, t.filter(), t.hinweise, t.aenderungen, t.scrollMemory, TeileRepository(t.api), FigurenRepository(t.api), t.kontosicht, SavedStateHandle()))
        vm.loadParts()
        assertTrue("Teilefehler", vm.partsState.value.partsFehler != null)
        vm.loadMinifigs()
        assertTrue("Figurenfehler", vm.partsState.value.minifigsFehler != null)
        assertEquals("fehler", vm.partsState.value.partsFehler)
        assertEquals(Fehlerklasse.SERVER, vm.partsState.value.partsFehlerKlasse)
        assertEquals(Fehlerklasse.SERVER, vm.partsState.value.minifigsFehlerKlasse)
    }

    @Test
    fun `das Set-Detail meldet den Fehler statt ewig zu laden`() {
        val leser = object : DateiLeser { override suspend fun lies(datei: DateiRef): Pair<String?, ByteArray>? = null }
        val vm = t.merke(SetDetailViewModel(t.sitzung, t.filter(), t.hinweise, t.sets(), t.setKatalog(), t.alarme(), t.setDateien(),
            FinanzenRepository(t.api), HaushaltRepository(t.api), leser,
            SavedStateHandle(mapOf("setNumber" to "75192-1"))))
        assertTrue("Fehler", vm.setDetailState.value.setDetailFehler != null)
        assertEquals(false, vm.setDetailState.value.setDetailLoading)
        assertEquals(Fehlerklasse.SERVER, vm.setDetailState.value.setDetailFehlerKlasse)
    }

    @Test
    fun `die Gutscheine melden den Fehler`() {
        val vm = GutscheinViewModel(
            repo = GutscheineRepository(t.api),
            texte = NummernTexte,
            leser = object : DateiLeser { override suspend fun lies(datei: DateiRef): Pair<String?, ByteArray>? = null },
            meldungen = t.meldungen,
        )
        vm.ladeGutscheine()
        assertTrue("Fehler", vm.state.value.fehler != null)
        assertEquals("fehler", vm.state.value.fehler)
    }
}
