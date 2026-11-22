package ch.brickinventoryapp.management

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import ch.brickinventoryapp.management.ui.screens.CacheEvents
import ch.brickinventoryapp.management.ui.screens.QuotaSection
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.model.domain.CacheMetricsView
import ch.brickinventoryapp.model.domain.QuotaView
import ch.brickinventoryapp.model.domain.QuotasView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * A tight quota warns with a symbol, not with its colour alone: yellow against red merges
 * for red-green colour blindness. Rendered with three services at 50, 80 and 95 percent.
 *
 * Counter-checks (local, Robolectric):
 *   the warning symbol removed from RateLimitRow → red (0 symbols, expected 2)
 *   threshold `pct > 0.7f` raised to 0.9f         → red (1 symbol, expected 2)
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class QuotaWarningTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `the quota row does not warn with color alone`() {
        val quotas = QuotasView(
            brickset = QuotaView(count = 50, limit = 100),
            bricklink = QuotaView(count = 80, limit = 100),
            rebrickable = QuotaView(count = 95, limit = 100),
        )
        val mon = MonitoringUiState(cacheStats = CacheMetricsView(rateLimits = quotas))
        val cache = CacheEvents(defaultState = {}, clearStore = {}, network = { _, _ -> }, design = {},
            cacheDuration = {}, cacheClear = {}, limits = { _, _, _ -> })
        compose.setContent { BrickInventoryManagerTheme { QuotaSection(mon, cache) } }
        compose.waitForIdle()
        val tight = compose.activity.getString(R.string.monitoring_quota_tight)
        assertEquals("80 and 95 percent are tight, 50 is not", 2,
            compose.onAllNodesWithContentDescription(tight).fetchSemanticsNodes().size)
    }
}
