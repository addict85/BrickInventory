package ch.brickinventoryapp.catalog

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.click
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performTouchInput
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.catalog.ui.CatalogUiState
import ch.brickinventoryapp.catalog.ui.screens.CatalogScreen
import ch.brickinventoryapp.catalog.ui.screens.HANDLE_TAG
import ch.brickinventoryapp.catalog.ui.screens.PLACEHOLDER_TAG
import ch.brickinventoryapp.catalog.ui.viewmodel.CatalogActions
import ch.brickinventoryapp.data.catalog.CATALOG_PAGE_SIZE
import ch.brickinventoryapp.model.domain.CatalogSetView
import ch.brickinventoryapp.model.domain.CatalogSort
import ch.brickinventoryapp.model.domain.YearCountView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.uistate.ScrollMemory
import coil3.ImageLoader
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The catalog grid keeps a slot for every set of the result and the year bar scrolls it: a jump
 * lands among placeholders, the bar neither filters nor loads, its handle follows the list, and
 * the position survives leaving the screen even though the length comes later.
 *
 * Counter-checks (run here):
 *   `onScrollTo = { catalog.setCatalogYear(…) }` instead of scrollCatalogTo → red “the year bar scrolls …”;
 *   `items(count = state.loadedPages.values.sumOf { it.size }` → red “the grid keeps a slot …”;
 *   `listNumber = 0` in CatalogGrid → red “the handle follows the list”.
 * The keeper with `ready = true` stays green: the grid is only composed once `total` is there, and
 * a jump on the detached state waits for its first layout.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-port-xxhdpi")
class CatalogGridTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val total = 10 * CATALOG_PAGE_SIZE

    private fun page(n: Int) = (0 until CATALOG_PAGE_SIZE).map { i ->
        val index = (n - 1) * CATALOG_PAGE_SIZE + i
        CatalogSetView(setNumber = "$index-1", name = "Set $index", year = 2020 - index / 100, numParts = 100)
    }

    /** Records every call; a jump target goes into the state as in the ViewModel. */
    private inner class Actions : CatalogActions {
        var state by mutableStateOf(CatalogUiState(total = total, sort = CatalogSort.YEAR_DESCENDING,
            yearDistribution = (0 until 6).map { YearCountView(2020 - it, 100) }, loadedPages = mapOf(1 to page(1))))
        val calls = mutableListOf<String>()
        override fun loadCatalogMeta() { calls += "meta" }
        override fun loadCatalogSets() { calls += "sets" }
        override fun catalogVisible(firstPage: Int, lastPage: Int) { calls += "visible $firstPage-$lastPage" }
        override fun scrollCatalogTo(number: Int) { calls += "scroll $number"; state = state.copy(scrollTo = number) }
        override fun catalogScrollConsumed() { state = state.copy(scrollTo = null) }
        override fun setCatalogQuery(q: String) { calls += "query" }
        override fun setCatalogTheme(themeId: Int?) { calls += "theme" }
        override fun setCatalogYear(year: Int?) { calls += "year $year" }
        override fun setCatalogSort(sort: CatalogSort) { calls += "sort" }
    }

    private val actions = Actions()
    private val memory = ScrollMemory()
    private var shown by mutableStateOf(true)

    private fun show() {
        val images = ImageLoader.Builder(ctx).build()
        compose.setContent {
            BrickInventoryManagerTheme {
                if (shown) CatalogScreen(actions.state, "", actions, images, onSetClick = {}, scrollMemory = memory)
            }
        }
        compose.waitForIdle()
    }

    private val grid = hasScrollToIndexAction() and SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)
    private fun position() = compose.onNode(grid).fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
    private fun scrollTo(index: Int) { compose.onNode(grid).performScrollToIndex(index); compose.waitForIdle() }

    @Test
    fun `the year bar scrolls the list and neither filters nor loads by itself`() {
        show()
        compose.onNodeWithContentDescription(ctx.getString(R.string.catalog_year_jump))
            .performTouchInput { click(Offset(centerX, height * 0.8f)) }
        compose.waitForIdle()
        val jump = actions.calls.filter { it.startsWith("scroll ") }.map { it.removePrefix("scroll ").toInt() }
        assertTrue("the bar did not scroll: ${actions.calls}", jump.isNotEmpty() && jump.last() > total / 2)
        assertTrue("the bar filters or loads: ${actions.calls}", actions.calls.none { it.startsWith("year") || it == "sets" })
        val page = jump.last() / CATALOG_PAGE_SIZE + 1
        assertTrue("the list did not report the page it jumped to: ${actions.calls}",
            actions.calls.any { c -> c.startsWith("visible ") && c.removePrefix("visible ").split("-").map(String::toInt).let { page in it[0]..it[1] } })
    }

    @Test
    fun `the grid keeps a slot for every set of the result`() {
        actions.state = actions.state.copy(loadedPages = mapOf(1 to page(1), 9 to page(9)))
        show()
        scrollTo(8 * CATALOG_PAGE_SIZE + 3)
        compose.onNode(hasText("Set ${8 * CATALOG_PAGE_SIZE + 3}", substring = true) and hasClickAction()).assertExists()
        scrollTo(total - 1)
        assertTrue("no placeholder where the page is missing", compose.onAllNodesWithTag(PLACEHOLDER_TAG).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun `the handle follows the list`() {
        show()
        val top = compose.onNodeWithTag(HANDLE_TAG).fetchSemanticsNode().boundsInRoot.top
        scrollTo(total * 3 / 4)
        val track = compose.onNodeWithContentDescription(ctx.getString(R.string.catalog_year_jump)).fetchSemanticsNode().boundsInRoot
        val now = compose.onNodeWithTag(HANDLE_TAG).fetchSemanticsNode().boundsInRoot.top
        assertTrue("the handle stays at ${now - track.top} px of ${track.height}", now - top > track.height / 2)
    }

    @Test
    fun `the position survives leaving the screen although the length comes later`() {
        show()
        scrollTo(total / 2)
        val before = position()
        assertTrue(before > 0f)
        shown = false
        compose.waitForIdle()
        actions.state = actions.state.copy(total = 0, loadedPages = emptyMap())
        shown = true
        compose.waitForIdle()
        actions.state = actions.state.copy(total = total, loadedPages = mapOf(1 to page(1)))
        compose.waitForIdle()
        assertEquals(before, position(), 1f)
    }
}
