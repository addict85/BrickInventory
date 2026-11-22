package ch.brickinventoryapp.login

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import ch.brickinventoryapp.login.ui.QrLoginPayload
import ch.brickinventoryapp.login.ui.screens.QrSuggestionDialog
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The dialog after a scanned code: the destination stands out highlighted, and
 * „Übernehmen“ only works after the checkbox „Ja, <host> ist mein Server“.
 *
 * Counter-check (Robolectric, measurable only in the CI; job `counter-checks`):
 *   (a) the button free again without the checkbox → red “taken over only after the yes …”
 *       (counter-checks/qr-dialog-ohne-ja.patch)
 */
@RunWith(RobolectricTestRunner::class)
class QrSuggestionDialogTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity

    @Test
    fun `it is taken over only after the yes to the named server`() {
        var adopted = 0
        compose.setContent {
            BrickInventoryManagerTheme {
                QrSuggestionDialog(
                    suggestion = QrLoginPayload("https://brick.example.org", "bim:abc"),
                    currentUrl = "",
                    development = false,
                    previousPin = { _, _ -> null },
                    mustTypeIn = { _, _ -> false },
                    onCancel = {},
                    onAdopt = { adopted++ },
                )
            }
        }
        compose.waitForIdle()
        val button = compose.onNodeWithText(ctx.getString(R.string.setup_qr_adopt))
        button.assertIsNotEnabled()
        compose.onNodeWithText(ctx.getString(R.string.setup_qr_target_confirm, "brick.example.org"))
            .performScrollTo().performClick()
        button.assertIsEnabled().performClick()
        assertEquals(1, adopted)
    }
}
