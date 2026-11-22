package ch.brickinventoryapp.app

import android.content.Context
import android.os.Looper
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.account.ui.screens.LocationsRoute
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.catalog.ui.CatalogUiState
import ch.brickinventoryapp.catalog.ui.screens.CatalogScreen
import ch.brickinventoryapp.catalog.ui.viewmodel.CatalogActions
import ch.brickinventoryapp.collection.ui.screens.AcquisitionManagementRoute
import ch.brickinventoryapp.collection.ui.screens.GalleryRoute
import ch.brickinventoryapp.collection.ui.screens.SetCard
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testCatalogRepository
import ch.brickinventoryapp.data.testing.testFinancesRepository
import ch.brickinventoryapp.data.testing.testHouseholdRepository
import ch.brickinventoryapp.data.testing.testManagementRepository
import ch.brickinventoryapp.data.testing.testMinifigsRepository
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.data.testing.testSetsRepository
import ch.brickinventoryapp.management.ui.ManagementUiState
import ch.brickinventoryapp.management.ui.screens.CacheEvents
import ch.brickinventoryapp.management.ui.screens.MonitoringScreen
import ch.brickinventoryapp.management.ui.screens.MonitoringState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
import ch.brickinventoryapp.model.domain.CatalogSetView
import ch.brickinventoryapp.model.domain.CatalogSort
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.FigureOrder
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.domain.YearCountView
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.parts.ui.PartsListAndDetailRoute
import ch.brickinventoryapp.parts.ui.PartsTarget
import ch.brickinventoryapp.parts.ui.screens.ManualItemDetailRoute
import ch.brickinventoryapp.parts.ui.screens.MinifigsRoute
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.viewmodel.PurchasesViewModel
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * One language of the UI, executed instead of searched in the source: filters as chips,
 * sorting of the minifigures, „hinzufügen“ everywhere, primary blue only for actions, one header
 * for part details and one word for „kein Preis“, reading width on the tablet, „Rückgängig“
 * after deleting, list rows from large font on and a year bar for all.
 *
 * Counter-checks (patches under counter-checks/, measured only in CI — Robolectric):
 *   kaufpreise-volle-breite       purchase prices without centeredUntil → red “purchase prices stand in form width on the tablet …”
 *   hintergrund-volle-breite      background work without centeredUntil → red “background work stands …”
 *   galerie-kachel-bei-130        list row again only via largeFont() → red “gallery shows list rows at 130 …”
 *   jahresleiste-28dp             track again 28 dp → red “year bar is 48 dp wide …”
 *   jahresleiste-ohne-sprung      TalkBack tap opens no menu → red “year bar jumps …”
 *   thema-wieder-blau             theme of the tile again in primary → red “theme and numbers …”
 *   teil-erfassen-titel           parts_add_title again „Teil erfassen“ → red “texts say add …”
 *   galerie-ohne-filterchips      gallery passes no active filters → red “active filter stands as a chip …”
 *   figuren-nummer-unsortiert     NUMMER does not sort → red “minifigures can be sorted“
 *   teil-loescht-sofort           marking deletes right away → red “deleting a part offers undo …”
 *   lagerort-gleich-geloescht     marking deletes right away → red “deleting a storage location offers undo …”
 *   kauf-loescht-sofort           marking deletes right away → red “deleting a purchase offers undo …”
 *   teil-ohne-preis-strich        market value without price again „—“ → red “part without market price …”
 *   setitem-eigener-kopf          part from sets again with 140 dp image → red “part from sets has the same header …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class UiUniformTest {

    @get:Rule
    val compose = createComposeRule()

    private val before = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val world = Examples.World(ContextTexts())
    private val images = SampleImages.loader(ctx)

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun tearDown() {
        Locale.setDefault(before)
        world.close()
    }

    private var mainColor = Color.Unspecified

    private fun show(font: Float = 1f, content: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                mainColor = MaterialTheme.colorScheme.primary
                val d = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(d.density, font)) {
                    Surface(color = MaterialTheme.colorScheme.background) { content() }
                }
            }
        }
        compose.waitForIdle()
    }

    private fun drive(name: String, ready: () -> Boolean) =
        driveUntil(name, requests = { world.paths.requests.size }, ready = ready)

    private val density get() = compose.density.density

    private fun node(text: String): SemanticsNode =
        compose.onAllNodes(hasText(text, substring = true), useUnmergedTree = true).fetchSemanticsNodes()
            .first { it.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null }

    private fun layout(n: SemanticsNode): TextLayoutResult {
        val outcome = mutableListOf<TextLayoutResult>()
        n.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(outcome)
        return outcome.single()
    }

    private fun requests(prefix: String) = world.paths.requests.filter { it.startsWith(prefix) }

    /** The clock stands; half a moment passes without the snackbar expiring. */
    private fun short() {
        compose.mainClock.autoAdvance = false
        repeat(5) {
            compose.mainClock.advanceTimeBy(100)
            shadowOf(Looper.getMainLooper()).idle()
        }
    }

    private fun purchases() = world.t.track(PurchasesViewModel(world.t.session, world.t.filter(), world.t.hints, world.t.changes,
        testHouseholdRepository(world.t.api), world.t.sets(), testFinancesRepository(world.t.api), testPartsRepository(world.t.api),
        testMinifigsRepository(world.t.api)))

    private fun settings() = world.t.track(SettingsViewModel(world.t.session, world.t.filter(), world.t.hints, world.t.sync,
        testAccountRepository(world.t.api, world.t.io), testManagementRepository(world.t.api), world.t.alerts(), testPartsRepository(world.t.api),
        object : FileReader { override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null }))

    private fun entryVm() = world.t.track(EntryViewModel(world.t.session, world.t.filter(), world.t.hints,
        testSetsRepository(world.t.api), world.t.setCatalog(), world.t.wantedList(), testCatalogRepository(world.t.api),
        object : SetCreator {
            override fun create(setNumber: String, quantity: Int, purchasePrice: Money?, condition: Condition?,
                                 ownerUserId: Int?, storage: String?): Flow<SetCreateStep> = emptyFlow()
        }))

    // ── Tablet: reading width like the settings ──

    private fun linksAbFormEdge(text: String, where: String) {
        val links = node(text).boundsInRoot.left / density
        // 1280 dp wide, 560 dp form centered: the content begins at 360 dp at the earliest.
        assertTrue("$where: “$text” starts at $links dp, not in the centered form width", links >= 360f)
    }

    @Test
    @Config(qualifiers = "de-rCH-w1280dp-h800dp-land-xhdpi")
    fun `purchase prices stand in form width on the tablet`() {
        val vm = purchases()
        show { AcquisitionManagementRoute(vm, type = ItemKind.SET, id = Examples.SET, title = "Millennium Falcon", onBack = {}) }
        drive("Käufe") { compose.onAllNodes(hasText(ctx.getString(R.string.common_quantity))).fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
        linksAbFormEdge(ctx.getString(R.string.common_quantity), "Kaufpreise")
    }

    @Test
    @Config(qualifiers = "de-rCH-w1280dp-h800dp-land-xhdpi")
    fun `background work stands in form width on the tablet`() {
        world.paths.responses["/api/v1/admin/auftraege"] = """{"success":true,"auftraege":[],"zusammenfassung":[],"pausen":[],
            "bildbedarf":0,"job_prozess":{"lebenszeichen":null,"alter_sekunden":null,"laeuft":true}}"""
        val api = world.t.api
        val vm = MonitoringViewModel(testManagementRepository(api), testAccountRepository(api), world.t.messages)
        runBlocking { vm.loadBackground() }
        val events = CacheEvents({}, {}, { _, _ -> }, {}, {}, {}, { _, _, _ -> })
        val background = vm.background.value
        show {
            MonitoringScreen(MonitoringState(MonitoringUiState(), background, ManagementUiState(),
                emptyMap(), Design.CLASSIC, 0L), vm, events)
        }
        linksAbFormEdge(ctx.getString(R.string.background_jobs), "Hintergrundarbeiten")
    }

    // ── Large font: list rows instead of one tile across the whole width ──

    @Test
    fun `gallery shows list rows at 130 percent`() {
        val vm = world.gallery().also { it.loadSets(); it.loadStats() }
        drive("Galerie") { vm.galleryState.value.sets.isNotEmpty() }
        show(font = 1.3f) {
            GalleryRoute(vm = vm, entryVm = entryVm(), imageLoader = images, onScanBarcode = {}, onSetClick = {})
        }
        val links = node("Millennium Falcon").boundsInRoot.left / density
        // In the row the image (96 dp) stands left of the name; as a tile it would stand at the edge.
        assertTrue("gallery at 130 %: the name starts at $links dp, so below an image over the full width",
            links >= 100f)
    }

    // ── Year bar: 48 dp and a jump menu for TalkBack and keyboard ──

    private val jumpTargets = mutableListOf<Int>()

    private val catalog = object : CatalogActions {
        override fun loadCatalogMeta() = Unit
        override fun loadCatalogSets() = Unit
        override fun catalogVisible(firstPage: Int, lastPage: Int) = Unit
        override fun scrollCatalogTo(number: Int) { jumpTargets += number }
        override fun catalogScrollConsumed() = Unit
        override fun setCatalogQuery(q: String) = Unit
        override fun setCatalogTheme(themeId: Int?) = Unit
        override fun setCatalogYear(year: Int?) = Unit
        override fun setCatalogSort(sort: CatalogSort) = Unit
    }

    private val catalogSets = (1..6).map { i ->
        CatalogSetView(setNumber = "1030$i-1", name = "Beispielset $i", year = 2024 - i / 3, numParts = 500 * i)
    }

    private fun showCatalog() = show {
        CatalogScreen(CatalogUiState(loadedPages = mapOf(1 to catalogSets), total = 6, sort = CatalogSort.YEAR_DESCENDING,
            yearDistribution = listOf(YearCountView(2024, 2), YearCountView(2023, 3), YearCountView(2022, 1))),
            serverUrl = "", catalog = catalog, imageLoader = images, onSetClick = {})
    }

    @Test
    fun `year bar is 48 dp wide`() {
        showCatalog()
        val track = compose.onNodeWithContentDescription(ctx.getString(R.string.catalog_year_jump)).fetchSemanticsNode()
        val width = track.boundsInRoot.width / density
        assertTrue("year bar is $width dp wide, a tap area needs 48 dp", width >= 47.5f)
    }

    @Test
    fun `year bar jumps via a menu of the years`() {
        showCatalog()
        compose.onNodeWithContentDescription(ctx.getString(R.string.catalog_year_jump))
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.waitForIdle()
        compose.onNodeWithText("2023").performClick()
        compose.waitForIdle()
        // 2024 has two sets: the year 2023 begins at position 2.
        assertEquals("jump menu of the year bar", listOf(2), jumpTargets)
    }

    // ── Texts: „hinzufügen“ as on the web, one name for the price comparison ──

    @Test
    fun `texts say add and price comparison`() {
        for (language in listOf("de-rCH", "en-rGB")) {
            RuntimeEnvironment.setQualifiers(language)
            val r = ApplicationProvider.getApplicationContext<Context>()
            assertEquals("$language: title and button for the part", r.getString(R.string.parts_add), r.getString(R.string.parts_add_title))
            assertEquals("$language: title and button for the figure", r.getString(R.string.minifigs_add), r.getString(R.string.minifigs_add_title))
            assertEquals("$language: destination and side of the comparison", r.getString(R.string.comparison_title), r.getString(R.string.nav_comparison))
        }
        RuntimeEnvironment.setQualifiers("de-rCH")
        val de = ApplicationProvider.getApplicationContext<Context>()
        for (id in listOf(R.string.gallery_add_first, R.string.parts_add_title, R.string.minifigs_add_title)) {
            assertTrue("“${de.getString(id)}” says add", de.getString(id).contains("hinzufügen"))
        }
    }

    // ── Primary blue only for actions ──

    private fun withoutMainColor(text: String, where: String) {
        val t = layout(node(text))
        val colors = listOf(t.layoutInput.style.color) +
            t.layoutInput.text.spanStyles.filter { text in t.layoutInput.text.text.substring(it.start, it.end) }.map { it.item.color }
        assertFalse("$where: “$text” stands in primary blue but is not tappable", mainColor in colors)
    }

    @Test
    fun `theme and numbers are not in primary blue`() {
        show {
            SetCard(SetView(setNumber = "75192-1", name = "Millennium Falcon", theme = "Star Wars", pieces = 7541),
                serverUrl = "", imageLoader = images, onClick = {})
        }
        assertNotEquals(Color.Unspecified, mainColor)
        withoutMainColor("Star Wars", "Thema der Kachel")
        withoutMainColor("75192-1", "Nummer der Kachel")
    }

    // ── Active filters as chips, sorting of the minifigures ──

    @Test
    fun `active filter stands as a chip below the search and can be removed`() {
        val vm = world.gallery().also { it.setGalleryTheme("Star Wars"); it.loadSets(); it.loadStats() }
        drive("Galerie") { vm.galleryState.value.sets.isNotEmpty() }
        show { GalleryRoute(vm = vm, entryVm = entryVm(), imageLoader = images, onScanBarcode = {}, onSetClick = {}) }
        compose.onNodeWithContentDescription(ctx.getString(R.string.filter_remove, "Star Wars")).performClick()
        compose.waitForIdle()
        assertEquals("the chip removes the theme filter", "", vm.galleryState.value.galleryTheme)
    }

    @Test
    fun `minifigures can be sorted`() {
        world.paths.responses["/api/v1/minifigs"] = """{"success":true,"figs":[
            {"fig_number":"sw0003","fig_name":"Anakin","quantity":1},
            {"fig_number":"sw0001","fig_name":"Luke","quantity":1},
            {"fig_number":"sw0002","fig_name":"Han","quantity":5}]}"""
        val vm = world.figures().also { it.loadMinifigs() }
        drive("Figuren") { vm.minifigsState.value.minifigs.size == 3 }
        show { MinifigsRoute(vm = vm, imageLoader = images) }
        val name = ctx.getString(R.string.parts_order_name)
        compose.onNode(hasContentDescription(ctx.getString(R.string.sort_menu_cd, name)) and hasClickAction()).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(ctx.getString(R.string.minifigs_order_number)).performClick()
        compose.waitForIdle()
        assertEquals("minifigures by number", listOf("sw0001", "sw0002", "sw0003"),
            vm.minifigsState.value.minifigs.map { it.figNumber })
        vm.setMinifigsOrder(FigureOrder.QUANTITY)
        assertEquals("minifigures by quantity", "sw0002", vm.minifigsState.value.minifigs.first().figNumber)
    }

    // ── Undo after deleting ──

    @Test
    fun `deleting a part offers undo and deletes only afterwards`() {
        world.paths.responses["/api/v1/parts/manual"] = """{"success":true,"parts":[{"id":9,"part_number":"3001",
            "part_name":"Brick 2 x 4","color_id":5,"color_name":"Red","quantity":12}]}"""
        val vm = world.parts().also { it.loadParts() }
        drive("Teile") { vm.partsState.value.manualParts?.isNotEmpty() == true }
        vm.partDeleteReserve("3001", 5, null, "Brick 2 x 4")
        drive("vorgemerkt") { true }
        assertTrue("marked is missing in the list", vm.partsState.value.manualParts.orEmpty().isEmpty())
        assertTrue("nothing deleted before the end of the snackbar", requests("DELETE /api/v1/parts/3001/5").isEmpty())
        vm.delete.undo()
        assertEquals("undo brings it back", 1, vm.partsState.value.manualParts.orEmpty().size)
        vm.partDeleteReserve("3001", 5, null, "Brick 2 x 4")
        vm.delete.execute()
        drive("gelöscht") { requests("DELETE /api/v1/parts/3001/5").isNotEmpty() }
    }

    @Test
    fun `deleting a storage location offers undo and deletes only afterwards`() {
        world.paths.responses["/api/v1/storage/locations"] = """{"success":true,"orte":[
            {"id":3,"name":"Keller"},{"id":4,"name":"Estrich"}]}"""
        val vm = settings().also { it.loadOwnLocations() }
        show { LocationsRoute(vm, remember { SnackbarHostState() }, onBack = {}) }
        drive("Lagerorte") { vm.storageState.value.own.size == 2 }
        vm.locationDeleteReserve(vm.storageState.value.own.first { it.id == 3 })
        short()
        assertEquals("marked is missing in the list", listOf(4), vm.storageState.value.own.map { it.id })
        assertTrue("nothing deleted before the end of the snackbar", requests("DELETE /api/v1/storage/locations/3").isEmpty())
        compose.onNodeWithText(ctx.getString(R.string.common_undo)).performClick()
        short()
        assertEquals("undo brings it back", 2, vm.storageState.value.own.size)
        assertTrue("undo does not delete", requests("DELETE /api/v1/storage/locations/3").isEmpty())
        vm.locationDeleteReserve(vm.storageState.value.own.first { it.id == 3 })
        vm.locationRoute.execute()
        drive("gelöscht") { requests("DELETE /api/v1/storage/locations/3").isNotEmpty() }
    }

    @Test
    fun `deleting a purchase offers undo and deletes only afterwards`() {
        val vm = purchases()
        show { AcquisitionManagementRoute(vm, type = ItemKind.SET, id = Examples.SET, title = "Millennium Falcon", onBack = {}) }
        drive("Käufe") { compose.onAllNodes(hasText(ctx.getString(R.string.common_quantity))).fetchSemanticsNodes().isNotEmpty() }
        vm.purchaseDeleteReserve(ItemKind.SET, Examples.SET, 0, 1)
        short()
        assertTrue("marked is missing in the list",
            compose.onAllNodes(hasText(ctx.getString(R.string.common_quantity))).fetchSemanticsNodes().isEmpty())
        assertTrue("nothing deleted before the end of the snackbar", requests("DELETE /api/v1/sets/75192-1/acquisitions/1").isEmpty())
        compose.onNodeWithText(ctx.getString(R.string.common_undo)).performClick()
        short()
        assertTrue("undo does not delete", requests("DELETE /api/v1/sets/75192-1/acquisitions/1").isEmpty())
        vm.purchaseDeleteReserve(ItemKind.SET, Examples.SET, 0, 1)
        vm.purchaseRoute.execute()
        drive("gelöscht") { requests("DELETE /api/v1/sets/75192-1/acquisitions/1").isNotEmpty() }
    }

    // ── One header for part details, one word for „kein Preis“ ──

    /** The image area for tapping (merged with the image), not the indented image inside it. */
    private fun imageHeight(name: String): Float = compose.onAllNodes(hasContentDescription(name))
        .fetchSemanticsNodes().maxOf { it.boundsInRoot.height } / density

    @Test
    fun `part without market price says no price yet`() {
        world.paths.responses["/api/v1/parts/manual"] = """{"success":true,"parts":[{"id":9,"part_number":"3001",
            "part_name":"Brick 2 x 4","color_id":5,"color_name":"Red","quantity":12,"image_local":"/beispiel/teil1.png"}]}"""
        val parts = world.parts().also { it.loadParts() }
        drive("Teile") { parts.partsState.value.manualParts?.isNotEmpty() == true }
        show {
            ManualItemDetailRoute(purchases(), parts, world.figures(), item = PartsTarget.ManualItemDetail(ItemKind.PART, "3001", 5, "Brick 2 x 4"),
                imageLoader = images, onBack = {}, onNavigateToAcqMgmt = { _, _, _, _ -> })
        }
        assertTrue("part without market price: “no price yet” instead of a dash",
            compose.onAllNodes(hasText(ctx.getString(R.string.detail_price_none_yet))).fetchSemanticsNodes().isNotEmpty())
        assertEquals("header of the self-entered part", 200f, imageHeight("Brick 2 x 4"), 1f)
    }

    @Test
    @Config(qualifiers = "de-rCH-w1280dp-h800dp-land-xhdpi")
    fun `part from sets has the same header as a self-added one`() {
        world.paths.responses["/api/v1/parts/3001/5/sets"] = """{"success":true,
            "item":{"nummer":"3001","name":"Brick 2 x 4","color_id":5,"color_name":"Red","category_name":"Bricks",
                    "image_local":"/beispiel/teil1.png","total_quantity":12},
            "sets":[{"set_number":"75192-1","set_name":"Millennium Falcon","quantity":8,"owner_user_id":1}]}"""
        val vm = world.parts().also { it.loadParts() }
        drive("Teile") { vm.partsState.value.parts.isNotEmpty() }
        show {
            PartsListAndDetailRoute(vm, images, "", { _, _, _, _ -> }, {}, { _, _, _, _ -> }) { _ ->
                PartsRoute(vm = vm, imageLoader = images)
            }
        }
        compose.onNode(hasText("Brick 2 x 4", substring = true) and hasClickAction()).performClick()
        drive("Teil offen") { vm.setItemState.value.header != null }
        compose.waitForIdle()
        assertEquals("header of the part from sets", 200f, imageHeight("Brick 2 x 4"), 1f)
        // The chip shows the color in the app's language (de-CH), as for the self-added part.
        assertTrue("figures as chips as for the self-entered part",
            compose.onAllNodes(hasText(ctx.getString(R.string.setitem_color) + " Rot", substring = true), useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty())
    }
}
