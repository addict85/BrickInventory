package ch.brickinventoryapp

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.ui.CsvImportUiState
import ch.brickinventoryapp.ui.Fehlerklasse
import ch.brickinventoryapp.ui.KachelPreis
import ch.brickinventoryapp.ui.Screen
import ch.brickinventoryapp.ui.components.FehlerHinweis
import ch.brickinventoryapp.ui.model.KaufAnsicht
import ch.brickinventoryapp.ui.model.SetAnsicht
import ch.brickinventoryapp.ui.screens.AcquisitionSummarySection
import ch.brickinventoryapp.ui.screens.MerklisteScreen
import ch.brickinventoryapp.ui.screens.SetCard
import ch.brickinventoryapp.ui.screens.SetDetailScreen
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.util.fmtMoney
import ch.brickinventoryapp.util.fmtProzent
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
import ch.brickinventoryapp.ressourcen.R

/**
 * Was die Bildschirmfotos zeigen, hier als Regel ausgeführt: Bei 200 % Schrift bricht
 * kein Betrag und keine Prozentzahl um, der Kaufpreis steht unter seiner Bezeichnung,
 * auf dem Tablet liegt der Umschalter rechts der Seitenleiste, ein Ladefehler nennt
 * seine Klasse, und die leere Merkliste bietet beide Wege zum ersten Eintrag.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   grosse-schrift-kachel-row       Prozent in der Kachel wieder in einer Row → rot „Kachel …“
 *   grosse-schrift-kaufpreis-daneben Kaufpreis neben der Bezeichnung → rot „Kaufpreis …“
 *   tablet-umschalter-oben          Umschalter auch auf dem Tablet in der App-Leiste → rot „Tablet …“
 *   fehlerhinweis-roher-satz        der Satz der Datenschicht auch bei OFFLINE → rot „Fehlerhinweis …“
 *   merkliste-leer-ohne-knoepfe     leere Merkliste ohne Knöpfe → rot „leere Merkliste …“
 *   detail-ohne-wertkacheln         Set-Detail ohne Wert-Kacheln → rot „Set-Detail zeigt Marktwert …“
 *   galerie-zwei-knoepfe            Scannen wieder als zweiter schwebender Knopf → rot „Galerie hat einen …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class OberflaechenRegelnTest {

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

    private fun zeilen(knoten: SemanticsNodeInteraction): Int {
        val ergebnis = mutableListOf<TextLayoutResult>()
        knoten.fetchSemanticsNode().config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(ergebnis)
        return ergebnis.single().lineCount
    }

    @Test
    fun `Kachel bei 200 Prozent bricht weder Betrag noch Prozent um`() {
        val bilder = coil3.ImageLoader.Builder(ctx).build()
        zeige(schrift = 2f) {
            Box(Modifier.width(188.dp)) {
                SetCard(SetAnsicht(setNumber = "75192-1", name = "Millennium Falcon", theme = "Star Wars"),
                    serverUrl = "", imageLoader = bilder, onClick = {}, onDelete = {},
                    preis = KachelPreis(812.5, 16.1), waehrung = "CHF")
            }
        }
        assertEquals("Prozent", 1, zeilen(compose.onNodeWithText(fmtProzent(16.1), useUnmergedTree = true)))
        assertEquals("Betrag", 1, zeilen(compose.onNodeWithText(fmtMoney(812.5, "CHF"), useUnmergedTree = true)))
    }

    @Test
    fun `Kaufpreis bei 200 Prozent steht unter der Bezeichnung in einer Zeile`() {
        zeige(schrift = 2f) {
            Box(Modifier.width(360.dp)) {
                AcquisitionSummarySection(listOf(KaufAnsicht(id = 1, quantity = 1, purchasePrice = 700.0)), "CHF") {}
            }
        }
        val betrag = compose.onNodeWithText(fmtMoney(700.0, "CHF"), useUnmergedTree = true)
        assertEquals(1, zeilen(betrag))
        val bezeichnung = compose.onNodeWithText(ctx.getString(R.string.detail_purchase_price)).fetchSemanticsNode().boundsInRoot
        assertTrue("Der Betrag steht unter der Bezeichnung", betrag.fetchSemanticsNode().boundsInRoot.top >= bezeichnung.bottom)
    }

    @Test
    fun `Tablet hat den Umschalter rechts der Seitenleiste`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        zeige {
            val nav = rememberNavController()
            val reiter = remember {
                listOf<Triple<Screen, @Composable () -> Unit, String>>(
                    Triple(Screen.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"))
            }
            MainScaffold(
                title = "Sammlung", navController = nav, bottomNavItems = reiter,
                snackbarHostState = remember { SnackbarHostState() },
                csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                onCsvAbbrechen = {}, onLogout = {}, serverUrl = "", onTabAngetippt = {},
            ) {
                NavHost(nav, startDestination = Screen.Gallery.route) { composable(Screen.Gallery.route) { } }
            }
        }
        val teile = ctx.getString(R.string.nav_parts)
        compose.onAllNodesWithText(teile).assertCountEquals(1)
        val leiste = compose.onAllNodesWithText("Sammlung")
        // Der Reiter in der Seitenleiste ist der linke der beiden (der andere ist der Titel).
        val reiterRechts = (0 until 2).map { leiste[it].fetchSemanticsNode().boundsInRoot }.minBy { it.left }.right
        assertTrue("Der Umschalter beginnt rechts der Seitenleiste",
            compose.onNodeWithText(teile).fetchSemanticsNode().boundsInRoot.left >= reiterRechts)
    }

    @Test
    fun `Fehlerhinweis nennt die Klasse und den Satz nur wo er mehr sagt`() {
        zeige { FehlerHinweis("Serverfehler (500)", {}, Fehlerklasse.OFFLINE) }
        compose.onNodeWithText(ctx.getString(R.string.fehler_offline_titel)).fetchSemanticsNode()
        compose.onAllNodesWithText("Serverfehler (500)").assertCountEquals(0)
    }

    @Test
    fun `Fehlerhinweis eines Serverfehlers zeigt den Code`() {
        zeige { FehlerHinweis("Serverfehler (500)", {}, Fehlerklasse.SERVER) }
        compose.onNodeWithText(ctx.getString(R.string.fehler_server_titel)).fetchSemanticsNode()
        compose.onNodeWithText("Serverfehler (500)").fetchSemanticsNode()
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

    @Test
    fun `Set-Detail zeigt Marktwert, Kaufpreis und G&V oben im klassischen Design`() {
        val welt = Beispiele.Welt(KontextTexte())
        try {
            val vm = welt.setDetail().also { it.ladeAlles() }
            zeige {
                SetDetailScreen(setNumber = Beispiele.SET, vm = vm, serverUrl = "",
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), onBack = {}, onDelete = {})
            }
            warte("Set-Detail") { vm.setDetailState.value.let { it.setPrice != null && it.priceHistory != null && !it.setPriceLoading } }
            compose.onNodeWithText(ctx.getString(R.string.detail_pnl_tile), useUnmergedTree = true).assertIsDisplayed()
            compose.onNodeWithText(fmtProzent(16.1), useUnmergedTree = true).assertIsDisplayed()
            compose.onAllNodesWithText(fmtMoney(812.5, "CHF"), useUnmergedTree = true)[0].assertIsDisplayed()
        } finally {
            welt.close()
        }
    }

    @Test
    fun `Galerie hat einen schwebenden Knopf und Scannen neben der Suche`() {
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
            warte("Galerie") { vm.galleryState.value.sets.isNotEmpty() && !vm.galleryState.value.galleryLoading }
            val scan = compose.onAllNodesWithContentDescription(ctx.getString(R.string.gallery_scan_barcode))
            scan.assertCountEquals(1)
            compose.onAllNodesWithContentDescription(ctx.getString(R.string.gallery_add_set)).assertCountEquals(1)
            val suche = compose.onNode(androidx.compose.ui.test.hasSetTextAction())
                .fetchSemanticsNode().boundsInRoot
            val knopf = scan[0].fetchSemanticsNode().boundsInRoot
            assertTrue("Scannen steht in der Zeile der Suche", knopf.top < suche.bottom && knopf.bottom > suche.top)
        } finally {
            welt.close()
        }
    }

    @Test
    fun `leere Merkliste bietet Merken und Scannen`() {
        val welt = Beispiele.Welt(KontextTexte())
        try {
            welt.pfade.antworten["/api/v1/wanted"] = """{"success":true,"merkposten":[]}"""
            val vm = welt.merkliste().also { it.ladeMerkliste() }
            zeige { MerklisteScreen(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build(), onScan = {}, onOeffnen = { _, _ -> }) }
            // Die Antwort kommt über den Hauptlooper; ihn selbst treiben wie BildschirmFotoTest.
            val ende = System.nanoTime() + 10_000_000_000L
            while (welt.pfade.anfragen.none { "/api/v1/wanted" in it } || vm.merklisteState.value.laedt) {
                check(System.nanoTime() < ende) { "Merkliste nach 10 s nicht geladen" }
                org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
                Thread.sleep(10)
            }
            compose.waitForIdle()
            compose.onNodeWithText(ctx.getString(R.string.wanted_add_first)).fetchSemanticsNode()
            compose.onNodeWithText(ctx.getString(R.string.gallery_scan_barcode)).fetchSemanticsNode()
        } finally {
            welt.close()
        }
    }
}
