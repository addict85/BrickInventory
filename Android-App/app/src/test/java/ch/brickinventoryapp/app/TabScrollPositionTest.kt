package ch.brickinventoryapp.app

import android.content.Context
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.printToString
import androidx.compose.ui.test.swipeUp
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.app.testing.HiltTestActivity
import ch.brickinventoryapp.app.testing.RegisterHiltTestActivity
import ch.brickinventoryapp.app.testing.TestApp
import ch.brickinventoryapp.parts.ui.PlPart
import ch.brickinventoryapp.parts.ui.viewmodel.PartListViewModel
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
import kotlin.math.abs

/**
 * Every tab with a list is back at its row after an excursion that takes it out of the
 * composition: gallery, parts and figures after their detail page, finances after the set,
 * settings and parts list after “More”. Run on [TestApp] with long lists.
 *
 * Counter-checks (run here):
 *   GalleryScreen's grid without `state = gridState` → red “the gallery …”;
 *   the ScrollPositionKeeper for PartsTarget.Parts removed from PartsGraph → red “parts …”;
 *   MinifigsScreen's grid without `state = gridState` → red “figures …”;
 *   FinanceScreen's list without `state = listState` → red “the finance list …”;
 *   the ScrollPositionKeeper of the settings removed from AccountGraph → red “the settings …”;
 *   PartsListScreen's list without `state = listState` → red “the parts list …”.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-port-xxhdpi")
class TabScrollPositionTest {

    private val compose = createAndroidComposeRule<HiltTestActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(RegisterHiltTestActivity()).around(compose)

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val app = TestApp(partLists = { nr -> "Set $nr" to (0 until COUNT).map { part(it) } })

    @After fun tearDown() = app.close()

    private fun part(i: Int) = PlPart(partNumber = "p$i", partName = "Part $i", colorName = "Red", colorHex = "C91A09",
        quantity = 1, imageUrl = null)

    private fun responses() {
        val r = app.world.paths.responses
        r["/api/v1/sets"] = """{"success":true,"total":$COUNT,"sets":[""" + (0 until COUNT).joinToString(",") {
            """{"set_number":"9$it-1","name":"Set $it","year":2020,"theme":"Icons","quantity":1,"num_parts":100}"""
        } + "]}"
        // Manually added parts and figures open their own page; set parts only a sheet over the list.
        r["/api/v1/parts/manual"] = """{"success":true,"parts":[""" + (0 until COUNT).joinToString(",") {
            """{"id":$it,"part_number":"p$it","part_name":"Part $it","color_id":5,"quantity":1}"""
        } + "]}"
        r["/api/v1/minifigs/manual"] = """{"success":true,"figs":[""" + (0 until COUNT).joinToString(",") {
            """{"id":$it,"fig_number":"f$it","fig_name":"Figure $it","quantity":1}"""
        } + "]}"
        r["/api/v1/finance/valuation"] = """{"success":true,"currency":"CHF","sets":[""" + (0 until COUNT).joinToString(",") {
            """{"set_number":"9$it-1","name":"Set $it","quantity":1,"purchase_price":10.0,"no_price":true,
               "acquisitions":[{"id":$it,"condition":"N","quantity":1,"purchase_price":10.0}]}"""
        } + """],"totals":{"min":"0.00","avg":"0.00","max":"0.00","qty_avg":"0.00"}}"""
    }

    private fun idle() { driveUntil("idle", { app.world.paths.requests.size }) { true }; compose.waitForIdle() }
    private fun text(id: Int) = ctx.getString(id)
    private fun tap(label: String) {
        val nodes = compose.onAllNodes(hasText(label) and hasClickAction())
        assertTrue("nothing to tap named $label:\n" + compose.onRoot().printToString(), nodes.fetchSemanticsNodes().isNotEmpty())
        nodes.onFirst().performClick()
        idle()
    }
    private fun tapFirst(start: String) {
        compose.onAllNodes(hasText(start, substring = true) and hasClickAction()).onFirst().performClick()
        idle()
    }
    private fun shown(label: String) = compose.onAllNodesWithText(label).fetchSemanticsNodes().isNotEmpty()
    private fun back() { compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }; idle() }

    /** The scroll area of the tab: the one that scrolls furthest. */
    private val scroller = SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)
    private fun list() = compose.onAllNodes(scroller).fetchSemanticsNodes()
        .maxBy { it.config[SemanticsProperties.VerticalScrollAxisRange].maxValue() }
    private fun position() = list().config[SemanticsProperties.VerticalScrollAxisRange].value()
    private fun scrollTo(index: Int) {
        compose.onAllNodes(hasScrollToIndexAction()).fetchSemanticsNodes().let { assertTrue("no lazy list", it.isNotEmpty()) }
        compose.onNode(hasScrollToIndexAction() and SemanticsMatcher("the longest") { it.id == list().id })
            .performScrollToIndex(index)
        idle()
    }

    private fun remembered(key: String) = app.world.t.scrollMemory.read(key).first

    /**
     * Scrolled, [away] and back: the ScrollMemory holds the row (the keeper watches the list's own
     * state) and the list stands where it stood (the keeper jumps back).
     */
    private fun roundTrip(what: String, key: String, scroll: () -> Unit, away: () -> Unit) {
        scroll()
        val before = position()
        assertTrue("$what did not scroll", before > 0f)
        assertTrue("$what does not report its row to the ScrollMemory", remembered(key) > 0)
        away()
        // The tab reloads on return; the keeper jumps once the list is ready.
        runCatching { driveUntil(what) { abs(position() - before) < 1f } }
        assertEquals("$what is not back at its row", before, position(), 1f)
    }

    private fun start() { responses(); app.show(compose); idle() }

    @Test
    fun `the gallery is back at its row after the set detail`() {
        start()
        roundTrip("the gallery", "gallery", { scrollTo(40) }) { tap("Set 41"); back() }
    }

    @Test
    fun `parts are back at their row after the single page`() {
        start()
        tap(text(R.string.nav_parts))
        roundTrip("parts", "parts", { scrollTo(40) }) { tap("Part 41"); back() }
    }

    @Test
    fun `figures are back at their row after the single page`() {
        start()
        tap(text(R.string.nav_minifigs))
        roundTrip("figures", "minifigs", { scrollTo(40) }) { tap("Figure 41"); back() }
    }

    @Test
    fun `the finance list is back at its row after the set`() {
        start()
        tap(text(R.string.nav_finance))
        roundTrip("the finance list", "finance", { scrollTo(30) }) { tapFirst("Set 3"); back() }
    }

    /** Another tab and “More” again: the saved page of the tab comes back, out of and into the composition. */
    private fun viaAnotherTab() { tap(text(R.string.nav_finance)); tap(text(R.string.nav_more)) }

    @Test
    fun `the settings are back at their place after another tab`() {
        start()
        tap(text(R.string.nav_more))
        tap(text(R.string.nav_settings))
        roundTrip("the settings", "settings", {
            compose.onNode(SemanticsMatcher("the settings") { it.id == list().id }).performTouchInput { swipeUp() }
            idle()
        }, ::viaAnotherTab)
    }

    @Test
    fun `the parts list is back at its row after another tab`() {
        start()
        tap(text(R.string.nav_more))
        tap(text(R.string.nav_partslist))
        val vm = app.viewModels.created.filterIsInstance<PartListViewModel>().single()
        compose.runOnUiThread { vm.createNow("10294-1") }
        driveUntil("parts list") { shown("Part 0") }
        roundTrip("the parts list", "partslist", { scrollTo(40) }, ::viaAnotherTab)
    }

    private companion object {
        const val COUNT = 50
    }
}
