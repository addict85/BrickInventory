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

/**
 * Drei Segmente, eines mit einer Beschriftung über zwei Zeilen und gewählt: Alle drei
 * sind gleich hoch, und das Häkchen neben der langen Beschriftung bleibt im Segment.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   segmente-ungleich-hoch       Segmentzeile ohne height(IntrinsicSize.Min) → rot „alle Segmente …“
 *   segment-haekchen-ueber-rand  Beschriftung wieder mit der vollen Innenbreite → rot „das Haekchen …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class SegmentWahlTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val lang = "Vorgabe aus den Hintergrundarbeiten"

    private fun zeige() {
        compose.setContent {
            BrickInventoryManagerTheme {
                Box(Modifier.width(300.dp)) {
                    SegmentWahl(listOf(1 to lang, 2 to "Neu", 3 to "Gebraucht"), gewaehlt = 1, onWahl = {})
                }
            }
        }
        compose.waitForIdle()
    }

    private fun segmente(): List<SemanticsNode> =
        compose.onAllNodes(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton))
            .fetchSemanticsNodes().sortedBy { it.positionInRoot.x }

    @Test
    fun `alle Segmente sind gleich hoch, auch wenn eines zwei Zeilen hat`() {
        zeige()
        val hoehen = segmente().map { it.size.height }
        assertEquals("Drei Segmente erwartet", 3, hoehen.size)
        assertTrue("Ungleich hoch: $hoehen", hoehen.distinct().size == 1)
    }

    @Test
    fun `das Haekchen neben der langen Beschriftung bleibt im Segment`() {
        zeige()
        val segment = segmente().first()
        val beschriftung = compose.onNode(hasText(lang), useUnmergedTree = true).fetchSemanticsNode()
        val dichte = compose.density
        val haekchen = with(dichte) { (SegmentedButtonDefaults.IconSize + 8.dp).toPx() }
        val luft = with(dichte) { HAEKCHEN_LUFT.toPx() }
        val noetig = beschriftung.size.width + haekchen + 2 * luft
        assertTrue("Beschriftung ${beschriftung.size.width} px und Häkchen brauchen $noetig px, " +
            "das Segment hat ${segment.size.width} px", noetig <= segment.size.width + 1f)
    }
}
