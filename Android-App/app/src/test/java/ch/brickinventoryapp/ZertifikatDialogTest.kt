package ch.brickinventoryapp

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTextInput
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.components.ZertifikatDialog
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.util.ZertifikatUngeklaert
import ch.brickinventoryapp.util.fingerabdruckLesbar
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.Base64

/**
 * Was der Zertifikatsdialog zeigt: Wo abgetippt wird, steht der abzutippende Teil
 * nicht auf dem Bildschirm (nur der Anfang); beim Erstkontakt über eine öffentliche
 * CA der ganze Fingerabdruck zum Vergleichen.
 *
 * Gegenproben (Robolectric, nur in der CI messbar; Job `gegenproben`):
 *   (a) im Dialog wieder `fingerabdruckLesbar(frage.fingerabdruck)` statt des
 *       Anfangs → rot „wer abtippt, sieht den abzutippenden Teil nicht“
 *       (gegenproben/zertifikat-zeigt-alles.patch)
 *   (b) `abschreiben` nur für GEAENDERT → rot „ueber eine Nutzer-CA …“
 *       (gegenproben/nutzerca-ein-tipp.patch)
 */
@RunWith(RobolectricTestRunner::class)
class ZertifikatDialogTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity
    private val fp = Base64.getEncoder().encodeToString(ByteArray(32) { (it * 7 + 3).toByte() })
    private val hex = fingerabdruckLesbar(fp)

    private fun zeige(art: ZertifikatUngeklaert.Art, erwartet: String? = null) {
        val frage = ZertifikatUngeklaert("nas:8443", fp, art, erwartet)
        compose.setContent {
            BrickInventoryManagerTheme {
                ZertifikatDialog(frage, nutzerCaAn = false, onVertrauen = { false }, onNutzerCa = {}, onAbbrechen = {})
            }
        }
        compose.waitForIdle()
    }

    private fun gezeigt(text: String) = compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().size

    @Test
    fun `wer abtippt, sieht den abzutippenden Teil nicht`() {
        zeige(ZertifikatUngeklaert.Art.GEAENDERT, erwartet = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        assertEquals("Die letzten 24 Zeichen stehen da", 0, gezeigt(hex.takeLast(35)))
        assertEquals("Der Anfang fehlt", 1, gezeigt(hex.take(11)))
    }

    @Test
    fun `ohne bekannte CA steht nur der Anfang da`() {
        zeige(ZertifikatUngeklaert.Art.UNBEKANNTE_CA)
        assertEquals(0, gezeigt(hex.takeLast(35)))
        assertEquals(1, gezeigt(hex.take(11)))
    }

    @Test
    fun `beim Erstkontakt ueber eine oeffentliche CA steht der ganze Fingerabdruck da`() {
        zeige(ZertifikatUngeklaert.Art.ERSTKONTAKT)
        assertEquals(1, gezeigt(hex))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsEnabled()
    }

    @Test
    fun `ueber eine Nutzer-CA genuegt kein Tipp, die Eingabe ist blind`() {
        zeige(ZertifikatUngeklaert.Art.NUTZER_CA)
        assertEquals(0, gezeigt(hex.takeLast(35)))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsNotEnabled()
        compose.onNode(hasSetTextAction()).performTextInput(hex.takeLast(35))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsEnabled()
    }
}
