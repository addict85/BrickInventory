package ch.brickinventoryapp.collection

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.Zustand

import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.model.domain.SetRecorded
import ch.brickinventoryapp.testing.testCatalogRepository
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import ch.brickinventoryapp.collection.ui.CheckPhase
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.state.ui.viewmodel.Texte
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
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
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste
import ch.brickinventoryapp.testing.text

/**
 * The entry ViewModel: scan, add by set number, check display.
 * The event stream of creating is simulated ([SetCreator]); everything else
 * runs in step against a PfadServer; "in flight" means held back.
 *
 * Counter-checks (measured 28.10.2026, kotlinc against EntryViewModel.kt):
 *   A  in showExisting() `exists` ignored (always false) → red “a
 *      scanned set that is already there gets opened …”
 *   B  the `finally` in resolveBarcode() removed → red “an unsuccessful scan
 *      opens the manual entry …” (the check display stays up)
 *   C  when creating, the master-data step not shown → red “creating
 *      shows the server's steps …”
 *   D  an empty error treated as a sentence from the server → red “an
 *      aborted event stream is a network error …”
 *   E  in confirmAddBarcode() the guard `if (stand.hinzufuegen.laeuft) return` removed →
 *      red “a second click on confirm …”; likewise if the dialog only
 *      closes after the answer or the owner is not carried along
 *   F  `hinzufuegen = Vorgang.Fertig` removed after the answer → red “a failure on
 *      confirm …” and “a second click …”
 *   G  the `return` removed in the parts-list branch → red “nothing is added
 *      from the parts list …”
 *   H  in useScannedSetNumber() the pre-check skipped → red “text
 *      recognition asks the server …” and “an error of the pre-check …”
 *   I  in showExisting() carried on after an error → red “an error
 *      of the pre-check aborts …”
 *   J  no manual entry on a failed catalog lookup → red “every
 *      unsuccessful path …”
 *   K  in abortCheckAb() the job not cancelled → red “the abort …”
 *      and “signing out …”
 *   L  in zuruecksetzen() the check not cancelled → red “signing out
 *      clears the check display too”
 *   M  in the error branch of resolveBarcode() again always „nicht gefunden“ →
 *      red “a server error on scan does not mean …”; the code not
 *      checked (always the message) → red “an unsuccessful scan …”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EntryViewModelTest {

    private val clock = TestCoroutineScheduler()
    private val takt = UnconfinedTestDispatcher(clock)
    private lateinit var paths: PfadServer
    private lateinit var t: TestDienste

    /** Lets the test clock run until nothing is pending, then checks [bedingung]. */
    private fun bis(was: String, bedingung: () -> Boolean) {
        clock.advanceUntilIdle()
        assertTrue(was, bedingung())
    }

    /** Like NumbersTexts, but with the arguments — the test also checks WHAT was substituted. */
    private object TextsWithArguments : Texte {
        override fun text(id: Int, vararg args: Any?) = "t$id" + args.joinToString("") { "|$it" }
        override fun menge(id: Int, anzahl: Int, vararg args: Any?) = "m$id:$anzahl"
        override fun meldung(fehler: Ergebnis.Fehler) = "fehler"
        override fun angemeldet() = true
    }

    /** Plays back the steps and records the check phases that were seen along the way. */
    private class Creator(val schritte: List<SetCreateStep>) : SetCreator {
        var vm: EntryViewModel? = null
        val gesehen = mutableListOf<CheckPhase?>()
        override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Geld?, condition: Zustand?,
                             ownerUserId: Int?, storage: String?): Flow<SetCreateStep> = flow {
            for (s in schritte) {
                emit(s)
                gesehen += vm?.entryState?.value?.check?.phase
            }
        }
    }

    private fun vm(creator: Creator = Creator(emptyList())) = t.merke(
        EntryViewModel(t.sitzung, t.filter(), t.hinweise, t.sets(), t.setCatalog(), t.merkliste(), testCatalogRepository(t.api), creator)
    ).also { creator.vm = it }

    @Before
    fun auf() {
        Dispatchers.setMain(takt)
        paths = PfadServer(
            "/api/v1/sets/barcode/5702016616316" to """{"success":true,"set_number":"75192-1","name":"Falke"}""",
            "/api/v1/sets/exists/75192-1" to """{"success":true,"exists":true,"set_number":"75192-1"}""",
            "/api/v1/wanted" to """{"success":true,"war_neu":true}""",
        )
        t = TestDienste(paths.imTakt(), TextsWithArguments, io = takt)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `a scanned set that already exists is opened instead of added`() {
        val vm = vm()
        vm.resolveBarcode("5702016616316", Scannerherkunft.GALERIE_SUCHE)
        bis("gefunden") { vm.barcodeState.value.gefundenesSet == "75192-1" }
        assertNull("Kein Bestätigungsdialog", vm.barcodeState.value.result)
        bis("Prüfanzeige weg") { vm.entryState.value.check == null }
    }

    @Test
    fun `an unsuccessful scan opens manual adding and clears the check display`() {
        paths.antworten["/api/v1/sets/barcode/0000"] = """{"success":false,"code":"barcode_kein_set","error":"Kein Set"}"""
        paths.codes["/api/v1/sets/barcode/0000"] = 404
        val vm = vm()
        vm.resolveBarcode("0000")
        bis("manuell") { vm.barcodeState.value.manuelleErfassungAnfordern }
        assertEquals("t${R.string.vm_barcode_not_found}|0000", t.meldungen.text)
        bis("Prüfanzeige weg") { vm.entryState.value.check == null }
    }

    @Test
    fun `a server error during the scan does not mean the set does not exist`() {
        paths.antworten["/api/v1/sets/barcode/0001"] = """{"success":false,"code":"interner_fehler"}"""
        paths.codes["/api/v1/sets/barcode/0001"] = 500
        val vm = vm()
        vm.resolveBarcode("0001")
        bis("manuell") { vm.barcodeState.value.manuelleErfassungAnfordern }
        assertEquals("fehler", t.meldungen.text)
    }

    @Test
    fun `the creation shows the server's steps and reports the new set`() {
        val creator = Creator(listOf(
            SetCreateStep.Stammdaten("Falke"), SetCreateStep.Bild, SetCreateStep.FastDone,
            SetCreateStep.Fertig(SetRecorded(nummer = "75192-1", angelegt = true)),
        ))
        val vm = vm(creator)
        vm.addSet(Erfassungswunsch("75192"))
        bis("fertig") { vm.entryState.value.check == null && t.meldungen.text != null }
        assertEquals(listOf(CheckPhase.ANLEGEN_STAMMDATEN, CheckPhase.ANLEGEN_BILD, CheckPhase.ANLEGEN_ABSCHLUSS),
            creator.gesehen.take(3))
        assertEquals("t${R.string.vm_added}|75192-1", t.meldungen.text)
        // Name and image are known only to the server: the store fetches the gallery afterwards.
        bis("nachgezogen") { paths.requestsAn("GET /api/v1/sets?").isNotEmpty() }
    }

    /**
     * Counter-check (measured 28.10.2026, kotlinc): the branch `katalogOffen`
     * removed → red, "added" is reported (vm_added).
     */
    @Test
    fun `without a catalog the creation reports saved, not added`() {
        val vm = vm(Creator(listOf(SetCreateStep.Fertig(
            SetRecorded(nummer = "99999-1", angelegt = true, katalogOffen = true)))))
        vm.addSet(Erfassungswunsch("99999"))
        bis("Meldung") { t.meldungen.text != null }
        assertEquals("t${R.string.vm_set_added_no_catalog}|99999-1", t.meldungen.text)
    }

    @Test
    fun `an existing set during creation opens the detail view and reports nothing`() {
        val vm = vm(Creator(listOf(SetCreateStep.Fertig(SetRecorded(nummer = "75192-1", vorhanden = true)))))
        vm.addSet(Erfassungswunsch("75192-1"))
        bis("gefunden") { vm.barcodeState.value.gefundenesSet == "75192-1" }
        assertTrue("nichts angelegt, nichts nachzuziehen", paths.requestsAn("GET /api/v1/sets?").isEmpty())
    }

    @Test
    fun `an aborted event stream is a network error, not a sentence of the server`() {
        val vm = vm(Creator(listOf(SetCreateStep.Fehler(""))))
        vm.addSet(Erfassungswunsch("75192-1"))
        bis("gemeldet") { t.meldungen.text != null }
        // A network error is formulated via meldung() ("fehler"); a sentence
        // from the server would come unchanged — here empty — and say nothing.
        assertEquals("t${R.string.vm_add_failed}|75192-1|fehler", t.meldungen.text)
    }

    @Test
    fun `a scan from the wishlist creates a wishlist item and closes the dialog`() {
        val vm = vm()
        vm.resolveBarcode("5702016616316", Scannerherkunft.MERKLISTE)
        bis("Dialog") { vm.barcodeState.value.result == "75192-1" }
        vm.confirmAddBarcode(Erfassungswunsch("75192-1", zustand = Zustand.GEBRAUCHT))
        bis("gemeldet") { t.meldungen.text != null }
        val merkliste = runBlocking { t.merkliste().observeWanted().first().liste }
        assertEquals("der Merkposten steht in der Ablage", listOf("75192-1"), merkliste.map { it.setNumber })
        assertEquals("t${R.string.wanted_added}", t.meldungen.text)
        assertTrue(paths.requestsAn("POST /api/v1/wanted").isNotEmpty())
        assertNull(vm.barcodeState.value.result)
    }

    /** A scan up to the confirmation dialog (source gallery, i.e. without the pre-check). */
    private fun untilToDialog(): EntryViewModel {
        val vm = vm()
        vm.resolveBarcode("5702016616316")
        bis("Dialog") { vm.barcodeState.value.result == "75192-1" }
        return vm
    }

    @Test
    fun `a second click on confirm does not create the set twice`() {
        paths.antworten["/api/v1/sets"] = """{"success":true,"action":"added","set_number":"75192-1"}"""
        paths.ausbleibend += "/api/v1/sets"
        val vm = untilToDialog()
        vm.confirmAddBarcode(Erfassungswunsch("75192-1", besitzer = 2))
        // The dialog closes right away, and creation happens in the background — without a check display.
        assertNull(vm.barcodeState.value.result)
        assertTrue(vm.barcodeState.value.hinzufuegen.laeuft)
        assertNull(vm.entryState.value.check)
        vm.confirmAddBarcode(Erfassungswunsch("75192-1", besitzer = 2))
        paths.freigeben()
        bis("fertig") { !vm.barcodeState.value.hinzufuegen.laeuft }
        assertEquals(1, paths.requestsAn("POST /api/v1/sets").size)
        val rumpf = paths.koerper[paths.requests.indexOf("POST /api/v1/sets")]
        assertTrue(rumpf, "\"owner_user_id\":2" in rumpf)
    }

    @Test
    fun `a failure on confirm names the set number and releases the button`() {
        paths.codes["/api/v1/sets"] = 500
        val vm = untilToDialog()
        vm.confirmAddBarcode(Erfassungswunsch("75192-1"))
        bis("gemeldet") { t.meldungen.text?.startsWith("t${R.string.vm_add_failed}") == true }
        assertEquals("t${R.string.vm_add_failed}|75192-1|fehler", t.meldungen.text)
        bis("frei") { !vm.barcodeState.value.hinzufuegen.laeuft }
    }

    @Test
    fun `nothing is created from the parts list, only the number is passed on`() {
        val vm = vm()
        vm.resolveBarcode("5702016616316", Scannerherkunft.TEILELISTE)
        bis("Dialog") { vm.barcodeState.value.result == "75192-1" }
        vm.confirmAddBarcode(Erfassungswunsch("75192-1"))
        assertEquals("75192-1", vm.barcodeState.value.forPartList)
        assertNull(vm.barcodeState.value.result)
        clock.advanceUntilIdle()
        assertTrue(paths.requestsAn("POST /api/v1/sets").isEmpty())
    }

    @Test
    fun `text recognition asks the server, shows that and opens an existing set`() {
        paths.ausbleibend += "/api/v1/sets/exists/75192-1"
        val vm = vm()
        vm.useScannedSetNumber("75192")
        assertEquals(CheckPhase.BESTAND, vm.entryState.value.check?.phase)
        paths.freigeben()
        bis("gefunden") { vm.barcodeState.value.gefundenesSet == "75192-1" }
        bis("Prüfanzeige weg") { vm.entryState.value.check == null }
        assertTrue("Ein vorhandenes Set fragt den Katalog nicht", paths.requestsAn("/catalog/").isEmpty())
    }

    @Test
    fun `an error of the pre-query aborts instead of guessing`() {
        paths.codes["/api/v1/sets/exists/10294-1"] = 500
        val vm = vm()
        vm.useScannedSetNumber("10294")
        bis("gemeldet") { t.meldungen.text == "fehler" }
        bis("Prüfanzeige weg") { vm.entryState.value.check == null }
        assertNull(vm.barcodeState.value.result)
        assertTrue("Nach einem Fehler wird nicht auf gut Glück weitergefragt", paths.requestsAn("/catalog/").isEmpty())
    }

    @Test
    fun `every unsuccessful path requests manual adding`() {
        paths.antworten["/api/v1/sets/barcode/111"] = """{"success":true,"set_number":""}"""
        paths.antworten["/api/v1/sets/exists/10294-1"] = """{"success":true,"exists":false,"set_number":"10294-1"}"""
        paths.antworten["/api/v1/catalog/sets/10294-1"] = """{"success":true}"""
        val vm = vm()
        val routes = listOf<Pair<String, () -> Unit>>(
            "EAN ohne Setnummer" to { vm.resolveBarcode("111") },
            "Texterkennung ohne Katalogeintrag" to { vm.useScannedSetNumber("10294") },
            "Katalogabfrage gescheitert" to {
                paths.codes["/api/v1/catalog/sets/10294-1"] = 500
                vm.useScannedSetNumber("10294")
            },
        )
        for ((name, weg) in routes) {
            vm.manuelleErfassungQuittieren()
            weg()
            bis(name) { vm.barcodeState.value.manuelleErfassungAnfordern }
            bis("$name: Prüfanzeige weg") { vm.entryState.value.check == null }
        }
    }

    @Test
    fun `the abort ends the fetch and not only the display`() {
        paths.ausbleibend += "/api/v1/sets/exists/75192-1"
        val vm = vm()
        vm.useScannedSetNumber("75192")
        assertTrue(vm.entryState.value.check != null)
        vm.abortCheckAb()
        assertNull(vm.entryState.value.check)
        paths.freigeben()
        clock.advanceUntilIdle()
        assertNull("Der abgebrochene Abruf öffnet hinterher doch noch das Set",
            vm.barcodeState.value.gefundenesSet)
    }

    @Test
    fun `sign-out also clears the check display`() {
        paths.ausbleibend += "/api/v1/sets/exists/75192-1"
        val vm = vm()
        vm.useScannedSetNumber("75192")
        assertTrue(vm.entryState.value.check != null)
        t.sitzung.abgemeldet()
        bis("geräumt") { vm.entryState.value.check == null }
        paths.freigeben()
        clock.advanceUntilIdle()
        assertNull(vm.barcodeState.value.gefundenesSet)
    }
}
