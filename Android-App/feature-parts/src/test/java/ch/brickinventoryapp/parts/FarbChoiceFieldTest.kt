package ch.brickinventoryapp.parts

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.parts.ui.screens.FarbWahlFeld
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Das Farbfeld eines manuell erfassten Teils, gezeichnet: Ohne Farbliste und ohne Namen
 * aus dem Bestand steht „Unbekannte Farbe“, nie die nackte Farbnummer; mit Namen aus
 * dem Bestand steht dieser. Die Schrift ist so gross wie die übrigen Werte (bodyMedium).
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   farbe-als-nummer        Rückfall wieder „Farbe %1$d“ mit der Nummer → rot „ohne Namen steht …“
 *   farbfeld-kleine-schrift Feld wieder in bodySmall → rot „ohne Namen steht …“ (Schriftgrösse)
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "de-rCH")
class FarbChoiceFieldTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private var wert = TextStyle.Default

    private fun zeige(farben: List<ColorView>, name: String?) {
        compose.setContent {
            BrickInventoryManagerTheme {
                wert = MaterialTheme.typography.bodyMedium
                FarbWahlFeld(farben = farben, aktuell = 5, aktuellerName = name, currentHex = null, onWahl = {})
            }
        }
        compose.waitForIdle()
    }

    private fun feld() = compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText)).fetchSemanticsNode("Kein Farbfeld")

    private fun fieldText() = feld().config[SemanticsProperties.EditableText].text

    @Test
    fun `ohne Namen steht Unbekannte Farbe in der Schrift der uebrigen Werte`() {
        zeige(emptyList(), null)
        assertEquals(compose.activity.getString(R.string.parts_color_unknown), fieldText())
        assertFalse("Die Farbnummer steht im Feld: ${fieldText()}", fieldText().contains("5"))
        val layouts = mutableListOf<TextLayoutResult>()
        feld().config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
        assertEquals("Schriftgrösse des Feldes", wert.fontSize, layouts.single().layoutInput.style.fontSize)
    }

    @Test
    fun `mit Namen aus dem Bestand steht dieser`() {
        zeige(emptyList(), "Red")
        assertEquals("Red", fieldText())
    }

    @Test
    fun `die Farbliste gewinnt gegen den Namen aus dem Bestand`() {
        zeige(listOf(ColorView(5, "Yellow", "F2CD37")), "Gelb (alt)")
        assertEquals("Yellow", fieldText())
    }
}
