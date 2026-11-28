package ch.brickinventoryapp.shared

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.shared.ui.SearchWithFilter
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The search-and-filter row above gallery, parts and figures: on the tablet the field stops
 * at about 720 dp and stands centered with its buttons; on the phone it takes the width.
 *
 * Counter-check (counter-checks/search-full-width-again.patch):
 *   search field back to `Modifier.weight(1f)` → red „on the tablet the search field …“
 *   (1170 dp wide, left-aligned)
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "de-rCH-w1280dp-h800dp-land-xhdpi")
class SearchWithFilterWidthTest {

    @get:Rule
    val compose = createComposeRule()

    private fun fieldIn(width: Int): Rect {
        compose.setContent {
            BrickInventoryManagerTheme {
                Box(Modifier.width(width.dp)) {
                    SearchWithFilter(value = "", onValue = {}, placeholder = "Suche", activeFilter = 0, onFilter = {})
                }
            }
        }
        compose.waitForIdle()
        val d = compose.density.density
        val b = compose.onNode(hasSetTextAction()).fetchSemanticsNode().boundsInRoot
        return Rect(b.left / d, b.top / d, b.right / d, b.bottom / d)
    }

    @Test
    fun `on the tablet the search field stops at reading width and stands centered`() {
        val field = fieldIn(1200)
        assertTrue("the search field is ${field.width} dp wide", field.width in 680f..720f)
        // Field and filter button (about 60 dp) together in the middle: the left margin is
        // roughly half of what remains.
        assertTrue("the search field starts at ${field.left} dp", field.left in 180f..260f)
    }

    @Test
    fun `on the phone the search field takes the width next to the filter button`() {
        val field = fieldIn(400)
        assertTrue("the search field is only ${field.width} dp wide", field.width > 300f)
        assertTrue("the search field starts at ${field.left} dp", field.left < 20f)
    }
}
