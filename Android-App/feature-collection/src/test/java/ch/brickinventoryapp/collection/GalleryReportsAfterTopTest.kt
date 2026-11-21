package ch.brickinventoryapp.collection

import ch.brickinventoryapp.model.ui.theme.Design
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
import ch.brickinventoryapp.model.domain.MetricsView
import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.collection.ui.GalleryUiState
import ch.brickinventoryapp.collection.ui.screens.GalleryEvents
import ch.brickinventoryapp.collection.ui.screens.GalleryState
import ch.brickinventoryapp.collection.ui.screens.GalleryScreen
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.LagerUiState
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
 * Counter-checks (patches under gegenproben/, Robolectric, measured by CI):
 *   galerie-filtert-selbst      the grid shows only sets whose name contains the search text → red “search text …”
 *   galerie-sortierwert-falsch  „Name A–Z“ reports name instead of name_asc → red “the sorting …”
 *   galerie-thema-verschluckt   the theme choice in the filter reports nothing → red “a theme …”
 *   galerie-ohne-anleitungen    the instructions chip is missing from the header → red “the header names …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class GalleryReportsAfterTopTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val vorher = Locale.getDefault()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() = Locale.setDefault(vorher)

    private val gesucht = mutableListOf<String>()
    private val sortiert = mutableListOf<String>()
    private val themen = mutableListOf<String>()

    private val events = GalleryEvents(
        suche = { gesucht += it }, thema = { themen += it }, sorting = { sortiert += it.kennung },
        konto = {}, lagerort = {}, aktualisieren = {},
        setErfassen = {}, manualEntryAcknowledged = {},
    )

    private fun zeige() {
        val galerie = GalleryUiState(
            sets = listOf(SetAnsicht(setNumber = "75192-1", name = "Millennium Falcon"), SetAnsicht(setNumber = "10294-1", name = "Titanic")),
            galleryThemes = listOf("Star Wars", "Icons"), galleryTotal = 2,
            stats = MetricsView(totalSets = 2, totalQuantity = 3, totalInstructions = 7, totalParts = 16631, totalMinifigs = 4),
        )
        val zustand = GalleryState(AppUiState(isLoggedIn = true), ScopeUiState(), galerie, emptyMap(), BarcodeUiState(), LagerUiState())
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) {
                    GalleryScreen(zustand, events, coil3.ImageLoader.Builder(ctx).build(), onScanBarcode = {}, onSetClick = {})
                }
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `search text goes up, the list stays the server's`() {
        zeige()
        compose.onNode(hasSetTextAction()).performTextInput("Lambo")
        compose.waitForIdle()
        assertEquals("Lambo", gesucht.lastOrNull())
        // Neither of the two matches the search text; what the server sent is shown anyway.
        compose.onNodeWithText("Millennium Falcon", useUnmergedTree = true).fetchSemanticsNode()
        compose.onNodeWithText("Titanic", useUnmergedTree = true).fetchSemanticsNode()
    }

    @Test
    fun `the sorting reports the server's keys`() {
        zeige()
        val menu = ctx.getString(R.string.sort_menu_cd, ctx.getString(R.string.gallery_sort_added_desc))
        val namen = mapOf(R.string.gallery_sort_added_asc to "added_asc", R.string.gallery_sort_name to "name_asc",
            R.string.gallery_sort_number to "num_asc", R.string.gallery_sort_year_desc to "year_desc",
            R.string.gallery_sort_price_desc to "price_desc", R.string.gallery_sort_price_asc to "price_asc",
            R.string.gallery_sort_qty_desc to "qty_desc", R.string.gallery_sort_qty_asc to "qty_asc")
        for (text in namen.keys) {
            compose.onNodeWithContentDescription(menu).performClick()
            compose.waitForIdle()
            compose.onNodeWithText(ctx.getString(text)).performClick()
            compose.waitForIdle()
        }
        assertEquals(namen.values.toList(), sortiert)
    }

    @Test
    fun `a theme from the filter goes up`() {
        zeige()
        compose.onNodeWithContentDescription(ctx.getString(R.string.filter_button)).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Star Wars").performClick()
        compose.waitForIdle()
        assertEquals(listOf("Star Wars"), themen)
    }

    @Test
    fun `the header names the number of instructions`() {
        zeige()
        compose.onNodeWithText(ctx.resources.getQuantityString(R.plurals.gallery_stat_instructions, 7, "7"),
            useUnmergedTree = true).fetchSemanticsNode()
    }
}
