package ch.brickinventoryapp

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.TeilelistenQuelle
import ch.brickinventoryapp.ui.screens.PlPart
import ch.brickinventoryapp.ui.viewmodel.ExportErgebnis
import ch.brickinventoryapp.ui.viewmodel.TeilelistenExport
import ch.brickinventoryapp.ui.viewmodel.TeilelisteViewModel
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
        t.cacheDir.deleteRecursively()
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

    private class Export(val ergebnis: ExportErgebnis) : TeilelistenExport {
        val ruempfe = mutableListOf<String>()
        override val status = flowOf<String?>(null)
        override suspend fun erzeuge(rumpf: String): ExportErgebnis { ruempfe += rumpf; return ergebnis }
    }

    private fun vm(
        quelle: Quelle = Quelle(),
        export: Export = Export(ExportErgebnis.Fehler(null)),
        gemerkt: SavedStateHandle = SavedStateHandle(),
    ) = TeilelisteViewModel(t.dienste, quelle, export, gemerkt).also { erzeugt += it }

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
        assertTrue("Der Rumpf nennt das Set", export.ruempfe.single().contains("10294-1"))
        vm.pdfGeoeffnet()
        assertNull(vm.zustand.value.pdfDatei)

        val ohne = vm(Quelle(mapOf("10294-1" to listOf(teil("3001", 2)))))
        ohne.erstelle("10294")
        advanceUntilIdle()
        ohne.exportiere()
        advanceUntilIdle()
        assertEquals("t${R.string.pdfexp_unknown_error}", ohne.zustand.value.pdfError)
        assertFalse(ohne.zustand.value.isExporting)
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
