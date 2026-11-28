package ch.brickinventoryapp.catalog

import android.content.Context
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.catalog.ui.CatalogUiState
import ch.brickinventoryapp.catalog.ui.screens.CatalogScreen
import ch.brickinventoryapp.catalog.ui.viewmodel.CatalogActions
import ch.brickinventoryapp.model.domain.CatalogSetView
import ch.brickinventoryapp.model.domain.CatalogSort
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import coil3.ImageLoader
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * An empty catalog shows only search and the empty state: theme and year filters and
 * „0 Sets im Katalog“ have nothing to act on. A search without hits keeps them, so the
 * filter can be changed.
 *
 * Counter-check (counter-checks/catalog-empty-with-filters.patch): filter row and count
 * again shown in the empty catalog → red “the empty catalog shows no filters and no count”.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-port-xxhdpi")
class CatalogEmptyStateTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    private object NoActions : CatalogActions {
        override fun loadCatalogMeta() = Unit
        override fun loadCatalogSets() = Unit
        override fun catalogVisible(firstPage: Int, lastPage: Int) = Unit
        override fun scrollCatalogTo(number: Int) = Unit
        override fun catalogScrollConsumed() = Unit
        override fun setCatalogQuery(q: String) = Unit
        override fun setCatalogTheme(themeId: Int?) = Unit
        override fun setCatalogYear(year: Int?) = Unit
        override fun setCatalogSort(sort: CatalogSort) = Unit
    }

    private fun show(state: CatalogUiState) {
        val images = ImageLoader.Builder(ctx).build()
        compose.setContent {
            BrickInventoryManagerTheme { CatalogScreen(state, "https://brick.example", NoActions, images, {}) }
        }
        compose.waitForIdle()
    }

    private fun count(text: String) = compose.onAllNodes(hasText(text), useUnmergedTree = true).fetchSemanticsNodes().size

    private val theme get() = ctx.getString(R.string.catalog_filter_theme)
    private val year get() = ctx.getString(R.string.catalog_filter_year)
    private fun total(n: Int) = ctx.resources.getQuantityString(R.plurals.catalog_result_count, n, n)

    @Test
    fun `the empty catalog shows no filters and no count`() {
        show(CatalogUiState(total = 0))
        assertEquals("empty state", 1, count(ctx.getString(R.string.catalog_empty_title)))
        assertEquals("theme filter", 0, count(theme))
        assertEquals("year filter", 0, count(year))
        assertEquals("count", 0, count(total(0)))
    }

    @Test
    fun `a search without hits keeps filters and count`() {
        show(CatalogUiState(total = 0, query = "xyz"))
        assertEquals("no hits", 1, count(ctx.getString(R.string.catalog_no_results)))
        assertEquals("theme filter", 1, count(theme))
        assertEquals("year filter", 1, count(year))
        assertEquals("count", 1, count(total(0)))
    }

    @Test
    fun `a filled catalog shows filters and count`() {
        val sets = (1..3).map { CatalogSetView(setNumber = "$it-1", name = "Set $it", year = 2020, numParts = 10) }
        show(CatalogUiState(total = 3, loadedPages = mapOf(1 to sets)))
        assertEquals("theme filter", 1, count(theme))
        assertEquals("count", 1, count(total(3)))
    }
}
