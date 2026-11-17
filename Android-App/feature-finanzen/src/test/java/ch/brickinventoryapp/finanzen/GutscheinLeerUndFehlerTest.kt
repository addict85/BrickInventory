package ch.brickinventoryapp.finanzen

import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import ch.brickinventoryapp.finanzen.ui.GutscheinUiState
import ch.brickinventoryapp.finanzen.ui.screens.GutscheineCard
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Die Gutscheinseite ohne Gutscheine: Ein Serverfehler nennt Überschrift und Rat seiner
 * Klasse und bietet einen neuen Versuch; die leere Liste sagt als Überschrift, dass es
 * noch keine gibt, und darunter, wozu die Seite da ist.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   gutschein-fehler-ohne-klasse  FehlerHinweis ohne fehler.art → rot „ein Serverfehler …“
 *   gutschein-leer-nur-satz       Leerzustand wieder nur die graue Zeile → rot „ohne Gutscheine …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "de-rCH")
class GutscheinLeerUndFehlerTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int) = compose.activity.getString(id)

    private fun zeige(zustand: GutscheinUiState, onErneut: () -> Unit = {}) {
        compose.setContent {
            BrickInventoryManagerTheme {
                GutscheineCard(zustand = zustand, onFeld = { _, _, _, _ -> }, onPinSchalten = {}, onBearbeiten = {},
                    onAbbrechen = {}, onSpeichern = {}, onLoeschen = {}, onPdfOeffnen = {}, onKopieren = { _, _ -> },
                    onGuthaben = {}, onGuthabenAbbrechen = {}, onErneut = onErneut,
                    onBestaetigen = { _, _ -> }, onBestaetigungAbbrechen = {})
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `ein Serverfehler nennt den Rat seiner Klasse und laedt auf Wunsch neu`() {
        var erneut = 0
        zeige(GutscheinUiState(abruf = Laden.Fehler(Fehlerklasse.SERVER, Meldung.Text("Serverfehler (502)")))) { erneut++ }
        compose.onNodeWithText(text(R.string.fehler_server_titel)).fetchSemanticsNode("Überschrift der Klasse fehlt")
        compose.onNodeWithText(text(R.string.fehler_server_text)).fetchSemanticsNode("Rat der Klasse fehlt")
        compose.onNodeWithText("Serverfehler (502)").fetchSemanticsNode("Der Satz des Servers fehlt")
        compose.onNodeWithText(text(R.string.common_retry)).performClick()
        assertEquals(1, erneut)
    }

    @Test
    fun `ohne Gutscheine steht eine Ueberschrift und darunter, wozu die Seite da ist`() {
        zeige(GutscheinUiState())
        val titel = compose.onNodeWithText(text(R.string.vouchers_empty)).fetchSemanticsNode("Titel fehlt")
        assertTrue("„Noch keine Gutscheine“ ist keine Überschrift",
            titel.config.getOrNull(SemanticsProperties.Heading) != null)
        compose.onNodeWithText(text(R.string.vouchers_empty_hint)).fetchSemanticsNode("Erklärung fehlt")
    }
}
