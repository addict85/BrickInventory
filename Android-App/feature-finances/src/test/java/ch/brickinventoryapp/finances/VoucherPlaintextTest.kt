package ch.brickinventoryapp.finances

import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testVouchersRepository
import ch.brickinventoryapp.data.testing.text
import ch.brickinventoryapp.finances.ui.CopyJob
import ch.brickinventoryapp.finances.ui.VoucherPdfTarget
import ch.brickinventoryapp.finances.ui.VoucherStep
import ch.brickinventoryapp.finances.ui.viewmodel.VoucherViewModel
import ch.brickinventoryapp.finances.ui.viewmodel.inputViaMask
import ch.brickinventoryapp.finances.ui.viewmodel.pdfWithOnceTicket
import ch.brickinventoryapp.finances.ui.viewmodel.voucherPdfAddress
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.ui.Operation
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.ui.running
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.testing.NumbersTexts
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

/**
 * Vouchers with a masked list: number and PIN, PDF and delete only after a
 * password (and code), the plain text only in the ViewModel. Against a test server.
 *
 * Counter-checks:
 *  A  In confirm() `codeNeeded = … || error.code in FACTOR_CODES` reset
 *     to `it.confirmation.codeNeeded` → red “revealing a PIN …”
 *     (code field does not appear).
 *  B  In verlange() the plain-text shortcut removed (always a new prompt) → red
 *     “revealing a PIN …” (copying asks again instead of copying).
 *  C  forgetPlaintext() does not clear `plaintext` → red “revealing a PIN …”.
 *  D  In confirm() the offline message on deleting removed (always
 *     texts.message) → red “offline it is not deleted …”.
 *  E  withTicket() does not attach the ticket → red “PDF and export …”.
 *  F  editVoucher() no longer takes `g.pin`, but "" instead → red
 *     “editing sends the mask …” (the PIN would be cleared or missing).
 *  G  inputViaMask() always returns `newValue` → red “the mask is a whole”.
 *  H  pdfWithOnceTicket() always false → red “PDF and export …” (the viewer
 *     retried a used-up ticket).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VoucherPlaintextTest {

    private lateinit var server: MockWebServer
    private lateinit var cacheDir: File
    private lateinit var channel: MessageChannel
    private lateinit var vm: VoucherViewModel

    private fun response(body: String, code: Int = 200) = TestApi.response(body, code)
    private fun pollUntil(was: String, condition: () -> Boolean) = TestApi.pollUntil(was, condition)

    /** This is how the server answers: only the mask. */
    private val masked = """{"success":true,"vouchers":[
        {"id":1,"number":"…3333","pin":"•••","amount":50,"currency":"CHF","has_pdf":true}]}"""
    private val plaintext = """{"success":true,"id":1,"number":"6000111122223333","pin":"1234"}"""

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server = MockWebServer()
        server.start()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-klar-${System.nanoTime()}").apply { mkdirs() }
        channel = MessageChannel()
        vm = VoucherViewModel(
            repo = testVouchersRepository(TestApi.forTarget(server)),
            texts = NumbersTexts,
            reader = object : FileReader { override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null },
            messages = channel,
        )
        server.enqueue(response(masked))
        vm.loadVouchers()
        pollUntil("Liste") { vm.state.value.vouchers.size == 1 && !vm.state.value.fetch.loading }
        server.takeRequest()
    }

    @After
    fun tearDown() {
        runCatching { server.shutdown() }
        cacheDir.deleteRecursively()
        Dispatchers.resetMain()
    }

    @Test
    fun `revealing the PIN asks for password, then code, and the plaintext lives only on the page`() {
        vm.switchVoucherPin(1)
        assertEquals(VoucherStep.PIN_SHOW, vm.state.value.confirmation?.step)
        assertEquals("no request before the password", 1, server.requestCount)

        server.enqueue(response("""{"success":false,"error":"Bitte den Code eingeben.","code":"second_factor_required"}""", 400))
        vm.confirm("geheim", null)
        pollUntil("Codefeld") { vm.state.value.confirmation?.let { it.codeNeeded && !it.operation.running } == true }
        assertTrue(vm.state.value.pinVisible.isEmpty())
        val first = server.takeRequest()
        assertEquals("POST /api/v2/vouchers/1/plaintext", "${first.method} ${first.path}")
        assertEquals("geheim", JSONObject(first.body.readUtf8()).getString("password"))

        server.enqueue(response(plaintext))
        vm.confirm("geheim", " 123456 ")
        pollUntil("aufgedeckt") { 1 in vm.state.value.pinVisible }
        assertNull(vm.state.value.confirmation)
        assertEquals("1234", vm.state.value.plaintext[1]?.pin)
        assertEquals("123456", JSONObject(server.takeRequest().body.readUtf8()).getString("code"))

        // Already there: copying does not ask again and copies the plain text.
        vm.copyVoucher(1, isNumber = true)
        assertEquals(CopyJob("6000111122223333", true), vm.state.value.copyTo)
        assertNull(vm.state.value.confirmation)
        assertEquals(3, server.requestCount)

        vm.leaveVouchers()
        assertTrue(vm.state.value.plaintext.isEmpty())
        assertTrue(vm.state.value.pinVisible.isEmpty())
        assertNull(vm.state.value.copyTo)
        // With a password again after leaving.
        vm.copyVoucher(1, isNumber = false)
        assertEquals(VoucherStep.PIN_COPY, vm.state.value.confirmation?.step)
    }

    @Test
    fun `deleting sends password and code in the body`() {
        vm.deleteVoucher(1)
        assertEquals(VoucherStep.DELETE, vm.state.value.confirmation?.step)
        server.enqueue(response("""{"success":true}"""))
        server.enqueue(response("""{"success":true,"vouchers":[]}"""))
        vm.confirm("geheim", "654321")
        pollUntil("gelöscht") { vm.state.value.vouchers.isEmpty() }
        val r = server.takeRequest()
        assertEquals("DELETE /api/v2/vouchers/1", "${r.method} ${r.path}")
        val body = JSONObject(r.body.readUtf8())
        assertEquals("geheim", body.getString("password"))
        assertEquals("654321", body.getString("code"))
        assertNull(vm.state.value.confirmation)
        assertEquals("the undo snackbar names the card", 1, vm.state.value.deleted)
    }

    @Test
    fun `offline nothing is deleted and nothing buffered`() {
        vm.deleteVoucher(1)
        server.shutdown()
        vm.confirm("geheim", null)
        pollUntil("Absage") { vm.state.value.confirmation?.let { it.operation is Operation.Failed } == true }
        assertEquals("t${R.string.vouchers_delete_offline}", vm.state.value.confirmation?.operation?.errorMessage.text)
        assertEquals("the voucher is still shown", 1, vm.state.value.vouchers.size)
    }

    @Test
    fun `PDF and export only with a ticket`() {
        vm.openVoucherPdf(1)
        assertNull("without a password no destination", vm.state.value.pdfTarget)
        server.enqueue(response("""{"success":true,"ticket":"t/1+","valid_seconds":60}"""))
        vm.confirm("geheim", null)
        pollUntil("Ticket") { vm.state.value.pdfTarget != null }
        assertEquals(VoucherPdfTarget(1, "t/1+"), vm.state.value.pdfTarget)
        assertEquals("POST /api/v2/vouchers/1/pdf-grant", server.takeRequest().let { "${it.method} ${it.path}" })
        assertEquals("https://brick.example/api/v2/vouchers/1/pdf?ticket=t%2F1%2B",
            voucherPdfAddress("https://brick.example/", vm.state.value.pdfTarget!!))
        assertTrue(pdfWithOnceTicket(voucherPdfAddress("https://brick.example/", vm.state.value.pdfTarget!!)))
        assertFalse(pdfWithOnceTicket("https://brick.example/api/v2/instructions/4/file"))
        vm.voucherPdfAcknowledge()

        vm.openVoucherExport()
        server.enqueue(response("""{"success":true,"ticket":"x","valid_seconds":60}"""))
        vm.confirm("geheim", null)
        pollUntil("Ticket") { vm.state.value.pdfTarget != null }
        assertEquals("POST /api/v2/vouchers/export/pdf-grant", server.takeRequest().let { "${it.method} ${it.path}" })
        assertEquals("https://brick.example/api/v2/vouchers/export/pdf?ticket=x",
            voucherPdfAddress("https://brick.example", vm.state.value.pdfTarget!!))
    }

    @Test
    fun `editing sends the mask back as unchanged`() {
        vm.editVoucher(1)
        assertEquals("…3333", vm.state.value.number)
        assertEquals("•••", vm.state.value.pin)
        vm.setVoucherField(amount = "60")
        server.enqueue(response("""{"success":true,"voucher":{"id":1,"number":"…3333","pin":"•••","amount":60,"currency":"CHF","has_pdf":true}}"""))
        server.enqueue(response(masked))
        vm.persist(null)
        pollUntil("gespeichert") { server.requestCount >= 3 && !vm.state.value.save.running }
        val r = server.takeRequest()
        assertEquals("PUT /api/v2/vouchers/1", "${r.method} ${r.path}")
        val body = JSONObject(r.body.readUtf8())
        assertEquals("…3333", body.getString("number"))
        assertEquals("•••", body.getString("pin"))
        assertEquals(60.0, body.getDouble("amount"), 0.0)
    }

    @Test
    fun `the mask is a whole`() {
        assertEquals("5", inputViaMask("…3333", "…33335", true))
        assertEquals("5", inputViaMask("…3333", "5…3333", true))
        assertEquals("one digit gone means: everything gone", "", inputViaMask("…3333", "…333", true))
        assertEquals("", inputViaMask("•••", "••", true))
        assertEquals("pasted replaces", "6000111122223333", inputViaMask("…3333", "6000111122223333", true))
        assertEquals("unchanged without a mask", "123", inputViaMask("12", "123", false))
        assertFalse(inputViaMask("•••", "•••7", true).contains('•'))
    }
}
