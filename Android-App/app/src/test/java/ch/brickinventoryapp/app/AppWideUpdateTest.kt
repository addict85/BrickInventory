package ch.brickinventoryapp.app

import android.content.Context
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.app.testing.HiltTestActivity
import ch.brickinventoryapp.app.testing.RegisterHiltTestActivity
import ch.brickinventoryapp.app.testing.TestApp
import ch.brickinventoryapp.app.testing.TestUpdates
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
 * The silent update check at sign-in speaks to the whole app: its hint stands over the gallery
 * and over any other tab, and nothing is loaded before the user says so. Run on [TestApp].
 *
 * Counter-checks (run here):
 *   `UpdateRoute(selfUpdate)` removed from BrickInventoryRoute → red “the hint of the silent check …”
 *   and “… also over another tab”;
 *   `LaunchedEffect(Unit) { selfUpdate.loadUpdate() }` in BrickInventoryRoute → red “… loads nothing …”;
 *   checkOnStart() with `checkOnUpdate(still = false)` → red “the check at start asks quietly …”.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-port-xxhdpi")
class AppWideUpdateTest {

    private val compose = createAndroidComposeRule<HiltTestActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(RegisterHiltTestActivity()).around(compose)

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private var app = TestApp()

    @After fun tearDown() = app.close()

    private fun hint() = compose.onAllNodesWithText(ctx.getString(R.string.update_dialog_title)).fetchSemanticsNodes()

    @Test
    fun `the hint of the silent check stands over the gallery and loads nothing by itself`() {
        app.close()
        app = TestApp(updates = TestUpdates(offered = 20))
        app.show(compose)
        driveUntil("gallery") { hint().isNotEmpty() }
        assertEquals("loaded without a tap", emptyList<Any>(), app.updates.loads)
    }

    @Test
    fun `a check that finds something later shows the hint also over another tab`() {
        app.show(compose)
        driveUntil("gallery") { app.updates.fetches.isNotEmpty() }
        compose.onNode(hasText(ctx.getString(R.string.nav_finance)) and hasClickAction()).performClick()
        driveUntil("finances") { true }
        assertTrue("a hint without an offer", hint().isEmpty())
        app.updates.offered = 20
        app.activity.update.checkOnUpdate(still = true)
        driveUntil("hint") { hint().isNotEmpty() }
        assertEquals(emptyList<Any>(), app.updates.loads)
    }

    @Test
    fun `the check at start asks quietly and reports no failure`() {
        app.show(compose)
        driveUntil("gallery") { app.updates.fetches.isNotEmpty() }
        val before = app.updates.fetches.size
        app.activity.update.checkOnStart()
        driveUntil("check") { app.updates.fetches.size > before }
        assertEquals("the start reports a failed check", null, app.activity.update.updateState.value.error)
        app.updates.checkAtStart = false
        app.activity.update.checkOnStart()
        driveUntil("switched off") { true }
        assertEquals("switched off the start still asks", before + 1, app.updates.fetches.size)
    }
}
