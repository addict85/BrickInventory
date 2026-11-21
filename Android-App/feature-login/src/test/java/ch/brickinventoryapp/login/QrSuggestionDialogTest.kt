package ch.brickinventoryapp.login

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import ch.brickinventoryapp.login.ui.QrLoginPayload
import ch.brickinventoryapp.login.ui.screens.QrVorschlagDialog
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
 * Counter-check (Robolectric, measurable only in the CI; job `gegenproben`):
 *   (a) the button free again without the checkbox → red “taken over only after the yes …”
 *       (gegenproben/qr-dialog-ohne-ja.patch)
 */
@RunWith(RobolectricTestRunner::class)
class QrSuggestionDialogTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity

    @Test
    fun `it is taken over only after the yes to the named server`() {
        var uebernommen = 0
        compose.setContent {
            BrickInventoryManagerTheme {
                QrVorschlagDialog(
                    vorschlag = QrLoginPayload("https://brick.example.org", "bim:abc"),
                    currentUrl = "",
                    entwicklung = false,
                    bisherigerPin = { _, _ -> null },
                    mussAbtippen = { _, _ -> false },
                    onAbbrechen = {},
                    onUebernehmen = { uebernommen++ },
                )
            }
        }
        compose.waitForIdle()
        val button = compose.onNodeWithText(ctx.getString(R.string.setup_qr_uebernehmen))
        button.assertIsNotEnabled()
        compose.onNodeWithText(ctx.getString(R.string.setup_qr_ziel_bestaetigen, "brick.example.org"))
            .performScrollTo().performClick()
        button.assertIsEnabled().performClick()
        assertEquals(1, uebernommen)
    }
}
