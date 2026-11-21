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
 * Drei Segmente, eines mit einer Beschriftung über zwei Zeilen und gewählt: Alle drei
 * sind gleich hoch, aber nicht höher als nötig, und das Häkchen neben der langen
 * Beschriftung bleibt im Segment.
 *
 * NATIVE, weil die Vorgabe LEGACY Text nicht wirklich misst: Die lange Beschriftung
 * brach nie um, und beide Gegenproben blieben grün.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   segmente-ungleich-hoch       Segmentzeile ohne height(IntrinsicSize.Min): fillMaxHeight
 *                                streckt jedes Segment auf die ganze Höhe → rot „alle Segmente …“
 *   segment-haekchen-ueber-rand  Beschriftung wieder mit der vollen Innenbreite → rot „das Haekchen …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class SegmentChoiceTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val lang = "Vorgabe aus den Hintergrundarbeiten"

    private fun zeige() {
        compose.setContent {
            BrickInventoryManagerTheme {
                Box(Modifier.width(300.dp)) {
                    SegmentChoice(listOf(1 to lang, 2 to "Neu", 3 to "Gebraucht"), gewaehlt = 1, onWahl = {})
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
        zeige()
        val heights = segments().map { it.size.height }
        assertEquals("Drei Segmente erwartet", 3, heights.size)
        assertTrue("Ungleich hoch: $heights", heights.distinct().size == 1)
        val beschriftung = compose.onNode(hasText(lang), useUnmergedTree = true).fetchSemanticsNode().size.height
        val atMost = beschriftung + with(compose.density) { 48.dp.roundToPx() }
        assertTrue("Segmente $heights px hoch, die Beschriftung braucht $beschriftung px", heights.first() <= atMost)
    }

    @Test
    fun `the check mark next to the long label stays in the segment`() {
        zeige()
        val segment = segments().first()
        val beschriftung = compose.onNode(hasText(lang), useUnmergedTree = true).fetchSemanticsNode()
        val dichte = compose.density
        val checkmark = with(dichte) { (SegmentedButtonDefaults.IconSize + 8.dp).toPx() }
        val air = with(dichte) { CHECKMARK_AIR.toPx() }
        val noetig = beschriftung.size.width + checkmark + 2 * air
        assertTrue("Beschriftung ${beschriftung.size.width} px und Häkchen brauchen $noetig px, " +
            "das Segment hat ${segment.size.width} px", noetig <= segment.size.width + 1f)
    }
}
