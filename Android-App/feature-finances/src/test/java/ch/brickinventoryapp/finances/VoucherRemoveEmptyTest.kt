package ch.brickinventoryapp.finances

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.data.testing.RowsServer
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testVouchersRepository
import ch.brickinventoryapp.data.testing.text
import ch.brickinventoryapp.finances.ui.viewmodel.VoucherViewModel
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * „Leere Gutscheine entfernen“: the switch comes from and goes to the account's settings,
 * and after the app's own balance run (or a single query) the cards the server removed at
 * 0.00 are named in the one snackbar and vanish with the reload.
 *
 * Counter-checks (counter-checks/, measured 27.11.2026 with tools/counter-checks.py, each red):
 *  - voucher-remove-empty-not-read: loadRemoveEmpty() ignores the answer → red „the switch
 *    reads and saves …“ (stays off).
 *  - voucher-remove-empty-saved-inverted: setRemoveEmptyVouchers() sends "0" for on → red
 *    „the switch reads and saves …“ (body).
 *  - voucher-remove-empty-run-silent: REMOVED counted as plain DONE → red „the run names the
 *    removed cards …“ (summary without the removal).
 *  - voucher-remove-empty-single-silent: the removal sentence dropped from queryBalance() →
 *    red „a single query names a removed card …“.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VoucherRemoveEmptyTest {

    private val clock = TestCoroutineScheduler()
    private val tick = UnconfinedTestDispatcher(clock)
    private lateinit var server: RowsServer
    private lateinit var channel: MessageChannel
    private lateinit var vm: VoucherViewModel

    private fun response(body: String, code: Int = 200) = TestApi.response(body, code)

    private fun until(was: String, condition: () -> Boolean) {
        clock.runCurrent()
        assertTrue(was, condition())
    }

    private val twoCards = """{"success":true,"vouchers":[
        {"id":1,"number":"6000111122223333","pin":"1234","amount":50,"currency":"CHF"},
        {"id":2,"number":"6000444455556666","pin":"5678","amount":25.5,"currency":"CHF"}]}"""
    private val secondOnly = """{"success":true,"vouchers":[
        {"id":2,"number":"6000444455556666","pin":"5678","amount":5,"currency":"CHF"}]}"""

    private fun balance(id: Int, amount: Double, removed: Boolean) = """{"success":true,
        "voucher":{"id":$id,"number":"60001111222$id","pin":"••••","amount":$amount,"currency":"CHF"},
        "displayed":"CHF $amount","currency_changed":false,"removed":$removed}"""

    @Before
    fun setUp() {
        Dispatchers.setMain(tick)
        server = RowsServer()
        channel = MessageChannel()
        vm = VoucherViewModel(
            repo = testVouchersRepository(server.api),
            texts = NumbersTexts,
            reader = object : FileReader { override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null },
            messages = channel,
            account = testAccountRepository(server.api, tick), SavedStateHandle())
    }

    @After
    fun tearDown() {
        server.shutdown()
        server.checkReadIn()
        Dispatchers.resetMain()
    }

    @Test
    fun `the switch reads and saves the account's setting`() {
        server.enqueue(response("""{"success":true,"settings":{"currency":"CHF","remove_empty_vouchers":true}}"""))
        vm.loadRemoveEmpty()
        until("read") { vm.state.value.removeEmpty }
        assertTrue(server.takeRequest().path.endsWith("/api/v2/settings"))

        server.enqueue(response("""{"success":true,"updated":1}"""))
        vm.setRemoveEmpty(false)
        until("saved off") { !vm.state.value.removeEmpty && server.requestCount == 2 }
        val off = server.takeRequest()
        assertEquals("PUT", off.method)
        assertEquals("""{"remove_empty_vouchers":"0"}""", off.body.readUtf8())

        server.enqueue(response("""{"success":true,"updated":1}"""))
        vm.setRemoveEmpty(true)
        until("saved on") { vm.state.value.removeEmpty && server.requestCount == 3 }
        assertEquals("""{"remove_empty_vouchers":"1"}""", server.takeRequest().body.readUtf8())

        // A rejection leaves the switch where the server has it.
        server.enqueue(response("""{"success":false,"error":"Wert ungültig","code":"value_invalid"}""", 400))
        vm.setRemoveEmpty(false)
        until("rejected") { server.requestCount == 4 && channel.text != null }
        assertTrue(vm.state.value.removeEmpty)
    }

    @Test
    fun `the run names the removed cards in its one message and reloads the list`() {
        server.enqueue(response(twoCards))
        vm.loadVouchers()
        until("list") { vm.state.value.vouchers.size == 2 }

        server.enqueue(response(balance(1, 0.0, removed = true)))
        server.enqueue(response(balance(2, 5.0, removed = false)))
        server.enqueue(response(secondOnly))
        vm.queryAllBalances()
        clock.advanceUntilIdle()
        until("reloaded") { server.requestCount == 4 && vm.state.value.vouchers.map { it.id } == listOf(2) }
        assertEquals("t${R.string.vouchers_balance_all_done} · m${R.plurals.vouchers_removed_empty}:1", channel.text)
    }

    @Test
    fun `a single query names a removed card, a full one says nothing of it`() {
        server.enqueue(response(twoCards))
        vm.loadVouchers()
        until("list") { vm.state.value.vouchers.size == 2 }

        server.enqueue(response(balance(2, 5.0, removed = false)))
        server.enqueue(response(twoCards))
        vm.queryBalance(2)
        until("kept") { server.requestCount == 3 && channel.text != null }
        assertFalse(channel.text.orEmpty().contains("m${R.plurals.vouchers_removed_empty}"))
        channel.acknowledge()

        server.enqueue(response(balance(1, 0.0, removed = true)))
        server.enqueue(response(secondOnly))
        vm.queryBalance(1)
        until("removed") { server.requestCount == 5 && vm.state.value.vouchers.map { it.id } == listOf(2) }
        assertTrue(channel.text.orEmpty(), channel.text.orEmpty().endsWith(" m${R.plurals.vouchers_removed_empty}:1"))
    }
}
