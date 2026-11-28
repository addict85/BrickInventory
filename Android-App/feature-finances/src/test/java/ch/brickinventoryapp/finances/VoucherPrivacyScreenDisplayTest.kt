package ch.brickinventoryapp.finances

import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testVouchersRepository
import ch.brickinventoryapp.dataapi.message.MessageChannel
import ch.brickinventoryapp.finances.ui.screens.VoucherPdfProtection
import ch.brickinventoryapp.finances.ui.screens.VouchersRoute
import ch.brickinventoryapp.finances.ui.viewmodel.VoucherViewModel
import ch.brickinventoryapp.finances.ui.viewmodel.voucherPdfAddress
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.state.testing.NumbersTexts
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The vouchers page and a voucher PDF set FLAG_SECURE, run; an
 * instruction manual in the same viewer does not. Replaces the source check in
 * feature-finances/VoucherPrivacyScreenTest.
 *
 * Counter-checks (Robolectric, measured by CI; job `counter-checks`):
 *   voucher-page-without-screen-protection  PrivacyShield() removed from VouchersRoute → red
 *                                    “the vouchers page …”
 *   voucher-pdf-without-screen-protection   VoucherPdfProtection without Sichtschutz → red “a voucher PDF …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class VoucherPrivacyScreenDisplayTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun guarded() =
        (compose.activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE) != 0

    @Test
    fun `the voucher page is protected as long as it is shown`() {
        val paths = PathServer()
        val vm = VoucherViewModel(
            repo = testVouchersRepository(paths.onTick()),
            texts = NumbersTexts,
            reader = object : FileReader { override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null },
            messages = MessageChannel(),
            account = testAccountRepository(paths.onTick()), SavedStateHandle())
        val visible = mutableStateOf(true)
        compose.setContent {
            BrickInventoryManagerTheme {
                if (visible.value) VouchersRoute(vm, SnackbarHostState(), onBack = {})
            }
        }
        compose.waitForIdle()
        assertTrue("number and PIN would show in screenshots", guarded())
        visible.value = false
        compose.waitForIdle()
        assertFalse("after leaving the app stays protected", guarded())
    }

    @Test
    fun `a voucher PDF is protected, a building instruction is not`() {
        val address = mutableStateOf(voucherPdfAddress("https://brick.example/", 7))
        compose.setContent { VoucherPdfProtection(address.value) }
        compose.waitForIdle()
        assertTrue("a voucher PDF would show in screenshots", guarded())
        address.value = "https://brick.example/api/v2/instructions/42/file"
        compose.waitForIdle()
        assertFalse("a building manual needs no protection", guarded())
    }
}
