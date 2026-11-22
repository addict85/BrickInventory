package ch.brickinventoryapp.management

import ch.brickinventoryapp.model.ui.theme.Design
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import ch.brickinventoryapp.data.PrewarmNetwork
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.management.ui.screens.CacheAndLimitsSection
import ch.brickinventoryapp.management.ui.screens.CacheEvents
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Monitoring's price cache only clears after a confirmation prompt: every rebuild costs
 * requests from the shared daily quota, and a mistake would take something away from
 * everyone else. Confirming happens in the chosen scope, cancel clears nothing. For the
 * pre-warming networks, the note about the measured Wi-Fi stands there.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   cache-leeren-ohne-frage    „Alles leeren“ clears right away → red “clearing asks …”
 *   vorwaermen-hinweis-fehlt   the note about the measured Wi-Fi is missing → red “at the networks …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CacheClearAsksTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int) = compose.activity.getString(id)
    private val emptied = mutableListOf<Boolean>()

    private fun show() {
        val events = CacheEvents(defaultState = {}, clearStore = {}, network = { _, _ -> }, design = {},
            cacheDuration = {}, cacheClear = { emptied += it }, limits = { _, _, _ -> })
        compose.setContent {
            BrickInventoryManagerTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    CacheAndLimitsSection(MonitoringUiState(),
                        mapOf(PrewarmNetwork.WIFI to true, PrewarmNetwork.MOBILE to false, PrewarmNetwork.ROAMING to false),
                        Design.CLASSIC, 0L, events)
                }
            }
        }
        compose.waitForIdle()
    }

    private fun inDialog(id: Int) = compose.onNode(hasText(text(id)) and hasClickAction() and hasAnyAncestor(isDialog()))

    private fun tap(id: Int) {
        compose.onNode(hasText(text(id)) and hasClickAction()).performScrollTo().performClick()
        compose.waitForIdle()
    }

    @Test
    fun `clearing asks first and then clears in the chosen scope`() {
        show()
        tap(R.string.monitoring_cache_clear_all)
        assertEquals("Ein Tipp allein leert schon", emptyList<Boolean>(), emptied)
        compose.onNodeWithText(text(R.string.monitoring_cache_clear_hint)).fetchSemanticsNode()
        inDialog(R.string.monitoring_cache_clear_confirm).performClick()
        compose.waitForIdle()

        tap(R.string.monitoring_cache_clear_prices)
        inDialog(R.string.common_cancel).performClick()
        compose.waitForIdle()
        tap(R.string.monitoring_cache_clear_prices)
        inDialog(R.string.monitoring_cache_clear_confirm).performClick()
        compose.waitForIdle()

        assertEquals("Alles, dann nach Abbrechen nichts, dann nur die Preise", listOf(true, false), emptied)
    }

    @Test
    fun `the networks show the hint about metered Wi-Fi`() {
        show()
        compose.onNodeWithText(text(R.string.monitoring_prewarm_hint)).performScrollTo()
    }
}
