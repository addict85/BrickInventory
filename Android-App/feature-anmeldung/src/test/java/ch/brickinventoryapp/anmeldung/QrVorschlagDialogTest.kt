package ch.brickinventoryapp.anmeldung

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import ch.brickinventoryapp.anmeldung.ui.QrLoginPayload
import ch.brickinventoryapp.anmeldung.ui.screens.QrVorschlagDialog
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Der Dialog nach einem gescannten Code: Das Ziel steht hervorgehoben da, und
 * „Übernehmen“ geht erst nach dem Haken „Ja, <host> ist mein Server“.
 *
 * Gegenprobe (Robolectric, nur in der CI messbar; Job `gegenproben`):
 *   (a) der Knopf wieder ohne den Haken frei → rot „uebernommen wird erst nach dem Ja …“
 *       (gegenproben/qr-dialog-ohne-ja.patch)
 */
@RunWith(RobolectricTestRunner::class)
class QrVorschlagDialogTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity

    @Test
    fun `uebernommen wird erst nach dem Ja zum genannten Server`() {
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
        val knopf = compose.onNodeWithText(ctx.getString(R.string.setup_qr_uebernehmen))
        knopf.assertIsNotEnabled()
        compose.onNodeWithText(ctx.getString(R.string.setup_qr_ziel_bestaetigen, "brick.example.org"))
            .performScrollTo().performClick()
        knopf.assertIsEnabled().performClick()
        assertEquals(1, uebernommen)
    }
}
