package ch.brickinventoryapp.collection

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import ch.brickinventoryapp.collection.ui.screens.BarcodeScannerScreen
import ch.brickinventoryapp.collection.ui.screens.ScannerHint
import ch.brickinventoryapp.collection.ui.screens.scannerHint
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The scanner never is a dead end: typing the number is offered the whole time, a scan
 * that finds nothing turns into advice after a while, and a camera that does not open says so.
 *
 * Counter-checks (not locally runnable, to be checked in CI — Robolectric):
 *   the „Nummer eintippen“ button removed from the overlay → red “typing the number …”
 *   scannerHint() letting SLOW win over a running confirmation → red “the slow hint …”
 *   scannerHint() without the camera error first → red “a camera error …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class ScannerWayOutTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `typing the number is offered while the camera is running`() {
        var typed = 0
        compose.setContent {
            BrickInventoryManagerTheme {
                BarcodeScannerScreen(onResult = {}, onDismiss = {}, typeInOn = { typed++ }, withoutCamera = true)
            }
        }
        compose.waitForIdle()
        compose.onNode(hasText(compose.activity.getString(R.string.scanner_number_type_in)) and hasClickAction())
            .performClick()
        compose.waitForIdle()
        assertEquals(1, typed)
    }

    @Test
    fun `the slow hint never covers a hit or a confirmation`() {
        assertEquals(ScannerHint.STATUS, scannerHint(frozen = false, cameraFailed = false, slow = false, confirming = false))
        assertEquals(ScannerHint.SLOW, scannerHint(frozen = false, cameraFailed = false, slow = true, confirming = false))
        assertEquals(ScannerHint.STATUS, scannerHint(frozen = false, cameraFailed = false, slow = true, confirming = true))
        assertEquals(ScannerHint.STATUS, scannerHint(frozen = true, cameraFailed = false, slow = true, confirming = false))
    }

    @Test
    fun `a camera error beats every other hint`() {
        assertEquals(ScannerHint.CAMERA_ERROR, scannerHint(frozen = false, cameraFailed = true, slow = true, confirming = true))
    }
}
