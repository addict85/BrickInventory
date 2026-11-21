package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.app.nav.Reiter
import ch.brickinventoryapp.model.domain.Zustand
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ViewInAr
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.platform.testTag
import androidx.compose.material3.Text
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.testing.testCatalogRepository
import ch.brickinventoryapp.app.csv.CsvImportUiState
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.collection.ui.TilePrice
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.collection.ui.screens.WantedRoute
import ch.brickinventoryapp.collection.ui.screens.SetCard
import ch.brickinventoryapp.collection.ui.screens.SetDetailRoute
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtProzent
import kotlinx.coroutines.flow.MutableStateFlow
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
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.ui.components.IMAGE_FALLBACK
import ch.brickinventoryapp.ui.components.SegmentChoice
import ch.brickinventoryapp.finances.ui.screens.FinanceRoute
import ch.brickinventoryapp.collection.ui.screens.GalleryRoute
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.finances.ui.setRows
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.finances.ui.inGroupsOfFour
import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.text.intl.LocaleList
import coil3.intercept.Interceptor
import coil3.request.ErrorResult
import java.math.BigDecimal
import java.util.Locale
import ch.brickinventoryapp.testing.testSetsRepository
import ch.brickinventoryapp.app.nav.AppTarget
import ch.brickinventoryapp.finances.ui.FinanzZiel
import ch.brickinventoryapp.collection.ui.SammlungZiel
import ch.brickinventoryapp.parts.ui.TeileZiel

/**
 * What the screenshots show, executed here as a rule: on the tablet the
 * switcher lies to the right of the side bar, a loading error names its class, and the empty
 * wishlist offers both paths to the first entry. Tile and value tiles are checked by
 * SetTileTest and ValueTilesTest in the modules that own them.
 *
 * Counter-checks (patches under gegenproben/, measured only in CI — Robolectric):
 *   tablet-umschalter-oben          switcher in the app bar on the tablet too → red “tablet has the switcher …”
 *   fehlerhinweis-roher-satz        the data layer's sentence also for OFFLINE → red “error hint …”
 *   merkliste-leer-ohne-knoepfe     button „Set merken“ without label → red “empty wishlist …”
 *   detail-ohne-wertkacheln         set detail without value tiles → red “set detail shows market value …”
 *   galerie-zwei-knoepfe            scanning again as a second floating button → red “gallery has a floating button …”
 *   telefon-kontomenue              account icon again in the app bar → red “phone navigates without …”
 *   teile-raster-fest               parts grid again fixed 120 dp → red “parts at 200 percent …”
 *   finanzen-einspaltig             finances single-column on the tablet too → red “finances stand in two columns on the tablet …”
 *   gutschein-pin-klein             PIN row without minimum height → red “voucher buttons …”
 *   bildflaeche-ohne-ersatz         ProduktBild without placeholder image → red “gallery without image shows the placeholder image”
 *   leiste-klappt-nicht-ein         TopAppBar without scrollBehavior → red “app bar yields when scrolling”
 *   merkliste-zustand-als-segmente  condition filter of the wishlist again as segments → red “wishlist filters …”
 *   umschalter-chips-bei-200        Sets | Parts | Minifigures from 130 % as a chip row instead of segments
 *                                   → red “the collection switcher shows all three views as segments at 200 percent …” (gap)
 *   umschalter-zeile-bei-200        segments in one row at 200 % too → red “the collection switcher
 *                                   shows all three views as segments at 200 percent …” („Minifiguren … abgeschnitten“)
 *   merkliste-detail-ersetzt-liste  wishlist item detail never next to the list → red “tablet shows wishlist and detail …”
 *   detail-mit-zurueckpfeil         detail next to the list with a back arrow instead of X → red “tablet shows wishlist and detail …”
 *   gutschein-formular-immer-offen  form again fixed below the list → red “adding a voucher opens …”
 *   teile-farben-englisch           color names untranslated, part names without language → red “parts name colors …”
 *   merkliste-leer-dreifach         empty wishlist again with button and search row → red “empty wishlist …”
 *   segmente-bei-grosser-schrift    single choice as segments at 200 % too → red “single choice breaks …”
 *   einfachwahl-chips-bei-200       single choice at 200 % again as chips → red “single choice stands as
 *                                   segments …”
 *   finanzen-kauf-je-stueck         purchase of the row again per piece → red “finances name …”
 *   finanzen-kopf-ohne-basis        header card from all positions instead of the basis → red “finance header …”
 *   kachel-quelle-ignoriert         tile also calls the purchase price „Marktpreis“ → red “gallery tile …”
 *   mehr-ohne-vergleich             comparison not under “More” → red “comparison and build list mark …”
 *   mehr-pfeil-anders-als-zurueck   arrow always leads to “More” → red “the arrow of a More subpage …”
 *   galerie-kachel-gross            set tile at 200 % too with an image across the width → red “gallery at 200 percent …”
 *   galerie-erfassen-schwebt        add floating at 200 % too → red “gallery at 200 percent …”
 *   teile-erfassen-schwebt          add floating at 200 % too → red “parts at 200 percent …”
 *   teile-kachel-gross              parts tile at 200 % too with an image across the width → red “parts at 200 percent show …”
 *   detail-spalte-ohne-hoechstbreite  set detail single-column again without common maximum width
 *                                   → red “set detail on the tablet in portrait …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class UisRulesTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() = Locale.setDefault(vorher)

    private fun zeige(schrift: Float = 1f, inhalt: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                val d = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(d.density, schrift)) {
                    Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
                }
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `tablet has the switcher to the right of the side bar`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        zeige {
            val nav = rememberNavController()
            val tab = remember {
                listOf(
                    Reiter(SammlungZiel.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"))
            }
            MainScaffold(
                title = "Sammlung", navController = nav, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                onCsvAbbrechen = {}, onTabAngetippt = {},
            ) {
                NavHost(nav, startDestination = SammlungZiel.Gallery) { composable<SammlungZiel.Gallery> { } }
            }
        }
        val teile = ctx.getString(R.string.nav_parts)
        compose.onAllNodesWithText(teile).assertCountEquals(1)
        val leiste = compose.onAllNodesWithText("Sammlung")
        // The tab in the side bar is the left one of the two (the other one is the title).
        val tabRight = (0 until 2).map { leiste[it].fetchSemanticsNode().boundsInRoot }.minBy { it.left }.right
        assertTrue("Der Umschalter beginnt rechts der Seitenleiste",
            compose.onNodeWithText(teile).fetchSemanticsNode().boundsInRoot.left >= tabRight)
    }

    /**
     * Sets | Parts | Minifigures switches the view and therefore stays made of segments at 200 %
     * too: adjoining (side by side or below each other), no label
     * cut off, all three fully in view.
     */
    @Test
    fun `the collection switcher shows all three views as segments at 200 percent`() {
        zeige(schrift = 2f) {
            val nav = rememberNavController()
            val tab = remember { listOf(Reiter(SammlungZiel.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung")) }
            MainScaffold(
                title = "Sammlung", navController = nav, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                onCsvAbbrechen = {}, onTabAngetippt = {},
            ) {
                NavHost(nav, startDestination = SammlungZiel.Gallery) { composable<SammlungZiel.Gallery> { } }
            }
        }
        val dichte = ctx.resources.displayMetrics.density
        val segments = listOf(R.string.nav_sets, R.string.nav_parts, R.string.nav_minifigs).map {
            val text = ctx.getString(it)
            val beschriftung = compose.onAllNodes(hasText(text), useUnmergedTree = true).fetchSemanticsNodes()
                .first { n -> n.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null }
            val layouts = mutableListOf<TextLayoutResult>()
            beschriftung.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
            assertTrue("$text bei 200 % abgeschnitten", layouts.none { l -> l.hasVisualOverflow })
            compose.onNode(hasText(text) and hasClickAction()).fetchSemanticsNode().boundsInRoot
        }
        val breite = ctx.resources.displayMetrics.widthPixels
        segments.forEach { s ->
            assertTrue("Segment ausserhalb des Bilds (${s.left / dichte} – ${s.right / dichte} dp)",
                s.left >= 0f && s.right <= breite + 1f)
        }
        segments.zipWithNext().forEach { (a, b) ->
            val sideBySide = kotlin.math.abs(b.left - a.right) <= 2 * dichte && kotlin.math.abs(a.top - b.top) < 1f
            val untereinander = kotlin.math.abs(b.top - a.bottom) <= 2 * dichte && kotlin.math.abs(a.left - b.left) < 1f
            assertTrue("Segmente stossen aneinander ($a / $b)", sideBySide || untereinander)
        }
    }

    @Test
    fun `app bar yields when scrolling and comes back when scrolling back`() {
        zeige {
            val nav = rememberNavController()
            val tab = remember {
                listOf(
                    Reiter(FinanzZiel.Finance, { Icon(Icons.Default.ViewInAr, null) }, "Finanzen"))
            }
            MainScaffold(
                title = "Finanzen", navController = nav, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                onCsvAbbrechen = {}, onTabAngetippt = {},
            ) {
                NavHost(nav, startDestination = FinanzZiel.Finance) {
                    composable<FinanzZiel.Finance> {
                        LazyColumn(Modifier.testTag("liste")) {
                            items(80) { i -> Text("Zeile $i", Modifier.padding(16.dp)) }
                        }
                    }
                }
            }
        }
        fun oben() = compose.onNodeWithTag("liste").fetchSemanticsNode().boundsInRoot.top
        val vorher = oben()
        compose.onNodeWithTag("liste").performTouchInput { swipeUp() }
        compose.waitForIdle()
        val dichte = ctx.resources.displayMetrics.density
        assertTrue("Die Liste rückt nach oben, wenn die Leiste weicht (${vorher / dichte} → ${oben() / dichte} dp)",
            oben() < vorher - 40 * dichte)
        compose.onNodeWithTag("liste").performTouchInput { swipeDown() }
        compose.waitForIdle()
        assertEquals("Zurückgerollt steht die Leiste wieder da", vorher, oben(), dichte)
    }

    @Test
    fun `phone navigates without drawer and account menu, More collects the rest`() {
        zeige {
            val nav = rememberNavController()
            val tab = remember {
                listOf(
                    Reiter(SammlungZiel.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"),
                    Reiter(AppTarget.Mehr, { Icon(Icons.Default.ViewInAr, null) }, ctx.getString(R.string.nav_more)))
            }
            MainScaffold(
                title = "Sammlung", navController = nav, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                onCsvAbbrechen = {}, onTabAngetippt = {},
            ) {
                NavHost(nav, startDestination = SammlungZiel.Gallery) {
                    composable<SammlungZiel.Gallery> { }
                    composable<AppTarget.Mehr> { MehrBildschirm(nav::openOfMore, isAdmin = false, updateVerfuegbar = false, onAbmelden = {}) }
                }
            }
        }
        // No second and third level in the app bar.
        compose.onAllNodesWithContentDescription(ctx.getString(R.string.konto_title)).assertCountEquals(0)
        compose.onAllNodesWithContentDescription(ctx.getString(R.string.nav_more)).assertCountEquals(0)
        compose.onNodeWithText(ctx.getString(R.string.nav_more)).performClick()
        compose.waitForIdle()
        // Settings and vouchers stand on the same page, each exactly once.
        compose.onAllNodesWithText(ctx.getString(R.string.nav_settings)).assertCountEquals(1)
        compose.onAllNodesWithText(ctx.getString(R.string.vouchers_title)).assertCountEquals(1)
    }

    @Test
    fun `error hint names the class and the sentence only where it says more`() {
        zeige { ErrorHint("Serverfehler (500)", {}, Fehlerklasse.OFFLINE) }
        compose.onNodeWithText(ctx.getString(R.string.fehler_offline_titel)).fetchSemanticsNode()
        compose.onAllNodesWithText("Serverfehler (500)").assertCountEquals(0)
    }

    @Test
    fun `error hint of a server error shows the code`() {
        zeige { ErrorHint("Serverfehler (500)", {}, Fehlerklasse.SERVER) }
        compose.onNodeWithText(ctx.getString(R.string.fehler_server_titel)).fetchSemanticsNode()
        compose.onNodeWithText("Serverfehler (500)").fetchSemanticsNode()
    }

    /** The world responds in ticks; drive the main looper until [fertig] holds. */
    private fun wait(name: String, fertig: () -> Boolean) {
        driveUntil(name, bereit = fertig)
        compose.waitForIdle()
    }

    @Test
    fun `set detail shows market value, purchase price and P&L at the top in the classic design`() {
        val world = Examples.Welt(ContextTexts())
        try {
            val vm = world.setDetail()
            zeige {
                SetDetailRoute(setNumber = Examples.SET, vm = vm, serverUrl = "",
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), onBack = {}, onDelete = {})
            }
            wait("Set-Detail") { vm.setDetailState.value.let { it.setPrice != null && it.priceHistory != null && !it.priceFetch.laedt } }
            compose.onNodeWithText(ctx.getString(R.string.detail_pnl_tile), useUnmergedTree = true).assertIsDisplayed()
            // The P&L tile names amount and percent (812.50 − 700.00); the percentage alone stands
            // further down in the badge per condition.
            compose.onNodeWithText("+" + fmtMoney(112.5, Waehrung("CHF")) + " · " + fmtProzent(16.1), useUnmergedTree = true)
                .assertIsDisplayed()
            compose.onAllNodesWithText(fmtMoney(812.5, Waehrung("CHF")), useUnmergedTree = true)[0].assertIsDisplayed()
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
        val world = Examples.Welt(ContextTexts())
        try {
            val vm = world.setDetail()
            zeige {
                SetDetailRoute(setNumber = Examples.SET, vm = vm, serverUrl = "",
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), onBack = {}, onDelete = {})
            }
            wait("Set-Detail") { vm.setDetailState.value.let { it.priceHistory != null && !it.historyFetch.laedt && !it.priceFetch.laedt } }
            val dichte = ctx.resources.displayMetrics.density
            val titel = ctx.getString(R.string.detail_section_price_history)
            // Inside, the tile lies 12 dp (medium), the title 16 dp (large) from the edge of its surface.
            val kachel = compose.onAllNodes(hasText(ctx.getString(R.string.detail_section_market)))[0]
                .fetchSemanticsNode().boundsInRoot.left - 12 * dichte
            compose.onNode(androidx.compose.ui.test.hasScrollToNodeAction()).performScrollToNode(hasText(titel, ignoreCase = true))
            // The heading, not its text in capitals below: the section title carries both.
            val karte = compose.onNode(hasText(titel) and androidx.compose.ui.test.isHeading(), useUnmergedTree = true)
                .fetchSemanticsNode().boundsInRoot.left - 16 * dichte
            assertEquals("Preisverlauf beginnt wie die Kacheln (${karte / dichte} / ${kachel / dichte} dp)",
                kachel / dichte, karte / dichte, 1f)
        } finally {
            world.close()
        }
    }

    /** A gallery with [bilder]; waits until the sets are there. */
    private fun galleryWith(world: Examples.Welt, bilder: coil3.ImageLoader, schrift: Float = 1f) {
        val vm = world.galerie().also { it.loadSets() }
        val erfassung = world.t.merke(EntryViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise, testSetsRepository(world.t.api), world.t.setCatalog(), world.t.merkliste(),
            testCatalogRepository(world.t.api),
            object : SetCreator {
                override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Geld?, condition: Zustand?,
                                     ownerUserId: Int?, storage: String?) =
                    kotlinx.coroutines.flow.emptyFlow<SetCreateStep>()
            }))
        zeige(schrift) {
            GalleryRoute(vm = vm, erfassung = erfassung,
                imageLoader = bilder, onScanBarcode = {}, onSetClick = {})
        }
        wait("Galerie") { vm.galleryState.value.sets.isNotEmpty() && !vm.galleryState.value.abruf.laedt }
    }

    /**
     * How many of the [namen] stand fully in the grid? Unclipped position instead of boundsInRoot: the
     * grid clips a half-visible tile, and clipped it would seemingly lie inside.
     */
    private fun wholeVisible(namen: List<String>): Int {
        val raster = compose.onNode(androidx.compose.ui.test.hasScrollToNodeAction()).fetchSemanticsNode().boundsInRoot
        return namen.count { name ->
            compose.onAllNodes(hasClickAction() and hasText(name, substring = true)).fetchSemanticsNodes().any { k ->
                val oben = k.positionInRoot.y
                k.size.height > 0 && oben >= raster.top - 0.5f && oben + k.size.height <= raster.bottom + 0.5f
            }
        }
    }

    /**
     * Add buttons with [beschreibung] that do not stand above the list. At 200 % add belongs
     * in the row below the search; a floating button lies below the
     * start of the list, even if the list is shorter than the screen with few sets.
     */
    private fun addNotViaList(beschreibung: String): List<Rect> {
        val liste = compose.onNode(androidx.compose.ui.test.hasScrollToNodeAction()).fetchSemanticsNode().boundsInRoot
        val buttons = compose.onAllNodesWithContentDescription(beschreibung).fetchSemanticsNodes().map { it.boundsInRoot }
        assertTrue("Erfassen ist da", buttons.isNotEmpty())
        return buttons.filter { it.bottom > liste.top + 0.5f }
    }

    /**
     * At 200 % font a tile is a list row, and add stands above the list:
     * with the image across the full width one set stood per screen, and the floating
     * button lay on the text of the bottom tile.
     */
    @Test
    fun `gallery at 200 percent shows several sets fully and add lies on none`() {
        val world = Examples.Welt(ContextTexts())
        try {
            galleryWith(world, coil3.ImageLoader.Builder(ctx).build(), schrift = 2f)
            val namen = listOf("Millennium Falcon", "Titanic", "Baumhaus")
            val ganz = wholeVisible(namen)
            assertTrue("Nur $ganz Set(s) ganz sichtbar", ganz >= 2)
            val daneben = addNotViaList(ctx.getString(R.string.gallery_add_set))
            assertTrue("Erfassen steht nicht über der Liste: $daneben", daneben.isEmpty())
        } finally {
            world.close()
        }
    }

    @Test
    fun `parts at 200 percent show several parts fully and add lies on none`() {
        val world = Examples.Welt(ContextTexts())
        try {
            val vm = world.teile().also { it.loadParts() }
            zeige(schrift = 2f) {
                PartsRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build())
            }
            wait("Teile") { vm.teileState.value.parts.isNotEmpty() }
            val namen = vm.teileState.value.parts.mapNotNull { it.partName }
            assertTrue(namen.size >= 3)
            val ganz = wholeVisible(namen)
            assertTrue("Nur $ganz Teil(e) ganz sichtbar", ganz >= 2)
            val daneben = addNotViaList(ctx.getString(R.string.parts_add))
            assertTrue("Erfassen steht nicht über der Liste: $daneben", daneben.isEmpty())
        } finally {
            world.close()
        }
    }

    /**
     * Comparison and build list are reached via “More”: there “More” stays selected, and the
     * arrow at the top leads back there as on the other More subpages.
     */
    @Test
    fun `comparison and build list mark More and lead back there with Back`() {
        val mehr = ctx.getString(R.string.nav_more)
        zeige {
            val nav = rememberNavController()
            val tab = remember {
                listOf(
                    Reiter(SammlungZiel.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"),
                    Reiter(AppTarget.Mehr, { Icon(Icons.Default.ViewInAr, null) }, mehr))
            }
            MainScaffold(
                title = "Seite", navController = nav, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                onCsvAbbrechen = {}, onTabAngetippt = {},
            ) {
                NavHost(nav, startDestination = SammlungZiel.Gallery) {
                    composable<SammlungZiel.Gallery> { }
                    composable<AppTarget.Mehr> { MehrBildschirm(nav::openOfMore, isAdmin = false, updateVerfuegbar = false, onAbmelden = {}) }
                    composable<SammlungZiel.Comparison> { Text("Vergleichsseite") }
                    composable<TeileZiel.PartsList> { Text("Baulistenseite") }
                }
            }
        }
        val zurueck = ctx.getString(R.string.common_back)
        // On a tab itself no back: it is a root.
        compose.onAllNodesWithContentDescription(zurueck).assertCountEquals(0)
        for ((entry, inhalt) in listOf(R.string.nav_comparison to "Vergleichsseite", R.string.nav_partslist to "Baulistenseite")) {
            compose.onNode(hasText(mehr) and hasClickAction()).performClick()
            compose.waitForIdle()
            compose.onNodeWithText(ctx.getString(entry)).performClick()
            compose.waitForIdle()
            compose.onNodeWithText(inhalt).fetchSemanticsNode()
            compose.onNode(hasText(mehr) and androidx.compose.ui.test.isSelected())
                .fetchSemanticsNode("„Mehr“ ist auf ${ctx.getString(entry)} nicht gewählt")
            compose.onNodeWithContentDescription(zurueck).performClick()
            compose.waitForIdle()
            // Back on “More”: its entries are there again.
            compose.onNodeWithText(ctx.getString(R.string.vouchers_title)).fetchSemanticsNode()
        }
    }

    /**
     * If a More subpage did not come from “More”, the arrow at the top leads where
     * the back gesture also leads: to the previous entry, not to “More”.
     */
    @Test
    fun `the arrow of a More subpage goes the same way as the back gesture`() {
        val mehr = ctx.getString(R.string.nav_more)
        var nav: NavHostController? = null
        zeige {
            val n = rememberNavController().also { nav = it }
            val tab = remember {
                listOf(
                    Reiter(SammlungZiel.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"),
                    Reiter(AppTarget.Mehr, { Icon(Icons.Default.ViewInAr, null) }, mehr))
            }
            MainScaffold(
                title = "Seite", navController = n, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                onCsvAbbrechen = {}, onTabAngetippt = {},
            ) {
                NavHost(n, startDestination = SammlungZiel.Gallery) {
                    composable<SammlungZiel.Gallery> { Text("Galerieseite") }
                    composable<AppTarget.Mehr> { MehrBildschirm(n::openOfMore, isAdmin = false, updateVerfuegbar = false, onAbmelden = {}) }
                    composable<SammlungZiel.Comparison> { Text("Vergleichsseite") }
                }
            }
        }
        // As from within a set: the comparison directly above the gallery, without “More”.
        compose.runOnIdle { nav!!.navigate(SammlungZiel.Comparison) }
        compose.onNodeWithText("Vergleichsseite").fetchSemanticsNode()
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
        val world = Examples.Welt(ContextTexts())
        try {
            // Every request fails, as offline or with a missing preview.
            val kaputt = coil3.ImageLoader.Builder(ctx).components {
                add(object : Interceptor {
                    override suspend fun intercept(chain: Interceptor.Chain) =
                        ErrorResult(null, chain.request, IllegalStateException("kein Bild"))
                })
            }.build()
            galleryWith(world, kaputt)
            val tiles = compose.onAllNodes(hasClickAction() and hasText("Millennium Falcon", substring = true))
                .fetchSemanticsNodes().size
            assertTrue("Die erste Kachel ist sichtbar", tiles >= 1)
            val namen = listOf("Millennium Falcon", "Titanic", "Baumhaus")
            val sichtbar = namen.count { compose.onAllNodesWithText(it, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
            assertEquals("Ersatzbild je sichtbarer Kachel", sichtbar, fallbackImages())
        } finally {
            world.close()
        }
    }

    @Test
    fun `gallery with image shows no placeholder image`() {
        val world = Examples.Welt(ContextTexts())
        try {
            galleryWith(world, SampleImages.loader(ctx))
            wait("Bilder") { fallbackImages() == 0 }
        } finally {
            world.close()
        }
    }

    @Test
    fun `gallery has a floating button and scanning next to the search`() {
        val world = Examples.Welt(ContextTexts())
        try {
            val vm = world.galerie().also { it.loadSets() }
            val erfassung = world.t.merke(EntryViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise, testSetsRepository(world.t.api), world.t.setCatalog(), world.t.merkliste(),
                testCatalogRepository(world.t.api),
                object : SetCreator {
                    override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Geld?, condition: Zustand?,
                                         ownerUserId: Int?, storage: String?) =
                        kotlinx.coroutines.flow.emptyFlow<SetCreateStep>()
                }))
            zeige {
                GalleryRoute(vm = vm, erfassung = erfassung,
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), onScanBarcode = {}, onSetClick = {})
            }
            wait("Galerie") { vm.galleryState.value.sets.isNotEmpty() && !vm.galleryState.value.abruf.laedt }
            val scan = compose.onAllNodesWithContentDescription(ctx.getString(R.string.gallery_scan_barcode))
            scan.assertCountEquals(1)
            compose.onAllNodesWithContentDescription(ctx.getString(R.string.gallery_add_set)).assertCountEquals(1)
            val suche = compose.onNode(androidx.compose.ui.test.hasSetTextAction())
                .fetchSemanticsNode().boundsInRoot
            val button = scan[0].fetchSemanticsNode().boundsInRoot
            assertTrue("Scannen steht in der Zeile der Suche", button.top < suche.bottom && button.bottom > suche.top)
        } finally {
            world.close()
        }
    }

    @Test
    fun `parts at 200 percent shorten no name`() {
        val world = Examples.Welt(ContextTexts())
        try {
            val vm = world.teile().also { it.loadParts() }
            zeige(schrift = 2f) {
                PartsRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build())
            }
            wait("Teile") { vm.teileState.value.parts.isNotEmpty() }
            val namen = vm.teileState.value.parts.mapNotNull { it.partName }
            assertTrue(namen.size >= 3)
            val dichte = ctx.resources.displayMetrics.density
            for (name in namen) {
                // The tile has grown with the font (120 dp × 2) …
                // The images grow with the tile: not every tile lies in the visible grid.
                compose.onNode(androidx.compose.ui.test.hasScrollToNodeAction())
                    .performScrollToNode(hasText(name) and hasClickAction())
                val kachel = compose.onNode(hasText(name) and hasClickAction()).fetchSemanticsNode().boundsInRoot
                assertTrue("Kachel von $name nur ${kachel.width / dichte} dp breit", kachel.width / dichte >= 200f)
                // … and the name stands in full: the last visible line ends with the
                // last character, without ellipsis. didOverflowWidth is no use: Robolectric
                // reports it for 342 px text under a 1119 px limit, fully in one line.
                val ergebnis = mutableListOf<TextLayoutResult>()
                compose.onNodeWithText(name, useUnmergedTree = true).fetchSemanticsNode()
                    .config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(ergebnis)
                val text = ergebnis.single()
                val letzte = text.lineCount - 1
                assertTrue("$name ist abgeschnitten (${text.lineCount} Zeilen, sichtbar bis " +
                    "${text.getLineEnd(letzte, visibleEnd = true)}/${name.length})",
                    !text.isLineEllipsized(letzte) && text.getLineEnd(letzte, visibleEnd = true) == name.length)
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
        val world = Examples.Welt(ContextTexts())
        try {
            val vm = world.teile().also { it.loadParts() }
            zeige { PartsRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
            wait("Teile") { vm.teileState.value.parts.isNotEmpty() }
            compose.onAllNodesWithText("Trans-Klar", useUnmergedTree = true).fetchSemanticsNodes().let {
                assertTrue("Trans-Klar steht da", it.isNotEmpty())
            }
            compose.onAllNodesWithText("Trans-Clear", useUnmergedTree = true).assertCountEquals(0)
            val name = compose.onNodeWithText("Brick 2 x 4", useUnmergedTree = true).fetchSemanticsNode()
                .config[SemanticsProperties.Text].single()
            assertTrue("Teilename als Englisch ausgezeichnet: ${name.spanStyles}",
                name.spanStyles.any { it.item.localeList == LocaleList("en") })
        } finally {
            world.close()
        }
    }

    @Test
    fun `finances stand in two columns on the tablet`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        val world = Examples.Welt(ContextTexts())
        try {
            val vm = world.finanzen().also { it.loadValuation(); it.loadPortfolioHistory("week") }
            zeige { FinanceRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
            wait("Finanzen") { vm.financeState.value.let { it.valuation != null && !it.verlauf.laedt } }
            val verlauf = compose.onNodeWithText(ctx.getString(R.string.chart_portfolio_value), useUnmergedTree = true)
                .fetchSemanticsNode().boundsInRoot
            val falcon = compose.onNodeWithText("Millennium Falcon", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
            assertTrue("Die Zeilen stehen rechts neben dem Verlauf ($verlauf / $falcon)",
                falcon.left > verlauf.right)
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
        zeige { Gutscheine() }
        val nummer = inGroupsOfFour("6061 2345 6789")
        val pin = compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_copy_pin, nummer))
            .fetchSemanticsNode().boundsInRoot
        val dichte = ctx.resources.displayMetrics.density
        assertTrue("PIN-Zeile nur ${pin.height / dichte} dp hoch", pin.height / dichte >= 47.5f)
        compose.onAllNodesWithContentDescription(ctx.getString(R.string.vouchers_cd_delete, nummer)).assertCountEquals(0)
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_menu, nummer)).performClick()
        compose.waitForIdle()
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_delete, nummer)).fetchSemanticsNode()
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_edit, nummer)).fetchSemanticsNode()
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_balance, nummer)).fetchSemanticsNode()
    }

    /** The form does not stand permanently below the list but opens as a sheet. */
    @Test
    fun `adding a voucher opens the form only on request`() {
        zeige { Gutscheine() }
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
        val world = Examples.Welt(ContextTexts())
        try {
            val vm = world.merkliste().also { it.loadWanted() }
            zeige { WantedRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build(), onScan = {}, onOpenSingle = { _, _ -> }) }
            wait("Merkliste") { vm.wantedState.value.merkposten.isNotEmpty() }
            val chips = listOf(R.string.filter_condition_all, R.string.condition_new, R.string.condition_used).map {
                compose.onNode(hasText(ctx.getString(it)) and
                    SemanticsMatcher.expectValue(SemanticsProperties.Role,
                        Role.Checkbox)).fetchSemanticsNode("${ctx.getString(it)} ist kein Filterchip").boundsInRoot
            }
            val dichte = ctx.resources.displayMetrics.density
            chips.zipWithNext().forEach { (a, b) ->
                assertTrue("Chips stehen mit Abstand (${a.right / dichte} / ${b.left / dichte} dp)", b.left - a.right >= 4 * dichte)
            }
            // The sorting does not stand as a chip with its name but behind the icon.
            val vorgabe = ctx.getString(R.string.gallery_sort_added_desc)
            compose.onAllNodesWithText(vorgabe).assertCountEquals(0)
            compose.onNodeWithContentDescription(ctx.getString(R.string.sort_menu_cd, vorgabe)).performClick()
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
        val world = Examples.Welt(ContextTexts())
        try {
            val vm = world.merkliste().also { it.loadWanted() }
            zeige {
                WantedRoute(vm = vm,
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), sideBySide = true,
                    onScan = {}, onOpenSingle = { _, _ -> error("auf dem Tablet keine eigene Seite") })
            }
            wait("Merkliste") { vm.wantedState.value.merkposten.isNotEmpty() }
            val karte = compose.onNode(hasText("Titanic", substring = true) and hasClickAction())
            karte.performClick()
            compose.waitForIdle()
            compose.onAllNodesWithContentDescription(ctx.getString(R.string.common_back)).assertCountEquals(0)
            val zurueck = compose.onNodeWithContentDescription(ctx.getString(R.string.detail_close)).fetchSemanticsNode().boundsInRoot
            val liste = compose.onNode(hasText("Lion Knights' Castle", substring = true) and hasClickAction()).fetchSemanticsNode().boundsInRoot
            assertTrue("Das Detail steht rechts der Liste ($liste / $zurueck)", zurueck.left >= liste.right)
            compose.onNode(hasText("Titanic", substring = true) and hasClickAction() and
                SemanticsMatcher.expectValue(SemanticsProperties.Selected, true))
                .fetchSemanticsNode()
        } finally {
            world.close()
        }
    }

    @Test
    fun `empty wishlist offers remembering and scanning`() {
        val world = Examples.Welt(ContextTexts())
        try {
            world.paths.antworten["/api/v1/wanted"] = """{"success":true,"merkposten":[]}"""
            val vm = world.merkliste().also { it.loadWanted() }
            zeige { WantedRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build(), onScan = {}, onOpenSingle = { _, _ -> }) }
            driveUntil("Merkliste", bereit = { !(world.paths.requests.none { "/api/v1/wanted" in it } || vm.wantedState.value.abruf.laedt) })
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
        val ergebnis = mutableListOf<TextLayoutResult>()
        compose.onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode()
            .config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(ergebnis)
        val t = ergebnis.single()
        assertTrue("„$text“ steht in ${t.lineCount} Zeilen, sichtbar bis ${t.getLineEnd(t.lineCount - 1, visibleEnd = true)}",
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
        zeige(schrift = 2f) {
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
        zeige(schrift = 2f) {
            Column(Modifier.width(360.dp).padding(horizontal = 16.dp).testTag("wahl")) {
                SegmentChoice(states.map { it to it }, states[0], {})
            }
        }
        val dichte = ctx.resources.displayMetrics.density
        val frame = compose.onNodeWithTag("wahl").fetchSemanticsNode().boundsInRoot
        val segments = states.map { text ->
            val node = compose.onNode(hasText(text) and hasClickAction()).fetchSemanticsNode()
            assertEquals("$text ist ein Optionsfeld", Role.RadioButton, node.config.getOrNull(SemanticsProperties.Role))
            node.boundsInRoot
        }
        segments.forEach { s ->
            assertTrue("Segment über die volle Breite (${s.width / dichte} von ${frame.width / dichte} dp)",
                kotlin.math.abs(s.width - frame.width) <= dichte)
        }
        val (oben, unten) = segments
        assertTrue("Segmente stehen untereinander und stossen aneinander ($oben / $unten)",
            kotlin.math.abs(unten.top - oben.bottom) <= 2 * dichte)
    }

    /** Titanic ×2: market value and purchase both for two pieces, the profit as an amount too. */
    @Test
    fun `finances name the purchase total and the profit as an amount for two pieces`() {
        val world = Examples.Welt(ContextTexts())
        try {
            val vm = world.finanzen().also { it.loadValuation() }
            zeige { FinanceRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
            wait("Finanzen") { vm.financeState.value.let { it.valuation != null && !it.bewertung.laedt } }
            val zeile = setRows(vm.financeState.value.valuation!!.sets).map { it.second }
                .first { it.menge > 1 && it.kaufpreis != null && it.wert != null }
            // Computed ourselves, not from kaufGesamt/gewinn: otherwise the test would check the calculation with itself.
            val gesamt = zeile.kaufpreis!! * zeile.menge
            val kauf = ctx.getString(R.string.finance_purchase_total, fmtMoney(gesamt, Waehrung("CHF")))
            compose.onNodeWithText(kauf, useUnmergedTree = true).fetchSemanticsNode()
            val gewinn = zeile.wert!! - gesamt
            compose.onAllNodesWithText(fmtMoney(gewinn, Waehrung("CHF")), substring = true, useUnmergedTree = true)
                .fetchSemanticsNodes().let { assertTrue("Gewinn als Betrag steht da", it.isNotEmpty()) }
        } finally {
            world.close()
        }
    }

    private fun standsDa(text: String, substring: Boolean = false) =
        compose.onAllNodesWithText(text, substring = substring, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()

    /**
     * The header card shows cost, P/L and market value from one basis so that they
     * add up, and names below it the position without market price — like the web.
     */
    @Test
    fun `finance header shows cost plus P and L equals market value and the basis row`() {
        val world = Examples.Welt(ContextTexts())
        try {
            val vm = world.finanzen().also { it.loadValuation() }
            zeige { FinanceRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
            wait("Finanzen") { vm.financeState.value.let { it.valuation != null && it.pnl != null && !it.bewertung.laedt } }
            compose.waitForIdle()
            // The numbers of the examples, not from financeHeader: otherwise the test would check the calculation with itself.
            val cost = BigDecimal("1500.00")
            val guv = BigDecimal("212.40")
            val wert = BigDecimal("1712.40")
            assertEquals(0, cost.add(guv).compareTo(wert))
            val costText = ctx.getString(R.string.finance_einstand_zeile, fmtMoney(cost.toDouble(), Waehrung("CHF")))
            assertTrue(costText, standsDa(costText))
            val guvText = ctx.getString(R.string.finance_guv_zeile, "+" + fmtMoney(guv.toDouble(), Waehrung("CHF")))
            assertTrue(guvText, standsDa(guvText))
            assertTrue("Marktwert", standsDa(fmtMoney(wert.toDouble(), Waehrung("CHF"))))
            // The cost of ALL positions (with the tree house) would stand next to a market value without it.
            val alle = ctx.getString(R.string.finance_einstand_zeile, fmtMoney(1680.0, Waehrung("CHF")))
            assertTrue("kein Einstand aller Positionen", !standsDa(alle))
            val gerechnet = ctx.resources.getQuantityString(R.plurals.finance_basis_gerechnet, 3, 2, 3)
            val ohne = ctx.resources.getQuantityString(R.plurals.finance_basis_ohne_markt, 1, 1, fmtMoney(180.0, Waehrung("CHF")))
            assertTrue(gerechnet, standsDa(gerechnet, substring = true))
            assertTrue(ohne, standsDa(ohne, substring = true))
        } finally {
            world.close()
        }
    }

    /** Without market price the server delivers the purchase price (kachel_quelle "kauf"); the tile says so. */
    @Test
    fun `gallery tile names the purchase price as purchase price`() {
        val bilder = coil3.ImageLoader.Builder(ctx).build()
        val markt = ctx.getString(R.string.gallery_card_market)
        val kauf = ctx.getString(R.string.gallery_card_paid)
        zeige {
            Row(Modifier.width(380.dp)) {
                Box(Modifier.weight(1f)) {
                    SetCard(SetAnsicht(setNumber = "21318-1", name = "Baumhaus"), "", bilder, {},
                        preis = TilePrice(Geld.aus(180.0), null, "kauf"), waehrung = Waehrung("CHF"))
                }
                // Older servers without kachel_quelle delivered only market prices.
                Box(Modifier.weight(1f)) {
                    SetCard(SetAnsicht(setNumber = "75192-1", name = "Millennium Falcon"), "", bilder, {},
                        preis = TilePrice(Geld.aus(812.5), 16.1), waehrung = Waehrung("CHF"))
                }
            }
        }
        compose.onAllNodesWithText(kauf, useUnmergedTree = true).assertCountEquals(1)
        compose.onAllNodesWithText(markt, useUnmergedTree = true).assertCountEquals(1)
        assertTrue(standsDa(fmtMoney(180.0, Waehrung("CHF"))))
    }
}
