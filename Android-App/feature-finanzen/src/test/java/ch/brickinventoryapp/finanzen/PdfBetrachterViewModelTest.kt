package ch.brickinventoryapp.finanzen

import android.os.ParcelFileDescriptor
import ch.brickinventoryapp.data.DownloadGescheitert
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.finanzen.ui.pdf.PdfFehler
import ch.brickinventoryapp.finanzen.ui.pdf.PdfHalter
import ch.brickinventoryapp.finanzen.ui.pdf.PdfLader
import ch.brickinventoryapp.finanzen.ui.pdf.PdfLoadState
import ch.brickinventoryapp.finanzen.ui.pdf.PdfQuelle
import ch.brickinventoryapp.finanzen.ui.pdf.PdfSeitenQuelle
import ch.brickinventoryapp.finanzen.ui.viewmodel.PdfBetrachterViewModel
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException
import java.io.InputStream
import java.net.UnknownHostException

/**
 * Der PDF-Betrachter lädt im ViewModel, nicht in der Komposition: Eine Drehung ruft
 * oeffne() erneut, der Download läuft weiter und beginnt nicht von vorn. Mit
 * StandardTestDispatcher und advanceUntilIdle, ohne Netz und ohne Warten.
 *
 * Gegenproben:
 *   A  in oeffne() die Abfrage `pdfUrl == adresse` entfernt
 *      (gegenproben/pdf-drehung-laedt-neu.patch) → rot „eine Drehung laedt nicht neu“
 *   B  den Fortschritt nicht weitergereicht (`{ }` statt `{ _state.value = it }`) →
 *      rot „der Fortschritt kommt im Zustand an …“
 *   C  die Prüfung pdfImBetrachter() entfernt → rot „eine fremde Adresse wird nicht geladen …“
 *   D  in PdfHalter.halte() die Abfrage `if (zu)` entfernt → rot „eine Quelle, die nach
 *      dem Verlassen ankommt, wird sofort geschlossen“
 *   E  gegenproben/pdf-seite-am-renderer-vorbei.patch → rot „eine Seite
 *      rendert der Lader …“
 *   F  gegenproben/pdf-fehler-ohne-klasse.patch: der Fehler ohne Klasse (nur der rohe
 *      Text) → rot „ein Fehler traegt seine Klasse …“
 *   G  gegenproben/pdf-erneut-tot.patch: erneut() lädt nicht → rot „nach einem Fehler
 *      laedt Erneut versuchen …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PdfBetrachterViewModelTest {

    private val takt = StandardTestDispatcher()

    @Before
    fun an() = Dispatchers.setMain(takt)

    @After
    fun aus() = Dispatchers.resetMain()

    private class Quelle : PdfQuelle {
        var zu = false
        override fun oeffne(): ParcelFileDescriptor = error("Im Test wird nicht gerendert")
        override fun eingang(): InputStream = "%PDF".byteInputStream()
        override fun close() { zu = true }
    }

    /** Lädt nach Vorgabe: meldet [fortschritt], wartet auf [bremse], liefert oder wirft. */
    private class Lader(
        val fortschritt: PdfLoadState? = null,
        val bremse: CompletableDeferred<Unit>? = null,
        var fehler: Exception? = null,
    ) : PdfLader {
        val adressen = mutableListOf<String>()
        val quelle = Quelle()
        override suspend fun lade(pdfUrl: String, offen: PdfHalter, onZustand: (PdfLoadState) -> Unit): Pair<PdfQuelle, Int> {
            adressen += pdfUrl
            fortschritt?.let(onZustand)
            bremse?.await()
            fehler?.let { throw it }
            offen.halte(quelle)
            return quelle to 12
        }
    }

    /** Der Renderer als Attrappe: Gerendert wird im isolierten Prozess, hier nur gezählt. */
    private val gerendert = mutableListOf<Int>()
    private val seitenquelle = PdfSeitenQuelle { _, index, _ -> gerendert += index; null }

    private fun vm(lader: Lader) = PdfBetrachterViewModel(lader, seitenquelle, takt)

    @Test
    fun `eine Seite rendert die Seitenquelle im eigenen Prozess, nicht das ViewModel`() = runTest(takt) {
        val lader = Lader()
        val vm = vm(lader)
        vm.oeffne(ANLEITUNG, SERVER)
        advanceUntilIdle()
        vm.seiten.seite(lader.quelle, 3, 1080)
        assertEquals(listOf(3), gerendert)
    }

    @Test
    fun `eine Drehung laedt nicht neu`() = runTest(takt) {
        val lader = Lader()
        val vm = vm(lader)
        vm.oeffne(ANLEITUNG, SERVER)
        // Die neue Komposition nach der Drehung ruft oeffne() noch einmal, mitten im Laden.
        vm.oeffne(ANLEITUNG, SERVER)
        advanceUntilIdle()
        vm.oeffne(ANLEITUNG, SERVER)
        advanceUntilIdle()
        assertEquals(listOf(ANLEITUNG), lader.adressen)
        assertEquals(PdfLoadState.Ready(lader.quelle, 12), vm.state.value)
    }

    @Test
    fun `der Fortschritt kommt im Zustand an, bis das PDF bereit ist`() = runTest(takt) {
        val bremse = CompletableDeferred<Unit>()
        val lader = Lader(fortschritt = PdfLoadState.Downloading(40, 400, 1000), bremse = bremse)
        val vm = vm(lader)
        vm.oeffne(ANLEITUNG, SERVER)
        advanceUntilIdle()
        assertEquals(PdfLoadState.Downloading(40, 400, 1000), vm.state.value)
        bremse.complete(Unit)
        advanceUntilIdle()
        assertEquals(PdfLoadState.Ready(lader.quelle, 12), vm.state.value)
    }

    @Test
    fun `eine fremde Adresse wird nicht geladen, mit der Adresse des Servers schon`() = runTest(takt) {
        val lader = Lader()
        val vm = vm(lader)
        vm.oeffne("https://fremd.example/anleitung.pdf", SERVER)
        advanceUntilIdle()
        assertEquals(PdfLoadState.Error(null, PdfFehler.FREMDER_HOST), vm.state.value)
        assertEquals(emptyList<String>(), lader.adressen)
        // Kam die Serveradresse erst nach dem ersten Bild, gilt der zweite Aufruf.
        val spaet = vm(lader)
        spaet.oeffne(ANLEITUNG, "")
        spaet.oeffne(ANLEITUNG, SERVER)
        advanceUntilIdle()
        assertEquals(listOf(ANLEITUNG), lader.adressen)
        assertTrue(spaet.state.value is PdfLoadState.Ready)
    }

    @Test
    fun `ein Fehler traegt seine Klasse und die Ursache als Zusatz, ohne Ursache heisst er Download gescheitert`() =
        runTest(takt) {
            val server = vm(Lader(fehler = DownloadGescheitert(503)))
            server.oeffne(ANLEITUNG, SERVER)
            val netz = vm(Lader(fehler = UnknownHostException("brick.example")))
            netz.oeffne(ANLEITUNG, SERVER)
            val abgelaufen = vm(Lader(fehler = DownloadGescheitert(401)))
            abgelaufen.oeffne(ANLEITUNG, SERVER)
            val anderes = vm(Lader(fehler = IOException("PDF zu gross")))
            anderes.oeffne(ANLEITUNG, SERVER)
            val ohne = vm(Lader(fehler = DownloadGescheitert()))
            ohne.oeffne(ANLEITUNG, SERVER)
            advanceUntilIdle()
            assertEquals(PdfLoadState.Error("HTTP 503", klasse = Fehlerklasse.SERVER), server.state.value)
            assertEquals(PdfLoadState.Error("brick.example", klasse = Fehlerklasse.OFFLINE), netz.state.value)
            assertEquals(PdfLoadState.Error("HTTP 401", klasse = Fehlerklasse.ANMELDUNG), abgelaufen.state.value)
            assertEquals(PdfLoadState.Error("PDF zu gross", klasse = Fehlerklasse.UNBEKANNT), anderes.state.value)
            assertEquals(PdfLoadState.Error(null, PdfFehler.DOWNLOAD), ohne.state.value)
        }

    @Test
    fun `nach einem Fehler laedt Erneut versuchen dieselbe Adresse noch einmal`() = runTest(takt) {
        val lader = Lader(fehler = DownloadGescheitert(503))
        val vm = vm(lader)
        vm.oeffne(ANLEITUNG, SERVER)
        advanceUntilIdle()
        assertTrue(vm.state.value is PdfLoadState.Error)
        // Dieselbe Adresse über oeffne() lädt nicht neu (Drehung); nur der Knopf tut es.
        vm.oeffne(ANLEITUNG, SERVER)
        advanceUntilIdle()
        assertEquals(listOf(ANLEITUNG), lader.adressen)
        lader.fehler = null
        vm.erneut()
        advanceUntilIdle()
        assertEquals(listOf(ANLEITUNG, ANLEITUNG), lader.adressen)
        assertEquals(PdfLoadState.Ready(lader.quelle, 12), vm.state.value)
        // Bereit lädt der Knopf nichts mehr: Er steht nur im Fehlerzustand.
        vm.erneut()
        advanceUntilIdle()
        assertEquals(2, lader.adressen.size)
    }

    @Test
    fun `eine Quelle, die nach dem Verlassen ankommt, wird sofort geschlossen`() {
        val halter = PdfHalter()
        val erste = Quelle()
        assertTrue(halter.halte(erste))
        assertFalse("Gehalten heisst offen", erste.zu)
        halter.close()
        assertTrue("Das Verlassen schliesst die gehaltene Quelle", erste.zu)
        val spaete = Quelle()
        assertFalse(halter.halte(spaete))
        assertTrue("Eine späte Quelle lebte sonst bis zum Prozessende", spaete.zu)
    }

    private companion object {
        const val SERVER = "https://brick.example"
        const val ANLEITUNG = "https://brick.example/api/v1/instructions/42/file"
    }
}
