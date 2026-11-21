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
 * Was die Bildschirmfotos zeigen, hier als Regel ausgeführt: Auf dem Tablet liegt der
 * Umschalter rechts der Seitenleiste, ein Ladefehler nennt seine Klasse, und die leere
 * Merkliste bietet beide Wege zum ersten Eintrag. Kachel und Wert-Kacheln prüfen
 * SetTileTest und ValueTilesTest in den Modulen, die sie besitzen.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   tablet-umschalter-oben          Umschalter auch auf dem Tablet in der App-Leiste → rot „Tablet …“
 *   fehlerhinweis-roher-satz        der Satz der Datenschicht auch bei OFFLINE → rot „Fehlerhinweis …“
 *   merkliste-leer-ohne-knoepfe     Knopf „Set merken“ ohne Beschriftung → rot „leere Merkliste …“
 *   detail-ohne-wertkacheln         Set-Detail ohne Wert-Kacheln → rot „Set-Detail zeigt Marktwert …“
 *   galerie-zwei-knoepfe            Scannen wieder als zweiter schwebender Knopf → rot „Galerie hat einen …“
 *   telefon-kontomenue              Kontosymbol wieder in der App-Leiste → rot „Telefon navigiert ohne …“
 *   teile-raster-fest               Teileraster wieder fest 120 dp → rot „Teile bei 200 Prozent …“
 *   finanzen-einspaltig             Finanzen auch auf dem Tablet einspaltig → rot „Finanzen stehen auf dem Tablet …“
 *   gutschein-pin-klein             PIN-Zeile ohne Mindesthöhe → rot „Gutschein-Knoepfe …“
 *   bildflaeche-ohne-ersatz         ProduktBild ohne Ersatzbild → rot „Galerie zeigt ohne Bild das Ersatzbild“
 *   leiste-klappt-nicht-ein         TopAppBar ohne scrollBehavior → rot „App-Leiste weicht beim Rollen“
 *   merkliste-zustand-als-segmente  Zustandsfilter der Merkliste wieder als Segmente → rot „Merkliste filtert …“
 *   umschalter-chips-bei-200        Sets | Teile | Minifiguren ab 130 % als Chipreihe statt Segmente
 *                                   → rot „der Sammlungs-Umschalter zeigt bei 200 Prozent …“ (Abstand)
 *   umschalter-zeile-bei-200        Segmente auch bei 200 % in einer Zeile → rot „der Sammlungs-Umschalter
 *                                   zeigt bei 200 Prozent …“ („Minifiguren … abgeschnitten“)
 *   merkliste-detail-ersetzt-liste  Merkposten-Detail nie neben der Liste → rot „Tablet zeigt Merkliste und Detail …“
 *   detail-mit-zurueckpfeil         Detail neben der Liste mit Zurück-Pfeil statt X → rot „Tablet zeigt Merkliste und Detail …“
 *   gutschein-formular-immer-offen  Formular wieder fest unter der Liste → rot „Gutschein hinzufuegen oeffnet …“
 *   teile-farben-englisch           Farbnamen unübersetzt, Teilenamen ohne Sprache → rot „Teile nennen Farben …“
 *   merkliste-leer-dreifach         leere Merkliste wieder mit Knopf und Suchzeile → rot „leere Merkliste …“
 *   segmente-bei-grosser-schrift    Einfachwahl auch bei 200 % als Segmente → rot „Einfachwahl bricht …“
 *   einfachwahl-chips-bei-200       Einfachwahl bei 200 % wieder als Chips → rot „Einfachwahl steht bei
 *                                   200 Prozent als Segmente …“
 *   finanzen-kauf-je-stueck         Kauf der Zeile wieder je Stück → rot „Finanzen nennen …“
 *   finanzen-kopf-ohne-basis        Kopfkarte aus allen Positionen statt der Basis → rot „Finanzkopf …“
 *   kachel-quelle-ignoriert         Kachel nennt auch den Kaufpreis „Marktpreis“ → rot „Galeriekachel …“
 *   mehr-ohne-vergleich             Vergleich nicht unter „Mehr“ → rot „Vergleich und Bauliste markieren …“
 *   mehr-pfeil-anders-als-zurueck   Pfeil führt immer auf „Mehr“ → rot „der Pfeil einer Mehr-Unterseite …“
 *   galerie-kachel-gross            Setkachel auch bei 200 % mit Bild über die Breite → rot „Galerie bei 200 Prozent …“
 *   galerie-erfassen-schwebt        Erfassen auch bei 200 % schwebend → rot „Galerie bei 200 Prozent …“
 *   teile-erfassen-schwebt          Erfassen auch bei 200 % schwebend → rot „Teile bei 200 Prozent …“
 *   teile-kachel-gross              Teilekachel auch bei 200 % mit Bild über die Breite → rot „Teile bei 200 Prozent zeigen …“
 *   detail-spalte-ohne-hoechstbreite  Set-Detail einspaltig wieder ohne gemeinsame Höchstbreite
 *                                   → rot „Set-Detail auf dem Tablet hochkant …“
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
        // Der Reiter in der Seitenleiste ist der linke der beiden (der andere ist der Titel).
        val tabRight = (0 until 2).map { leiste[it].fetchSemanticsNode().boundsInRoot }.minBy { it.left }.right
        assertTrue("Der Umschalter beginnt rechts der Seitenleiste",
            compose.onNodeWithText(teile).fetchSemanticsNode().boundsInRoot.left >= tabRight)
    }

    /**
     * Sets | Teile | Minifiguren wechselt die Ansicht und bleibt darum auch bei 200 % aus
     * Segmenten: aneinanderstossend (neben- oder untereinander), keine Beschriftung
     * abgeschnitten, alle drei ganz im Bild.
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
        // Keine zweite und dritte Ebene in der App-Leiste.
        compose.onAllNodesWithContentDescription(ctx.getString(R.string.konto_title)).assertCountEquals(0)
        compose.onAllNodesWithContentDescription(ctx.getString(R.string.nav_more)).assertCountEquals(0)
        compose.onNodeWithText(ctx.getString(R.string.nav_more)).performClick()
        compose.waitForIdle()
        // Einstellungen und Gutscheine stehen auf derselben Seite, jedes genau einmal.
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

    /** Die Welt antwortet im Takt; den Hauptlooper treiben, bis [fertig] gilt. */
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
            // Die G&V-Kachel nennt Betrag und Prozent (812.50 − 700.00); der Prozentwert allein steht
            // weiter unten in der Plakette je Zustand.
            compose.onNodeWithText("+" + fmtMoney(112.5, Waehrung("CHF")) + " · " + fmtProzent(16.1), useUnmergedTree = true)
                .assertIsDisplayed()
            compose.onAllNodesWithText(fmtMoney(812.5, Waehrung("CHF")), useUnmergedTree = true)[0].assertIsDisplayed()
        } finally {
            world.close()
        }
    }

    /**
     * Tablet hochkant, eine Spalte: Kacheln und Preisverlauf beginnen an derselben Kante.
     * Vorher stand die Karte auf der Lesebreite mittig, die Kacheln über die ganze Breite.
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
            // Innen liegen die Kachel 12 dp (mittel), der Titel 16 dp (gross) vom Rand ihrer Fläche.
            val kachel = compose.onAllNodes(hasText(ctx.getString(R.string.detail_section_market)))[0]
                .fetchSemanticsNode().boundsInRoot.left - 12 * dichte
            compose.onNode(androidx.compose.ui.test.hasScrollToNodeAction()).performScrollToNode(hasText(titel, ignoreCase = true))
            // Die Überschrift, nicht ihr Text in Versalien darunter: Abschnittstitel trägt beide.
            val karte = compose.onNode(hasText(titel) and androidx.compose.ui.test.isHeading(), useUnmergedTree = true)
                .fetchSemanticsNode().boundsInRoot.left - 16 * dichte
            assertEquals("Preisverlauf beginnt wie die Kacheln (${karte / dichte} / ${kachel / dichte} dp)",
                kachel / dichte, karte / dichte, 1f)
        } finally {
            world.close()
        }
    }

    /** Eine Galerie mit [bilder]; wartet, bis die Sets da sind. */
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
     * Wie viele der [namen] stehen ganz im Raster? Ungekürzte Lage statt boundsInRoot: Das
     * Raster schneidet eine halb sichtbare Kachel ab, und abgeschnitten läge sie scheinbar drin.
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
     * Erfassen-Knöpfe mit [beschreibung], die nicht über der Liste stehen. Bei 200 % gehört
     * Erfassen in die Zeile unter der Suche; ein schwebender Knopf liegt unterhalb des
     * Listenanfangs, auch wenn die Liste bei wenigen Sets kürzer ist als der Bildschirm.
     */
    private fun addNotViaList(beschreibung: String): List<Rect> {
        val liste = compose.onNode(androidx.compose.ui.test.hasScrollToNodeAction()).fetchSemanticsNode().boundsInRoot
        val buttons = compose.onAllNodesWithContentDescription(beschreibung).fetchSemanticsNodes().map { it.boundsInRoot }
        assertTrue("Erfassen ist da", buttons.isNotEmpty())
        return buttons.filter { it.bottom > liste.top + 0.5f }
    }

    /**
     * Bei 200 % Schrift ist eine Kachel eine Listenzeile, und Erfassen steht über der Liste:
     * Mit dem Bild über die volle Breite stand ein Set je Bildschirm, und der schwebende
     * Knopf lag auf dem Text der untersten Kachel.
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
     * Vergleich und Bauliste erreicht man über „Mehr“: Dort bleibt „Mehr“ gewählt, und der
     * Pfeil oben führt dorthin zurück wie auf den übrigen Mehr-Unterseiten.
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
        // Auf einem Reiter selbst kein Zurück: Er ist eine Wurzel.
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
            // Zurück auf „Mehr“: dessen Einträge stehen wieder da.
            compose.onNodeWithText(ctx.getString(R.string.vouchers_title)).fetchSemanticsNode()
        }
    }

    /**
     * Kam eine Mehr-Unterseite nicht von „Mehr“, führt der Pfeil oben dorthin, wohin
     * auch die Zurück-Geste führt: an den vorigen Eintrag, nicht auf „Mehr“.
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
        // Wie aus einem Set heraus: der Vergleich direkt über der Galerie, ohne „Mehr“.
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
            // Jede Anfrage scheitert, wie offline oder bei fehlender Vorschau.
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
                // Die Kachel ist mit der Schrift gewachsen (120 dp × 2) …
                // Die Bilder wachsen mit der Kachel: Nicht jede Kachel liegt im sichtbaren Raster.
                compose.onNode(androidx.compose.ui.test.hasScrollToNodeAction())
                    .performScrollToNode(hasText(name) and hasClickAction())
                val kachel = compose.onNode(hasText(name) and hasClickAction()).fetchSemanticsNode().boundsInRoot
                assertTrue("Kachel von $name nur ${kachel.width / dichte} dp breit", kachel.width / dichte >= 200f)
                // … und der Name steht ganz da: Die letzte sichtbare Zeile endet mit dem
                // letzten Zeichen, ohne Auslassung. didOverflowWidth taugt nicht: Robolectric
                // meldet es bei 342 px Text unter 1119 px Grenze, ganz in einer Zeile.
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
     * Farben auf Deutsch wie in der Webapp („Trans-Klar“), Teilenamen bleiben englisch,
     * sind aber als Englisch ausgezeichnet, damit TalkBack sie richtig ausspricht.
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
     * Jeder Gutschein trägt EIN Menü (statt fünf Symbole in unregelmässigen Abständen);
     * Menü und Einträge nennen die Nummer, die PIN-Zeile ist 48 dp hoch.
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

    /** Das Formular steht nicht dauerhaft unter der Liste, sondern öffnet als Blatt. */
    @Test
    fun `adding a voucher opens the form only on request`() {
        zeige { Gutscheine() }
        compose.onAllNodesWithText(ctx.getString(R.string.vouchers_number)).assertCountEquals(0)
        compose.onNode(hasText(ctx.getString(R.string.vouchers_add)) and hasClickAction()).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(ctx.getString(R.string.vouchers_number)).fetchSemanticsNode()
    }

    /**
     * Ein Bauteil je Entscheidungstyp: Der Zustand schränkt die Liste ein und steht als
     * Filterchips da (Rolle Checkbox, mit Abstand), wie die Filter in Galerie und Finanzen;
     * Segmente gehören Ansichten. Die Sortierung ist ein Menü hinter einem Symbol.
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
            // Die Sortierung steht nicht als Chip mit ihrem Namen da, sondern hinter dem Symbol.
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
     * List-Detail auf dem Tablet: Der geöffnete Merkposten steht rechts neben der
     * Liste, die Liste bleibt sichtbar, und seine Karte ist als gewählt markiert. Oben
     * im Detail steht Schliessen statt eines Zurück-Pfeils, der eine Seite versprach.
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
            // Nur diese beiden Wege: kein schwebender Knopf und kein Scan-Symbol darüber.
            compose.onAllNodesWithContentDescription(ctx.getString(R.string.wanted_add_title)).assertCountEquals(0)
            compose.onAllNodesWithContentDescription(ctx.getString(R.string.gallery_scan_barcode)).assertCountEquals(0)
        } finally {
            world.close()
        }
    }

    /** Text ganz in einer Zeile: weder umgebrochen noch ausgelassen. */
    private fun wholeOneRow(text: String) {
        val ergebnis = mutableListOf<TextLayoutResult>()
        compose.onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode()
            .config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(ergebnis)
        val t = ergebnis.single()
        assertTrue("„$text“ steht in ${t.lineCount} Zeilen, sichtbar bis ${t.getLineEnd(t.lineCount - 1, visibleEnd = true)}",
            t.lineCount == 1 && !t.isLineEllipsized(0) && t.getLineEnd(0, visibleEnd = true) == text.length)
    }

    /**
     * Eine Einfachwahl bei 200 % auf einem schmalen Telefon: Jede Möglichkeit steht
     * ganz in einer Zeile. Als Segmente brach „Gebraucht“ zu „Gebrau/cht“.
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
     * Bei 200 % bleibt eine Einfachwahl eine Segmentgruppe: untereinander, jede Möglichkeit
     * über die volle Breite und als Optionsfeld vorgelesen. Als Chips las sie sich wie ein Filter.
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

    /** Titanic ×2: Marktwert und Kauf beide für zwei Stück, der Gewinn auch als Betrag. */
    @Test
    fun `finances name the purchase total and the profit as an amount for two pieces`() {
        val world = Examples.Welt(ContextTexts())
        try {
            val vm = world.finanzen().also { it.loadValuation() }
            zeige { FinanceRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
            wait("Finanzen") { vm.financeState.value.let { it.valuation != null && !it.bewertung.laedt } }
            val zeile = setRows(vm.financeState.value.valuation!!.sets).map { it.second }
                .first { it.menge > 1 && it.kaufpreis != null && it.wert != null }
            // Selbst gerechnet, nicht aus kaufGesamt/gewinn: Sonst prüfte der Test die Rechnung mit sich selbst.
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
     * Die Kopfkarte zeigt Einstand, G/V und Marktwert aus einer Basis, so dass sie
     * aufgehen, und nennt darunter die Position ohne Marktpreis — wie das Web.
     */
    @Test
    fun `finance header shows cost plus P and L equals market value and the basis row`() {
        val world = Examples.Welt(ContextTexts())
        try {
            val vm = world.finanzen().also { it.loadValuation() }
            zeige { FinanceRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
            wait("Finanzen") { vm.financeState.value.let { it.valuation != null && it.pnl != null && !it.bewertung.laedt } }
            compose.waitForIdle()
            // Die Zahlen der Beispiele, nicht aus financeHeader: Sonst prüfte der Test die Rechnung mit sich selbst.
            val cost = BigDecimal("1500.00")
            val guv = BigDecimal("212.40")
            val wert = BigDecimal("1712.40")
            assertEquals(0, cost.add(guv).compareTo(wert))
            val costText = ctx.getString(R.string.finance_einstand_zeile, fmtMoney(cost.toDouble(), Waehrung("CHF")))
            assertTrue(costText, standsDa(costText))
            val guvText = ctx.getString(R.string.finance_guv_zeile, "+" + fmtMoney(guv.toDouble(), Waehrung("CHF")))
            assertTrue(guvText, standsDa(guvText))
            assertTrue("Marktwert", standsDa(fmtMoney(wert.toDouble(), Waehrung("CHF"))))
            // Der Einstand ALLER Positionen (mit dem Baumhaus) stünde neben einem Marktwert ohne es.
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

    /** Ohne Marktpreis liefert der Server den Kaufpreis (kachel_quelle "kauf"); die Kachel sagt es. */
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
                // Ältere Server ohne kachel_quelle lieferten nur Marktpreise.
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
