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
 * The color field of a manually entered part, rendered: without a color list and without a name
 * from the stock it reads "Unbekannte Farbe", never the bare color number; with a name from
 * the stock it shows that. The font is as large as the other values (bodyMedium).
 *
 * Counter-checks (patches under gegenproben/, Robolectric, measured by CI):
 *   farbe-als-nummer        fallback back to "Farbe %1$d" with the number → red “without a name it reads …”
 *   farbfeld-kleine-schrift the field back in bodySmall → red “without a name it reads …” (font size)
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
    fun `without a name Unknown color stands in the font of the other values`() {
        zeige(emptyList(), null)
        assertEquals(compose.activity.getString(R.string.parts_color_unknown), fieldText())
        assertFalse("Die Farbnummer steht im Feld: ${fieldText()}", fieldText().contains("5"))
        val layouts = mutableListOf<TextLayoutResult>()
        feld().config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
        assertEquals("Schriftgrösse des Feldes", wert.fontSize, layouts.single().layoutInput.style.fontSize)
    }

    @Test
    fun `with a name from the stock that one stands`() {
        zeige(emptyList(), "Red")
        assertEquals("Red", fieldText())
    }

    @Test
    fun `the color list wins over the name from the stock`() {
        zeige(listOf(ColorView(5, "Yellow", "F2CD37")), "Gelb (alt)")
        assertEquals("Yellow", fieldText())
    }
}
