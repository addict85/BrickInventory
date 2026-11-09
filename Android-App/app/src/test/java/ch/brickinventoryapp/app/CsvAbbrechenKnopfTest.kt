package ch.brickinventoryapp.app

import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.screens.CsvImportBanner
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Ein laufender CSV-Import lässt sich abbrechen, ohne erst den Balken aufzuklappen: Der
 * Knopf steht zugeklappt in der Kopfzeile, wie in der Webapp; ein fertiger Import zeigt
 * keinen.
 *
 * Gegenprobe (gegenproben/csv-abbrechen-versteckt.patch, Robolectric, misst die CI): der
 * Knopf nur bei aufgeklapptem Balken → rot „ein laufender Import …“.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CsvAbbrechenKnopfTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `ein laufender Import laesst sich zugeklappt abbrechen, ein fertiger nicht`() {
        var abgebrochen = 0
        val laeuft = mutableStateOf(true)
        compose.setContent {
            BrickInventoryManagerTheme {
                CsvImportBanner(done = 3, total = 10, current = "75192-1", ok = 3, warn = 0, err = 0,
                    running = laeuft.value, onAbbrechen = { abgebrochen++ })
            }
        }
        val knopf = compose.activity.getString(R.string.csv_cancel)
        compose.onNodeWithContentDescription(knopf).performClick()
        compose.waitForIdle()
        assertEquals(1, abgebrochen)

        laeuft.value = false
        compose.waitForIdle()
        compose.onAllNodesWithContentDescription(knopf).assertCountEquals(0)
    }
}
