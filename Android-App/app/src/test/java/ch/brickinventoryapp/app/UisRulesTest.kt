package ch.brickinventoryapp.app

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ViewInAr
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.intl.LocaleList
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.lifecycle.SavedStateHandle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.app.nav.AppTarget
import ch.brickinventoryapp.app.nav.Tab
import ch.brickinventoryapp.app.testing.Examples
import ch.brickinventoryapp.collection.ui.CollectionTarget
import ch.brickinventoryapp.collection.ui.TilePrice
import ch.brickinventoryapp.collection.ui.screens.GalleryRoute
import ch.brickinventoryapp.collection.ui.screens.SetCard
import ch.brickinventoryapp.collection.ui.screens.SetDetailRoute
import ch.brickinventoryapp.collection.ui.screens.WantedRoute
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.data.testing.testCatalogRepository
import ch.brickinventoryapp.data.testing.testSetsRepository
import ch.brickinventoryapp.dataapi.collection.SetCreateStep
import ch.brickinventoryapp.dataapi.collection.SetCreator
import ch.brickinventoryapp.finances.ui.FinanceTarget
import ch.brickinventoryapp.finances.ui.screens.FinanceRoute
import ch.brickinventoryapp.finances.ui.setRows
import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.network.util.NetworkAddressRules
import ch.brickinventoryapp.parts.ui.PartsTarget
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.IMAGE_FALLBACK
import ch.brickinventoryapp.ui.components.LocalAddressRules
import ch.brickinventoryapp.ui.components.SegmentChoice
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtPercent
import ch.brickinventoryapp.uistate.ErrorClass
import ch.brickinventoryapp.uistate.loading
import coil3.intercept.Interceptor
import coil3.request.ErrorResult
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.math.BigDecimal
import java.util.Locale

/**
 * What the screenshots show, executed here as a rule: on the tablet the
 * switcher lies to the right of the side bar, a loading error names its class, and the empty
 * wishlist offers both paths to the first entry. Tile and value tiles are checked by
 * SetTileTest and ValueTilesTest in the modules that own them.
 *
 * Counter-checks (patches under counter-checks/, measured only in CI — Robolectric):
 *   tablet-toggle-on-top          switcher in the app bar on the tablet too → red “tablet has the switcher …”
 *   error-hint-raw-sentence        the data layer's sentence also for OFFLINE → red “error hint …”
 *   wanted-list-empty-without-buttons     button „Set merken“ without label → red “empty wishlist …”
 *   detail-without-value-tiles         set detail without value tiles → red “set detail shows market value …”
 *   gallery-two-buttons            scanning again as a second floating button → red “gallery has a floating button …”
 *   phone-account-menu              account icon again in the app bar → red “phone navigates without …”
 *   parts-grid-fixed               parts grid again fixed 120 dp → red “parts at 200 percent …”
 *   finances-single-column             finances single-column on the tablet too → red “finances stand in two columns on the tablet …”
 *   voucher-pin-small             PIN row without minimum height → red “voucher buttons …”
 *   image-surface-without-placeholder         ProductImage without placeholder image → red “gallery without image shows the placeholder image”
 *   bar-does-not-collapse         TopAppBar without scrollBehavior → red “app bar yields when scrolling”
 *   wanted-list-state-as-segments  condition filter of the wishlist again as segments → red “wishlist filters …”
 *   toggle-chips-at-200        Sets | Parts | Minifigures from 130 % as a chip row instead of segments
 *                                   → red “the collection switcher shows all three views as segments at 200 percent …” (gap)
 *   toggle-row-at-200        segments in one row at 200 % too → red “the collection switcher
 *                                   shows all three views as segments at 200 percent …” („Minifiguren … abgeschnitten“)
 *   wanted-list-detail-replaces-list  wishlist item detail never next to the list → red “tablet shows wishlist and detail …”
 *   detail-with-back-arrow         detail next to the list with a back arrow instead of X → red “tablet shows wishlist and detail …”
 *   voucher-form-always-open  form again fixed below the list → red “adding a voucher opens …”
 *   parts-colors-english           color names untranslated, part names without language → red “parts name colors …”
 *   wanted-list-empty-threefold         empty wishlist again with button and search row → red “empty wishlist …”
 *   segments-with-large-font    single choice as segments at 200 % too → red “single choice breaks …”
 *   single-choice-chips-at-200       single choice at 200 % again as chips → red “single choice stands as
 *                                   segments …”
 *   finances-purchase-per-piece         purchase of the row again per piece → red “finances name …”
 *   finances-header-without-base        header card from all positions instead of the basis → red “finance header …”
 *   tile-source-ignored         tile shows the purchase price as „Marktpreis“ again → red “gallery tile …”
 *   tile-falls-back-to-purchase tile without market price shows the own purchase price → red “gallery tile …”
 *   more-without-comparison             comparison not under “More” → red “comparison and build list mark …”
 *   more-arrow-differs-from-back   arrow always leads to “More” → red “the arrow of a More subpage …”
 *   gallery-tile-large            set tile at 200 % too with an image across the width → red “gallery at 200 percent …”
 *   gallery-capture-floats        add floating at 200 % too → red “gallery at 200 percent …”
 *   parts-capture-floats          add floating at 200 % too → red “parts at 200 percent …”
 *   parts-tile-large              parts tile at 200 % too with an image across the width → red “parts at 200 percent show …”
 *   detail-column-without-max-width  set detail single-column again without common maximum width
 *                                   → red “set detail on the tablet in portrait …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class UisRulesTest {

    @get:Rule
    val compose = createComposeRule()

    private val before = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun tearDown() = Locale.setDefault(before)

    private fun show(font: Float = 1f, content: @Composable () -> Unit) {
        compose.setContent { CompositionLocalProvider(LocalAddressRules provides NetworkAddressRules) {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                val d = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(d.density, font)) {
                    Surface(color = MaterialTheme.colorScheme.background) { content() }
                }
            }
         } }
        compose.waitForIdle()
    }

    @Test
    fun `tablet has the switcher to the right of the side bar`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        show {
            val nav = rememberNavController()
            val tab = remember {
                listOf(
                    Tab(CollectionTarget.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"))
            }
            MainScaffold(
                title = "Sammlung", navController = nav, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                onTabTapped = {},
            ) {
                NavHost(nav, startDestination = CollectionTarget.Gallery) { composable<CollectionTarget.Gallery> { } }
            }
        }
        val parts = ctx.getString(R.string.nav_parts)
        compose.onAllNodesWithText(parts).assertCountEquals(1)
        val bar = compose.onAllNodesWithText("Sammlung")
        // The tab in the side bar is the left one of the two (the other one is the title).
        val tabRight = (0 until 2).map { bar[it].fetchSemanticsNode().boundsInRoot }.minBy { it.left }.right
        assertTrue("the switcher starts right of the side bar",
            compose.onNodeWithText(parts).fetchSemanticsNode().boundsInRoot.left >= tabRight)
    }

    /**
     * Sets | Parts | Minifigures switches the view and therefore stays made of segments at 200 %
     * too: adjoining (side by side or below each other), no label
     * cut off, all three fully in view.
     */
    @Test
    fun `the collection switcher shows all three views as segments at 200 percent`() {
        show(font = 2f) {
            val nav = rememberNavController()
            val tab = remember { listOf(Tab(CollectionTarget.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung")) }
            MainScaffold(
                title = "Sammlung", navController = nav, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                onTabTapped = {},
            ) {
                NavHost(nav, startDestination = CollectionTarget.Gallery) { composable<CollectionTarget.Gallery> { } }
            }
        }
        val density = ctx.resources.displayMetrics.density
        val segments = listOf(R.string.nav_sets, R.string.nav_parts, R.string.nav_minifigs).map {
            val text = ctx.getString(it)
            val label = compose.onAllNodes(hasText(text), useUnmergedTree = true).fetchSemanticsNodes()
                .first { n -> n.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null }
            val layouts = mutableListOf<TextLayoutResult>()
            label.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
            assertTrue("$text cut off at 200 %", layouts.none { l -> l.hasVisualOverflow })
            compose.onNode(hasText(text) and hasClickAction()).fetchSemanticsNode().boundsInRoot
        }
        val width = ctx.resources.displayMetrics.widthPixels
        segments.forEach { s ->
            assertTrue("segment outside the image (${s.left / density} – ${s.right / density} dp)",
                s.left >= 0f && s.right <= width + 1f)
        }
        segments.zipWithNext().forEach { (a, b) ->
            val sideBySide = kotlin.math.abs(b.left - a.right) <= 2 * density && kotlin.math.abs(a.top - b.top) < 1f
            val stacked = kotlin.math.abs(b.top - a.bottom) <= 2 * density && kotlin.math.abs(a.left - b.left) < 1f
            assertTrue("Segmente stossen aneinander ($a / $b)", sideBySide || stacked)
        }
    }

    @Test
    fun `app bar yields when scrolling and comes back when scrolling back`() {
        show {
            val nav = rememberNavController()
            val tab = remember {
                listOf(
                    Tab(FinanceTarget.Finance, { Icon(Icons.Default.ViewInAr, null) }, "Finanzen"))
            }
            MainScaffold(
                title = "Finanzen", navController = nav, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                onTabTapped = {},
            ) {
                NavHost(nav, startDestination = FinanceTarget.Finance) {
                    composable<FinanceTarget.Finance> {
                        LazyColumn(Modifier.testTag("liste")) {
                            items(80) { i -> Text("Zeile $i", Modifier.padding(16.dp)) }
                        }
                    }
                }
            }
        }
        fun top() = compose.onNodeWithTag("liste").fetchSemanticsNode().boundsInRoot.top
        val before = top()
        compose.onNodeWithTag("liste").performTouchInput { swipeUp() }
        compose.waitForIdle()
        val density = ctx.resources.displayMetrics.density
        assertTrue("the list moves up when the bar gives way (${before / density} → ${top() / density} dp)",
            top() < before - 40 * density)
        compose.onNodeWithTag("liste").performTouchInput { swipeDown() }
        compose.waitForIdle()
        assertEquals("scrolled back, the bar is there again", before, top(), density)
    }

    @Test
    fun `phone navigates without drawer and account menu, More collects the rest`() {
        show {
            val nav = rememberNavController()
            val tab = remember {
                listOf(
                    Tab(CollectionTarget.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"),
                    Tab(AppTarget.More, { Icon(Icons.Default.ViewInAr, null) }, ctx.getString(R.string.nav_more)))
            }
            MainScaffold(
                title = "Sammlung", navController = nav, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                onTabTapped = {},
            ) {
                NavHost(nav, startDestination = CollectionTarget.Gallery) {
                    composable<CollectionTarget.Gallery> { }
                    composable<AppTarget.More> { MoreScreen(nav::openOfMore, isAdmin = false, onLogout = {}) }
                }
            }
        }
        // No second and third level in the app bar.
        compose.onAllNodesWithContentDescription(ctx.getString(R.string.account_title)).assertCountEquals(0)
        compose.onAllNodesWithContentDescription(ctx.getString(R.string.nav_more)).assertCountEquals(0)
        compose.onNodeWithText(ctx.getString(R.string.nav_more)).performClick()
        compose.waitForIdle()
        // Settings and vouchers stand on the same page, each exactly once.
        compose.onAllNodesWithText(ctx.getString(R.string.nav_settings)).assertCountEquals(1)
        compose.onAllNodesWithText(ctx.getString(R.string.vouchers_title)).assertCountEquals(1)
    }

    @Test
    fun `error hint names the class and the sentence only where it says more`() {
        show { ErrorHint("Serverfehler (500)", {}, ErrorClass.OFFLINE) }
        compose.onNodeWithText(ctx.getString(R.string.error_offline_title)).fetchSemanticsNode()
        compose.onAllNodesWithText("Serverfehler (500)").assertCountEquals(0)
    }

    @Test
    fun `error hint of a server error shows the code`() {
        show { ErrorHint("Serverfehler (500)", {}, ErrorClass.SERVER) }
        compose.onNodeWithText(ctx.getString(R.string.error_server_title)).fetchSemanticsNode()
        compose.onNodeWithText("Serverfehler (500)").fetchSemanticsNode()
    }

    /** The world responds in ticks; drive the main looper until [done] holds. */
    private fun wait(name: String, done: () -> Boolean) {
        driveUntil(name, ready = done)
        compose.waitForIdle()
    }

    @Test
    fun `set detail shows market value, purchase price and P&L at the top in the classic design`() {
        val world = Examples.World(ContextTexts())
        try {
            val vm = world.setDetail()
            show {
                SetDetailRoute(setNumber = Examples.SET, vm = vm, serverUrl = "",
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), onBack = {}, onDelete = {})
            }
            wait("set detail") { vm.setDetailState.value.let { it.setPrice != null && it.priceHistory != null && !it.priceFetch.loading } }
            compose.onNodeWithText(ctx.getString(R.string.detail_pnl_tile), useUnmergedTree = true).assertIsDisplayed()
            // The P&L tile names amount and percent (812.50 − 700.00); the percentage alone stands
            // further down in the badge per condition.
            compose.onNodeWithText("+" + fmtMoney(112.5, CurrencyCode("CHF")) + " · " + fmtPercent(16.1), useUnmergedTree = true)
                .assertIsDisplayed()
            compose.onAllNodesWithText(fmtMoney(812.5, CurrencyCode("CHF")), useUnmergedTree = true)[0].assertIsDisplayed()
        } finally {
            world.close()
        }
    }

    /**
     * Tablet in portrait, one column: tiles and price history begin at the same edge.
     * Previously the card stood centered at reading width, the tiles across the whole width.
     */
    @Test
    fun `set detail on the tablet in portrait has a width for tiles and price history`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w800dp-h1280dp-port-xhdpi")
        val world = Examples.World(ContextTexts())
        try {
            val vm = world.setDetail()
            show {
                SetDetailRoute(setNumber = Examples.SET, vm = vm, serverUrl = "",
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), onBack = {}, onDelete = {})
            }
            wait("set detail") { vm.setDetailState.value.let { it.priceHistory != null && !it.historyFetch.loading && !it.priceFetch.loading } }
            val density = ctx.resources.displayMetrics.density
            val title = ctx.getString(R.string.detail_section_price_history)
            // Inside, the tile lies 12 dp (medium), the title 16 dp (large) from the edge of its surface.
            val tile = compose.onAllNodes(hasText(ctx.getString(R.string.detail_section_market)))[0]
                .fetchSemanticsNode().boundsInRoot.left - 12 * density
            compose.onNode(androidx.compose.ui.test.hasScrollToNodeAction()).performScrollToNode(hasText(title, ignoreCase = true))
            // The heading, not its text in capitals below: the section title carries both.
            val card = compose.onNode(hasText(title) and androidx.compose.ui.test.isHeading(), useUnmergedTree = true)
                .fetchSemanticsNode().boundsInRoot.left - 16 * density
            assertEquals("price history starts like the tiles (${card / density} / ${tile / density} dp)",
                tile / density, card / density, 1f)
        } finally {
            world.close()
        }
    }

    /** A gallery with [images]; waits until the sets are there. */
    private fun galleryWith(world: Examples.World, images: coil3.ImageLoader, font: Float = 1f) {
        val vm = world.gallery().also { it.loadSets() }
        val entryVm = world.t.track(EntryViewModel(world.t.session, world.t.filter(), world.t.hints, testSetsRepository(world.t.api), world.t.setCatalog(), world.t.wantedList(),
            testCatalogRepository(world.t.api),
            object : SetCreator {
                override fun create(setNumber: String, quantity: Int, purchasePrice: Money?, condition: Condition?,
                                     ownerUserId: Int?, storage: String?) =
                    kotlinx.coroutines.flow.emptyFlow<SetCreateStep>()
            }, SavedStateHandle()))
        show(font) {
            GalleryRoute(vm = vm, entryVm = entryVm,
                imageLoader = images, onScanBarcode = {}, onSetClick = {})
        }
        wait("gallery") { vm.galleryState.value.sets.isNotEmpty() && !vm.galleryState.value.fetch.loading }
    }

    /**
     * How many of the [names] stand fully in the grid? Unclipped position instead of boundsInRoot: the
     * grid clips a half-visible tile, and clipped it would seemingly lie inside.
     */
    private fun wholeVisible(names: List<String>): Int {
        val raster = compose.onNode(androidx.compose.ui.test.hasScrollToNodeAction()).fetchSemanticsNode().boundsInRoot
        return names.count { name ->
            compose.onAllNodes(hasClickAction() and hasText(name, substring = true)).fetchSemanticsNodes().any { k ->
                val top = k.positionInRoot.y
                k.size.height > 0 && top >= raster.top - 0.5f && top + k.size.height <= raster.bottom + 0.5f
            }
        }
    }

    /**
     * Add buttons with [description] that do not stand above the list. At 200 % add belongs
     * in the row below the search; a floating button lies below the
     * start of the list, even if the list is shorter than the screen with few sets.
     */
    private fun addNotViaList(description: String): List<Rect> {
        val list = compose.onNode(androidx.compose.ui.test.hasScrollToNodeAction()).fetchSemanticsNode().boundsInRoot
        val buttons = compose.onAllNodesWithContentDescription(description).fetchSemanticsNodes().map { it.boundsInRoot }
        assertTrue("add is there", buttons.isNotEmpty())
        return buttons.filter { it.bottom > list.top + 0.5f }
    }

    /**
     * At 200 % font a tile is a list row, and add stands above the list:
     * with the image across the full width one set stood per screen, and the floating
     * button lay on the text of the bottom tile.
     */
    @Test
    fun `gallery at 200 percent shows several sets fully and add lies on none`() {
        val world = Examples.World(ContextTexts())
        try {
            galleryWith(world, coil3.ImageLoader.Builder(ctx).build(), font = 2f)
            val names = listOf("Millennium Falcon", "Titanic", "Baumhaus")
            val whole = wholeVisible(names)
            assertTrue("only $whole set(s) fully visible", whole >= 2)
            val beside = addNotViaList(ctx.getString(R.string.gallery_add_set))
            assertTrue("add does not stand above the list: $beside", beside.isEmpty())
        } finally {
            world.close()
        }
    }

    @Test
    fun `parts at 200 percent show several parts fully and add lies on none`() {
        val world = Examples.World(ContextTexts())
        try {
            val vm = world.parts().also { it.loadParts() }
            show(font = 2f) {
                PartsRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build())
            }
            wait("parts") { vm.partsState.value.parts.isNotEmpty() }
            val names = vm.partsState.value.parts.mapNotNull { it.partName }
            assertTrue(names.size >= 3)
            val whole = wholeVisible(names)
            assertTrue("only $whole part(s) fully visible", whole >= 2)
            val beside = addNotViaList(ctx.getString(R.string.parts_add))
            assertTrue("add does not stand above the list: $beside", beside.isEmpty())
        } finally {
            world.close()
        }
    }

    /**
     * Price comparison and build list are reached via “More”: there “More” stays selected, and
     * the arrow at the top leads back there as on the other More subpages. The wishlist is a
     * tab of its own: selected itself, without an arrow.
     */
    @Test
    fun `comparison and build list mark More and lead back there with Back, the wishlist is a tab`() {
        val more = ctx.getString(R.string.nav_more)
        val wanted = ctx.getString(R.string.nav_wanted)
        var navigation: NavHostController? = null
        show {
            val nav = rememberNavController().also { navigation = it }
            val tab = remember {
                listOf(
                    Tab(CollectionTarget.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"),
                    Tab(CollectionTarget.Wanted, { Icon(Icons.Default.ViewInAr, null) }, wanted),
                    Tab(AppTarget.More, { Icon(Icons.Default.ViewInAr, null) }, more))
            }
            MainScaffold(
                title = "Seite", navController = nav, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                onTabTapped = {},
            ) {
                NavHost(nav, startDestination = CollectionTarget.Gallery) {
                    composable<CollectionTarget.Gallery> { }
                    composable<AppTarget.More> { MoreScreen(nav::openOfMore, isAdmin = false, onLogout = {}) }
                    composable<CollectionTarget.Wanted> { Text("Merklisteseite") }
                    composable<CollectionTarget.WantedItemDetail> { Text("Merkpostenseite") }
                    composable<CollectionTarget.Comparison> { Text("Vergleichsseite") }
                    composable<PartsTarget.PartsList> { Text("Baulistenseite") }
                }
            }
        }
        val back = ctx.getString(R.string.common_back)
        // On a tab itself no back: it is a root.
        compose.onAllNodesWithContentDescription(back).assertCountEquals(0)
        for ((entry, content) in listOf(R.string.comparison_title to "Vergleichsseite", R.string.nav_partslist to "Baulistenseite")) {
            compose.onNode(hasText(more) and hasClickAction()).performClick()
            compose.waitForIdle()
            compose.onNodeWithText(ctx.getString(entry)).performClick()
            compose.waitForIdle()
            compose.onNodeWithText(content).fetchSemanticsNode()
            compose.onNode(hasText(more) and androidx.compose.ui.test.isSelected())
                .fetchSemanticsNode("„Mehr“ ist auf ${ctx.getString(entry)} nicht gewählt")
            compose.onNodeWithContentDescription(back).performClick()
            compose.waitForIdle()
            // Back on “More”: its entries are there again.
            compose.onNodeWithText(ctx.getString(R.string.vouchers_title)).fetchSemanticsNode()
        }
        compose.onNode(hasText(wanted) and hasClickAction()).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Merklisteseite").fetchSemanticsNode()
        compose.onNode(hasText(wanted) and androidx.compose.ui.test.isSelected())
            .fetchSemanticsNode("the wishlist tab is not selected on its own page")
        compose.onAllNodesWithContentDescription(back).assertCountEquals(0)
        compose.runOnIdle { navigation!!.navigate(CollectionTarget.WantedItemDetail("75192-1", Condition.NEW)) }
        compose.onNodeWithText("Merkpostenseite").fetchSemanticsNode()
        compose.onNode(hasText(wanted) and androidx.compose.ui.test.isSelected())
            .fetchSemanticsNode("the wishlist tab is not selected on an item's detail")
    }

    /**
     * If a More subpage did not come from “More”, the arrow at the top leads where
     * the back gesture also leads: to the previous entry, not to “More”.
     */
    @Test
    fun `the arrow of a More subpage goes the same way as the back gesture`() {
        val more = ctx.getString(R.string.nav_more)
        var nav: NavHostController? = null
        show {
            val n = rememberNavController().also { nav = it }
            val tab = remember {
                listOf(
                    Tab(CollectionTarget.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"),
                    Tab(AppTarget.More, { Icon(Icons.Default.ViewInAr, null) }, more))
            }
            MainScaffold(
                title = "Seite", navController = n, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                onTabTapped = {},
            ) {
                NavHost(n, startDestination = CollectionTarget.Gallery) {
                    composable<CollectionTarget.Gallery> { Text("Galerieseite") }
                    composable<AppTarget.More> { MoreScreen(n::openOfMore, isAdmin = false, onLogout = {}) }
                    composable<PartsTarget.PartsList> { Text("Baulistenseite") }
                }
            }
        }
        // As from within a set: the build list directly above the gallery, without “More”.
        compose.runOnIdle { nav!!.navigate(PartsTarget.PartsList) }
        compose.onNodeWithText("Baulistenseite").fetchSemanticsNode()
        compose.onNodeWithContentDescription(ctx.getString(R.string.common_back)).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Galerieseite").fetchSemanticsNode("Der Pfeil führte nicht dorthin, wohin Zurück führt")
        compose.onAllNodesWithText(ctx.getString(R.string.vouchers_title)).assertCountEquals(0)
    }

    private fun fallbackImages() = compose.onAllNodes(
        androidx.compose.ui.test.hasTestTag(IMAGE_FALLBACK), useUnmergedTree = true)
        .fetchSemanticsNodes().size

    @Test
    fun `gallery without image shows the placeholder image on every tile`() {
        val world = Examples.World(ContextTexts())
        try {
            // Every request fails, as offline or with a missing preview.
            val broken = coil3.ImageLoader.Builder(ctx).components {
                add(object : Interceptor {
                    override suspend fun intercept(chain: Interceptor.Chain) =
                        ErrorResult(null, chain.request, IllegalStateException("no image"))
                })
            }.build()
            galleryWith(world, broken)
            val tiles = compose.onAllNodes(hasClickAction() and hasText("Millennium Falcon", substring = true))
                .fetchSemanticsNodes().size
            assertTrue("the first tile is visible", tiles >= 1)
            val names = listOf("Millennium Falcon", "Titanic", "Baumhaus")
            val visible = names.count { compose.onAllNodesWithText(it, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
            assertEquals("fallback image per visible tile", visible, fallbackImages())
        } finally {
            world.close()
        }
    }

    @Test
    fun `gallery with image shows no placeholder image`() {
        val world = Examples.World(ContextTexts())
        try {
            galleryWith(world, SampleImages.loader(ctx))
            wait("images") { fallbackImages() == 0 }
        } finally {
            world.close()
        }
    }

    /**
     * One floating button that asks manual or scan (to add), and a scan icon next to the
     * search that fills the search field — two scanners with two different jobs.
     *
     * Counter-checks (counter-checks/gallery-two-buttons.patch, gallery-search-scan-adds.patch):
     * a second floating scan button → red (two scan icons); the search row's scan wired to
     * onScanBarcode → red "the scan next to the search fills the search, it does not add".
     */
    @Test
    fun `gallery's floating button opens a choice between manual entry and scan`() {
        val world = Examples.World(ContextTexts())
        try {
            val vm = world.gallery().also { it.loadSets() }
            val entryVm = world.t.track(EntryViewModel(world.t.session, world.t.filter(), world.t.hints, testSetsRepository(world.t.api), world.t.setCatalog(), world.t.wantedList(),
                testCatalogRepository(world.t.api),
                object : SetCreator {
                    override fun create(setNumber: String, quantity: Int, purchasePrice: Money?, condition: Condition?,
                                         ownerUserId: Int?, storage: String?) =
                        kotlinx.coroutines.flow.emptyFlow<SetCreateStep>()
                }, SavedStateHandle()))
            var scanned = 0
            var searched = 0
            show {
                GalleryRoute(vm = vm, entryVm = entryVm,
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), onScanBarcode = { scanned++ }, onSetClick = {},
                    onSearchBarcode = { searched++ })
            }
            wait("gallery") { vm.galleryState.value.sets.isNotEmpty() && !vm.galleryState.value.fetch.loading }
            val scanIcons = compose.onAllNodesWithContentDescription(ctx.getString(R.string.gallery_scan_barcode))
            scanIcons.assertCountEquals(1)
            scanIcons[0].performClick()
            assertEquals("the scan next to the search fills the search, it does not add", 1 to 0, searched to scanned)
            compose.onAllNodesWithContentDescription(ctx.getString(R.string.gallery_add_set)).assertCountEquals(1)
            compose.onNodeWithContentDescription(ctx.getString(R.string.gallery_add_set)).performClick()
            compose.onNodeWithText(ctx.getString(R.string.gallery_add_manually)).fetchSemanticsNode()
            compose.onNodeWithText(ctx.getString(R.string.gallery_scan_barcode)).performClick()
            assertEquals("choosing scan calls onScanBarcode", 1 to 1, scanned to searched)
        } finally {
            world.close()
        }
    }

    @Test
    fun `parts at 200 percent shorten no name`() {
        val world = Examples.World(ContextTexts())
        try {
            val vm = world.parts().also { it.loadParts() }
            show(font = 2f) {
                PartsRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build())
            }
            wait("parts") { vm.partsState.value.parts.isNotEmpty() }
            val names = vm.partsState.value.parts.mapNotNull { it.partName }
            assertTrue(names.size >= 3)
            val density = ctx.resources.displayMetrics.density
            for (name in names) {
                // The tile has grown with the font (120 dp × 2) …
                // The images grow with the tile: not every tile lies in the visible grid.
                compose.onNode(androidx.compose.ui.test.hasScrollToNodeAction())
                    .performScrollToNode(hasText(name) and hasClickAction())
                val tile = compose.onNode(hasText(name) and hasClickAction()).fetchSemanticsNode().boundsInRoot
                assertTrue("tile of $name only ${tile.width / density} dp wide", tile.width / density >= 200f)
                // … and the name stands in full: the last visible line ends with the
                // last character, without ellipsis. didOverflowWidth is no use: Robolectric
                // reports it for 342 px text under a 1119 px limit, fully in one line.
                val outcome = mutableListOf<TextLayoutResult>()
                compose.onNodeWithText(name, useUnmergedTree = true).fetchSemanticsNode()
                    .config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(outcome)
                val text = outcome.single()
                val last = text.lineCount - 1
                assertTrue("$name is cut off (${text.lineCount} lines, visible up to " +
                    "${text.getLineEnd(last, visibleEnd = true)}/${name.length})",
                    !text.isLineEllipsized(last) && text.getLineEnd(last, visibleEnd = true) == name.length)
            }
        } finally {
            world.close()
        }
    }

    /**
     * Colors in German as in the web app („Trans-Klar“), part names stay English,
     * but are marked as English so that TalkBack pronounces them correctly.
     */
    @Test
    fun `parts name colors in German and names as English`() {
        val world = Examples.World(ContextTexts())
        try {
            val vm = world.parts().also { it.loadParts() }
            show { PartsRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
            wait("parts") { vm.partsState.value.parts.isNotEmpty() }
            compose.onAllNodesWithText("Trans-Klar", useUnmergedTree = true).fetchSemanticsNodes().let {
                assertTrue("Trans-Clear is shown", it.isNotEmpty())
            }
            compose.onAllNodesWithText("Trans-Clear", useUnmergedTree = true).assertCountEquals(0)
            val name = compose.onNodeWithText("Brick 2 x 4", useUnmergedTree = true).fetchSemanticsNode()
                .config[SemanticsProperties.Text].single()
            assertTrue("part name marked as English: ${name.spanStyles}",
                name.spanStyles.any { it.item.localeList == LocaleList("en") })
        } finally {
            world.close()
        }
    }

    @Test
    fun `finances stand in two columns on the tablet`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        val world = Examples.World(ContextTexts())
        try {
            val vm = world.finances().also { it.loadValuation(); it.loadPortfolioHistory("week") }
            show { FinanceRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
            wait("finances") { vm.financeState.value.let { it.valuation != null && !it.history.loading } }
            val history = compose.onNodeWithText(ctx.getString(R.string.chart_portfolio_value), useUnmergedTree = true)
                .fetchSemanticsNode().boundsInRoot
            val falcon = compose.onNodeWithText("Millennium Falcon", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
            assertTrue("the rows stand right of the history ($history / $falcon)",
                falcon.left > history.right)
        } finally {
            world.close()
        }
    }

    /**
     * Every voucher carries ONE menu (instead of five icons at irregular distances);
     * menu and entries name the number, the PIN row is 48 dp high.
     */
    @Test
    fun `voucher buttons name the number and the PIN has 48 dp`() {
        show { Vouchers() }
        val number = "6061 2345 6789"
        val pin = compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_copy_pin, number))
            .fetchSemanticsNode().boundsInRoot
        val density = ctx.resources.displayMetrics.density
        assertTrue("PIN row only ${pin.height / density} dp high", pin.height / density >= 47.5f)
        compose.onAllNodesWithContentDescription(ctx.getString(R.string.vouchers_cd_delete, number)).assertCountEquals(0)
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_menu, number)).performClick()
        compose.waitForIdle()
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_delete, number)).fetchSemanticsNode()
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_edit, number)).fetchSemanticsNode()
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_balance, number)).fetchSemanticsNode()
    }

    /** The form does not stand permanently below the list but opens as a sheet. */
    @Test
    fun `adding a voucher opens the form only on request`() {
        show { Vouchers() }
        compose.onAllNodesWithText(ctx.getString(R.string.vouchers_number)).assertCountEquals(0)
        compose.onNode(hasText(ctx.getString(R.string.vouchers_add)) and hasClickAction()).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(ctx.getString(R.string.vouchers_number)).fetchSemanticsNode()
    }

    /**
     * One component per decision type: the condition narrows the list and stands as
     * filter chips (role checkbox, with spacing), like the filters in gallery and finances;
     * segments belong to views. The sorting is a menu behind an icon.
     */
    @Test
    fun `wishlist filters the condition with chips and sorts via a menu`() {
        val world = Examples.World(ContextTexts())
        try {
            val vm = world.wantedList().also { it.loadWanted() }
            show { WantedRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build(), onScan = {}, onOpenSingle = { _, _ -> }) }
            wait("watchlist") { vm.wantedState.value.wantedItem.isNotEmpty() }
            val chips = listOf(R.string.filter_condition_all, R.string.condition_new, R.string.condition_used).map {
                compose.onNode(hasText(ctx.getString(it)) and
                    SemanticsMatcher.expectValue(SemanticsProperties.Role,
                        Role.Checkbox)).fetchSemanticsNode("${ctx.getString(it)} ist kein Filterchip").boundsInRoot
            }
            val density = ctx.resources.displayMetrics.density
            chips.zipWithNext().forEach { (a, b) ->
                assertTrue("chips stand with a gap (${a.right / density} / ${b.left / density} dp)", b.left - a.right >= 4 * density)
            }
            // The sorting does not stand as a chip with its name but behind the icon.
            val default = ctx.getString(R.string.gallery_sort_added_desc)
            compose.onAllNodesWithText(default).assertCountEquals(0)
            compose.onNodeWithContentDescription(ctx.getString(R.string.sort_menu_cd, default)).performClick()
            compose.waitForIdle()
            compose.onNodeWithText(ctx.getString(R.string.gallery_sort_name)).fetchSemanticsNode()
        } finally {
            world.close()
        }
    }

    /**
     * List detail on the tablet: the opened wishlist item stands to the right of the
     * list, the list stays visible, and its card is marked as selected. At the top
     * of the detail stands close instead of a back arrow that promised a page.
     */
    @Test
    fun `tablet shows wishlist and detail side by side`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        val world = Examples.World(ContextTexts())
        try {
            val vm = world.wantedList().also { it.loadWanted() }
            show {
                WantedRoute(vm = vm,
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), sideBySide = true,
                    onScan = {}, onOpenSingle = { _, _ -> error("no page of its own on the tablet") })
            }
            wait("watchlist") { vm.wantedState.value.wantedItem.isNotEmpty() }
            val card = compose.onNode(hasText("Titanic", substring = true) and hasClickAction())
            card.performClick()
            compose.waitForIdle()
            compose.onAllNodesWithContentDescription(ctx.getString(R.string.common_back)).assertCountEquals(0)
            val back = compose.onNodeWithContentDescription(ctx.getString(R.string.detail_close)).fetchSemanticsNode().boundsInRoot
            val list = compose.onNode(hasText("Lion Knights' Castle", substring = true) and hasClickAction()).fetchSemanticsNode().boundsInRoot
            assertTrue("the detail stands right of the list ($list / $back)", back.left >= list.right)
            compose.onNode(hasText("Titanic", substring = true) and hasClickAction() and
                SemanticsMatcher.expectValue(SemanticsProperties.Selected, true))
                .fetchSemanticsNode()
        } finally {
            world.close()
        }
    }

    @Test
    fun `empty wishlist offers remembering and scanning`() {
        val world = Examples.World(ContextTexts())
        try {
            world.paths.responses["/api/v2/wanted"] = """{"success":true,"item":[]}"""
            val vm = world.wantedList().also { it.loadWanted() }
            show { WantedRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build(), onScan = {}, onOpenSingle = { _, _ -> }) }
            driveUntil("watchlist", ready = { !(world.paths.requests.none { "/api/v2/wanted" in it } || vm.wantedState.value.fetch.loading) })
            compose.waitForIdle()
            compose.onNodeWithText(ctx.getString(R.string.wanted_add_first)).fetchSemanticsNode()
            compose.onNodeWithText(ctx.getString(R.string.gallery_scan_barcode)).fetchSemanticsNode()
            // Only these two paths: no floating button and no scan icon above.
            compose.onAllNodesWithContentDescription(ctx.getString(R.string.wanted_add_title)).assertCountEquals(0)
            compose.onAllNodesWithContentDescription(ctx.getString(R.string.gallery_scan_barcode)).assertCountEquals(0)
        } finally {
            world.close()
        }
    }

    /** Text fully in one line: neither wrapped nor elided. */
    private fun wholeOneRow(text: String) {
        val outcome = mutableListOf<TextLayoutResult>()
        compose.onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode()
            .config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(outcome)
        val t = outcome.single()
        assertTrue("“$text” stands in ${t.lineCount} lines, visible up to ${t.getLineEnd(t.lineCount - 1, visibleEnd = true)}",
            t.lineCount == 1 && !t.isLineEllipsized(0) && t.getLineEnd(0, visibleEnd = true) == text.length)
    }

    /**
     * A single choice at 200 % on a narrow phone: every option stands
     * fully in one line. As segments „Gebraucht“ broke into „Gebrau/cht“.
     */
    @Test
    fun `single choice breaks no word at 200 percent`() {
        val states = listOf(R.string.filter_condition_all, R.string.condition_new, R.string.condition_used)
            .map { ctx.getString(it) }
        val period = listOf(R.string.chart_period_week, R.string.chart_period_month, R.string.chart_period_year,
            R.string.chart_period_max).map { ctx.getString(it) }
        show(font = 2f) {
            Column(Modifier.width(360.dp).padding(horizontal = 16.dp)) {
                SegmentChoice(states.map { it to it }, states[0], {})
                SegmentChoice(period.map { it to it }, period[0], {})
            }
        }
        (states + period).forEach { wholeOneRow(it) }
    }

    /**
     * At 200 % a single choice stays a segment group: below each other, every option
     * across the full width and read out as a radio button. As chips it read like a filter.
     */
    @Test
    fun `single choice stands as segments below each other in full width at 200 percent`() {
        val states = listOf(R.string.condition_new, R.string.condition_used).map { ctx.getString(it) }
        show(font = 2f) {
            Column(Modifier.width(360.dp).padding(horizontal = 16.dp).testTag("wahl")) {
                SegmentChoice(states.map { it to it }, states[0], {})
            }
        }
        val density = ctx.resources.displayMetrics.density
        val frame = compose.onNodeWithTag("wahl").fetchSemanticsNode().boundsInRoot
        val segments = states.map { text ->
            val node = compose.onNode(hasText(text) and hasClickAction()).fetchSemanticsNode()
            assertEquals("$text is a radio button", Role.RadioButton, node.config.getOrNull(SemanticsProperties.Role))
            node.boundsInRoot
        }
        segments.forEach { s ->
            assertTrue("segment over the full width (${s.width / density} of ${frame.width / density} dp)",
                kotlin.math.abs(s.width - frame.width) <= density)
        }
        val (top, bottom) = segments
        assertTrue("segments stand one below the other and touch ($top / $bottom)",
            kotlin.math.abs(bottom.top - top.bottom) <= 2 * density)
    }

    /** Titanic ×2: market value and purchase both for two pieces, the profit as an amount too. */
    @Test
    fun `finances name the purchase total and the profit as an amount for two pieces`() {
        val world = Examples.World(ContextTexts())
        try {
            val vm = world.finances().also { it.loadValuation() }
            show { FinanceRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
            wait("finances") { vm.financeState.value.let { it.valuation != null && !it.valuationLoad.loading } }
            val row = setRows(vm.financeState.value.valuation!!.sets).map { it.second }
                .first { it.quantity > 1 && it.purchasePrice != null && it.value != null }
            // Computed ourselves, not from purchaseTotal/profit: otherwise the test would check the calculation with itself.
            val total = row.purchasePrice!! * row.quantity
            val purchase = ctx.getString(R.string.finance_purchase_total, fmtMoney(total, CurrencyCode("CHF")))
            compose.onNodeWithText(purchase, useUnmergedTree = true).fetchSemanticsNode()
            val profit = row.value!! - total
            compose.onAllNodesWithText(fmtMoney(profit, CurrencyCode("CHF")), substring = true, useUnmergedTree = true)
                .fetchSemanticsNodes().let { assertTrue("profit as an amount is shown", it.isNotEmpty()) }
        } finally {
            world.close()
        }
    }

    private fun showsText(text: String, substring: Boolean = false) =
        compose.onAllNodesWithText(text, substring = substring, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()

    /**
     * The header card shows cost, P/L and market value from one basis so that they
     * add up, and names below it the position without market price — like the web.
     */
    @Test
    fun `finance header shows cost plus P and L equals market value and the basis row`() {
        val world = Examples.World(ContextTexts())
        try {
            val vm = world.finances().also { it.loadValuation() }
            show { FinanceRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
            wait("finances") { vm.financeState.value.let { it.valuation != null && it.pnl != null && !it.valuationLoad.loading } }
            compose.waitForIdle()
            // The numbers of the examples, not from financeHeader: otherwise the test would check the calculation with itself.
            val cost = BigDecimal("1500.00")
            val pnl = BigDecimal("212.40")
            val value = BigDecimal("1712.40")
            assertEquals(0, cost.add(pnl).compareTo(value))
            val costText = ctx.getString(R.string.finance_cost_basis_row, fmtMoney(cost.toDouble(), CurrencyCode("CHF")))
            assertTrue(costText, showsText(costText))
            val pnlText = ctx.getString(R.string.finance_pnl_row, "+" + fmtMoney(pnl.toDouble(), CurrencyCode("CHF")))
            assertTrue(pnlText, showsText(pnlText))
            assertTrue("market value", showsText(fmtMoney(value.toDouble(), CurrencyCode("CHF"))))
            // The cost of ALL positions (with the tree house) would stand next to a market value without it.
            val all = ctx.getString(R.string.finance_cost_basis_row, fmtMoney(1680.0, CurrencyCode("CHF")))
            assertTrue("no cost basis of all positions", !showsText(all))
            val calculated = ctx.resources.getQuantityString(R.plurals.finance_basis_calculated, 3, 2, 3)
            val without = ctx.resources.getQuantityString(R.plurals.finance_basis_without_market, 1, 1, fmtMoney(180.0, CurrencyCode("CHF")))
            assertTrue(calculated, showsText(calculated, substring = true))
            assertTrue(without, showsText(without, substring = true))
        } finally {
            world.close()
        }
    }

    /**
     * Without market price the server delivers the purchase price (kachel_quelle "kauf"); the
     * tile still shows only market prices and says „kein Marktpreis“ instead of switching value.
     */
    @Test
    fun `gallery tile shows the market price only and names a missing one`() {
        val images = coil3.ImageLoader.Builder(ctx).build()
        val market = ctx.getString(R.string.gallery_card_market)
        val none = ctx.getString(R.string.gallery_card_no_market)
        show {
            Row(Modifier.width(380.dp)) {
                Box(Modifier.weight(1f)) {
                    SetCard(SetView(setNumber = "21318-1", name = "Baumhaus", avgPurchasePrice = Money.from(170.0)), "", images, {},
                        price = TilePrice(Money.from(180.0), null, "purchase"), currency = CurrencyCode("CHF"))
                }
                // Older servers without kachel_quelle delivered only market prices.
                Box(Modifier.weight(1f)) {
                    SetCard(SetView(setNumber = "75192-1", name = "Millennium Falcon"), "", images, {},
                        price = TilePrice(Money.from(812.5), 16.1), currency = CurrencyCode("CHF"))
                }
            }
        }
        compose.onAllNodesWithText(none, useUnmergedTree = true).assertCountEquals(1)
        compose.onAllNodesWithText(market, useUnmergedTree = true).assertCountEquals(1)
        assertTrue("market price", showsText(fmtMoney(812.5, CurrencyCode("CHF"))))
        assertTrue("purchase price shown on the tile", !showsText(fmtMoney(180.0, CurrencyCode("CHF"))))
        assertTrue("own purchase price shown on the tile", !showsText(fmtMoney(170.0, CurrencyCode("CHF"))))
    }
}
