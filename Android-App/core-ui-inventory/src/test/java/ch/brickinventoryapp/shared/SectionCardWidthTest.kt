package ch.brickinventoryapp.shared

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.shared.ui.LocalColumnMap
import ch.brickinventoryapp.shared.ui.SectionCard
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.theme.Spacing
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The set detail's section card: limited to reading width in a single column, as wide as
 * the column (minus margin) in one column of the tablet layout. Narrower, it used to stand
 * centered in a 640 dp wide column, with an empty margin left and right.
 *
 * Counter-check (measured only in CI — Robolectric):
 *   sectioncard-in-spalte-schmal  SectionCard doesn't read LocalColumnMap (always centeredUntil)
 *                                 → red „in a column the card takes the full width“
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "de-rCH-w1280dp-h800dp-land-xhdpi")
class SectionCardWidthTest {

    @get:Rule
    val compose = createComposeRule()

    /** The width of the card content in dp; it fills the card up to its inner margin. */
    private fun contentWidth(column: Boolean): Float {
        compose.setContent {
            BrickInventoryManagerTheme {
                CompositionLocalProvider(LocalColumnMap provides column) {
                    Box(Modifier.width(800.dp)) {
                        SectionCard("Angaben") { Box(Modifier.fillMaxWidth().height(8.dp).testTag("inhalt")) }
                    }
                }
            }
        }
        compose.waitForIdle()
        return compose.onNodeWithTag("inhalt").fetchSemanticsNode().size.width / compose.density.density
    }

    @Test
    fun `single-column the card stays at reading width`() {
        assertTrue("wider than the reading width", contentWidth(column = false) <= 560f)
    }

    @Test
    fun `in a column the card takes the full width`() {
        val expected = 800f - 4 * Spacing.large.value
        assertEquals(expected, contentWidth(column = true), 1f)
    }
}
