package ch.brickinventoryapp.finances

import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testAccountRepository
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
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.ui.running
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
 * Vouchers with a masked list: number, PIN and PDF need only the login (no password, no
 * code), deleting asks „are you sure“ first; the plain text lives only in the ViewModel.
 * Against a test server.
 *
 * Counter-checks:
 *  A  In require() every step again only opens the prompt instead of running
 *     (counter-checks/voucher-show-asks-again.patch) → red “revealing the PIN runs …”.
 *  B  In require() the plain-text shortcut removed → red “revealing a PIN …”
 *     (copying asks the server again instead of copying).
 *  C  forgetPlaintext() does not clear `plaintext` → red “revealing a PIN …”.
 *  D  In require() DELETE runs right away like the other steps → red “deleting asks …”
 *     (counter-checks/voucher-delete-without-question.patch).
 *  E  In run() the rejection no longer closes the step → red “offline nothing is
 *     deleted …” (counter-checks/voucher-refusal-keeps-step.patch).
 *  F  editVoucher() no longer takes `g.pin`, but "" instead → red
 *     “editing sends the mask …” (the PIN would be cleared or missing).
 *  G  inputViaMask() always returns `newValue` → red “the mask is a whole”.
 *  H  pdfWithOnceTicket() always false → red “PDF and export …” (the viewer
 *     retried a used-up ticket).
 *  I  The repository sends a password again with the PDF release → red “PDF and export …”
 *     (counter-checks/voucher-pdf-with-password.patch).
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
            account = testAccountRepository(TestApi.forTarget(server)),
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

    /** The body of a confirmed step: JSON, but without password and code. */
    private fun assertNoSecrets(body: String) {
        val o = JSONObject(body)
        assertTrue("no password in $body", o.isNull("password"))
        assertTrue("no code in $body", o.isNull("code"))
    }

    @Test
    fun `revealing the PIN runs without a prompt, and the plaintext lives only on the page`() {
        server.enqueue(response(plaintext))
        vm.switchVoucherPin(1)
        pollUntil("revealed") { 1 in vm.state.value.pinVisible }
        assertNull("no prompt left over", vm.state.value.confirmation)
        assertEquals("1234", vm.state.value.plaintext[1]?.pin)
        val first = server.takeRequest()
        assertEquals("POST /api/v2/vouchers/1/plaintext", "${first.method} ${first.path}")
        assertNoSecrets(first.body.readUtf8())

        // Already there: copying does not ask the server again and copies the plain text.
        vm.copyVoucher(1, isNumber = true)
        assertEquals(CopyJob("6000111122223333", true), vm.state.value.copyTo)
        assertNull(vm.state.value.confirmation)
        assertEquals(2, server.requestCount)

        vm.leaveVouchers()
        assertTrue(vm.state.value.plaintext.isEmpty())
        assertTrue(vm.state.value.pinVisible.isEmpty())
        assertNull(vm.state.value.copyTo)
        // After leaving the plain text comes from the server again, still without a prompt.
        server.enqueue(response(plaintext))
        vm.copyVoucher(1, isNumber = false)
        pollUntil("copied") { vm.state.value.copyTo != null }
        assertEquals(CopyJob("1234", false), vm.state.value.copyTo)
        assertEquals(3, server.requestCount)
    }

    @Test
    fun `deleting asks first and then sends no password`() {
        vm.deleteVoucher(1)
        assertEquals(VoucherStep.DELETE, vm.state.value.confirmation?.step)
        assertFalse("nothing runs before „are you sure“", vm.state.value.confirmation!!.operation.running)
        assertEquals("no request before „are you sure“", 1, server.requestCount)
        server.enqueue(response("""{"success":true}"""))
        server.enqueue(response("""{"success":true,"vouchers":[]}"""))
        vm.confirm()
        pollUntil("deleted") { vm.state.value.vouchers.isEmpty() }
        val r = server.takeRequest()
        assertEquals("DELETE /api/v2/vouchers/1", "${r.method} ${r.path}")
        assertNoSecrets(r.body.readUtf8())
        assertNull(vm.state.value.confirmation)
        assertEquals("the undo snackbar names the card", 1, vm.state.value.deleted)
    }

    @Test
    fun `offline nothing is deleted and nothing buffered`() {
        vm.deleteVoucher(1)
        server.shutdown()
        vm.confirm()
        pollUntil("refusal") { vm.state.value.confirmation == null && channel.text != null }
        assertEquals("the voucher is still shown", 1, vm.state.value.vouchers.size)
        assertNull("nothing waits for the network", vm.state.value.deleted)
    }

    @Test
    fun `PDF and export only with a ticket`() {
        server.enqueue(response("""{"success":true,"ticket":"t/1+","valid_seconds":60}"""))
        vm.openVoucherPdf(1)
        pollUntil("ticket") { vm.state.value.pdfTarget != null }
        assertEquals(VoucherPdfTarget(1, "t/1+"), vm.state.value.pdfTarget)
        assertNull("no prompt left over", vm.state.value.confirmation)
        val grant = server.takeRequest()
        assertEquals("POST /api/v2/vouchers/1/pdf-grant", "${grant.method} ${grant.path}")
        assertNoSecrets(grant.body.readUtf8())
        assertEquals("https://brick.example/api/v2/vouchers/1/pdf?ticket=t%2F1%2B",
            voucherPdfAddress("https://brick.example/", vm.state.value.pdfTarget!!))
        assertTrue(pdfWithOnceTicket(voucherPdfAddress("https://brick.example/", vm.state.value.pdfTarget!!)))
        assertFalse(pdfWithOnceTicket("https://brick.example/api/v2/instructions/4/file"))
        vm.voucherPdfAcknowledge()

        server.enqueue(response("""{"success":true,"ticket":"x","valid_seconds":60}"""))
        vm.openVoucherExport()
        pollUntil("ticket") { vm.state.value.pdfTarget != null }
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
