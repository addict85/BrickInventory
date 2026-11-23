package ch.brickinventoryapp.app

import android.content.Context
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.app.testing.HiltTestActivity
import ch.brickinventoryapp.app.testing.RegisterHiltTestActivity
import ch.brickinventoryapp.app.testing.TestApp
import ch.brickinventoryapp.finances.ui.FinanceTarget
import ch.brickinventoryapp.resources.R
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The vouchers are the first entry of “More”, so one finds them at the checkout; the sections
 * live there and nowhere else — the settings do not lead to them a second time.
 *
 * Counter-checks (run here):
 *   the vouchers entry moved behind the price alerts in MoreScreen → red “the vouchers are the first …”;
 *   a „Lagerorte verwalten“ entry (storage_manage) added to SettingsScreen → red “the settings lead …”.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-port-xxhdpi")
class MorePageTest {

    private val compose = createAndroidComposeRule<HiltTestActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(RegisterHiltTestActivity()).around(compose)

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val app = TestApp()

    @After fun tearDown() = app.close()

    @Test
    fun `the vouchers are the first entry of the More page`() {
        val opened = mutableListOf<Any>()
        compose.setContent { MoreScreen(onTarget = { opened += it }, isAdmin = true, updateAvailable = false, onLogout = {}) }
        compose.waitForIdle()
        compose.onAllNodes(hasClickAction()).onFirst().performClick()
        assertEquals(listOf<Any>(FinanceTarget.Vouchers), opened)
    }

    @Test
    fun `the settings lead to none of the sections on More`() {
        app.show(compose)
        driveUntil("gallery", { app.world.paths.requests.size }) { true }
        for (label in listOf(R.string.nav_more, R.string.nav_settings)) {
            compose.onAllNodes(hasText(ctx.getString(label)) and hasClickAction()).onFirst().performClick()
            compose.waitForIdle()
        }
        val sections = listOf(R.string.vouchers_title, R.string.alerts_group, R.string.storage_manage, R.string.household_title,
            R.string.csv_upload_title, R.string.account_title).map(ctx::getString)
        assertTrue("not on the settings", compose.onAllNodesWithText(ctx.getString(R.string.settings_currency)).fetchSemanticsNodes().isNotEmpty())
        val twice = sections.filter { compose.onAllNodes(hasText(it) and hasClickAction()).fetchSemanticsNodes().isNotEmpty() }
        assertEquals("sections reachable a second time from the settings", emptyList<String>(), twice)
    }
}
