package ch.brickinventoryapp.ui.components

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Three segments, one with a two-line label and selected: all three
 * are the same height, but no taller than needed, and the checkmark next to the
 * long label stays inside the segment.
 *
 * NATIVE, because the default LEGACY Text doesn't really measure: the
 * long label never wrapped, and both counter-checks stayed green.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   segments-unequal-height       segment row without height(IntrinsicSize.Min): fillMaxHeight
 *                                stretches each segment to the full height → red „alle Segmente …“
 *   segment-checkmark-over-edge  label back with the full inner width → red „das Haekchen …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class SegmentChoiceTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val lang = "Vorgabe aus den Hintergrundarbeiten"

    private fun show() {
        compose.setContent {
            BrickInventoryManagerTheme {
                Box(Modifier.width(300.dp)) {
                    SegmentChoice(listOf(1 to lang, 2 to "Neu", 3 to "Gebraucht"), chosen = 1, onChoice = {})
                }
            }
        }
        compose.waitForIdle()
    }

    private fun segments(): List<SemanticsNode> =
        compose.onAllNodes(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton))
            .fetchSemanticsNodes().sortedBy { it.positionInRoot.x }

    @Test
    fun `all segments are equally high and not higher than needed, even if one has two lines`() {
        show()
        val heights = segments().map { it.size.height }
        assertEquals("three segments expected", 3, heights.size)
        assertTrue("Ungleich hoch: $heights", heights.distinct().size == 1)
        val label = compose.onNode(hasText(lang), useUnmergedTree = true).fetchSemanticsNode().size.height
        val atMost = label + with(compose.density) { 48.dp.roundToPx() }
        assertTrue("segments $heights px high, the label needs $label px", heights.first() <= atMost)
    }

    @Test
    fun `the check mark next to the long label stays in the segment`() {
        show()
        val segment = segments().first()
        val label = compose.onNode(hasText(lang), useUnmergedTree = true).fetchSemanticsNode()
        val density = compose.density
        val checkmark = with(density) { (SegmentedButtonDefaults.IconSize + 8.dp).toPx() }
        val air = with(density) { CHECKMARK_AIR.toPx() }
        val needed = label.size.width + checkmark + 2 * air
        assertTrue("label ${label.size.width} px and checkmark need $needed px, " +
            "the segment has ${segment.size.width} px", needed <= segment.size.width + 1f)
    }
}
