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
 * Counter-check (Robolectric, measured by CI; job `gegenproben`):
 *   sichtschutz-ohne-dialogfenster  Sichtschutz() only sets the Activity's window →
 *                                   red „ein aufgedecktes Passwort im Dialog …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DialogPrivacyScreenTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int) = compose.activity.getString(id)

    private fun geschuetzt(fenster: Window?) =
        (checkNotNull(fenster).attributes.flags and WindowManager.LayoutParams.FLAG_SECURE) != 0

    private fun dialogWindow() = checkNotNull(ShadowDialog.getLatestDialog()) { "Kein Dialog offen" }.window

    @Test
    fun `a revealed password in the dialog is protected immediately and free again afterwards`() {
        compose.setContent {
            BrickInventoryManagerTheme {
                PasswordPrompt(titel = "Bestätigen", text = "Passwort", bestaetigen = "OK", codeNoetig = false,
                    fehler = null, laeuft = false, onBestaetigen = { _, _ -> }, onAbbrechen = {})
            }
        }
        // Tapping rebuilds the dialog; after that only the eye changes its content.
        compose.onNode(hasSetTextAction()).performTextInput("geheim-123")
        compose.waitForIdle()
        assertFalse("Verdeckt braucht der Dialog keinen Schutz", geschuetzt(dialogWindow()))

        compose.onNodeWithContentDescription(text(R.string.cd_password_show)).performClick()
        compose.waitForIdle()
        assertTrue("Das aufgedeckte Passwort stand ungeschützt im Dialogfenster", geschuetzt(dialogWindow()))

        compose.onNodeWithContentDescription(text(R.string.cd_password_hide)).performClick()
        compose.waitForIdle()
        assertFalse("Wieder verdeckt bleibt der Dialog geschützt", geschuetzt(dialogWindow()))
        assertFalse("Die Seite darunter bleibt geschützt", geschuetzt(compose.activity.window))
    }
}
