package ch.brickinventoryapp.collection

import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.ui.running
import ch.brickinventoryapp.model.ui.ScannerOrigin
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.Condition

import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.model.domain.SetRecorded
import ch.brickinventoryapp.testing.testCatalogRepository
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import ch.brickinventoryapp.collection.ui.CheckPhase
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.state.ui.viewmodel.Texts
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
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.testing.PathServer
import ch.brickinventoryapp.testing.TestServices
import ch.brickinventoryapp.testing.text

/**
 * The entry ViewModel: scan, add by set number, check display.
 * The event stream of creating is simulated ([SetCreator]); everything else
 * runs in step against a PathServer; "in flight" means held back.
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
 *   E  in confirmAddBarcode() the guard `if (state.add.running) return` removed →
 *      red “a second click on confirm …”; likewise if the dialog only
 *      closes after the answer or the owner is not carried along
 *   F  `add = Operation.Done` removed after the answer → red “a failure on
 *      confirm …” and “a second click …”
 *   G  the `return` removed in the parts-list branch → red “nothing is added
 *      from the parts list …”
 *   H  in useScannedSetNumber() the pre-check skipped → red “text
 *      recognition asks the server …” and “an error of the pre-check …”
 *   I  in showExisting() carried on after an error → red “an error
 *      of the pre-check aborts …”
 *   J  no manual entry on a failed catalog lookup → red “every
 *      unsuccessful path …”
 *   K  in cancelCheck() the job not cancelled → red “the abort …”
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
    private val tick = UnconfinedTestDispatcher(clock)
    private lateinit var paths: PathServer
    private lateinit var t: TestServices

    /** Lets the test clock run until nothing is pending, then checks [condition]. */
    private fun until(was: String, condition: () -> Boolean) {
        clock.advanceUntilIdle()
        assertTrue(was, condition())
    }

    /** Like NumbersTexts, but with the arguments — the test also checks WHAT was substituted. */
    private object TextsWithArguments : Texts {
        override fun text(id: Int, vararg args: Any?) = "t$id" + args.joinToString("") { "|$it" }
        override fun quantity(id: Int, count: Int, vararg args: Any?) = "m$id:$count"
        override fun message(error: Outcome.Failure) = "fehler"
        override fun loggedIn() = true
    }

    /** Plays back the steps and records the check phases that were seen along the way. */
    private class Creator(val steps: List<SetCreateStep>) : SetCreator {
        var vm: EntryViewModel? = null
        val seen = mutableListOf<CheckPhase?>()
        override fun create(setNumber: String, quantity: Int, purchasePrice: Money?, condition: Condition?,
                             ownerUserId: Int?, storage: String?): Flow<SetCreateStep> = flow {
            for (s in steps) {
                emit(s)
                seen += vm?.entryState?.value?.check?.phase
            }
        }
    }

    private fun vm(creator: Creator = Creator(emptyList())) = t.track(
        EntryViewModel(t.session, t.filter(), t.hints, t.sets(), t.setCatalog(), t.wantedList(), testCatalogRepository(t.api), creator)
    ).also { creator.vm = it }

    @Before
    fun setUp() {
        Dispatchers.setMain(tick)
        paths = PathServer(
            "/api/v1/sets/barcode/5702016616316" to """{"success":true,"set_number":"75192-1","name":"Falke"}""",
            "/api/v1/sets/exists/75192-1" to """{"success":true,"exists":true,"set_number":"75192-1"}""",
            "/api/v1/wanted" to """{"success":true,"war_neu":true}""",
        )
        t = TestServices(paths.onTick(), TextsWithArguments, io = tick)
    }

    @After
    fun tearDown() {
        t.cleanUp()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `a scanned set that already exists is opened instead of added`() {
        val vm = vm()
        vm.resolveBarcode("5702016616316", ScannerOrigin.GALLERY_SEARCH)
        until("gefunden") { vm.barcodeState.value.foundSet == "75192-1" }
        assertNull("Kein Bestätigungsdialog", vm.barcodeState.value.result)
        until("Prüfanzeige weg") { vm.entryState.value.check == null }
    }

    @Test
    fun `an unsuccessful scan opens manual adding and clears the check display`() {
        paths.responses["/api/v1/sets/barcode/0000"] = """{"success":false,"code":"barcode_kein_set","error":"Kein Set"}"""
        paths.codes["/api/v1/sets/barcode/0000"] = 404
        val vm = vm()
        vm.resolveBarcode("0000")
        until("manuell") { vm.barcodeState.value.requestManualEntry }
        assertEquals("t${R.string.vm_barcode_not_found}|0000", t.messages.text)
        until("Prüfanzeige weg") { vm.entryState.value.check == null }
    }

    @Test
    fun `a server error during the scan does not mean the set does not exist`() {
        paths.responses["/api/v1/sets/barcode/0001"] = """{"success":false,"code":"interner_fehler"}"""
        paths.codes["/api/v1/sets/barcode/0001"] = 500
        val vm = vm()
        vm.resolveBarcode("0001")
        until("manuell") { vm.barcodeState.value.requestManualEntry }
        assertEquals("fehler", t.messages.text)
    }

    @Test
    fun `the creation shows the server's steps and reports the new set`() {
        val creator = Creator(listOf(
            SetCreateStep.MasterData("Falke"), SetCreateStep.Image, SetCreateStep.FastDone,
            SetCreateStep.Done(SetRecorded(number = "75192-1", created = true)),
        ))
        val vm = vm(creator)
        vm.addSet(EntryRequest("75192"))
        until("fertig") { vm.entryState.value.check == null && t.messages.text != null }
        assertEquals(listOf(CheckPhase.CREATE_MASTER_DATA, CheckPhase.CREATE_IMAGE, CheckPhase.CREATE_COMPLETION),
            creator.seen.take(3))
        assertEquals("t${R.string.vm_added}|75192-1", t.messages.text)
        // Name and image are known only to the server: the store fetches the gallery afterwards.
        until("nachgezogen") { paths.requestsTo("GET /api/v1/sets?").isNotEmpty() }
    }

    /**
     * Counter-check (measured 28.10.2026, kotlinc): the branch `catalogOpen`
     * removed → red, "added" is reported (vm_added).
     */
    @Test
    fun `without a catalog the creation reports saved, not added`() {
        val vm = vm(Creator(listOf(SetCreateStep.Done(
            SetRecorded(number = "99999-1", created = true, catalogOpen = true)))))
        vm.addSet(EntryRequest("99999"))
        until("Meldung") { t.messages.text != null }
        assertEquals("t${R.string.vm_set_added_no_catalog}|99999-1", t.messages.text)
    }

    @Test
    fun `an existing set during creation opens the detail view and reports nothing`() {
        val vm = vm(Creator(listOf(SetCreateStep.Done(SetRecorded(number = "75192-1", present = true)))))
        vm.addSet(EntryRequest("75192-1"))
        until("gefunden") { vm.barcodeState.value.foundSet == "75192-1" }
        assertTrue("nichts angelegt, nichts nachzuziehen", paths.requestsTo("GET /api/v1/sets?").isEmpty())
    }

    @Test
    fun `an aborted event stream is a network error, not a sentence of the server`() {
        val vm = vm(Creator(listOf(SetCreateStep.Failure(""))))
        vm.addSet(EntryRequest("75192-1"))
        until("gemeldet") { t.messages.text != null }
        // A network error is formulated via message() ("fehler"); a sentence
        // from the server would come unchanged — here empty — and say nothing.
        assertEquals("t${R.string.vm_add_failed}|75192-1|fehler", t.messages.text)
    }

    @Test
    fun `a scan from the wishlist creates a wishlist item and closes the dialog`() {
        val vm = vm()
        vm.resolveBarcode("5702016616316", ScannerOrigin.WANTED_LIST)
        until("Dialog") { vm.barcodeState.value.result == "75192-1" }
        vm.confirmAddBarcode(EntryRequest("75192-1", condition = Condition.USED))
        until("gemeldet") { t.messages.text != null }
        val wantedList = runBlocking { t.wantedList().observeWanted().first().list }
        assertEquals("der Merkposten steht in der Ablage", listOf("75192-1"), wantedList.map { it.setNumber })
        assertEquals("t${R.string.wanted_added}", t.messages.text)
        assertTrue(paths.requestsTo("POST /api/v1/wanted").isNotEmpty())
        assertNull(vm.barcodeState.value.result)
    }

    /** A scan up to the confirmation dialog (source gallery, i.e. without the pre-check). */
    private fun untilToDialog(): EntryViewModel {
        val vm = vm()
        vm.resolveBarcode("5702016616316")
        until("Dialog") { vm.barcodeState.value.result == "75192-1" }
        return vm
    }

    @Test
    fun `a second click on confirm does not create the set twice`() {
        paths.responses["/api/v1/sets"] = """{"success":true,"action":"added","set_number":"75192-1"}"""
        paths.missing += "/api/v1/sets"
        val vm = untilToDialog()
        vm.confirmAddBarcode(EntryRequest("75192-1", owner = 2))
        // The dialog closes right away, and creation happens in the background — without a check display.
        assertNull(vm.barcodeState.value.result)
        assertTrue(vm.barcodeState.value.add.running)
        assertNull(vm.entryState.value.check)
        vm.confirmAddBarcode(EntryRequest("75192-1", owner = 2))
        paths.release()
        until("fertig") { !vm.barcodeState.value.add.running }
        assertEquals(1, paths.requestsTo("POST /api/v1/sets").size)
        val body = paths.bodyBytes[paths.requests.indexOf("POST /api/v1/sets")]
        assertTrue(body, "\"owner_user_id\":2" in body)
    }

    @Test
    fun `a failure on confirm names the set number and releases the button`() {
        paths.codes["/api/v1/sets"] = 500
        val vm = untilToDialog()
        vm.confirmAddBarcode(EntryRequest("75192-1"))
        until("gemeldet") { t.messages.text?.startsWith("t${R.string.vm_add_failed}") == true }
        assertEquals("t${R.string.vm_add_failed}|75192-1|fehler", t.messages.text)
        until("frei") { !vm.barcodeState.value.add.running }
    }

    @Test
    fun `nothing is created from the parts list, only the number is passed on`() {
        val vm = vm()
        vm.resolveBarcode("5702016616316", ScannerOrigin.PART_LIST)
        until("Dialog") { vm.barcodeState.value.result == "75192-1" }
        vm.confirmAddBarcode(EntryRequest("75192-1"))
        assertEquals("75192-1", vm.barcodeState.value.forPartList)
        assertNull(vm.barcodeState.value.result)
        clock.advanceUntilIdle()
        assertTrue(paths.requestsTo("POST /api/v1/sets").isEmpty())
    }

    @Test
    fun `text recognition asks the server, shows that and opens an existing set`() {
        paths.missing += "/api/v1/sets/exists/75192-1"
        val vm = vm()
        vm.useScannedSetNumber("75192")
        assertEquals(CheckPhase.STOCK, vm.entryState.value.check?.phase)
        paths.release()
        until("gefunden") { vm.barcodeState.value.foundSet == "75192-1" }
        until("Prüfanzeige weg") { vm.entryState.value.check == null }
        assertTrue("Ein vorhandenes Set fragt den Katalog nicht", paths.requestsTo("/catalog/").isEmpty())
    }

    @Test
    fun `an error of the pre-query aborts instead of guessing`() {
        paths.codes["/api/v1/sets/exists/10294-1"] = 500
        val vm = vm()
        vm.useScannedSetNumber("10294")
        until("gemeldet") { t.messages.text == "fehler" }
        until("Prüfanzeige weg") { vm.entryState.value.check == null }
        assertNull(vm.barcodeState.value.result)
        assertTrue("Nach einem Fehler wird nicht auf gut Glück weitergefragt", paths.requestsTo("/catalog/").isEmpty())
    }

    @Test
    fun `every unsuccessful path requests manual adding`() {
        paths.responses["/api/v1/sets/barcode/111"] = """{"success":true,"set_number":""}"""
        paths.responses["/api/v1/sets/exists/10294-1"] = """{"success":true,"exists":false,"set_number":"10294-1"}"""
        paths.responses["/api/v1/catalog/sets/10294-1"] = """{"success":true}"""
        val vm = vm()
        val routes = listOf<Pair<String, () -> Unit>>(
            "EAN ohne Setnummer" to { vm.resolveBarcode("111") },
            "Texterkennung ohne Katalogeintrag" to { vm.useScannedSetNumber("10294") },
            "Katalogabfrage gescheitert" to {
                paths.codes["/api/v1/catalog/sets/10294-1"] = 500
                vm.useScannedSetNumber("10294")
            },
        )
        for ((name, gone) in routes) {
            vm.acknowledgeManualEntry()
            gone()
            until(name) { vm.barcodeState.value.requestManualEntry }
            until("$name: Prüfanzeige weg") { vm.entryState.value.check == null }
        }
    }

    @Test
    fun `the abort ends the fetch and not only the display`() {
        paths.missing += "/api/v1/sets/exists/75192-1"
        val vm = vm()
        vm.useScannedSetNumber("75192")
        assertTrue(vm.entryState.value.check != null)
        vm.cancelCheck()
        assertNull(vm.entryState.value.check)
        paths.release()
        clock.advanceUntilIdle()
        assertNull("Der abgebrochene Abruf öffnet hinterher doch noch das Set",
            vm.barcodeState.value.foundSet)
    }

    @Test
    fun `sign-out also clears the check display`() {
        paths.missing += "/api/v1/sets/exists/75192-1"
        val vm = vm()
        vm.useScannedSetNumber("75192")
        assertTrue(vm.entryState.value.check != null)
        t.session.loggedOut()
        until("geräumt") { vm.entryState.value.check == null }
        paths.release()
        clock.advanceUntilIdle()
        assertNull(vm.barcodeState.value.foundSet)
    }
}
