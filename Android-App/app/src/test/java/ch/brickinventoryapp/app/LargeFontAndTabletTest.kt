package ch.brickinventoryapp.app

import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ViewInAr
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.app.nav.AppTarget
import ch.brickinventoryapp.app.nav.Tab
import ch.brickinventoryapp.app.testing.Examples
import ch.brickinventoryapp.catalog.ui.CatalogTarget
import ch.brickinventoryapp.collection.ui.CollectionTarget
import ch.brickinventoryapp.collection.ui.screens.GalleryRoute
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.data.testing.testCatalogRepository
import ch.brickinventoryapp.data.testing.testSetsRepository
import ch.brickinventoryapp.finances.ui.FinanceTarget
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.PriceChartView
import ch.brickinventoryapp.model.domain.PricePointView
import ch.brickinventoryapp.model.domain.PriceSeriesView
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.parts.ui.PartsListAndDetailRoute
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.shared.ui.ConditionRow
import ch.brickinventoryapp.shared.ui.PriceChart
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.fmtMoney
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * Large font and tablet, executed as behavior: navigation destinations stand
 * in one line at 200 %, the gallery's search placeholder is never cut off
 * on the phone.
 *
 * Counter-checks (patches under counter-checks/, measured only in CI — Robolectric):
 *   reiter-bricht-um          label again as text without line limit → red “tab bar …”
 *   reiter-schrumpft-bis-7sp  lower bound again fixed 7 sp → red “tab bar never shrinks …”
 *   reiter-boden-normalgroesse  lower bound again the normal size → red “tab label grows …”
 *   reiter-eigene-groesse     all labelled, each in its own size → red “tab bar breaks …”
 *   suche-neben-filtertext    filter button with text already from 360 dp → red “search placeholder …”
 *   verlauf-ab-zwei-punkten   line already from two points → red “price history …”
 *   teile-detail-als-dialog   parts detail as a dialog on the tablet too → red “tablet shows part …”
 *   teile-detail-schliessen-rechts  close again to the right of the title → red “tablet shows part …”
 *   teile-kachel-ohne-auswahl  open tile not marked → red “tablet shows part …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class LargeFontAndTabletTest {

    @get:Rule
    val compose = createComposeRule()

    private val before = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun tearDown() = Locale.setDefault(before)

    private fun show(font: Float = 1f, content: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                val d = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(d.density, font)) {
                    Surface(color = MaterialTheme.colorScheme.background) { content() }
                }
            }
        }
        compose.waitForIdle()
    }

    private fun layout(node: SemanticsNode): TextLayoutResult {
        val outcome = mutableListOf<TextLayoutResult>()
        node.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(outcome)
        return outcome.single()
    }

    /** The text node with exactly [text] (not a field that carries it as a placeholder). */
    private fun textNode(text: String): SemanticsNode =
        compose.onAllNodes(hasText(text), useUnmergedTree = true).fetchSemanticsNodes()
            .first { n -> n.config.getOrNull(SemanticsProperties.EditableText) == null &&
                n.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null }

    private fun wholeOneRow(text: String, where: String) {
        val t = layout(textNode(text))
        assertTrue("$where: “$text” stands in ${t.lineCount} lines, visible up to " +
            "${t.getLineEnd(t.lineCount - 1, visibleEnd = true)}/${text.length}",
            t.lineCount == 1 && !t.isLineEllipsized(0) && t.getLineEnd(0, visibleEnd = true) == text.length)
    }

    private val fiveTargets by lazy {
        listOf(CollectionTarget.Gallery to R.string.nav_collection, FinanceTarget.Finance to R.string.nav_finance,
            CollectionTarget.Wanted to R.string.nav_wanted, CatalogTarget.Catalog to R.string.nav_catalog, AppTarget.More to R.string.nav_more)
            .map { (target, text) -> target to ctx.getString(text) }
    }

    /** The visible labels of the bar; a destination without one carries its name and is tappable. */
    private fun visibleLabels(targets: List<Pair<Any, String>>): List<String> = targets.map { it.second }.filter { text ->
        val visible = compose.onAllNodes(hasText(text), useUnmergedTree = true).fetchSemanticsNodes()
            .any { it.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null }
        if (!visible) compose.onNode(androidx.compose.ui.test.hasContentDescription(text) and androidx.compose.ui.test.hasClickAction())
            .fetchSemanticsNode("„$text“ hat weder Beschriftung noch Namen")
        visible
    }

    @Test
    fun `tab bar breaks no word at 200 percent`() {
        val targets = fiveTargets
        show(font = 2f) {
            val nav = rememberNavController()
            val tab = remember {
                targets.map { (target, text) -> Tab(target, { Icon(Icons.Default.ViewInAr, null) }, text) }
            }
            MainScaffold(
                title = "Titel", navController = nav, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                onTabTapped = {},
            ) {
                NavHost(nav, startDestination = FinanceTarget.Finance) { composable<FinanceTarget.Finance> { } }
            }
        }
        val visible = visibleLabels(targets)
        assertTrue("the chosen destination is not labeled", ctx.getString(R.string.nav_finance) in visible)
        visible.forEach { wholeOneRow(it, "Reiterleiste") }
        val sizes = visible.map { layout(textNode(it)).layoutInput.style.fontSize }.toSet()
        assertTrue("tab bar in different sizes: $sizes", sizes.size == 1)
    }

    /** At 200 % the labels stand at least one and a half times as large as at 100 %. */
    @Test
    fun `tab label grows at 200 percent at least to one and a half times`() {
        val targets = fiveTargets
        var normal = 0f
        show(font = 2f) {
            normal = MaterialTheme.typography.labelMedium.fontSize.value
            val nav = rememberNavController()
            val tab = remember {
                targets.map { (target, text) -> Tab(target, { Icon(Icons.Default.ViewInAr, null) }, text) }
            }
            MainScaffold(
                title = "Titel", navController = nav, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                onTabTapped = {},
            ) {
                NavHost(nav, startDestination = CollectionTarget.Wanted) { composable<CollectionTarget.Wanted> { } }
            }
        }
        val visible = visibleLabels(targets)
        assertTrue("no label visible", visible.isNotEmpty())
        visible.forEach { text ->
            val t = layout(textNode(text))
            val set = t.layoutInput.style.fontSize.value * t.layoutInput.density.fontScale
            assertTrue("“$text” in $set instead of at least ${1.5f * normal} points", set >= 1.5f * normal - 0.01f)
            assertTrue("“$text” overflows", !t.hasVisualOverflow)
        }
    }

    /**
     * A label that does not fit even at normal size („Einstellungen“ in a
     * fifth of the width at 130 %) does not become smaller than without magnification: then only
     * icons stand there, each with its name for TalkBack. It must be small enough for 7 sp,
     * otherwise a lower lower bound would never matter either.
     */
    @Test
    fun `tab bar never shrinks below the normal font size`() {
        val targets = listOf(CollectionTarget.Gallery to R.string.nav_collection, FinanceTarget.Finance to R.string.nav_settings,
            CollectionTarget.Wanted to R.string.nav_wanted, CatalogTarget.Catalog to R.string.nav_catalog, AppTarget.More to R.string.nav_more)
            .map { (target, text) -> target to ctx.getString(text) }
        val font = 1.3f
        var normal = 0f
        show(font = font) {
            normal = MaterialTheme.typography.labelMedium.fontSize.value
            val nav = rememberNavController()
            val tab = remember {
                targets.map { (target, text) -> Tab(target, { Icon(Icons.Default.ViewInAr, null) }, text) }
            }
            MainScaffold(
                title = "Titel", navController = nav, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                onTabTapped = {},
            ) {
                NavHost(nav, startDestination = CollectionTarget.Gallery) { composable<CollectionTarget.Gallery> { } }
            }
        }
        visibleLabels(targets).forEach { text ->
            val style = layout(textNode(text)).layoutInput.style.fontSize.value
            assertTrue("“$text” in ${style * font} instead of at least ${font * normal} points", style * font >= font * normal - 0.01f)
        }
    }

    // Counter-check zustand-feste-spalte: label at every font in the fixed
    // 90 dp column → red „Zustandszeile: „Zustand“ steht in 2 Zeilen“.
    @Test
    fun `state row breaks no word at 200 percent`() {
        show(font = 2f) { ConditionRow(condition = Condition.NEW, onUiState = {}) }
        wholeOneRow(ctx.getString(R.string.common_condition), "Zustandszeile")
    }

    @Test
    fun `search placeholder of the gallery is shown in full on the phone`() = suchPlaceholderWhole(1f)

    // Counter-check suche-gross-neben-knoepfen: buttons next to the field even at large
    // font → red „Such-Platzhalter 200 %: … sichtbar bis 5/7“.
    @Test
    fun `search placeholder of the gallery is shown in full at 200 percent too`() = suchPlaceholderWhole(2f)

    private fun suchPlaceholderWhole(font: Float) {
        val world = Examples.World(ContextTexts())
        try {
            val vm = world.gallery().also { it.loadSets() }
            val entryVm = world.t.track(EntryViewModel(world.t.session, world.t.filter(), world.t.hints, testSetsRepository(world.t.api), world.t.setCatalog(), world.t.wantedList(),
                testCatalogRepository(world.t.api),
                object : SetCreator {
                    override fun create(setNumber: String, quantity: Int, purchasePrice: Money?, condition: Condition?,
                                         ownerUserId: Int?, storage: String?) =
                        kotlinx.coroutines.flow.emptyFlow<SetCreateStep>()
                }))
            show(font) {
                GalleryRoute(vm = vm, entryVm = entryVm,
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), onScanBarcode = {}, onSetClick = {})
            }
            driveUntil("gallery", ready = { !(vm.galleryState.value.let { it.sets.isEmpty() || it.fetch.loading }) })
            compose.waitForIdle()
            wholeOneRow(ctx.getString(R.string.gallery_search_placeholder),
                if (font == 1f) "Such-Platzhalter" else "Such-Platzhalter 200 %")
        } finally {
            world.close()
        }
    }

    private fun history(points: Int) = PriceChartView(
        values = listOf(PriceSeriesView("N",
            (1..points).map { PricePointView("2026-0$it-01", Money.from(700.0 + 10 * it)!!) })))

    /** Two points without an axis read like a trend; only from three does a line appear. */
    @Test
    fun `price history shows no line below three points and names low and high`() {
        val points = androidx.compose.runtime.mutableIntStateOf(2)
        show {
            Column {
                PriceChart(history(points.intValue), CurrencyCode("CHF"))
            }
        }
        val toLittle = ctx.getString(R.string.price_chart_too_few)
        assertTrue("price history with two points says why there is no chart",
            compose.onAllNodes(hasText(toLittle)).fetchSemanticsNodes().size == 1)
        val deepHigh = ctx.getString(R.string.price_chart_low_high,
            fmtMoney(710.0, CurrencyCode("CHF")), fmtMoney(720.0, CurrencyCode("CHF")))
        assertTrue("price history names low and high",
            compose.onAllNodes(hasText(deepHigh)).fetchSemanticsNodes().size == 1)
        points.intValue = 3
        compose.waitForIdle()
        assertTrue("price history with three points shows the line",
            compose.onAllNodes(hasText(toLittle)).fetchSemanticsNodes().isEmpty())
    }

    /** The world responds in ticks; drive the main looper until [done] holds. */
    private fun wait(name: String, done: () -> Boolean) {
        driveUntil(name, ready = done)
        compose.waitForIdle()
    }

    /** List detail as in the wishlist: the part stands on the right, the list stays on the left. */
    @Test
    fun `tablet shows part and list side by side`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        val world = Examples.World(ContextTexts())
        try {
            world.paths.responses["/api/v1/parts/3001/5/sets"] = """{"success":true,
                "item":{"nummer":"3001","name":"Brick 2 x 4","color_id":5,"color_name":"Red","total_quantity":12},
                "sets":[{"set_number":"75192-1","set_name":"Millennium Falcon","quantity":8,"owner_user_id":1}]}"""
            val vm = world.parts().also { it.loadParts() }
            val images = coil3.ImageLoader.Builder(ctx).build()
            show {
                PartsListAndDetailRoute(vm, images, "", { _, _, _, _ -> }, {}, { _, _, _, _ -> }) { _ ->
                    PartsRoute(vm = vm, imageLoader = images)
                }
            }
            wait("parts") { vm.partsState.value.parts.isNotEmpty() }
            val tile = androidx.compose.ui.test.hasText("Brick 2 x 4", substring = true) and
                androidx.compose.ui.test.hasClickAction()
            compose.onNode(tile).performClick()
            wait("part") { !vm.setItemState.value.fetch.loading }
            val too = compose.onNode(androidx.compose.ui.test.hasContentDescription(ctx.getString(R.string.detail_close)))
                .fetchSemanticsNode().boundsInRoot
            val list = compose.onNode(tile).fetchSemanticsNode().boundsInRoot
            assertTrue("tablet shows the part right of the list ($list / $too)", too.left >= list.right)
            assertTrue("tablet shows the part without a dialog",
                compose.onAllNodes(androidx.compose.ui.test.isDialog()).fetchSemanticsNodes().isEmpty())
            // One pattern for all detail headers: close to the left of the title, the tile marked.
            val title = compose.onNode(androidx.compose.ui.test.hasText("Brick 2 x 4") and
                androidx.compose.ui.test.isHeading()).fetchSemanticsNode().boundsInRoot
            assertTrue("tablet shows the part with close left of the title ($too / $title)", too.right <= title.left)
            compose.onNode(tile and SemanticsMatcher.expectValue(
                SemanticsProperties.Selected, true)).fetchSemanticsNode("Kachel nicht markiert")
        } finally {
            world.close()
        }
    }
}
