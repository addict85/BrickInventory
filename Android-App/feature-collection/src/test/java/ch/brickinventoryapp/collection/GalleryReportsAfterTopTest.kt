package ch.brickinventoryapp.collection

import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.collection.ui.GalleryUiState
import ch.brickinventoryapp.collection.ui.screens.GalleryEvents
import ch.brickinventoryapp.collection.ui.screens.GalleryScreen
import ch.brickinventoryapp.collection.ui.screens.GalleryState
import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.domain.MetricsView
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * The gallery does not search, filter or sort itself: search text, theme and sorting
 * go up as an event (to the server), the list stays as the server
 * sent it, and the sort values are the server's keys. Plus the number of
 * instructions in the header. Rendered with a fixed state and events that
 * get recorded.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   gallery-filters-itself      the grid shows only sets whose name contains the search text → red “search text …”
 *   gallery-sort-value-wrong  „Name A–Z“ reports name instead of name_asc → red “the sorting …”
 *   gallery-theme-swallowed   the theme choice in the filter reports nothing → red “a theme …”
 *   gallery-without-instructions    the instructions chip is missing from the header → red “the header names …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class GalleryReportsAfterTopTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val before = Locale.getDefault()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun tearDown() = Locale.setDefault(before)

    private val searched = mutableListOf<String>()
    private val sorted = mutableListOf<String>()
    private val themes = mutableListOf<String>()

    private val events = GalleryEvents(
        search = { searched += it }, theme = { themes += it }, sorting = { sorted += it.identifier },
        account = {}, storageLocation = {}, refresh = {},
        setRecord = {}, manualEntryAcknowledged = {},
    )

    private fun show() {
        val gallery = GalleryUiState(
            sets = listOf(SetView(setNumber = "75192-1", name = "Millennium Falcon"), SetView(setNumber = "10294-1", name = "Titanic")),
            galleryThemes = listOf("Star Wars", "Icons"), galleryTotal = 2,
            stats = MetricsView(totalSets = 2, totalQuantity = 3, totalInstructions = 7, totalParts = 16631, totalMinifigs = 4),
        )
        val condition = GalleryState(AppUiState(isLoggedIn = true), ScopeUiState(), gallery, emptyMap(), BarcodeUiState(), StorageUiState())
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) {
                    GalleryScreen(condition, events, coil3.ImageLoader.Builder(ctx).build(), onScanBarcode = {}, onSetClick = {})
                }
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `search text goes up, the list stays the server's`() {
        show()
        compose.onNode(hasSetTextAction()).performTextInput("Lambo")
        compose.waitForIdle()
        assertEquals("Lambo", searched.lastOrNull())
        // Neither of the two matches the search text; what the server sent is shown anyway.
        compose.onNodeWithText("Millennium Falcon", useUnmergedTree = true).fetchSemanticsNode()
        compose.onNodeWithText("Titanic", useUnmergedTree = true).fetchSemanticsNode()
    }

    @Test
    fun `the sorting reports the server's keys`() {
        show()
        val menu = ctx.getString(R.string.sort_menu_cd, ctx.getString(R.string.gallery_sort_added_desc))
        val names = mapOf(R.string.gallery_sort_added_asc to "added_asc", R.string.gallery_sort_name to "name_asc",
            R.string.gallery_sort_number to "num_asc", R.string.gallery_sort_year_desc to "year_desc",
            R.string.gallery_sort_price_desc to "price_desc", R.string.gallery_sort_price_asc to "price_asc",
            R.string.gallery_sort_qty_desc to "qty_desc", R.string.gallery_sort_qty_asc to "qty_asc")
        for (text in names.keys) {
            compose.onNodeWithContentDescription(menu).performClick()
            compose.waitForIdle()
            compose.onNodeWithText(ctx.getString(text)).performClick()
            compose.waitForIdle()
        }
        assertEquals(names.values.toList(), sorted)
    }

    @Test
    fun `a theme from the filter goes up`() {
        show()
        compose.onNodeWithContentDescription(ctx.getString(R.string.filter_button)).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Star Wars").performClick()
        compose.waitForIdle()
        assertEquals(listOf("Star Wars"), themes)
    }

    @Test
    fun `the header names the number of instructions`() {
        show()
        compose.onNodeWithText(ctx.resources.getQuantityString(R.plurals.gallery_stat_instructions, 7, "7"),
            useUnmergedTree = true).fetchSemanticsNode()
    }
}
