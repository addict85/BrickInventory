package ch.brickinventoryapp.app

import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.app.ui.components.CsvImportBanner
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * A running CSV import can be cancelled without first expanding the bar: the
 * button stands collapsed in the header row, as in the web app; a finished import shows
 * none.
 *
 * Counter-check (counter-checks/csv-abbrechen-versteckt.patch, Robolectric, measured by CI): the
 * button only with an expanded bar → red “a running import …”.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CsvCancelButtonTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `a running import can be cancelled while collapsed, a finished one cannot`() {
        var cancelled = 0
        val running = mutableStateOf(true)
        compose.setContent {
            BrickInventoryManagerTheme {
                CsvImportBanner(done = 3, total = 10, current = "75192-1", ok = 3, warn = 0, err = 0,
                    running = running.value, onCancel = { cancelled++ })
            }
        }
        val button = compose.activity.getString(R.string.csv_cancel)
        compose.onNodeWithContentDescription(button).performClick()
        compose.waitForIdle()
        assertEquals(1, cancelled)

        running.value = false
        compose.waitForIdle()
        compose.onAllNodesWithContentDescription(button).assertCountEquals(0)
    }
}
