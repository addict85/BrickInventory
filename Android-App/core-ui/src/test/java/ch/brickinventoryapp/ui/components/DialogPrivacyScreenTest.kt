package ch.brickinventoryapp.ui.components

import android.view.Window
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowDialog

/**
 * A revealed password in a prompt is under FLAG_SECURE right away, even
 * if the app overview isn't hidden: the dialog has its own
 * window, which would only pick up the page's protection on its next rebuild.
 *
 * Counter-check (Robolectric, measured by CI; job `counter-checks`):
 *   screen-protection-without-dialog-window  PrivacyShield() only sets the Activity's window →
 *                                   red „ein aufgedecktes Passwort im Dialog …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DialogPrivacyScreenTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int) = compose.activity.getString(id)

    private fun guarded(window: Window?) =
        (checkNotNull(window).attributes.flags and WindowManager.LayoutParams.FLAG_SECURE) != 0

    private fun dialogWindow() = checkNotNull(ShadowDialog.getLatestDialog()) { "no dialog open" }.window

    @Test
    fun `a revealed password in the dialog is protected immediately and free again afterwards`() {
        compose.setContent {
            BrickInventoryManagerTheme {
                PasswordPrompt(title = "Bestätigen", text = "Passwort", confirm = "OK", codeNeeded = false,
                    error = null, running = false, onConfirm = { _, _ -> }, onCancel = {})
            }
        }
        // Tapping rebuilds the dialog; after that only the eye changes its content.
        compose.onNode(hasSetTextAction()).performTextInput("geheim-123")
        compose.waitForIdle()
        assertFalse("covered, the dialog needs no protection", guarded(dialogWindow()))

        compose.onNodeWithContentDescription(text(R.string.cd_password_show)).performClick()
        compose.waitForIdle()
        assertTrue("the revealed password stood unprotected in the dialog window", guarded(dialogWindow()))

        compose.onNodeWithContentDescription(text(R.string.cd_password_hide)).performClick()
        compose.waitForIdle()
        assertFalse("covered again, the dialog stays protected", guarded(dialogWindow()))
        assertFalse("the page below stays protected", guarded(compose.activity.window))
    }
}
