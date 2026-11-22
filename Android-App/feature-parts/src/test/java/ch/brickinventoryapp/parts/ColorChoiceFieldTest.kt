package ch.brickinventoryapp.parts

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isPopup
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.parts.ui.screens.ColorChoiceField
import ch.brickinventoryapp.resources.R
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
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   farbe-als-nummer        fallback back to "Farbe %1$d" with the number → red “without a name it reads …”
 *   farbfeld-kleine-schrift the field back in bodySmall → red “without a name it reads …” (font size)
 * Counter-check (run here): `if (c.id != current) onChoice(c)` → `onChoice(c)` → red “the current
 * color again is no choice” ([5] instead of []).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "de-rCH")
class ColorChoiceFieldTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private var value = TextStyle.Default

    private fun show(colors: List<ColorView>, name: String?) {
        compose.setContent {
            BrickInventoryManagerTheme {
                value = MaterialTheme.typography.bodyMedium
                ColorChoiceField(colors = colors, current = 5, currentName = name, currentHex = null, onChoice = {})
            }
        }
        compose.waitForIdle()
    }

    private fun field() = compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText)).fetchSemanticsNode("Kein Farbfeld")

    private fun fieldText() = field().config[SemanticsProperties.EditableText].text

    @Test
    fun `without a name Unknown color stands in the font of the other values`() {
        show(emptyList(), null)
        assertEquals(compose.activity.getString(R.string.parts_color_unknown), fieldText())
        assertFalse("The color number stands in the field: ${fieldText()}", fieldText().contains("5"))
        val layouts = mutableListOf<TextLayoutResult>()
        field().config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
        assertEquals("Font size of the field", value.fontSize, layouts.single().layoutInput.style.fontSize)
    }

    @Test
    fun `with a name from the stock that one stands`() {
        show(emptyList(), "Red")
        assertEquals("Red", fieldText())
    }

    @Test
    fun `the color list wins over the name from the stock`() {
        show(listOf(ColorView(5, "Yellow", "F2CD37")), "Gelb (alt)")
        assertEquals("Yellow", fieldText())
    }

    private fun choose(name: String): List<Int> {
        val chosen = mutableListOf<Int>()
        val colors = listOf(ColorView(5, "Red", "C91A09"), ColorView(11, "Black", "05131D"))
        compose.setContent {
            BrickInventoryManagerTheme {
                ColorChoiceField(colors, current = 5, currentName = "Red", currentHex = null, onChoice = { chosen += it.id })
            }
        }
        compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText)).performClick()
        compose.waitForIdle()
        compose.onNode(hasText(name) and hasClickAction() and hasAnyAncestor(isPopup())).performClick()
        compose.waitForIdle()
        return chosen
    }

    @Test
    fun `the current color again is no choice`() {
        assertEquals(emptyList<Int>(), choose("Red"))
    }

    @Test
    fun `another color is passed on`() {
        assertEquals(listOf(11), choose("Black"))
    }
}
