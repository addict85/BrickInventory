package ch.brickinventoryapp.parts

import ch.brickinventoryapp.model.ui.Operation
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.testing.text
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.domain.PartListJob
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.parts.ui.PartListsSource
import ch.brickinventoryapp.parts.ui.PlPart
import ch.brickinventoryapp.data.service.ExportResult
import ch.brickinventoryapp.data.service.PartListsExport
import ch.brickinventoryapp.data.service.PdfFailure
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.domain.PdfProgress
import ch.brickinventoryapp.model.domain.PdfStep
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import ch.brickinventoryapp.parts.ui.viewmodel.PartListViewModel
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.PathServer
import ch.brickinventoryapp.testing.TestServices

/**
 * The build list lives in the ViewModel: list, running fetch and status survive
 * a rotation, the set numbers also a process end. Without network (doubles for
 * the source and export) and with StandardTestDispatcher instead of waiting.
 *
 * Counter-checks:
 *   A  in createNow() the key `"${p.blPartNumber ?: p.partNumber}|${p.colorName}"`
 *      replaced with `"${p.partNumber}|${p.colorName}|${combined.size}"`
 *      (counter-checks/bauliste-ohne-zusammenfassen.patch) → red “identical parts
 *      across several sets are counted together”
 *   B  in applyChangeTo() the remembering in the SavedStateHandle removed → red “the set numbers
 *      survive a process end …”
 *   C  zuruecksetzen() not overridden → red “a sign-out empties the build list”
 *   D  in export() the file not taken into the state → red “a finished
 *      PDF is offered once …”
 *   E  counter-checks/pdf-fehler-leer.patch: errorText() for a failed
 *      job again returns only the server's sentence (even empty) → red “an error always has
 *      a sentence …” (measurable only in the CI)
 *   F  undoRemove() without the branch for an unchanged list (always re-inserting with
 *      generated = false) → red “undo after removing brings back the generated list”;
 *      removalSeen() clearing unconditionally → red “a newer removal keeps its undo”
 *      (not locally runnable, to be checked in CI)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PartListViewModelTest {

    private val tick = StandardTestDispatcher()
    private lateinit var paths: PathServer
    private lateinit var t: TestServices
    private val created = mutableListOf<PartListViewModel>()

    @Before
    fun an() {
        Dispatchers.setMain(tick)
        paths = PathServer()
        t = TestServices(paths.server)
    }

    @After
    fun from() {
        created.forEach { it.viewModelScope.cancel() }
        tick.scheduler.advanceUntilIdle()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    private class Source(val parts: Map<String, List<PlPart>> = emptyMap()) : PartListsSource {
        val asked = mutableListOf<String>()
        var brake: CompletableDeferred<Unit>? = null
        var stock: List<PlPart>? = null
        override suspend fun resolveSetOn(setNumber: String, serverUrl: String): Pair<String, List<PlPart>> {
            asked += setNumber
            brake?.await()
            return "Name $setNumber" to parts[setNumber].orEmpty()
        }
        override suspend fun withInventory(parts: List<PlPart>, onlyLose: Boolean, withSubAccounts: Boolean) = stock
        override fun sorted(parts: Collection<PlPart>) = parts.sortedBy { it.partNumber }
    }

    private class Export(
        val outcome: ExportResult,
        override val progress: Flow<PdfProgress?> = flowOf(null),
    ) : PartListsExport {
        val jobs = mutableListOf<PartListJob>()
        override suspend fun generate(job: PartListJob): ExportResult { jobs += job; return outcome }
    }

    private fun vm(
        source: Source = Source(),
        export: Export = Export(ExportResult.Failure(PdfFailure.Fetch(Outcome.Failure.Network()))),
        wanted: SavedStateHandle = SavedStateHandle(),
    ) = PartListViewModel(t.session, t.hints, source, export, wanted).also { created += it }

    private fun part(nr: String, quantity: Int, color: String = "Rot") =
        PlPart(partNumber = nr, partName = nr, colorName = color, colorHex = null, quantity = quantity, imageUrl = null)

    @Test
    fun `the fetch runs in the ViewModel and delivers the list`() = runTest(tick) {
        val source = Source(mapOf("21318-1" to listOf(part("3001", 4)))).apply { brake = CompletableDeferred() }
        val vm = vm(source)
        vm.createNow("21318")
        advanceUntilIdle()
        assertTrue("Während des Abrufs lädt die Liste", vm.uiState.value.generating.loading)
        assertEquals(R.string.partslist_loading_set, (vm.uiState.value.status as Message.Resource).id)
        source.brake!!.complete(Unit)
        advanceUntilIdle()
        val z = vm.uiState.value
        assertFalse(z.generating.loading)
        assertTrue(z.generated)
        assertEquals(listOf("3001"), z.parts.map { it.partNumber })
        assertEquals("Der Name aus dem Katalog steht am Set", listOf("Name 21318-1"), z.sets.map { it.name })
        assertEquals(listOf("21318-1"), source.asked)
    }

    @Test
    fun `equal parts of several sets are added up`() = runTest(tick) {
        val source = Source(mapOf(
            "10294-1" to listOf(part("3001", 2), part("3002", 1)),
            "21318-1" to listOf(part("3001", 3), part("3001", 1, color = "Blau")),
        ))
        val vm = vm(source)
        vm.addAdd("10294")
        vm.createNow("21318-1")
        advanceUntilIdle()
        val quantities = vm.uiState.value.parts.associate { "${it.partNumber}|${it.colorName}" to it.quantity }
        assertEquals(mapOf("3001|Rot" to 5, "3002|Rot" to 1, "3001|Blau" to 1), quantities)
    }

    @Test
    fun `a number appears only once in the list`() = runTest(tick) {
        val vm = vm()
        vm.addAdd("10294")
        vm.addAdd("10294-1")
        assertEquals(listOf("10294-1"), vm.uiState.value.sets.map { it.setNumber })
        assertEquals(Message.Resource(R.string.partslist_set_already_added), vm.uiState.value.status)
    }

    @Test
    fun `the set numbers survive the process end, the parts do not`() = runTest(tick) {
        val wanted = SavedStateHandle()
        val before = vm(Source(mapOf("10294-1" to listOf(part("3001", 2)))), wanted = wanted)
        before.createNow("10294")
        advanceUntilIdle()
        val after = vm(wanted = wanted)
        assertEquals(listOf("10294-1"), after.uiState.value.sets.map { it.setNumber })
        assertTrue("Tausend Zeilen gehören nicht ins Bundle", after.uiState.value.parts.isEmpty())
        assertFalse(after.uiState.value.generated)
    }

    @Test
    fun `the stock names what is missing`() = runTest(tick) {
        val source = Source(mapOf("10294-1" to listOf(part("3001", 4), part("3002", 1))))
        val vm = vm(source)
        vm.createNow("10294")
        advanceUntilIdle()
        source.stock = listOf(part("3001", 4).copy(present = 1), part("3002", 1).copy(present = 1))
        vm.loadInventory()
        advanceUntilIdle()
        // Three copies missing, of one part: the quantity form with the number of copies.
        assertEquals("m${R.plurals.partslist_owned_missing}:3", vm.uiState.value.status.text)
        assertEquals(listOf(1, 1), vm.uiState.value.parts.map { it.present })
        source.stock = null
        vm.loadInventory()
        advanceUntilIdle()
        assertEquals(Message.Resource(R.string.partslist_owned_error), vm.uiState.value.status)
        assertEquals(Operation.Done, vm.uiState.value.stock)
    }

    @Test
    fun `a finished PDF is offered once, an error reported`() = runTest(tick) {
        val file = File("teileliste.pdf")
        val export = Export(ExportResult.FileEntry(file))
        val vm = vm(Source(mapOf("10294-1" to listOf(part("3001", 2)))), export)
        vm.createNow("10294")
        advanceUntilIdle()
        vm.export()
        advanceUntilIdle()
        assertEquals(file, vm.uiState.value.pdfFile)
        val job = export.jobs.single()
        assertEquals("Der Auftrag nennt das Set", listOf("10294-1"), job.sets.map { it.number })
        assertEquals(listOf("3001" to 2), job.rows.map { it.number to it.quantity })
        vm.pdfOpened()
        assertNull(vm.uiState.value.pdfFile)

        val without = vm(Source(mapOf("10294-1" to listOf(part("3001", 2)))))
        without.createNow("10294")
        advanceUntilIdle()
        without.export()
        advanceUntilIdle()
        // The fetch speaks like every fetch (errorMessage), not empty.
        assertTrue(without.uiState.value.pdf is Operation.Failed)
        without.pdfErrorSeen()
        assertEquals(Operation.Done, without.uiState.value.pdf)
    }

    @Test
    fun `an error always has a sentence, even without the server's sentence`() = runTest(tick) {
        for ((reason, expected) in listOf(
            PdfFailure.Job(null) to "t${R.string.pdfexp_server_error}",
            PdfFailure.Job("") to "t${R.string.pdfexp_server_error}",
            PdfFailure.Job("Bild fehlt") to "Bild fehlt",
            PdfFailure.Fetch(Outcome.Failure.Rejected()) to "t${R.string.err_session_expired}",
        )) {
            val vm = vm(Source(mapOf("10294-1" to listOf(part("3001", 2)))), Export(ExportResult.Failure(reason)))
            vm.createNow("10294")
            advanceUntilIdle()
            vm.export()
            advanceUntilIdle()
            assertEquals("$reason", expected, vm.uiState.value.pdf.errorMessage.text)
        }
    }

    @Test
    fun `the state of the export becomes a sentence, the remaining time only while it lasts`() = runTest(tick) {
        val state = MutableStateFlow<PdfProgress?>(PdfProgress(PdfStep.CREATED, 12))
        val vm = vm(export = Export(ExportResult.FileEntry(File("x.pdf")), state))
        backgroundScope.launch { vm.pdfExportStatus.collect {} }
        advanceUntilIdle()
        assertEquals("t${R.string.pdfexp_creating_eta}", vm.pdfExportStatus.value)
        state.value = PdfProgress(PdfStep.CREATED, 0)
        advanceUntilIdle()
        assertEquals("t${R.string.pdfexp_almost_done}", vm.pdfExportStatus.value)
        state.value = null
        advanceUntilIdle()
        assertNull(vm.pdfExportStatus.value)
    }

    @Test
    fun `a sign-out empties the build list`() = runTest(tick) {
        val vm = vm(Source(mapOf("10294-1" to listOf(part("3001", 2)))))
        vm.createNow("10294")
        advanceUntilIdle()
        t.session.loggedOut()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.sets.isEmpty())
        assertTrue(vm.uiState.value.parts.isEmpty())
    }

    @Test
    fun `undo after removing brings back the generated list`() = runTest(tick) {
        val vm = vm(Source(mapOf("10294-1" to listOf(part("3001", 2)), "21318-1" to listOf(part("3002", 1)))))
        vm.addAdd("10294")
        vm.createNow("21318")
        advanceUntilIdle()
        vm.remove(0)
        val r = vm.uiState.value.removed!!
        assertEquals(listOf("21318-1"), vm.uiState.value.sets.map { it.setNumber })
        assertFalse(vm.uiState.value.generated)
        vm.undoRemove(r)
        val z = vm.uiState.value
        assertEquals("Wieder an seinem Platz", listOf("10294-1", "21318-1"), z.sets.map { it.setNumber })
        assertTrue("Die Liste gilt wieder, nichts hat sich geändert", z.generated)
        assertNull(z.removed)
    }

    @Test
    fun `undo after a change re-inserts the set, the list must be created anew`() = runTest(tick) {
        val vm = vm()
        vm.addAdd("10294")
        vm.addAdd("21318")
        vm.remove(0)
        val r = vm.uiState.value.removed!!
        vm.addAdd("42100")
        vm.undoRemove(r)
        assertEquals(listOf("10294-1", "21318-1", "42100-1"), vm.uiState.value.sets.map { it.setNumber })
        assertFalse(vm.uiState.value.generated)
    }

    @Test
    fun `a newer removal keeps its undo`() = runTest(tick) {
        val vm = vm()
        vm.addAdd("10294")
        vm.addAdd("21318")
        vm.remove(0)
        val first = vm.uiState.value.removed!!
        vm.remove(0)
        val second = vm.uiState.value.removed!!
        vm.removalSeen(first)
        assertEquals(second, vm.uiState.value.removed)
        vm.removalSeen(second)
        assertNull(vm.uiState.value.removed)
    }
}
