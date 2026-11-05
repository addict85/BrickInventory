package ch.brickinventoryapp

import android.view.Window
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.components.PasswortRueckfrage
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
 * Ein aufgedecktes Passwort in einer Rückfrage steht sofort unter FLAG_SECURE, auch
 * wenn die App-Übersicht nicht verborgen ist (sec17 N2): Der Dialog hat ein eigenes
 * Fenster, das den Schutz der Seite erst bei seinem nächsten Neuaufbau übernähme.
 *
 * Gegenprobe (Robolectric, misst die CI; Job `gegenproben`):
 *   sichtschutz-ohne-dialogfenster  Sichtschutz() setzt nur das Fenster der Activity →
 *                                   rot „ein aufgedecktes Passwort im Dialog …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DialogSichtschutzTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int) = compose.activity.getString(id)

    private fun geschuetzt(fenster: Window?) =
        (checkNotNull(fenster).attributes.flags and WindowManager.LayoutParams.FLAG_SECURE) != 0

    private fun dialogFenster() = checkNotNull(ShadowDialog.getLatestDialog()) { "Kein Dialog offen" }.window

    @Test
    fun `ein aufgedecktes Passwort im Dialog ist sofort geschuetzt und danach wieder frei`() {
        compose.setContent {
            BrickInventoryManagerTheme {
                PasswortRueckfrage(titel = "Bestätigen", text = "Passwort", bestaetigen = "OK", codeNoetig = false,
                    fehler = null, laeuft = false, onBestaetigen = { _, _ -> }, onAbbrechen = {})
            }
        }
        // Tippen baut den Dialog neu auf; danach ändert nur noch das Auge seinen Inhalt.
        compose.onNode(hasSetTextAction()).performTextInput("geheim-123")
        compose.waitForIdle()
        assertFalse("Verdeckt braucht der Dialog keinen Schutz", geschuetzt(dialogFenster()))

        compose.onNodeWithContentDescription(text(R.string.cd_password_show)).performClick()
        compose.waitForIdle()
        assertTrue("Das aufgedeckte Passwort stand ungeschützt im Dialogfenster", geschuetzt(dialogFenster()))

        compose.onNodeWithContentDescription(text(R.string.cd_password_hide)).performClick()
        compose.waitForIdle()
        assertFalse("Wieder verdeckt bleibt der Dialog geschützt", geschuetzt(dialogFenster()))
        assertFalse("Die Seite darunter bleibt geschützt", geschuetzt(compose.activity.window))
    }
}
