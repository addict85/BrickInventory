package ch.brickinventoryapp.finances

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testVouchersRepository
import ch.brickinventoryapp.data.testing.text
import ch.brickinventoryapp.dataapi.message.MessageChannel
import ch.brickinventoryapp.finances.ui.viewmodel.VoucherViewModel
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.testing.NumbersTexts
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * A deleted voucher stays on the server for a few days: the snackbar's „Rückgängig“
 * calls the restore route, a snackbar ending without it only forgets the card.
 *
 * Counter-checks:
 *  A  in runStepFrom() DELETE without `deleted = b.id` → red “undo restores …”
 *     (no card for the snackbar).
 *  B  restoreVoucher() calls repo.restore() no more → red “undo restores …”.
 *  C  deletedAcknowledge() calls restoreVoucher() → red “without undo …”.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VoucherUndoTest {

    private val list = """{"success":true,"vouchers":[
        {"id":1,"number":"…3333","pin":"•••","amount":50,"currency":"CHF","has_pdf":true}]}"""
    private val paths = PathServer(
        "/api/v2/vouchers" to list,
        "/api/v2/vouchers/1" to """{"success":true}""",
        "/api/v2/vouchers/1/restore" to """{"success":true,"voucher":null}""",
    )
    private val channel = MessageChannel()
    private lateinit var vm: VoucherViewModel

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        vm = VoucherViewModel(
            repo = testVouchersRepository(paths.onTick()),
            texts = NumbersTexts,
            reader = object : FileReader { override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null },
            messages = channel,
            account = testAccountRepository(paths.onTick()), SavedStateHandle())
        vm.loadVouchers()
    }

    @After
    fun tearDown() {
        paths.server.shutdown()
        Dispatchers.resetMain()
    }

    private fun delete() {
        vm.deleteVoucher(1)
    }

    @Test
    fun `undo restores the card on the server`() {
        delete()
        assertEquals("the snackbar gets the card", 1, vm.state.value.deleted)
        vm.restoreVoucher(1)
        assertNull("the snackbar is answered", vm.state.value.deleted)
        assertEquals(listOf("POST /api/v2/vouchers/1/restore"), paths.requestsTo("/restore"))
        assertEquals("t${R.string.vouchers_restored}", channel.text)
    }

    @Test
    fun `without undo nothing more goes to the server`() {
        delete()
        val before = paths.requests.size
        vm.deletedAcknowledge()
        assertNull(vm.state.value.deleted)
        assertEquals(before, paths.requests.size)
        assertEquals(emptyList<String>(), paths.requestsTo("/restore"))
    }
}
