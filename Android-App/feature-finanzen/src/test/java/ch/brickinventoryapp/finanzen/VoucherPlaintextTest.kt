package ch.brickinventoryapp.finanzen

import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.finanzen.ui.VoucherPdfTarget
import ch.brickinventoryapp.finanzen.ui.VoucherStep
import ch.brickinventoryapp.finanzen.ui.CopyJob
import ch.brickinventoryapp.testing.testVouchersRepository
import ch.brickinventoryapp.model.datei.FileReader
import ch.brickinventoryapp.model.datei.FileRef
import ch.brickinventoryapp.finanzen.ui.viewmodel.GutscheinViewModel
import ch.brickinventoryapp.finanzen.ui.viewmodel.inputViaMask
import ch.brickinventoryapp.finanzen.ui.viewmodel.voucherPdfAddress
import ch.brickinventoryapp.finanzen.ui.viewmodel.pdfWithOnceTicket
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.NumbersTexts
import ch.brickinventoryapp.testing.TestApi
import ch.brickinventoryapp.testing.text

/**
 * Gutscheine mit maskierter Liste: Nummer und PIN, PDF und Löschen erst nach
 * Passwort (und Code), der Klartext nur im ViewModel. Gegen einen Testserver.
 *
 * Gegenproben:
 *  A  In bestaetige() `codeNoetig = … || fehler.code in FACTOR_CODES` auf
 *     `it.confirmation.codeNoetig` zurückgesetzt → rot „PIN aufdecken …“
 *     (Codefeld erscheint nicht).
 *  B  In verlange() den Klartext-Kurzweg entfernt (immer neue Rückfrage) → rot
 *     „PIN aufdecken …“ (kopieren fragt erneut, statt zu kopieren).
 *  C  forgetPlaintext() leert `klartext` nicht → rot „PIN aufdecken …“.
 *  D  In bestaetige() die Offline-Meldung beim Löschen entfernt (immer
 *     texte.meldung) → rot „offline wird nicht geloescht …“.
 *  E  withTicket() hängt das Ticket nicht an → rot „PDF und Export …“.
 *  F  editVoucher() nimmt `g.pin` nicht mehr, sondern "" → rot
 *     „Bearbeiten schickt die Maske …“ (PIN würde gelöscht bzw. fehlt).
 *  G  inputViaMask() gibt immer `neu` zurück → rot „die Maske ist ein Ganzes“.
 *  H  pdfWithOnceTicket() immer false → rot „PDF und Export …“ (der Betrachter
 *     versuchte ein verbrauchtes Ticket erneut).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VoucherPlaintextTest {

    private lateinit var server: MockWebServer
    private lateinit var cacheDir: File
    private lateinit var kanal: MeldungsKanal
    private lateinit var vm: GutscheinViewModel

    private fun antwort(rumpf: String, code: Int = 200) = TestApi.antwort(rumpf, code)
    private fun warteBis(was: String, bedingung: () -> Boolean) = TestApi.warteBis(was, bedingung)

    /** So antwortet der Server: nur die Maske. */
    private val maskiert = """{"success":true,"vouchers":[
        {"id":1,"number":"…3333","pin":"•••","amount":50,"currency":"CHF","hat_pdf":true}]}"""
    private val klartext = """{"success":true,"id":1,"number":"6000111122223333","pin":"1234"}"""

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server = MockWebServer()
        server.start()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-klar-${System.nanoTime()}").apply { mkdirs() }
        kanal = MeldungsKanal()
        vm = GutscheinViewModel(
            repo = testVouchersRepository(TestApi.fuer(server)),
            texts = NumbersTexts,
            reader = object : FileReader { override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null },
            meldungen = kanal,
        )
        server.enqueue(antwort(maskiert))
        vm.loadVouchers()
        warteBis("Liste") { vm.state.value.gutscheine.size == 1 && !vm.state.value.abruf.laedt }
        server.takeRequest()
    }

    @After
    fun zu() {
        runCatching { server.shutdown() }
        cacheDir.deleteRecursively()
        Dispatchers.resetMain()
    }

    @Test
    fun `PIN aufdecken fragt nach Passwort, dann Code, und der Klartext lebt nur auf der Seite`() {
        vm.switchVoucherPin(1)
        assertEquals(VoucherStep.PIN_ZEIGEN, vm.state.value.confirmation?.schritt)
        assertEquals("Vor dem Passwort keine Anfrage", 1, server.requestCount)

        server.enqueue(antwort("""{"success":false,"error":"Bitte den Code eingeben.","code":"zweiter_faktor_noetig"}""", 400))
        vm.confirm("geheim", null)
        warteBis("Codefeld") { vm.state.value.confirmation?.let { it.codeNoetig && !it.operation.laeuft } == true }
        assertTrue(vm.state.value.pinSichtbar.isEmpty())
        val erste = server.takeRequest()
        assertEquals("POST /api/v1/vouchers/1/klartext", "${erste.method} ${erste.path}")
        assertEquals("geheim", JSONObject(erste.body.readUtf8()).getString("password"))

        server.enqueue(antwort(klartext))
        vm.confirm("geheim", " 123456 ")
        warteBis("aufgedeckt") { 1 in vm.state.value.pinSichtbar }
        assertNull(vm.state.value.confirmation)
        assertEquals("1234", vm.state.value.klartext[1]?.pin)
        assertEquals("123456", JSONObject(server.takeRequest().body.readUtf8()).getString("code"))

        // Schon da: Kopieren fragt nicht noch einmal und kopiert den Klartext.
        vm.copyVoucher(1, isNumber = true)
        assertEquals(CopyJob("6000111122223333", true), vm.state.value.copyTo)
        assertNull(vm.state.value.confirmation)
        assertEquals(3, server.requestCount)

        vm.leaveVouchers()
        assertTrue(vm.state.value.klartext.isEmpty())
        assertTrue(vm.state.value.pinSichtbar.isEmpty())
        assertNull(vm.state.value.copyTo)
        // Nach dem Verlassen wieder mit Passwort.
        vm.copyVoucher(1, isNumber = false)
        assertEquals(VoucherStep.PIN_COPY, vm.state.value.confirmation?.schritt)
    }

    @Test
    fun `Loeschen schickt Passwort und Code im Rumpf`() {
        vm.deleteVoucher(1)
        assertEquals(VoucherStep.DELETE, vm.state.value.confirmation?.schritt)
        server.enqueue(antwort("""{"success":true}"""))
        server.enqueue(antwort("""{"success":true,"vouchers":[]}"""))
        vm.confirm("geheim", "654321")
        warteBis("gelöscht") { vm.state.value.gutscheine.isEmpty() }
        val r = server.takeRequest()
        assertEquals("DELETE /api/v1/vouchers/1", "${r.method} ${r.path}")
        val rumpf = JSONObject(r.body.readUtf8())
        assertEquals("geheim", rumpf.getString("password"))
        assertEquals("654321", rumpf.getString("code"))
        assertNull(vm.state.value.confirmation)
        assertEquals("t${R.string.vouchers_deleted}", kanal.text)
    }

    @Test
    fun `offline wird nicht geloescht und nichts gepuffert`() {
        vm.deleteVoucher(1)
        server.shutdown()
        vm.confirm("geheim", null)
        warteBis("Absage") { vm.state.value.confirmation?.let { it.operation is Vorgang.Fehlgeschlagen } == true }
        assertEquals("t${R.string.vouchers_delete_offline}", vm.state.value.confirmation?.operation?.errorMessage.text)
        assertEquals("Der Gutschein steht noch da", 1, vm.state.value.gutscheine.size)
    }

    @Test
    fun `PDF und Export erst mit Ticket`() {
        vm.openVoucherPdf(1)
        assertNull("Ohne Passwort kein Ziel", vm.state.value.pdfTarget)
        server.enqueue(antwort("""{"success":true,"ticket":"t/1+","gueltig_sek":60}"""))
        vm.confirm("geheim", null)
        warteBis("Ticket") { vm.state.value.pdfTarget != null }
        assertEquals(VoucherPdfTarget(1, "t/1+"), vm.state.value.pdfTarget)
        assertEquals("POST /api/v1/vouchers/1/pdf-freigabe", server.takeRequest().let { "${it.method} ${it.path}" })
        assertEquals("https://brick.example/api/v1/vouchers/1/pdf?ticket=t%2F1%2B",
            voucherPdfAddress("https://brick.example/", vm.state.value.pdfTarget!!))
        assertTrue(pdfWithOnceTicket(voucherPdfAddress("https://brick.example/", vm.state.value.pdfTarget!!)))
        assertFalse(pdfWithOnceTicket("https://brick.example/api/v1/instructions/4/file"))
        vm.voucherPdfAcknowledge()

        vm.openVoucherExport()
        server.enqueue(antwort("""{"success":true,"ticket":"x","gueltig_sek":60}"""))
        vm.confirm("geheim", null)
        warteBis("Ticket") { vm.state.value.pdfTarget != null }
        assertEquals("POST /api/v1/vouchers/export/pdf-freigabe", server.takeRequest().let { "${it.method} ${it.path}" })
        assertEquals("https://brick.example/api/v1/vouchers/export/pdf?ticket=x",
            voucherPdfAddress("https://brick.example", vm.state.value.pdfTarget!!))
    }

    @Test
    fun `Bearbeiten schickt die Maske als unveraendert zurueck`() {
        vm.editVoucher(1)
        assertEquals("…3333", vm.state.value.nummer)
        assertEquals("•••", vm.state.value.pin)
        vm.setVoucherField(betrag = "60")
        server.enqueue(antwort("""{"success":true,"voucher":{"id":1,"number":"…3333","pin":"•••","amount":60,"currency":"CHF","hat_pdf":true}}"""))
        server.enqueue(antwort(maskiert))
        vm.speichere(null)
        warteBis("gespeichert") { server.requestCount >= 3 && !vm.state.value.speichern.laeuft }
        val r = server.takeRequest()
        assertEquals("PUT /api/v1/vouchers/1", "${r.method} ${r.path}")
        val rumpf = JSONObject(r.body.readUtf8())
        assertEquals("…3333", rumpf.getString("number"))
        assertEquals("•••", rumpf.getString("pin"))
        assertEquals(60.0, rumpf.getDouble("amount"), 0.0)
    }

    @Test
    fun `die Maske ist ein Ganzes`() {
        assertEquals("5", inputViaMask("…3333", "…33335", true))
        assertEquals("5", inputViaMask("…3333", "5…3333", true))
        assertEquals("Eine Ziffer weg heisst: alles weg", "", inputViaMask("…3333", "…333", true))
        assertEquals("", inputViaMask("•••", "••", true))
        assertEquals("Eingefügt ersetzt", "6000111122223333", inputViaMask("…3333", "6000111122223333", true))
        assertEquals("Ohne Maske unverändert", "123", inputViaMask("12", "123", false))
        assertFalse(inputViaMask("•••", "•••7", true).contains('•'))
    }
}
