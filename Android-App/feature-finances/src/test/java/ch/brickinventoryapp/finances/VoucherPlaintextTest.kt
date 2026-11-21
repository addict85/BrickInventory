package ch.brickinventoryapp.finances

import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.finances.ui.VoucherPdfTarget
import ch.brickinventoryapp.finances.ui.VoucherStep
import ch.brickinventoryapp.finances.ui.CopyJob
import ch.brickinventoryapp.testing.testVouchersRepository
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.finances.ui.viewmodel.GutscheinViewModel
import ch.brickinventoryapp.finances.ui.viewmodel.inputViaMask
import ch.brickinventoryapp.finances.ui.viewmodel.voucherPdfAddress
import ch.brickinventoryapp.finances.ui.viewmodel.pdfWithOnceTicket
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
 * Vouchers with a masked list: number and PIN, PDF and delete only after a
 * password (and code), the plain text only in the ViewModel. Against a test server.
 *
 * Counter-checks:
 *  A  In bestaetige() `codeNoetig = … || fehler.code in FACTOR_CODES` reset
 *     to `it.confirmation.codeNoetig` → red “revealing a PIN …”
 *     (code field does not appear).
 *  B  In verlange() the plain-text shortcut removed (always a new prompt) → red
 *     “revealing a PIN …” (copying asks again instead of copying).
 *  C  forgetPlaintext() does not clear `klartext` → red “revealing a PIN …”.
 *  D  In bestaetige() the offline message on deleting removed (always
 *     texte.meldung) → red “offline it is not deleted …”.
 *  E  withTicket() does not attach the ticket → red “PDF and export …”.
 *  F  editVoucher() no longer takes `g.pin`, but "" instead → red
 *     “editing sends the mask …” (the PIN would be cleared or missing).
 *  G  inputViaMask() always returns `neu` → red “the mask is a whole”.
 *  H  pdfWithOnceTicket() always false → red “PDF and export …” (the viewer
 *     retried a used-up ticket).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VoucherPlaintextTest {

    private lateinit var server: MockWebServer
    private lateinit var cacheDir: File
    private lateinit var kanal: MeldungsKanal
    private lateinit var vm: GutscheinViewModel

    private fun antwort(rumpf: String, code: Int = 200) = TestApi.antwort(rumpf, code)
    private fun warteBis(was: String, bedingung: () -> Boolean) = TestApi.warteBis(was, bedingung)

    /** This is how the server answers: only the mask. */
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
    fun `revealing the PIN asks for password, then code, and the plaintext lives only on the page`() {
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

        // Already there: copying does not ask again and copies the plain text.
        vm.copyVoucher(1, isNumber = true)
        assertEquals(CopyJob("6000111122223333", true), vm.state.value.copyTo)
        assertNull(vm.state.value.confirmation)
        assertEquals(3, server.requestCount)

        vm.leaveVouchers()
        assertTrue(vm.state.value.klartext.isEmpty())
        assertTrue(vm.state.value.pinSichtbar.isEmpty())
        assertNull(vm.state.value.copyTo)
        // With a password again after leaving.
        vm.copyVoucher(1, isNumber = false)
        assertEquals(VoucherStep.PIN_COPY, vm.state.value.confirmation?.schritt)
    }

    @Test
    fun `deleting sends password and code in the body`() {
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
    fun `offline nothing is deleted and nothing buffered`() {
        vm.deleteVoucher(1)
        server.shutdown()
        vm.confirm("geheim", null)
        warteBis("Absage") { vm.state.value.confirmation?.let { it.operation is Vorgang.Fehlgeschlagen } == true }
        assertEquals("t${R.string.vouchers_delete_offline}", vm.state.value.confirmation?.operation?.errorMessage.text)
        assertEquals("Der Gutschein steht noch da", 1, vm.state.value.gutscheine.size)
    }

    @Test
    fun `PDF and export only with a ticket`() {
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
    fun `editing sends the mask back as unchanged`() {
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
    fun `the mask is a whole`() {
        assertEquals("5", inputViaMask("…3333", "…33335", true))
        assertEquals("5", inputViaMask("…3333", "5…3333", true))
        assertEquals("Eine Ziffer weg heisst: alles weg", "", inputViaMask("…3333", "…333", true))
        assertEquals("", inputViaMask("•••", "••", true))
        assertEquals("Eingefügt ersetzt", "6000111122223333", inputViaMask("…3333", "6000111122223333", true))
        assertEquals("Ohne Maske unverändert", "123", inputViaMask("12", "123", false))
        assertFalse(inputViaMask("•••", "•••7", true).contains('•'))
    }
}
