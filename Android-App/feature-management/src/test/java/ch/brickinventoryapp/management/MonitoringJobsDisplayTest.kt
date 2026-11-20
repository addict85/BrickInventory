package ch.brickinventoryapp.management

import ch.brickinventoryapp.model.ui.theme.Design
import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import ch.brickinventoryapp.data.VorwaermNetwork
import ch.brickinventoryapp.model.domain.JobStateView
import ch.brickinventoryapp.model.domain.ScheduleView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.management.ui.ManagementUiState
import ch.brickinventoryapp.management.ui.screens.CacheEvents
import ch.brickinventoryapp.management.ui.screens.MonitoringScreen
import ch.brickinventoryapp.management.ui.screens.MonitoringState
import ch.brickinventoryapp.management.ui.viewmodel.BackgroundUiState
import ch.brickinventoryapp.management.ui.viewmodel.Jobstart
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Die Job-Karten der Überwachung, gezeichnet mit festem Zustand: Der Zeitplan, den der
 * Server mit den Jobs schickt, steht an seiner Karte, und die zwei Bilderknöpfe lösen
 * Verschiedenes aus — Bestandsbilder nachladen gegen Katalogbilder einreihen.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   monitoring-ohne-zeitplan          die Karte bekommt den Zeitplan nicht → rot „der Zeitplan …“
 *   monitoring-bilderknoepfe-gleich   der Katalogknopf lädt Bestandsbilder → rot „die zwei Bilderknöpfe …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MonitoringJobsDisplayTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int) = compose.activity.getString(id)

    private val gestartet = mutableListOf<Jobstart>()

    private val aktionen = object : SilentActions() {
        override fun starte(job: Jobstart) { gestartet += job }
    }

    private fun zeige() {
        val mon = MonitoringUiState(
            jobs = mapOf("prices" to JobStateView(label = "Preise"), "imgDl" to JobStateView(label = "Bilder")),
            jobSchedules = mapOf("prices" to ScheduleView(type = "daily", time = "07:05")),
        )
        val zustand = MonitoringState(mon, BackgroundUiState(), ManagementUiState(),
            mapOf(VorwaermNetwork.WLAN to true, VorwaermNetwork.MOBILE to false, VorwaermNetwork.ROAMING to false), Design.CLASSIC, 0L)
        val cache = CacheEvents(defaultState = {}, clearStore = {}, netz = { _, _ -> }, design = {},
            cacheDuration = {}, cacheLeeren = {}, limits = { _, _, _ -> })
        compose.setContent { BrickInventoryManagerTheme { MonitoringScreen(zustand, aktionen, cache) } }
        compose.waitForIdle()
    }

    /** Rollt die Liste, die [ziel] enthält; neben ihr rollen kleinere Reihen. */
    private fun roleTo(ziel: SemanticsMatcher) {
        val listen = compose.onAllNodes(hasScrollAction()).fetchSemanticsNodes().size
        assertTrue("Nichts gefunden, das zu ${ziel.description} rollt", (0 until listen).any { i ->
            runCatching { compose.onAllNodes(hasScrollAction())[i].performScrollToNode(ziel) }.isSuccess
        })
        compose.waitForIdle()
    }

    @Test
    fun `der Zeitplan des Servers steht an seiner Job-Karte`() {
        zeige()
        roleTo(hasText("07:05"))
        val node: SemanticsNode = compose.onNode(hasText("07:05"), useUnmergedTree = true).fetchSemanticsNode()
        assertTrue(node.boundsInRoot.height > 0f)
    }

    @Test
    fun `die zwei Bilderknoepfe loesen Verschiedenes aus`() {
        zeige()
        for (id in listOf(R.string.monitoring_redownload_missing, R.string.monitoring_catalog_images)) {
            val button = hasText(text(id)) and hasClickAction()
            roleTo(button)
            compose.onNode(button).performClick()
            compose.waitForIdle()
        }
        assertEquals(listOf(Jobstart.BESTANDSBILDER, Jobstart.KATALOGBILDER), gestartet)
    }
}
