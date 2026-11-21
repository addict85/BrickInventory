package ch.brickinventoryapp.parts

import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.testing.text
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.domain.Teilelistenauftrag
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.parts.ui.PartListsSource
import ch.brickinventoryapp.parts.ui.PlPart
import ch.brickinventoryapp.data.service.ExportResult
import ch.brickinventoryapp.data.service.PartListsExport
import ch.brickinventoryapp.data.service.PdfFailure
import ch.brickinventoryapp.data.repository.Ergebnis
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
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste

/**
 * The build list lives in the ViewModel: list, running fetch and status survive
 * a rotation, the set numbers also a process end. Without network (doubles for
 * the source and export) and with StandardTestDispatcher instead of waiting.
 *
 * Counter-checks:
 *   A  in erstelle() the key `"${p.blPartNumber ?: p.partNumber}|${p.colorName}"`
 *      replaced with `"${p.partNumber}|${p.colorName}|${combined.size}"`
 *      (gegenproben/bauliste-ohne-zusammenfassen.patch) → red “identical parts
 *      across several sets are counted together”
 *   B  in aendere() the remembering in the SavedStateHandle removed → red “the set numbers
 *      survive a process end …”
 *   C  zuruecksetzen() not overridden → red “a sign-out empties the build list”
 *   D  in exportiere() the file not taken into the state → red “a finished
 *      PDF is offered once …”
 *   E  gegenproben/pdf-fehler-leer.patch: errorText() for a failed
 *      job again returns only the server's sentence (even empty) → red “an error always has
 *      a sentence …” (measurable only in the CI)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PartListViewModelTest {

    private val takt = StandardTestDispatcher()
    private lateinit var paths: PfadServer
    private lateinit var t: TestDienste
    private val erzeugt = mutableListOf<PartListViewModel>()

    @Before
    fun an() {
        Dispatchers.setMain(takt)
        paths = PfadServer()
        t = TestDienste(paths.server)
    }

    @After
    fun aus() {
        erzeugt.forEach { it.viewModelScope.cancel() }
        takt.scheduler.advanceUntilIdle()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    private class Quelle(val teile: Map<String, List<PlPart>> = emptyMap()) : PartListsSource {
        val gefragt = mutableListOf<String>()
        var brake: CompletableDeferred<Unit>? = null
        var bestand: List<PlPart>? = null
        override suspend fun resolveSetOn(setNumber: String, serverUrl: String): Pair<String, List<PlPart>> {
            gefragt += setNumber
            brake?.await()
            return "Name $setNumber" to teile[setNumber].orEmpty()
        }
        override suspend fun withInventory(teile: List<PlPart>, onlyLose: Boolean, withSubAccounts: Boolean) = bestand
        override fun sortiert(teile: Collection<PlPart>) = teile.sortedBy { it.partNumber }
    }

    private class Export(
        val ergebnis: ExportResult,
        override val fortschritt: Flow<PdfProgress?> = flowOf(null),
    ) : PartListsExport {
        val auftraege = mutableListOf<Teilelistenauftrag>()
        override suspend fun erzeuge(job: Teilelistenauftrag): ExportResult { auftraege += job; return ergebnis }
    }

    private fun vm(
        quelle: Quelle = Quelle(),
        export: Export = Export(ExportResult.Fehler(PdfFailure.Abruf(Ergebnis.Fehler.Netz()))),
        gemerkt: SavedStateHandle = SavedStateHandle(),
    ) = PartListViewModel(t.sitzung, t.hinweise, quelle, export, gemerkt).also { erzeugt += it }

    private fun teil(nr: String, menge: Int, farbe: String = "Rot") =
        PlPart(partNumber = nr, partName = nr, colorName = farbe, colorHex = null, quantity = menge, imageUrl = null)

    @Test
    fun `the fetch runs in the ViewModel and delivers the list`() = runTest(takt) {
        val quelle = Quelle(mapOf("21318-1" to listOf(teil("3001", 4)))).apply { brake = CompletableDeferred() }
        val vm = vm(quelle)
        vm.erstelle("21318")
        advanceUntilIdle()
        assertTrue("Während des Abrufs lädt die Liste", vm.zustand.value.erzeugen.laedt)
        assertEquals(R.string.partslist_loading_set, (vm.zustand.value.status as Meldung.Resource).id)
        quelle.brake!!.complete(Unit)
        advanceUntilIdle()
        val z = vm.zustand.value
        assertFalse(z.erzeugen.laedt)
        assertTrue(z.generated)
        assertEquals(listOf("3001"), z.parts.map { it.partNumber })
        assertEquals("Der Name aus dem Katalog steht am Set", listOf("Name 21318-1"), z.sets.map { it.name })
        assertEquals(listOf("21318-1"), quelle.gefragt)
    }

    @Test
    fun `equal parts of several sets are added up`() = runTest(takt) {
        val quelle = Quelle(mapOf(
            "10294-1" to listOf(teil("3001", 2), teil("3002", 1)),
            "21318-1" to listOf(teil("3001", 3), teil("3001", 1, farbe = "Blau")),
        ))
        val vm = vm(quelle)
        vm.addAdd("10294")
        vm.erstelle("21318-1")
        advanceUntilIdle()
        val quantities = vm.zustand.value.parts.associate { "${it.partNumber}|${it.colorName}" to it.quantity }
        assertEquals(mapOf("3001|Rot" to 5, "3002|Rot" to 1, "3001|Blau" to 1), quantities)
    }

    @Test
    fun `a number appears only once in the list`() = runTest(takt) {
        val vm = vm()
        vm.addAdd("10294")
        vm.addAdd("10294-1")
        assertEquals(listOf("10294-1"), vm.zustand.value.sets.map { it.setNumber })
        assertEquals(Meldung.Resource(R.string.partslist_set_already_added), vm.zustand.value.status)
    }

    @Test
    fun `the set numbers survive the process end, the parts do not`() = runTest(takt) {
        val gemerkt = SavedStateHandle()
        val vorher = vm(Quelle(mapOf("10294-1" to listOf(teil("3001", 2)))), gemerkt = gemerkt)
        vorher.erstelle("10294")
        advanceUntilIdle()
        val after = vm(gemerkt = gemerkt)
        assertEquals(listOf("10294-1"), after.zustand.value.sets.map { it.setNumber })
        assertTrue("Tausend Zeilen gehören nicht ins Bundle", after.zustand.value.parts.isEmpty())
        assertFalse(after.zustand.value.generated)
    }

    @Test
    fun `the stock names what is missing`() = runTest(takt) {
        val quelle = Quelle(mapOf("10294-1" to listOf(teil("3001", 4), teil("3002", 1))))
        val vm = vm(quelle)
        vm.erstelle("10294")
        advanceUntilIdle()
        quelle.bestand = listOf(teil("3001", 4).copy(vorhanden = 1), teil("3002", 1).copy(vorhanden = 1))
        vm.loadInventory()
        advanceUntilIdle()
        // Three copies missing, of one part: the quantity form with the number of copies.
        assertEquals("m${R.plurals.partslist_owned_missing}:3", vm.zustand.value.status.text)
        assertEquals(listOf(1, 1), vm.zustand.value.parts.map { it.vorhanden })
        quelle.bestand = null
        vm.loadInventory()
        advanceUntilIdle()
        assertEquals(Meldung.Resource(R.string.partslist_owned_error), vm.zustand.value.status)
        assertEquals(Vorgang.Fertig, vm.zustand.value.bestand)
    }

    @Test
    fun `a finished PDF is offered once, an error reported`() = runTest(takt) {
        val datei = File("teileliste.pdf")
        val export = Export(ExportResult.Datei(datei))
        val vm = vm(Quelle(mapOf("10294-1" to listOf(teil("3001", 2)))), export)
        vm.erstelle("10294")
        advanceUntilIdle()
        vm.exportiere()
        advanceUntilIdle()
        assertEquals(datei, vm.zustand.value.pdfFile)
        val job = export.auftraege.single()
        assertEquals("Der Auftrag nennt das Set", listOf("10294-1"), job.sets.map { it.nummer })
        assertEquals(listOf("3001" to 2), job.zeilen.map { it.nummer to it.menge })
        vm.pdfOpened()
        assertNull(vm.zustand.value.pdfFile)

        val ohne = vm(Quelle(mapOf("10294-1" to listOf(teil("3001", 2)))))
        ohne.erstelle("10294")
        advanceUntilIdle()
        ohne.exportiere()
        advanceUntilIdle()
        // The fetch speaks like every fetch (errorMessage), not empty.
        assertTrue(ohne.zustand.value.pdf is Vorgang.Fehlgeschlagen)
        ohne.pdfErrorSeen()
        assertEquals(Vorgang.Fertig, ohne.zustand.value.pdf)
    }

    @Test
    fun `an error always has a sentence, even without the server's sentence`() = runTest(takt) {
        for ((grund, erwartet) in listOf(
            PdfFailure.Auftrag(null) to "t${R.string.pdfexp_server_error}",
            PdfFailure.Auftrag("") to "t${R.string.pdfexp_server_error}",
            PdfFailure.Auftrag("Bild fehlt") to "Bild fehlt",
            PdfFailure.Abruf(Ergebnis.Fehler.Abgewiesen()) to "t${R.string.err_session_expired}",
        )) {
            val vm = vm(Quelle(mapOf("10294-1" to listOf(teil("3001", 2)))), Export(ExportResult.Fehler(grund)))
            vm.erstelle("10294")
            advanceUntilIdle()
            vm.exportiere()
            advanceUntilIdle()
            assertEquals("$grund", erwartet, vm.zustand.value.pdf.errorMessage.text)
        }
    }

    @Test
    fun `the state of the export becomes a sentence, the remaining time only while it lasts`() = runTest(takt) {
        val stand = MutableStateFlow<PdfProgress?>(PdfProgress(PdfStep.CREATED, 12))
        val vm = vm(export = Export(ExportResult.Datei(File("x.pdf")), stand))
        backgroundScope.launch { vm.pdfExportStatus.collect {} }
        advanceUntilIdle()
        assertEquals("t${R.string.pdfexp_creating_eta}", vm.pdfExportStatus.value)
        stand.value = PdfProgress(PdfStep.CREATED, 0)
        advanceUntilIdle()
        assertEquals("t${R.string.pdfexp_almost_done}", vm.pdfExportStatus.value)
        stand.value = null
        advanceUntilIdle()
        assertNull(vm.pdfExportStatus.value)
    }

    @Test
    fun `a sign-out empties the build list`() = runTest(takt) {
        val vm = vm(Quelle(mapOf("10294-1" to listOf(teil("3001", 2)))))
        vm.erstelle("10294")
        advanceUntilIdle()
        t.sitzung.abgemeldet()
        advanceUntilIdle()
        assertTrue(vm.zustand.value.sets.isEmpty())
        assertTrue(vm.zustand.value.parts.isEmpty())
    }
}
