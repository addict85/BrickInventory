package ch.brickinventoryapp.teile

import ch.brickinventoryapp.vertrag.PdfAuftragAnfrage
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.teile.ui.TeilelistenQuelle
import ch.brickinventoryapp.teile.ui.PlPart
import ch.brickinventoryapp.data.service.ExportErgebnis
import ch.brickinventoryapp.data.service.TeilelistenExport
import ch.brickinventoryapp.data.service.PdfFehlschlag
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.fach.PdfFortschritt
import ch.brickinventoryapp.model.fach.PdfSchritt
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import ch.brickinventoryapp.teile.ui.viewmodel.TeilelisteViewModel
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
 * Die Bauliste lebt im ViewModel: Liste, laufender Abruf und Status überstehen
 * eine Drehung, die Setnummern auch das Prozessende. Ohne Netz (Doubles für
 * Quelle und Export) und mit StandardTestDispatcher statt Warten.
 *
 * Gegenproben:
 *   A  in erstelle() den Schlüssel `"${p.blPartNumber ?: p.partNumber}|${p.colorName}"`
 *      durch `"${p.partNumber}|${p.colorName}|${combined.size}"` ersetzt
 *      (gegenproben/bauliste-ohne-zusammenfassen.patch) → rot „gleiche Teile
 *      mehrerer Sets werden zusammengezaehlt“
 *   B  in aendere() das Merken im SavedStateHandle entfernt → rot „die Setnummern
 *      ueberleben das Prozessende …“
 *   C  zuruecksetzen() nicht überschrieben → rot „eine Abmeldung leert die Bauliste“
 *   D  in exportiere() die Datei nicht in den Zustand übernommen → rot „ein fertiges
 *      PDF wird einmal angeboten …“
 *   E  gegenproben/pdf-fehler-leer.patch: fehlerText() gibt für einen gescheiterten
 *      Auftrag wieder nur den Satz des Servers (auch leer) → rot „ein Fehler hat immer
 *      einen Satz …“ (nur in der CI messbar)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeilelisteViewModelTest {

    private val takt = StandardTestDispatcher()
    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste
    private val erzeugt = mutableListOf<TeilelisteViewModel>()

    @Before
    fun an() {
        Dispatchers.setMain(takt)
        pfade = PfadServer()
        t = TestDienste(pfade.server)
    }

    @After
    fun aus() {
        erzeugt.forEach { it.viewModelScope.cancel() }
        takt.scheduler.advanceUntilIdle()
        Dispatchers.resetMain()
        pfade.server.shutdown()
    }

    private class Quelle(val teile: Map<String, List<PlPart>> = emptyMap()) : TeilelistenQuelle {
        val gefragt = mutableListOf<String>()
        var bremse: CompletableDeferred<Unit>? = null
        var bestand: List<PlPart>? = null
        override suspend fun loeseSetAuf(setNumber: String, serverUrl: String): Pair<String, List<PlPart>> {
            gefragt += setNumber
            bremse?.await()
            return "Name $setNumber" to teile[setNumber].orEmpty()
        }
        override suspend fun mitBestand(teile: List<PlPart>, nurLose: Boolean, mitUnterkonten: Boolean) = bestand
        override fun sortiert(teile: Collection<PlPart>) = teile.sortedBy { it.partNumber }
    }

    private class Export(
        val ergebnis: ExportErgebnis,
        override val fortschritt: Flow<PdfFortschritt?> = flowOf(null),
    ) : TeilelistenExport {
        val auftraege = mutableListOf<PdfAuftragAnfrage>()
        override suspend fun erzeuge(auftrag: PdfAuftragAnfrage): ExportErgebnis { auftraege += auftrag; return ergebnis }
    }

    private fun vm(
        quelle: Quelle = Quelle(),
        export: Export = Export(ExportErgebnis.Fehler(PdfFehlschlag.Abruf(Ergebnis.Error.Netz()))),
        gemerkt: SavedStateHandle = SavedStateHandle(),
    ) = TeilelisteViewModel(t.sitzung, t.hinweise, quelle, export, gemerkt).also { erzeugt += it }

    private fun teil(nr: String, menge: Int, farbe: String = "Rot") =
        PlPart(partNumber = nr, partName = nr, colorName = farbe, colorHex = null, quantity = menge, imageUrl = null)

    @Test
    fun `der Abruf laeuft im ViewModel und liefert die Liste`() = runTest(takt) {
        val quelle = Quelle(mapOf("21318-1" to listOf(teil("3001", 4)))).apply { bremse = CompletableDeferred() }
        val vm = vm(quelle)
        vm.erstelle("21318")
        advanceUntilIdle()
        assertTrue("Während des Abrufs lädt die Liste", vm.zustand.value.isLoading)
        assertEquals("t${R.string.partslist_loading_set}", vm.zustand.value.status)
        quelle.bremse!!.complete(Unit)
        advanceUntilIdle()
        val z = vm.zustand.value
        assertFalse(z.isLoading)
        assertTrue(z.generated)
        assertEquals(listOf("3001"), z.parts.map { it.partNumber })
        assertEquals("Der Name aus dem Katalog steht am Set", listOf("Name 21318-1"), z.sets.map { it.name })
        assertEquals(listOf("21318-1"), quelle.gefragt)
    }

    @Test
    fun `gleiche Teile mehrerer Sets werden zusammengezaehlt`() = runTest(takt) {
        val quelle = Quelle(mapOf(
            "10294-1" to listOf(teil("3001", 2), teil("3002", 1)),
            "21318-1" to listOf(teil("3001", 3), teil("3001", 1, farbe = "Blau")),
        ))
        val vm = vm(quelle)
        vm.fuegeHinzu("10294")
        vm.erstelle("21318-1")
        advanceUntilIdle()
        val mengen = vm.zustand.value.parts.associate { "${it.partNumber}|${it.colorName}" to it.quantity }
        assertEquals(mapOf("3001|Rot" to 5, "3002|Rot" to 1, "3001|Blau" to 1), mengen)
    }

    @Test
    fun `eine Nummer steht nur einmal in der Liste`() = runTest(takt) {
        val vm = vm()
        vm.fuegeHinzu("10294")
        vm.fuegeHinzu("10294-1")
        assertEquals(listOf("10294-1"), vm.zustand.value.sets.map { it.setNumber })
        assertEquals("t${R.string.partslist_set_already_added}", vm.zustand.value.status)
    }

    @Test
    fun `die Setnummern ueberleben das Prozessende, die Teile nicht`() = runTest(takt) {
        val gemerkt = SavedStateHandle()
        val vorher = vm(Quelle(mapOf("10294-1" to listOf(teil("3001", 2)))), gemerkt = gemerkt)
        vorher.erstelle("10294")
        advanceUntilIdle()
        val nachher = vm(gemerkt = gemerkt)
        assertEquals(listOf("10294-1"), nachher.zustand.value.sets.map { it.setNumber })
        assertTrue("Tausend Zeilen gehören nicht ins Bundle", nachher.zustand.value.parts.isEmpty())
        assertFalse(nachher.zustand.value.generated)
    }

    @Test
    fun `der Bestand nennt, was fehlt`() = runTest(takt) {
        val quelle = Quelle(mapOf("10294-1" to listOf(teil("3001", 4), teil("3002", 1))))
        val vm = vm(quelle)
        vm.erstelle("10294")
        advanceUntilIdle()
        quelle.bestand = listOf(teil("3001", 4).copy(vorhanden = 1), teil("3002", 1).copy(vorhanden = 1))
        vm.ladeBestand()
        advanceUntilIdle()
        // Drei Stück fehlen, von einem Teil: die Mengenform mit der Zahl der Stücke.
        assertEquals("m${R.plurals.partslist_owned_missing}:3", vm.zustand.value.status)
        assertEquals(listOf(1, 1), vm.zustand.value.parts.map { it.vorhanden })
        quelle.bestand = null
        vm.ladeBestand()
        advanceUntilIdle()
        assertEquals("t${R.string.partslist_owned_error}", vm.zustand.value.status)
        assertFalse(vm.zustand.value.bestandLaeuft)
    }

    @Test
    fun `ein fertiges PDF wird einmal angeboten, ein Fehler gemeldet`() = runTest(takt) {
        val datei = File("teileliste.pdf")
        val export = Export(ExportErgebnis.Datei(datei))
        val vm = vm(Quelle(mapOf("10294-1" to listOf(teil("3001", 2)))), export)
        vm.erstelle("10294")
        advanceUntilIdle()
        vm.exportiere()
        advanceUntilIdle()
        assertEquals(datei, vm.zustand.value.pdfDatei)
        val auftrag = export.auftraege.single()
        assertEquals("Der Auftrag nennt das Set", listOf("10294-1"), auftrag.sets.map { it.setNumber })
        assertEquals(listOf("3001" to 2), auftrag.parts.map { it.partNumber to it.quantity })
        vm.pdfGeoeffnet()
        assertNull(vm.zustand.value.pdfDatei)

        val ohne = vm(Quelle(mapOf("10294-1" to listOf(teil("3001", 2)))))
        ohne.erstelle("10294")
        advanceUntilIdle()
        ohne.exportiere()
        advanceUntilIdle()
        // Der Abruf spricht wie jeder Abruf (NummernTexte.meldung), nicht leer.
        assertEquals("fehler", ohne.zustand.value.pdfError)
        assertFalse(ohne.zustand.value.isExporting)
    }

    @Test
    fun `ein Fehler hat immer einen Satz, auch ohne Satz des Servers`() = runTest(takt) {
        for ((grund, erwartet) in listOf(
            PdfFehlschlag.Auftrag(null) to "t${R.string.pdfexp_server_error}",
            PdfFehlschlag.Auftrag("") to "t${R.string.pdfexp_server_error}",
            PdfFehlschlag.Auftrag("Bild fehlt") to "Bild fehlt",
            PdfFehlschlag.Abruf(Ergebnis.Error.Abgewiesen()) to "fehler",
        )) {
            val vm = vm(Quelle(mapOf("10294-1" to listOf(teil("3001", 2)))), Export(ExportErgebnis.Fehler(grund)))
            vm.erstelle("10294")
            advanceUntilIdle()
            vm.exportiere()
            advanceUntilIdle()
            assertEquals("$grund", erwartet, vm.zustand.value.pdfError)
        }
    }

    @Test
    fun `der Stand des Exports wird ein Satz, die Restzeit nur solange sie bleibt`() = runTest(takt) {
        val stand = MutableStateFlow<PdfFortschritt?>(PdfFortschritt(PdfSchritt.ERSTELLT, 12))
        val vm = vm(export = Export(ExportErgebnis.Datei(File("x.pdf")), stand))
        backgroundScope.launch { vm.pdfExportStatus.collect {} }
        advanceUntilIdle()
        assertEquals("t${R.string.pdfexp_creating_eta}", vm.pdfExportStatus.value)
        stand.value = PdfFortschritt(PdfSchritt.ERSTELLT, 0)
        advanceUntilIdle()
        assertEquals("t${R.string.pdfexp_almost_done}", vm.pdfExportStatus.value)
        stand.value = null
        advanceUntilIdle()
        assertNull(vm.pdfExportStatus.value)
    }

    @Test
    fun `eine Abmeldung leert die Bauliste`() = runTest(takt) {
        val vm = vm(Quelle(mapOf("10294-1" to listOf(teil("3001", 2)))))
        vm.erstelle("10294")
        advanceUntilIdle()
        t.sitzung.abgemeldet()
        advanceUntilIdle()
        assertTrue(vm.zustand.value.sets.isEmpty())
        assertTrue(vm.zustand.value.parts.isEmpty())
    }
}
