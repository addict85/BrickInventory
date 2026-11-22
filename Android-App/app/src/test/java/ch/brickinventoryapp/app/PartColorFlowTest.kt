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
 * Correcting a manually entered part's color, through the app: the page always offers the color
 * row (also without a color name), the change goes to the web app's service with the card's owner,
 * and the page reopens with the new color, without the old one on the way back.
 *
 * Counter-checks (run here):
 *   ManualColorRow only `if (… && entry.part?.colorName != null)` → red “the color row stands …”;
 *   `owner = null` in the color change of ManualItemDetailScreen → red “the change goes …”;
 *   onColorChanged without `popBackStack()` in PartsGraph → red “… and back leads to the list”;
 *   onColorChanged without the navigation → red “… opens with the new color …”.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-port-xxhdpi")
class PartColorFlowTest {

    private val compose = createAndroidComposeRule<HiltTestActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(RegisterHiltTestActivity()).around(compose)

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val app = TestApp()

    @After fun tearDown() = app.close()

    private fun idle() { driveUntil("idle", { app.world.paths.requests.size }) { true }; compose.waitForIdle() }
    private fun tap(label: String) {
        val nodes = compose.onAllNodes(hasText(label) and hasClickAction())
        assertTrue("nothing to tap named $label", nodes.fetchSemanticsNodes().isNotEmpty())
        nodes.onFirst().performClick()
        idle()
    }
    private fun shown(label: String) = compose.onAllNodesWithText(label).fetchSemanticsNodes().isNotEmpty()

    /** A manual brick of account 7 without a color name, opened on its page. */
    private fun openBrick(colors: String) {
        val r = app.world.paths.responses
        r["/api/v1/parts/manual"] = """{"success":true,"parts":[{"id":1,"part_number":"3001","part_name":"Brick 2 x 4",""" +
            """"color_id":5,"quantity":2,"user_id":7}]}"""
        r["/api/v1/parts/brick-colors"] = """{"success":true,"colors":$colors}"""
        r["/api/v1/parts/3001/5/color"] = """{"success":true}"""
        app.show(compose)
        idle()
        tap(ctx.getString(R.string.nav_parts))
        tap("Brick 2 x 4")
    }

    private val colors = """[{"id":5,"name":"Red","hex":"C91A09"},{"id":11,"name":"Black","hex":"05131D"}]"""

    @Test
    fun `the color row stands also without a color name and a color list`() {
        openBrick("[]")
        assertTrue("no color row", shown(ctx.getString(R.string.detail_color)))
        assertTrue("no fallback for a color without a name", shown(ctx.getString(R.string.parts_color_unknown)))
    }

    @Test
    fun `the change goes to the web app's service and the page opens with the new color, and back leads to the list`() {
        openBrick(colors)
        tap("Red")
        tap("Black")
        assertEquals(listOf("PUT /api/v1/parts/3001/5/color?owner=7"), app.world.paths.requestsTo("PUT "))
        val body = app.world.paths.bodyBytes[app.world.paths.requests.indexOfFirst { it.startsWith("PUT ") }]
        assertTrue(body, "\"color_id\":11" in body)
        driveUntil("reopened") { shown("Black") && !shown("Red") }
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        idle()
        assertTrue("back lands on a detail page instead of the list", !shown(ctx.getString(R.string.detail_color)))
    }
}
