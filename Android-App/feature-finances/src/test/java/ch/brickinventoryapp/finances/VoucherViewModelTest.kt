package ch.brickinventoryapp.finances

import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.data.testing.RowsServer
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testVouchersRepository
import ch.brickinventoryapp.data.testing.text
import ch.brickinventoryapp.finances.ui.viewmodel.VoucherViewModel
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.ui.running
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.testing.NumbersTexts
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
import java.io.File

/**
 * The voucher ViewModel, in step against answers in a fixed order.
 *
 * Possible since it was separated out of MainViewModel and gets its
 * texts through an interface instead of through the Context.
 *
 * Counter-checks:
 *  - In persist() the 422 takeover removed (message only): "what was read from the PDF ends up in the form" red — number empty.
 *  - The PDF check `type != "application/pdf"` removed: "a non-PDF file does not go to the server" red — one fetch instead of none.
 *  - In the finally of queryAllBalances() back to `load()` instead of
 *    `loadVouchers()`: "a cancelled run cleans up and reloads" red — the
 *    cancelled coroutine no longer loads (two fetches instead of three).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VoucherViewModelTest {

    private val clock = TestCoroutineScheduler()
    private val tick = UnconfinedTestDispatcher(clock)
    private lateinit var server: RowsServer
    private lateinit var cacheDir: File
    private lateinit var channel: MessageChannel
    private lateinit var vm: VoucherViewModel

    private fun response(body: String, code: Int = 200) = TestApi.response(body, code)

    /** Without advancing the clock: a server wait period visibly stays put. */
    private fun until(was: String, condition: () -> Boolean) {
        clock.runCurrent()
        assertTrue(was, condition())
    }

    private val twoCards = """{"success":true,"vouchers":[
        {"id":1,"number":"6000111122223333","pin":"1234","amount":50,"currency":"CHF"},
        {"id":2,"number":"6000444455556666","pin":"5678","amount":25.5,"currency":"EUR"}]}"""

    @Before
    fun setUp() {
        Dispatchers.setMain(tick)
        server = RowsServer()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-gut-${System.nanoTime()}")
        cacheDir.mkdirs()
        val api = server.api
        channel = MessageChannel()
        vm = VoucherViewModel(
            repo = testVouchersRepository(api),
            texts = NumbersTexts,
            reader = object : FileReader { override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null },
            messages = channel,
            account = testAccountRepository(api),
        )
    }

    @After
    fun tearDown() {
        server.shutdown()
        server.checkReadIn()
        cacheDir.deleteRecursively()
        Dispatchers.resetMain()
    }

    @Test
    fun `the list is loaded and a voucher is fetched into the form`() {
        server.enqueue(response(twoCards))
        vm.loadVouchers()
        until("list") { vm.state.value.vouchers.size == 2 && !vm.state.value.fetch.loading }

        vm.editVoucher(1)
        val s = vm.state.value
        assertEquals(1, s.edited)
        assertEquals("6000111122223333", s.number)
        // Whole amounts without ".0" — what stands in the field is what the user keeps typing.
        assertEquals("50", s.amount)
        vm.editVoucher(2)
        assertEquals("25.5", vm.state.value.amount)
        assertEquals("EUR", vm.state.value.currency)
    }

    @Test
    fun `what was read from the PDF lands in the form`() {
        server.enqueue(response("""{"success":false,"error":"Betrag fehlt",
            "parsed":{"number":"6000999988887777","pin":"4321","currency":"EUR"}}""", 422))
        vm.persist { "application/pdf" to byteArrayOf(37, 80, 68, 70) }
        until("form") { !vm.state.value.save.running && server.requestCount == 1 && channel.text != null }

        val s = vm.state.value
        assertEquals("6000999988887777", s.number)
        assertEquals("4321", s.pin)
        assertEquals("EUR", s.currency)
        assertEquals("", s.amount)
        assertEquals("t${R.string.vouchers_pdf_incomplete}", channel.text)
        assertTrue(server.takeRequest().path.endsWith("/api/v2/vouchers/pdf"))
    }

    @Test
    fun `a non-PDF file does not go to the server`() {
        vm.persist { "image/png" to byteArrayOf(1, 2, 3) }
        until("message") { channel.text != null && !vm.state.value.save.running }
        assertEquals("t${R.string.vouchers_only_pdf}", channel.text)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `an aborted run cleans up and reloads`() {
        server.enqueue(response(twoCards))
        vm.loadVouchers()
        until("list") { vm.state.value.vouchers.size == 2 }

        // The limit reports `abstand`: the ViewModel visibly waits.
        server.enqueue(response("""{"success":false,"code":"balance_interval","reason":"abstand","waitSeconds":30}""", 429))
        server.enqueue(response(twoCards))
        vm.queryAllBalances()
        until("waiting time") { (vm.state.value.balanceRun?.waitSec ?: 0) > 0 }
        assertEquals(2, vm.state.value.balanceRun?.total)

        vm.cancelBalanceRun()
        until("neu geladen") { server.requestCount == 3 }
        assertNull(vm.state.value.balanceRun)
        assertNull(vm.state.value.balanceRunning)
        assertEquals("t${R.string.vouchers_balance_all_done}", channel.text)
    }

    // Counter-check (measured 02.11.2026): `|| d.reason == "account"` removed in the ViewModel
    // → red, the balance of voucher 2 was also queried (2 instead of 1).
    @Test
    fun `the account limit aborts the pass`() {
        server.enqueue(response(twoCards))
        vm.loadVouchers()
        until("list") { vm.state.value.vouchers.size == 2 }

        server.enqueue(response("""{"success":false,"code":"too_many_requests","error":"Zu viele Abfragen","reason":"konto","waitSeconds":1800}""", 429))
        server.enqueue(response(twoCards))
        vm.queryAllBalances()
        // List, one query, then the reload in the finally — no second card.
        clock.advanceUntilIdle()
        until("neu geladen") { server.requestCount >= 3 }
        val paths = List(server.requestCount) { server.takeRequest().path.orEmpty() }
        assertEquals("no second card after the account limit: $paths", 1, paths.count { "/balance" in it })
    }
}
