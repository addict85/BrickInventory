package ch.brickinventoryapp.shared

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
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
 * The search-and-filter row above gallery, parts and figures spans the whole
 * width of the grid on the tablet. Limited to 720 dp, it used to end in the middle over the tiles.
 *
 * Counter-check (measured only in CI — Robolectric):
 *   suche-wieder-begrenzt  search field reverted to `widthIn(max = 720.dp)` → red „auf dem Tablet geht …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "de-rCH-w1280dp-h800dp-land-xhdpi")
class SearchWithFilterWidthTest {

    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `on the tablet the search row spans the whole width`() {
        compose.setContent {
            BrickInventoryManagerTheme {
                Box(Modifier.width(1200.dp)) {
                    SearchWithFilter(value = "", onValue = {}, placeholder = "Suche", activeFilter = 0, onFilter = {})
                }
            }
        }
        compose.waitForIdle()
        val field = compose.onNode(hasSetTextAction()).fetchSemanticsNode().boundsInRoot
        val width = field.width / compose.density.density
        // The filter button and margins need a good 100 dp; the rest belongs to the field (previously at most 720).
        assertTrue("Das Suchfeld ist nur $width dp breit", width > 1000f)
    }
}
