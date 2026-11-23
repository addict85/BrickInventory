package ch.brickinventoryapp.management

import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import ch.brickinventoryapp.data.PrewarmNetwork
import ch.brickinventoryapp.management.ui.ManagementUiState
import ch.brickinventoryapp.management.ui.screens.CacheEvents
import ch.brickinventoryapp.management.ui.screens.MonitoringScreen
import ch.brickinventoryapp.management.ui.screens.MonitoringState
import ch.brickinventoryapp.management.ui.viewmodel.BackgroundUiState
import ch.brickinventoryapp.management.ui.viewmodel.Jobstart
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.model.domain.JobStateView
import ch.brickinventoryapp.model.domain.ScheduleView
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Monitoring's job cards, rendered with a fixed state: the schedule the
 * server sends with the jobs stands at its card, and the two image buttons trigger
 * different things — reloading stock images versus queuing catalog images.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   monitoring-without-schedule          the card does not get the schedule → red “the schedule …”
 *   monitoring-image-buttons-equal   the catalog button loads stock images → red “the two image buttons …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MonitoringJobsDisplayTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int) = compose.activity.getString(id)

    private val started = mutableListOf<Jobstart>()

    private val actions = object : SilentActions() {
        override fun launch(job: Jobstart) { started += job }
    }

    private fun show() {
        val mon = MonitoringUiState(
            jobs = mapOf("prices" to JobStateView(label = "Preise"), "imgDl" to JobStateView(label = "Bilder")),
            jobSchedules = mapOf("prices" to ScheduleView(type = "daily", time = "07:05")),
        )
        val condition = MonitoringState(mon, BackgroundUiState(), ManagementUiState(),
            mapOf(PrewarmNetwork.WIFI to true, PrewarmNetwork.MOBILE to false, PrewarmNetwork.ROAMING to false), Design.CLASSIC, 0L)
        val cache = CacheEvents(defaultState = {}, clearStore = {}, network = { _, _ -> }, design = {},
            cacheDuration = {}, cacheClear = {}, limits = { _, _, _ -> })
        compose.setContent { BrickInventoryManagerTheme { MonitoringScreen(condition, actions, cache) } }
        compose.waitForIdle()
    }

    /** Scrolls the list containing [target]; smaller rows next to it scroll along. */
    private fun roleTo(target: SemanticsMatcher) {
        val lists = compose.onAllNodes(hasScrollAction()).fetchSemanticsNodes().size
        assertTrue("nothing found that scrolls to ${target.description}", (0 until lists).any { i ->
            runCatching { compose.onAllNodes(hasScrollAction())[i].performScrollToNode(target) }.isSuccess
        })
        compose.waitForIdle()
    }

    @Test
    fun `the server's schedule stands at its job card`() {
        show()
        roleTo(hasText("07:05"))
        val node: SemanticsNode = compose.onNode(hasText("07:05"), useUnmergedTree = true).fetchSemanticsNode()
        assertTrue(node.boundsInRoot.height > 0f)
    }

    @Test
    fun `the two image buttons trigger different things`() {
        show()
        for (id in listOf(R.string.monitoring_redownload_missing, R.string.monitoring_catalog_images)) {
            val button = hasText(text(id)) and hasClickAction()
            roleTo(button)
            compose.onNode(button).performClick()
            compose.waitForIdle()
        }
        assertEquals(listOf(Jobstart.STOCK_IMAGES, Jobstart.CATALOG_IMAGES), started)
    }
}
