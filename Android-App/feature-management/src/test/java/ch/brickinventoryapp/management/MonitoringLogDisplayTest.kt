package ch.brickinventoryapp.management

import android.text.format.DateFormat
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import ch.brickinventoryapp.data.PrewarmNetwork
import ch.brickinventoryapp.management.ui.ManagementUiState
import ch.brickinventoryapp.management.ui.screens.CacheEvents
import ch.brickinventoryapp.management.ui.screens.MonitoringScreen
import ch.brickinventoryapp.management.ui.screens.MonitoringState
import ch.brickinventoryapp.management.ui.viewmodel.BackgroundUiState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.model.domain.LogRowView
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.util.fmtClockTime
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.appNumberLocale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant

/**
 * Monitoring's server log shows the time for every row, like the
 * web app, and can be filtered by level and text. Filtering happens on the device: the
 * rows are already loaded, a fetch per keystroke would just be a wait.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   protokoll-ohne-uhrzeit          the row does not show loggedAt → red “every row names …”
 *   protokoll-stufe-filtert-nicht   a deselected level chip hides nothing → red “a deselected level …”
 *   protokoll-suche-filtert-nicht   the search text hides nothing → red “the search …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MonitoringLogDisplayTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int) = compose.activity.getString(id)

    private var logFetches = 0

    private val actions = object : SilentActions() {
        override fun chooseLog(minutes: Int) { logFetches++ }
    }

    private val info = LogRowView(1, "info", "Preislauf gestartet", Instant.parse("2026-11-10T08:15:30Z"))
    private val error = LogRowView(2, "error", "Abruf bei BrickLink gescheitert", Instant.parse("2026-11-10T09:42:07Z"))

    /** Renders monitoring with two log rows and expands the log. */
    private fun openShow() {
        val condition = MonitoringState(MonitoringUiState(), BackgroundUiState(), ManagementUiState(log = listOf(info, error)),
            mapOf(PrewarmNetwork.WIFI to true, PrewarmNetwork.MOBILE to false, PrewarmNetwork.ROAMING to false), Design.CLASSIC, 0L)
        val cache = CacheEvents(defaultState = {}, clearStore = {}, network = { _, _ -> }, design = {},
            cacheDuration = {}, cacheClear = {}, limits = { _, _, _ -> })
        compose.setContent { BrickInventoryManagerTheme { MonitoringScreen(condition, actions, cache) } }
        compose.waitForIdle()
        roleTo(hasText(text(R.string.admin_log_title)))
        compose.onNodeWithContentDescription(text(R.string.common_expand)).performClick()
        compose.waitForIdle()
        roleTo(hasText(error.message!!))
        assertEquals("expanding does not fetch loaded rows again", 0, logFetches)
    }

    /** Scrolls the list containing [target]; smaller rows next to it scroll along. */
    private fun roleTo(target: SemanticsMatcher) {
        val lists = compose.onAllNodes(hasScrollAction()).fetchSemanticsNodes().size
        assertTrue("nothing found that scrolls to ${target.description}", (0 until lists).any { i ->
            runCatching { compose.onAllNodes(hasScrollAction())[i].performScrollToNode(target) }.isSuccess
        })
        compose.waitForIdle()
    }

    private fun count(text: String) = compose.onAllNodes(hasText(text), useUnmergedTree = true).fetchSemanticsNodes().size

    @Test
    fun `every line names its time`() {
        openShow()
        for (row in listOf(info, error)) {
            // The way the row shows it: by the device's 12/24-hour setting.
            val timeOfDay = fmtClockTime(row.loggedAt, appNumberLocale(), DateFormat.is24HourFormat(compose.activity))!!
            assertEquals("time of day $timeOfDay for “${row.message}”", 1, count(timeOfDay))
        }
    }

    @Test
    fun `a deselected level hides its lines`() {
        openShow()
        assertEquals(1, count(info.message!!))
        compose.onNode(hasText("INFO") and hasClickAction()).performClick()
        compose.waitForIdle()
        assertEquals("the INFO row is still shown", 0, count(info.message!!))
        assertEquals("the ERROR row disappeared too", 1, count(error.message!!))
    }

    @Test
    fun `the search hides lines without the text`() {
        openShow()
        compose.onNodeWithContentDescription(text(R.string.admin_log_search)).performTextInput("BrickLink")
        compose.waitForIdle()
        assertEquals("the row without the search text is still shown", 0, count(info.message!!))
        assertEquals("the matching row disappeared too", 1, count(error.message!!))
    }
}
