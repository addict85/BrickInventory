package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.parts.ui.PartsListAndDetailRoute
import ch.brickinventoryapp.app.nav.Reiter
import ch.brickinventoryapp.model.domain.Zustand
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
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.testing.testCatalogRepository
import ch.brickinventoryapp.app.csv.CsvImportUiState
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.model.domain.PreisDiagrammAnsicht
import ch.brickinventoryapp.model.domain.PricePointView
import ch.brickinventoryapp.model.domain.PriceSeriesView
import ch.brickinventoryapp.collection.ui.screens.GalleryRoute
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.shared.ui.PriceChart
import ch.brickinventoryapp.shared.ui.Zustandszeile
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.ui.util.fmtMoney
import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.SemanticsMatcher
import java.util.Locale
import org.robolectric.RuntimeEnvironment
import ch.brickinventoryapp.testing.testSetsRepository
import ch.brickinventoryapp.app.nav.AppTarget
import ch.brickinventoryapp.finances.ui.FinanzZiel
import ch.brickinventoryapp.catalog.ui.KatalogZiel
import ch.brickinventoryapp.collection.ui.SammlungZiel

/**
 * Grosse Schrift und Tablet, als Verhalten ausgeführt: Navigationsziele stehen
 * bei 200 % in einer Zeile, der Such-Platzhalter der Galerie ist auf dem Telefon nie
 * abgeschnitten.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   reiter-bricht-um          Beschriftung wieder als Text ohne Zeilengrenze → rot „Reiterleiste …“
 *   reiter-schrumpft-bis-7sp  Untergrenze wieder fest 7 sp → rot „Reiterleiste schrumpft nie …“
 *   reiter-boden-normalgroesse  Untergrenze wieder die Normalgrösse → rot „Reiterbeschriftung waechst …“
 *   reiter-eigene-groesse     alle beschriftet, jede in eigener Grösse → rot „Reiterleiste bricht …“
 *   suche-neben-filtertext    Filterknopf mit Text schon ab 360 dp → rot „Such-Platzhalter …“
 *   verlauf-ab-zwei-punkten   Linie schon ab zwei Punkten → rot „Preisverlauf …“
 *   teile-detail-als-dialog   Teile-Detail auch auf dem Tablet als Dialog → rot „Tablet zeigt Teil …“
 *   teile-detail-schliessen-rechts  Schliessen wieder rechts vom Titel → rot „Tablet zeigt Teil …“
 *   teile-kachel-ohne-auswahl  offene Kachel nicht markiert → rot „Tablet zeigt Teil …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class LargeFontAndTabletTest {

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

    private fun layout(node: SemanticsNode): TextLayoutResult {
        val ergebnis = mutableListOf<TextLayoutResult>()
        node.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(ergebnis)
        return ergebnis.single()
    }

    /** Der Textknoten mit genau [text] (nicht ein Feld, das ihn als Platzhalter trägt). */
    private fun textNode(text: String): SemanticsNode =
        compose.onAllNodes(hasText(text), useUnmergedTree = true).fetchSemanticsNodes()
            .first { n -> n.config.getOrNull(SemanticsProperties.EditableText) == null &&
                n.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null }

    private fun wholeOneRow(text: String, wo: String) {
        val t = layout(textNode(text))
        assertTrue("$wo: „$text“ steht in ${t.lineCount} Zeilen, sichtbar bis " +
            "${t.getLineEnd(t.lineCount - 1, visibleEnd = true)}/${text.length}",
            t.lineCount == 1 && !t.isLineEllipsized(0) && t.getLineEnd(0, visibleEnd = true) == text.length)
    }

    private val fiveTargets by lazy {
        listOf(SammlungZiel.Gallery to R.string.nav_collection, FinanzZiel.Finance to R.string.nav_finance,
            SammlungZiel.Wanted to R.string.nav_wanted, KatalogZiel.Catalog to R.string.nav_catalog, AppTarget.Mehr to R.string.nav_more)
            .map { (ziel, text) -> ziel to ctx.getString(text) }
    }

    /** Die sichtbaren Beschriftungen der Leiste; ein Ziel ohne trägt seinen Namen und ist antippbar. */
    private fun visibleLabels(targets: List<Pair<Any, String>>): List<String> = targets.map { it.second }.filter { text ->
        val sichtbar = compose.onAllNodes(hasText(text), useUnmergedTree = true).fetchSemanticsNodes()
            .any { it.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null }
        if (!sichtbar) compose.onNode(androidx.compose.ui.test.hasContentDescription(text) and androidx.compose.ui.test.hasClickAction())
            .fetchSemanticsNode("„$text“ hat weder Beschriftung noch Namen")
        sichtbar
    }

    @Test
    fun `tab bar breaks no word at 200 percent`() {
        val targets = fiveTargets
        zeige(schrift = 2f) {
            val nav = rememberNavController()
            val tab = remember {
                targets.map { (ziel, text) -> Reiter(ziel, { Icon(Icons.Default.ViewInAr, null) }, text) }
            }
            MainScaffold(
                title = "Titel", navController = nav, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                onCsvAbbrechen = {}, onTabAngetippt = {},
            ) {
                NavHost(nav, startDestination = FinanzZiel.Finance) { composable<FinanzZiel.Finance> { } }
            }
        }
        val sichtbar = visibleLabels(targets)
        assertTrue("Das gewählte Ziel ist nicht beschriftet", ctx.getString(R.string.nav_finance) in sichtbar)
        sichtbar.forEach { wholeOneRow(it, "Reiterleiste") }
        val sizes = sichtbar.map { layout(textNode(it)).layoutInput.style.fontSize }.toSet()
        assertTrue("Reiterleiste in verschiedenen Grössen: $sizes", sizes.size == 1)
    }

    /** Bei 200 % stehen die Beschriftungen mindestens anderthalbmal so gross da wie bei 100 %. */
    @Test
    fun `tab label grows at 200 percent at least to one and a half times`() {
        val targets = fiveTargets
        var normal = 0f
        zeige(schrift = 2f) {
            normal = MaterialTheme.typography.labelMedium.fontSize.value
            val nav = rememberNavController()
            val tab = remember {
                targets.map { (ziel, text) -> Reiter(ziel, { Icon(Icons.Default.ViewInAr, null) }, text) }
            }
            MainScaffold(
                title = "Titel", navController = nav, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                onCsvAbbrechen = {}, onTabAngetippt = {},
            ) {
                NavHost(nav, startDestination = SammlungZiel.Wanted) { composable<SammlungZiel.Wanted> { } }
            }
        }
        val sichtbar = visibleLabels(targets)
        assertTrue("Keine Beschriftung sichtbar", sichtbar.isNotEmpty())
        sichtbar.forEach { text ->
            val t = layout(textNode(text))
            val gesetzt = t.layoutInput.style.fontSize.value * t.layoutInput.density.fontScale
            assertTrue("„$text“ in $gesetzt statt mindestens ${1.5f * normal} Punkt", gesetzt >= 1.5f * normal - 0.01f)
            assertTrue("„$text“ läuft über", !t.hasVisualOverflow)
        }
    }

    /**
     * Eine Beschriftung, die auch in Normalgrösse nicht passt („Einstellungen“ in einem
     * Fünftel der Breite bei 130 %), wird nicht kleiner als ohne Vergrösserung: Dann stehen
     * nur Symbole da, jedes mit seinem Namen für TalkBack. Klein genug für 7 sp muss sie
     * sein, sonst fiele auch eine tiefere Untergrenze nie ins Gewicht.
     */
    @Test
    fun `tab bar never shrinks below the normal font size`() {
        val targets = listOf(SammlungZiel.Gallery to R.string.nav_collection, FinanzZiel.Finance to R.string.nav_settings,
            SammlungZiel.Wanted to R.string.nav_wanted, KatalogZiel.Catalog to R.string.nav_catalog, AppTarget.Mehr to R.string.nav_more)
            .map { (ziel, text) -> ziel to ctx.getString(text) }
        val schrift = 1.3f
        var normal = 0f
        zeige(schrift = schrift) {
            normal = MaterialTheme.typography.labelMedium.fontSize.value
            val nav = rememberNavController()
            val tab = remember {
                targets.map { (ziel, text) -> Reiter(ziel, { Icon(Icons.Default.ViewInAr, null) }, text) }
            }
            MainScaffold(
                title = "Titel", navController = nav, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                onCsvAbbrechen = {}, onTabAngetippt = {},
            ) {
                NavHost(nav, startDestination = SammlungZiel.Gallery) { composable<SammlungZiel.Gallery> { } }
            }
        }
        visibleLabels(targets).forEach { text ->
            val stil = layout(textNode(text)).layoutInput.style.fontSize.value
            assertTrue("„$text“ in ${stil * schrift} statt mindestens ${schrift * normal} Punkt", stil * schrift >= schrift * normal - 0.01f)
        }
    }

    // Gegenprobe zustand-feste-spalte: Beschriftung bei jeder Schrift in der festen
    // 90-dp-Spalte → rot „Zustandszeile: „Zustand“ steht in 2 Zeilen“.
    @Test
    fun `state row breaks no word at 200 percent`() {
        zeige(schrift = 2f) { Zustandszeile(zustand = Zustand.NEU, onZustand = {}) }
        wholeOneRow(ctx.getString(R.string.common_condition), "Zustandszeile")
    }

    @Test
    fun `search placeholder of the gallery is shown in full on the phone`() = suchPlaceholderWhole(1f)

    // Gegenprobe suche-gross-neben-knoepfen: Knöpfe auch bei grosser Schrift neben
    // dem Feld → rot „Such-Platzhalter 200 %: … sichtbar bis 5/7“.
    @Test
    fun `search placeholder of the gallery is shown in full at 200 percent too`() = suchPlaceholderWhole(2f)

    private fun suchPlaceholderWhole(schrift: Float) {
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
            zeige(schrift) {
                GalleryRoute(vm = vm, erfassung = erfassung,
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), onScanBarcode = {}, onSetClick = {})
            }
            driveUntil("Galerie", bereit = { !(vm.galleryState.value.let { it.sets.isEmpty() || it.abruf.laedt }) })
            compose.waitForIdle()
            wholeOneRow(ctx.getString(R.string.gallery_search_placeholder),
                if (schrift == 1f) "Such-Platzhalter" else "Such-Platzhalter 200 %")
        } finally {
            world.close()
        }
    }

    private fun verlauf(punkte: Int) = PreisDiagrammAnsicht(
        values = listOf(PriceSeriesView("N",
            (1..punkte).map { PricePointView("2026-0$it-01", Geld.aus(700.0 + 10 * it)!!) })))

    /** Zwei Punkte ohne Achse lasen sich wie ein Trend; erst ab drei steht eine Linie da. */
    @Test
    fun `price history shows no line below three points and names low and high`() {
        val punkte = androidx.compose.runtime.mutableIntStateOf(2)
        zeige {
            Column {
                PriceChart(verlauf(punkte.intValue), Waehrung("CHF"))
            }
        }
        val toLittle = ctx.getString(R.string.price_chart_too_few)
        assertTrue("Preisverlauf mit zwei Punkten sagt, warum kein Diagramm",
            compose.onAllNodes(hasText(toLittle)).fetchSemanticsNodes().size == 1)
        val deepHigh = ctx.getString(R.string.price_chart_low_high,
            fmtMoney(710.0, Waehrung("CHF")), fmtMoney(720.0, Waehrung("CHF")))
        assertTrue("Preisverlauf nennt Tief und Hoch",
            compose.onAllNodes(hasText(deepHigh)).fetchSemanticsNodes().size == 1)
        punkte.intValue = 3
        compose.waitForIdle()
        assertTrue("Preisverlauf mit drei Punkten zeigt die Linie",
            compose.onAllNodes(hasText(toLittle)).fetchSemanticsNodes().isEmpty())
    }

    /** Die Welt antwortet im Takt; den Hauptlooper treiben, bis [fertig] gilt. */
    private fun wait(name: String, fertig: () -> Boolean) {
        driveUntil(name, bereit = fertig)
        compose.waitForIdle()
    }

    /** Listen-Detail wie in der Merkliste: Das Teil steht rechts, die Liste bleibt links stehen. */
    @Test
    fun `tablet shows part and list side by side`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        val world = Examples.Welt(ContextTexts())
        try {
            world.paths.antworten["/api/v1/parts/3001/5/sets"] = """{"success":true,
                "item":{"nummer":"3001","name":"Brick 2 x 4","color_id":5,"color_name":"Red","total_quantity":12},
                "sets":[{"set_number":"75192-1","set_name":"Millennium Falcon","quantity":8,"owner_user_id":1}]}"""
            val vm = world.teile().also { it.loadParts() }
            val bilder = coil3.ImageLoader.Builder(ctx).build()
            zeige {
                PartsListAndDetailRoute(vm, bilder, "", { _, _, _, _ -> }, {}, { _, _, _, _ -> }) { _ ->
                    PartsRoute(vm = vm, imageLoader = bilder)
                }
            }
            wait("Teile") { vm.teileState.value.parts.isNotEmpty() }
            val kachel = androidx.compose.ui.test.hasText("Brick 2 x 4", substring = true) and
                androidx.compose.ui.test.hasClickAction()
            compose.onNode(kachel).performClick()
            wait("Teil") { !vm.setItemState.value.abruf.laedt }
            val zu = compose.onNode(androidx.compose.ui.test.hasContentDescription(ctx.getString(R.string.detail_close)))
                .fetchSemanticsNode().boundsInRoot
            val liste = compose.onNode(kachel).fetchSemanticsNode().boundsInRoot
            assertTrue("Tablet zeigt Teil rechts der Liste ($liste / $zu)", zu.left >= liste.right)
            assertTrue("Tablet zeigt Teil ohne Dialog",
                compose.onAllNodes(androidx.compose.ui.test.isDialog()).fetchSemanticsNodes().isEmpty())
            // Ein Muster für alle Detailköpfe: Schliessen links vom Titel, die Kachel markiert.
            val titel = compose.onNode(androidx.compose.ui.test.hasText("Brick 2 x 4") and
                androidx.compose.ui.test.isHeading()).fetchSemanticsNode().boundsInRoot
            assertTrue("Tablet zeigt Teil mit Schliessen links vom Titel ($zu / $titel)", zu.right <= titel.left)
            compose.onNode(kachel and SemanticsMatcher.expectValue(
                SemanticsProperties.Selected, true)).fetchSemanticsNode("Kachel nicht markiert")
        } finally {
            world.close()
        }
    }
}
