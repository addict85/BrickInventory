package ch.brickinventoryapp.shared

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.shared.ui.TableRow
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import coil3.ImageLoader
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The table row tells the screen reader what tapping does: TalkBack reads the click label
 * instead of only „double-tap to activate“.
 *
 * Counter-checks (local, Robolectric):
 *   `clickable(onClickLabel = onClickLabel, …)` without the label → red (label null)
 *   onClick no longer passed to clickable                         → red (0 taps counted)
 */
@RunWith(RobolectricTestRunner::class)
class TableRowClickLabelTest {

    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `the table row tells the screen reader what tapping does`() {
        var taps = 0
        val images = ImageLoader.Builder(ApplicationProvider.getApplicationContext()).build()
        compose.setContent {
            BrickInventoryManagerTheme {
                TableRow(imageUrl = null, number = "3001", name = "Brick 2 x 4", quantity = 12,
                    imageLoader = images, onClick = { taps++ }, onClickLabel = "Teil öffnen")
            }
        }
        val row = compose.onNode(hasClickAction())
        assertEquals("Teil öffnen", row.fetchSemanticsNode().config[SemanticsActions.OnClick].label)
        row.performClick()
        assertEquals(1, taps)
    }
}
