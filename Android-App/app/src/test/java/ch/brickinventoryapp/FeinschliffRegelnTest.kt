package ch.brickinventoryapp

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
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.CsvImportUiState
import ch.brickinventoryapp.ui.Screen
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
import ch.brickinventoryapp.data.SetAnlegenSchritt
import ch.brickinventoryapp.data.SetAnleger
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.nav.TeileListeUndDetailRoute
import ch.brickinventoryapp.ui.model.PreisDiagrammAnsicht
import ch.brickinventoryapp.ui.model.PreisPunktAnsicht
import ch.brickinventoryapp.ui.model.PreisReiheAnsicht
import ch.brickinventoryapp.ui.screens.GalleryRoute
import ch.brickinventoryapp.ui.screens.PartsRoute
import ch.brickinventoryapp.ui.screens.PriceChart
import ch.brickinventoryapp.ui.screens.Zustandszeile
import ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel
import ch.brickinventoryapp.util.fmtMoney

/**
 * Regeln aus der achten UI-Prüfung, als Verhalten ausgeführt: Navigationsziele stehen
 * bei 200 % in einer Zeile, der Such-Platzhalter der Galerie ist auf dem Telefon nie
 * abgeschnitten.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   reiter-bricht-um          Beschriftung wieder als Text ohne Zeilengrenze → rot „Reiterleiste …“
 *   reiter-schrumpft-bis-7sp  Untergrenze wieder fest 7 sp → rot „Reiterleiste schrumpft nie …“
 *   suche-neben-filtertext    Filterknopf mit Text schon ab 360 dp → rot „Such-Platzhalter …“
 *   verlauf-ab-zwei-punkten   Linie schon ab zwei Punkten → rot „Preisverlauf …“
 *   teile-detail-als-dialog   Teile-Detail auch auf dem Tablet als Dialog → rot „Tablet zeigt Teil …“
 *   teile-detail-schliessen-rechts  Schliessen wieder rechts vom Titel → rot „Tablet zeigt Teil …“
 *   teile-kachel-ohne-auswahl  offene Kachel nicht markiert → rot „Tablet zeigt Teil …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class FeinschliffRegelnTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = java.util.Locale.getDefault()
    private val ctx: android.content.Context = ApplicationProvider.getApplicationContext()

    init { java.util.Locale.setDefault(java.util.Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() = java.util.Locale.setDefault(vorher)

    private fun zeige(schrift: Float = 1f, inhalt: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = "classic") {
                val d = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(d.density, schrift)) {
                    Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
                }
            }
        }
        compose.waitForIdle()
    }

    private fun layout(knoten: SemanticsNode): TextLayoutResult {
        val ergebnis = mutableListOf<TextLayoutResult>()
        knoten.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(ergebnis)
        return ergebnis.single()
    }

    /** Der Textknoten mit genau [text] (nicht ein Feld, das ihn als Platzhalter trägt). */
    private fun textKnoten(text: String): SemanticsNode =
        compose.onAllNodes(hasText(text), useUnmergedTree = true).fetchSemanticsNodes()
            .first { n -> n.config.getOrNull(SemanticsProperties.EditableText) == null &&
                n.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null }

    private fun ganzEineZeile(text: String, wo: String) {
        val t = layout(textKnoten(text))
        assertTrue("$wo: „$text“ steht in ${t.lineCount} Zeilen, sichtbar bis " +
            "${t.getLineEnd(t.lineCount - 1, visibleEnd = true)}/${text.length}",
            t.lineCount == 1 && !t.isLineEllipsized(0) && t.getLineEnd(0, visibleEnd = true) == text.length)
    }

    @Test
    fun `Reiterleiste bricht bei 200 Prozent kein Wort um`() {
        val ziele = listOf(Screen.Gallery to R.string.nav_collection, Screen.Finance to R.string.nav_finance,
            Screen.Wanted to R.string.nav_wanted, Screen.Catalog to R.string.nav_catalog, Screen.Mehr to R.string.nav_more)
            .map { (ziel, text) -> ziel to ctx.getString(text) }
        zeige(schrift = 2f) {
            val nav = rememberNavController()
            val reiter = remember {
                ziele.map { (ziel, text) -> Triple<Screen, @Composable () -> Unit, String>(ziel, { Icon(Icons.Default.ViewInAr, null) }, text) }
            }
            MainScaffold(
                title = "Titel", navController = nav, bottomNavItems = reiter,
                snackbarHostState = remember { SnackbarHostState() },
                csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                onCsvAbbrechen = {}, serverUrl = "", onTabAngetippt = {},
            ) {
                NavHost(nav, startDestination = Screen.Finance) { composable<Screen.Finance> { } }
            }
        }
        ziele.forEach { (_, text) -> ganzEineZeile(text, "Reiterleiste") }
        // Gegenprobe reiter-eigene-groesse: jede Beschriftung schrumpft für sich → rot
        // „Reiterleiste in verschiedenen Grössen“.
        val groessen = ziele.map { (_, text) -> layout(textKnoten(text)).layoutInput.style.fontSize }.toSet()
        assertTrue("Reiterleiste in verschiedenen Grössen: $groessen", groessen.size == 1)
    }

    /**
     * Eine Beschriftung, die auch in Normalgrösse nicht passt („Hintergrundarbeiten“ in
     * einem Fünftel der Breite bei 130 %), wird nicht kleiner als ohne Vergrösserung:
     * Dann stehen nur Symbole da, jedes mit seinem Namen für TalkBack.
     */
    @Test
    fun `Reiterleiste schrumpft nie unter die normale Schriftgroesse`() {
        val ziele = listOf(Screen.Gallery to R.string.nav_collection, Screen.Finance to R.string.nav_monitoring,
            Screen.Wanted to R.string.nav_wanted, Screen.Catalog to R.string.nav_catalog, Screen.Mehr to R.string.nav_more)
            .map { (ziel, text) -> ziel to ctx.getString(text) }
        val schrift = 1.3f
        var normal = 0f
        zeige(schrift = schrift) {
            normal = MaterialTheme.typography.labelSmall.fontSize.value
            val nav = rememberNavController()
            val reiter = remember {
                ziele.map { (ziel, text) -> Triple<Screen, @Composable () -> Unit, String>(ziel, { Icon(Icons.Default.ViewInAr, null) }, text) }
            }
            MainScaffold(
                title = "Titel", navController = nav, bottomNavItems = reiter,
                snackbarHostState = remember { SnackbarHostState() },
                csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                onCsvAbbrechen = {}, serverUrl = "", onTabAngetippt = {},
            ) {
                NavHost(nav, startDestination = Screen.Gallery) { composable<Screen.Gallery> { } }
            }
        }
        ziele.forEach { (_, text) ->
            val sichtbar = compose.onAllNodes(hasText(text), useUnmergedTree = true).fetchSemanticsNodes()
                .filter { it.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null }
            if (sichtbar.isEmpty()) {
                compose.onNode(androidx.compose.ui.test.hasContentDescription(text) and androidx.compose.ui.test.hasClickAction())
                    .fetchSemanticsNode("„$text“ hat weder Beschriftung noch Namen")
            } else sichtbar.forEach { knoten ->
                val stil = layout(knoten).layoutInput.style.fontSize.value
                assertTrue("„$text“ in ${stil * schrift} statt mindestens $normal Punkt", stil * schrift >= normal - 0.01f)
            }
        }
    }

    // Gegenprobe zustand-feste-spalte: Beschriftung bei jeder Schrift in der festen
    // 90-dp-Spalte → rot „Zustandszeile: „Zustand“ steht in 2 Zeilen“.
    @Test
    fun `Zustandszeile bricht bei 200 Prozent kein Wort um`() {
        zeige(schrift = 2f) { Zustandszeile(zustand = "N", onZustand = {}) }
        ganzEineZeile(ctx.getString(R.string.common_condition), "Zustandszeile")
    }

    @Test
    fun `Such-Platzhalter der Galerie steht auf dem Telefon ganz da`() = suchPlatzhalterGanz(1f)

    // Gegenprobe suche-gross-neben-knoepfen: Knöpfe auch bei grosser Schrift neben
    // dem Feld → rot „Such-Platzhalter 200 %: … sichtbar bis 5/7“.
    @Test
    fun `Such-Platzhalter der Galerie steht auch bei 200 Prozent ganz da`() = suchPlatzhalterGanz(2f)

    private fun suchPlatzhalterGanz(schrift: Float) {
        val welt = Beispiele.Welt(KontextTexte())
        try {
            val vm = welt.galerie().also { it.loadSets() }
            val erfassung = welt.t.merke(ErfassungViewModel(welt.t.sitzung, welt.t.filter(), welt.t.hinweise, welt.t.bestand,
                SetsRepository(welt.t.api, welt.t.cache),
                KatalogRepository(welt.t.api, welt.t.cache),
                object : SetAnleger {
                    override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Double?, condition: String?,
                                         ownerUserId: Int?, storage: String?) =
                        kotlinx.coroutines.flow.emptyFlow<SetAnlegenSchritt>()
                }))
            zeige(schrift) {
                GalleryRoute(vm = vm, erfassung = erfassung,
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), onScanBarcode = {}, onSetClick = {})
            }
            val ende = System.nanoTime() + 10_000_000_000L
            while (vm.galleryState.value.let { it.sets.isEmpty() || it.galleryLoading }) {
                check(System.nanoTime() < ende) { "Galerie nach 10 s nicht geladen" }
                org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
                Thread.sleep(10)
            }
            compose.waitForIdle()
            ganzEineZeile(ctx.getString(R.string.gallery_search_placeholder),
                if (schrift == 1f) "Such-Platzhalter" else "Such-Platzhalter 200 %")
        } finally {
            welt.close()
        }
    }

    private fun verlauf(punkte: Int) = PreisDiagrammAnsicht(
        values = listOf(PreisReiheAnsicht("N",
            (1..punkte).map { PreisPunktAnsicht("2026-0$it-01", 700.0 + 10 * it) })))

    /** Zwei Punkte ohne Achse lasen sich wie ein Trend; erst ab drei steht eine Linie da. */
    @Test
    fun `Preisverlauf zeigt unter drei Punkten keine Linie und nennt Tief und Hoch`() {
        val punkte = androidx.compose.runtime.mutableIntStateOf(2)
        zeige {
            androidx.compose.foundation.layout.Column {
                PriceChart(verlauf(punkte.intValue), "CHF")
            }
        }
        val zuWenig = ctx.getString(R.string.price_chart_too_few)
        assertTrue("Preisverlauf mit zwei Punkten sagt, warum kein Diagramm",
            compose.onAllNodes(hasText(zuWenig)).fetchSemanticsNodes().size == 1)
        val tiefHoch = ctx.getString(R.string.price_chart_low_high,
            fmtMoney(710.0, "CHF"), fmtMoney(720.0, "CHF"))
        assertTrue("Preisverlauf nennt Tief und Hoch",
            compose.onAllNodes(hasText(tiefHoch)).fetchSemanticsNodes().size == 1)
        punkte.intValue = 3
        compose.waitForIdle()
        assertTrue("Preisverlauf mit drei Punkten zeigt die Linie",
            compose.onAllNodes(hasText(zuWenig)).fetchSemanticsNodes().isEmpty())
    }

    /** Antworten des Testservers kommen über den Hauptlooper; ihn selbst treiben. */
    private fun warte(name: String, fertig: () -> Boolean) {
        val ende = System.nanoTime() + 10_000_000_000L
        while (!fertig()) {
            check(System.nanoTime() < ende) { "$name nach 10 s nicht geladen" }
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
            Thread.sleep(10)
        }
        compose.waitForIdle()
    }

    /** Listen-Detail wie in der Merkliste: Das Teil steht rechts, die Liste bleibt links stehen. */
    @Test
    fun `Tablet zeigt Teil und Liste nebeneinander`() {
        org.robolectric.RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        val welt = Beispiele.Welt(KontextTexte())
        try {
            welt.pfade.antworten["/api/v1/parts/3001/5/sets"] = """{"success":true,
                "item":{"nummer":"3001","name":"Brick 2 x 4","color_id":5,"color_name":"Red","total_quantity":12},
                "sets":[{"set_number":"75192-1","set_name":"Millennium Falcon","quantity":8,"owner_user_id":1}]}"""
            val vm = welt.teile().also { it.loadParts() }
            val bilder = coil3.ImageLoader.Builder(ctx).build()
            zeige {
                TeileListeUndDetailRoute(vm, bilder, "", rememberNavController()) { _ ->
                    PartsRoute(vm = vm, imageLoader = bilder)
                }
            }
            warte("Teile") { vm.partsState.value.parts.isNotEmpty() }
            val kachel = androidx.compose.ui.test.hasText("Brick 2 x 4", substring = true) and
                androidx.compose.ui.test.hasClickAction()
            compose.onNode(kachel).performClick()
            warte("Teil") { !vm.setItemState.value.laedt }
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
            compose.onNode(kachel and androidx.compose.ui.test.SemanticsMatcher.expectValue(
                androidx.compose.ui.semantics.SemanticsProperties.Selected, true)).fetchSemanticsNode("Kachel nicht markiert")
        } finally {
            welt.close()
        }
    }
}
