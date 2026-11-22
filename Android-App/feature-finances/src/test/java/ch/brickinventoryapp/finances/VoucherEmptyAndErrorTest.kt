package ch.brickinventoryapp.finances

import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import ch.brickinventoryapp.finances.ui.GutscheinUiState
import ch.brickinventoryapp.finances.ui.screens.GutscheineCard
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The vouchers page without vouchers: a server error names the heading and advice of its
 * class and offers a retry; the empty list says as a heading that there
 * are none yet, and underneath, what the page is for.
 *
 * Counter-checks (patches under gegenproben/, Robolectric, measured by CI):
 *   gutschein-fehler-ohne-klasse  ErrorHint without fehler.art → red “a server error …”
 *   gutschein-leer-nur-satz       empty state again only the gray line → red “without vouchers …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "de-rCH")
class VoucherEmptyAndErrorTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int) = compose.activity.getString(id)

    private fun zeige(zustand: GutscheinUiState, onErneut: () -> Unit = {}) {
        compose.setContent {
            BrickInventoryManagerTheme {
                GutscheineCard(zustand = zustand, onFeld = { _, _, _, _ -> }, switchOnPin = {}, editOn = {},
                    onAbbrechen = {}, onSpeichern = {}, deleteOn = {}, openOnPdf = {}, onKopieren = { _, _ -> },
                    onBalance = {}, cancelOnBalance = {}, onErneut = onErneut,
                    onBestaetigen = { _, _ -> }, cancelOnConfirmation = {})
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `a server error names the advice of its class and reloads on request`() {
        var erneut = 0
        zeige(GutscheinUiState(abruf = Laden.Fehler(Fehlerklasse.SERVER, Meldung.Text("Serverfehler (502)")))) { erneut++ }
        compose.onNodeWithText(text(R.string.fehler_server_titel)).fetchSemanticsNode("Überschrift der Klasse fehlt")
        compose.onNodeWithText(text(R.string.fehler_server_text)).fetchSemanticsNode("Rat der Klasse fehlt")
        compose.onNodeWithText("Serverfehler (502)").fetchSemanticsNode("Der Satz des Servers fehlt")
        compose.onNodeWithText(text(R.string.common_retry)).performClick()
        assertEquals(1, erneut)
    }

    @Test
    fun `without vouchers a heading stands and below it what the page is for`() {
        zeige(GutscheinUiState())
        val titel = compose.onNodeWithText(text(R.string.vouchers_empty)).fetchSemanticsNode("Titel fehlt")
        assertTrue("„Noch keine Gutscheine“ ist keine Überschrift",
            titel.config.getOrNull(SemanticsProperties.Heading) != null)
        compose.onNodeWithText(text(R.string.vouchers_empty_hint)).fetchSemanticsNode("Erklärung fehlt")
    }
}
