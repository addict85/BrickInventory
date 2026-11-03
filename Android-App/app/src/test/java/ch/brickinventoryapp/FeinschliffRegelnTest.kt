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

/**
 * Regeln aus der achten UI-Prüfung, als Verhalten ausgeführt: Navigationsziele stehen
 * bei 200 % in einer Zeile, der Such-Platzhalter der Galerie ist auf dem Telefon nie
 * abgeschnitten.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   reiter-bricht-um          Beschriftung wieder als Text ohne Zeilengrenze → rot „Reiterleiste …“
 *   suche-neben-filtertext    Filterknopf mit Text schon ab 360 dp → rot „Such-Platzhalter …“
 *   verlauf-ab-zwei-punkten   Linie schon ab zwei Punkten → rot „Preisverlauf …“
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
                NavHost(nav, startDestination = Screen.Finance.route) { composable(Screen.Finance.route) { } }
            }
        }
        ziele.forEach { (_, text) -> ganzEineZeile(text, "Reiterleiste") }
    }

    @Test
    fun `Such-Platzhalter der Galerie steht auf dem Telefon ganz da`() {
        val welt = Beispiele.Welt(KontextTexte())
        try {
            val vm = welt.galerie().also { it.loadSets() }
            val erfassung = welt.t.merke(ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel(welt.t.dienste,
                ch.brickinventoryapp.data.repository.SetsRepository(welt.t.api, welt.t.cache),
                ch.brickinventoryapp.data.repository.KatalogRepository(welt.t.api, welt.t.cache),
                object : ch.brickinventoryapp.data.SetAnleger {
                    override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Double?, condition: String?,
                                         ownerUserId: Int?, storage: String?) =
                        kotlinx.coroutines.flow.emptyFlow<ch.brickinventoryapp.data.SetAnlegenSchritt>()
                }))
            zeige {
                ch.brickinventoryapp.ui.screens.GalleryScreen(vm = vm, erfassung = erfassung,
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), onScanBarcode = {}, onSetClick = {})
            }
            val ende = System.nanoTime() + 10_000_000_000L
            while (vm.galleryState.value.let { it.sets.isEmpty() || it.galleryLoading }) {
                check(System.nanoTime() < ende) { "Galerie nach 10 s nicht geladen" }
                org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
                Thread.sleep(10)
            }
            compose.waitForIdle()
            ganzEineZeile(ctx.getString(R.string.gallery_search_placeholder), "Such-Platzhalter")
        } finally {
            welt.close()
        }
    }

    private fun verlauf(punkte: Int) = ch.brickinventoryapp.ui.model.PreisDiagrammAnsicht(
        values = listOf(ch.brickinventoryapp.ui.model.PreisReiheAnsicht("N",
            (1..punkte).map { ch.brickinventoryapp.ui.model.PreisPunktAnsicht("2026-0$it-01", 700.0 + 10 * it) })))

    /** Zwei Punkte ohne Achse lasen sich wie ein Trend; erst ab drei steht eine Linie da. */
    @Test
    fun `Preisverlauf zeigt unter drei Punkten keine Linie und nennt Tief und Hoch`() {
        val punkte = androidx.compose.runtime.mutableIntStateOf(2)
        zeige {
            androidx.compose.foundation.layout.Column {
                ch.brickinventoryapp.ui.screens.PriceChart(verlauf(punkte.intValue), "CHF")
            }
        }
        val zuWenig = ctx.getString(R.string.price_chart_too_few)
        assertTrue("Preisverlauf mit zwei Punkten sagt, warum kein Diagramm",
            compose.onAllNodes(hasText(zuWenig)).fetchSemanticsNodes().size == 1)
        val tiefHoch = ctx.getString(R.string.price_chart_low_high,
            ch.brickinventoryapp.util.fmtMoney(710.0, "CHF"), ch.brickinventoryapp.util.fmtMoney(720.0, "CHF"))
        assertTrue("Preisverlauf nennt Tief und Hoch",
            compose.onAllNodes(hasText(tiefHoch)).fetchSemanticsNodes().size == 1)
        punkte.intValue = 3
        compose.waitForIdle()
        assertTrue("Preisverlauf mit drei Punkten zeigt die Linie",
            compose.onAllNodes(hasText(zuWenig)).fetchSemanticsNodes().isEmpty())
    }
}
