package ch.brickinventoryapp.finances

import ch.brickinventoryapp.testing.testVouchersRepository
import ch.brickinventoryapp.model.file.FileRef
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.finances.ui.screens.VoucherPdfProtection
import ch.brickinventoryapp.finances.ui.screens.VouchersRoute
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.finances.ui.viewmodel.VoucherViewModel
import ch.brickinventoryapp.finances.ui.viewmodel.voucherPdfAddress
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import ch.brickinventoryapp.testing.NumbersTexts
import ch.brickinventoryapp.testing.PathServer

/**
 * The vouchers page and a voucher PDF set FLAG_SECURE, run; an
 * instruction manual in the same viewer does not. Replaces the source check in
 * feature-finances/VoucherPrivacyScreenTest.
 *
 * Counter-checks (Robolectric, measured by CI; job `counter-checks`):
 *   gutscheinseite-ohne-sichtschutz  PrivacyShield() removed from VouchersRoute → red
 *                                    “the vouchers page …”
 *   gutschein-pdf-ohne-sichtschutz   VoucherPdfProtection without Sichtschutz → red “a voucher PDF …”
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
        )
        val visible = mutableStateOf(true)
        compose.setContent {
            BrickInventoryManagerTheme {
                if (visible.value) VouchersRoute(vm, SnackbarHostState(), onBack = {})
            }
        }
        compose.waitForIdle()
        assertTrue("Nummer und PIN stünden in Bildschirmfotos", guarded())
        visible.value = false
        compose.waitForIdle()
        assertFalse("Nach dem Verlassen bleibt die App geschützt", guarded())
    }

    @Test
    fun `a voucher PDF is protected, a building instruction is not`() {
        val address = mutableStateOf(voucherPdfAddress("https://brick.example/", 7))
        compose.setContent { VoucherPdfProtection(address.value) }
        compose.waitForIdle()
        assertTrue("Ein Gutschein-PDF stünde in Bildschirmfotos", guarded())
        address.value = "https://brick.example/api/v1/instructions/42/file"
        compose.waitForIdle()
        assertFalse("Eine Bauanleitung braucht keinen Schutz", guarded())
    }
}
