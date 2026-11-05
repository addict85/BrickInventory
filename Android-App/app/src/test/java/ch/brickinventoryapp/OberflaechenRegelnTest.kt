package ch.brickinventoryapp

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
import androidx.compose.ui.test.SemanticsNodeInteraction
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
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
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
import ch.brickinventoryapp.ui.screens.MerklisteRoute
import ch.brickinventoryapp.ui.screens.SetCard
import ch.brickinventoryapp.ui.screens.SetDetailRoute
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
 *   grosse-schrift-kachel-row       Prozent wieder neben dem Betrag in einer Row → rot „Kachel …“
 *   grosse-schrift-kaufpreis-daneben Kaufpreis neben der Bezeichnung → rot „Kaufpreis …“
 *   tablet-umschalter-oben          Umschalter auch auf dem Tablet in der App-Leiste → rot „Tablet …“
 *   fehlerhinweis-roher-satz        der Satz der Datenschicht auch bei OFFLINE → rot „Fehlerhinweis …“
 *   merkliste-leer-ohne-knoepfe     Knopf „Set merken“ ohne Beschriftung → rot „leere Merkliste …“
 *   detail-ohne-wertkacheln         Set-Detail ohne Wert-Kacheln → rot „Set-Detail zeigt Marktwert …“
 *   galerie-zwei-knoepfe            Scannen wieder als zweiter schwebender Knopf → rot „Galerie hat einen …“
 *   telefon-kontomenue              Kontosymbol wieder in der App-Leiste → rot „Telefon navigiert ohne …“
 *   teile-raster-fest               Teileraster wieder fest 120 dp → rot „Teile bei 200 Prozent …“
 *   finanzen-einspaltig             Finanzen auch auf dem Tablet einspaltig → rot „Finanzen stehen auf dem Tablet …“
 *   gutschein-pin-klein             PIN-Zeile ohne Mindesthöhe → rot „Gutschein-Knoepfe …“
 *   wertkacheln-immer-drei          Wert-Kacheln immer zu dritt nebeneinander → rot „Wert-Kacheln … 100 Prozent“
 *   bildflaeche-ohne-ersatz         ProduktBild ohne Ersatzbild → rot „Galerie zeigt ohne Bild das Ersatzbild“
 *   leiste-klappt-nicht-ein         TopAppBar ohne scrollBehavior → rot „App-Leiste weicht beim Rollen“
 *   merkliste-zustand-als-chips     Zustandsfilter der Merkliste als Radio-Chips → rot „Merkliste waehlt …“
 *   merkliste-detail-ersetzt-liste  Merkposten-Detail nie neben der Liste → rot „Tablet zeigt Merkliste und Detail …“
 *   detail-mit-zurueckpfeil         Detail neben der Liste mit Zurück-Pfeil statt X → rot „Tablet zeigt Merkliste und Detail …“
 *   gutschein-formular-immer-offen  Formular wieder fest unter der Liste → rot „Gutschein hinzufuegen oeffnet …“
 *   teile-farben-englisch           Farbnamen unübersetzt, Teilenamen ohne Sprache → rot „Teile nennen Farben …“
 *   merkliste-leer-dreifach         leere Merkliste wieder mit Knopf und Suchzeile → rot „leere Merkliste …“
 *   segmente-bei-grosser-schrift    Einfachwahl auch bei 200 % als Segmente → rot „Einfachwahl bricht …“
 *   kachel-hoehe-nach-inhalt        Name ohne zwei feste Zeilen → rot „Kacheln einer Reihe …“
 *   finanzen-kauf-je-stueck         Kauf der Zeile wieder je Stück → rot „Finanzen nennen …“
 *   finanzen-kopf-ohne-basis        Kopfkarte aus allen Positionen statt der Basis → rot „Finanzkopf …“
 *   kachel-quelle-ignoriert         Kachel nennt auch den Kaufpreis „Marktpreis“ → rot „Galeriekachel …“
 *   mehr-ohne-vergleich             Vergleich nicht unter „Mehr“ → rot „Vergleich und Bauliste markieren …“
 *   galerie-kachel-gross            Setkachel auch bei 200 % mit Bild über die Breite → rot „Galerie bei 200 Prozent …“
 *   galerie-erfassen-schwebt        Erfassen auch bei 200 % schwebend → rot „Galerie bei 200 Prozent …“
 *   teile-erfassen-schwebt          Erfassen auch bei 200 % schwebend → rot „Teile bei 200 Prozent …“
 *   teile-kachel-gross              Teilekachel auch bei 200 % mit Bild über die Breite → rot „Teile bei 200 Prozent zeigen …“
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
                    serverUrl = "", imageLoader = bilder, onClick = {},
                    preis = KachelPreis(812.5, 16.1), waehrung = "CHF")
            }
        }
        assertEquals("Prozent", 1, zeilen(compose.onNodeWithText(fmtProzent(16.1), useUnmergedTree = true)))
        assertEquals("Betrag", 1, zeilen(compose.onNodeWithText(fmtMoney(812.5, "CHF"), useUnmergedTree = true)))
    }

    /**
     * Prüft je Betrag: eine Zeile, nichts ausgelassen und nicht breiter als seine
     * Kachel (mit softWrap = false liefe er sonst über den Rand). Kacheln derselben
     * Reihe sind gleich hoch.
     */
    private fun wertKachelnGanz(schrift: Float) {
        val markt = fmtMoney(1712.4, "CHF")
        val kauf = fmtMoney(1500.0, "CHF")
        val pnl = fmtProzent(14.2)
        zeige(schrift) {
            Box(Modifier.width(360.dp).padding(horizontal = 16.dp)) {
                ch.brickinventoryapp.ui.screens.WertKacheln(markt, kauf, 14.2)
            }
        }
        for (betrag in listOf(markt, kauf, pnl)) {
            val ergebnis = mutableListOf<TextLayoutResult>()
            compose.onNodeWithText(betrag, useUnmergedTree = true).fetchSemanticsNode()
                .config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(ergebnis)
            val t = ergebnis.single()
            assertEquals("$betrag in einer Zeile", 1, t.lineCount)
            assertTrue("$betrag ist abgeschnitten (rechts ${t.getLineRight(0)} von ${t.size.width})",
                !t.isLineEllipsized(0) && t.getLineEnd(0, visibleEnd = true) == betrag.length &&
                    t.getLineRight(0) <= t.size.width + 0.5f)
        }
        val kacheln = listOf(R.string.detail_section_market, R.string.detail_purchase_price, R.string.detail_pnl_tile)
            .map { compose.onNodeWithText(ctx.getString(it), substring = true).fetchSemanticsNode().boundsInRoot }
        kacheln.groupBy { it.top }.values.filter { it.size > 1 }.forEach { reihe ->
            assertTrue("Kacheln einer Reihe gleich hoch: ${reihe.map { it.height }}",
                reihe.all { kotlin.math.abs(it.height - reihe[0].height) < 1f })
        }
    }

    @Test
    fun `Wert-Kacheln zeigen vierstellige Betraege auf schmalem Telefon bei 100 Prozent ganz`() = wertKachelnGanz(1f)

    @Test
    fun `Wert-Kacheln zeigen vierstellige Betraege auf schmalem Telefon bei 200 Prozent ganz`() = wertKachelnGanz(2f)

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
                onCsvAbbrechen = {}, serverUrl = "", onTabAngetippt = {},
            ) {
                NavHost(nav, startDestination = Screen.Gallery) { composable<Screen.Gallery> { } }
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
    fun `App-Leiste weicht beim Rollen und kommt beim Zurueckrollen wieder`() {
        zeige {
            val nav = rememberNavController()
            val reiter = remember {
                listOf<Triple<Screen, @Composable () -> Unit, String>>(
                    Triple(Screen.Finance, { Icon(Icons.Default.ViewInAr, null) }, "Finanzen"))
            }
            MainScaffold(
                title = "Finanzen", navController = nav, bottomNavItems = reiter,
                snackbarHostState = remember { SnackbarHostState() },
                csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                onCsvAbbrechen = {}, serverUrl = "", onTabAngetippt = {},
            ) {
                NavHost(nav, startDestination = Screen.Finance) {
                    composable<Screen.Finance> {
                        androidx.compose.foundation.lazy.LazyColumn(Modifier.testTag("liste")) {
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
    fun `Telefon navigiert ohne Schublade und Kontomenue, Mehr sammelt den Rest`() {
        zeige {
            val nav = rememberNavController()
            val reiter = remember {
                listOf<Triple<Screen, @Composable () -> Unit, String>>(
                    Triple(Screen.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"),
                    Triple(Screen.Mehr, { Icon(Icons.Default.ViewInAr, null) }, ctx.getString(R.string.nav_more)))
            }
            MainScaffold(
                title = "Sammlung", navController = nav, bottomNavItems = reiter,
                snackbarHostState = remember { SnackbarHostState() },
                csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                onCsvAbbrechen = {}, serverUrl = "", onTabAngetippt = {},
            ) {
                NavHost(nav, startDestination = Screen.Gallery) {
                    composable<Screen.Gallery> { }
                    composable<Screen.Mehr> { MehrBildschirm(nav::oeffneVonMehr, isAdmin = false, updateVerfuegbar = false, onAbmelden = {}) }
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
                SetDetailRoute(setNumber = Beispiele.SET, vm = vm, serverUrl = "",
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

    /** Eine Galerie mit [bilder]; wartet, bis die Sets da sind. */
    private fun galerieMit(welt: Beispiele.Welt, bilder: coil3.ImageLoader, schrift: Float = 1f) {
        val vm = welt.galerie().also { it.loadSets() }
        val erfassung = welt.t.merke(ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel(welt.t.dienste,
            ch.brickinventoryapp.data.repository.SetsRepository(welt.t.api, welt.t.cache),
            ch.brickinventoryapp.data.repository.KatalogRepository(welt.t.api, welt.t.cache),
            object : ch.brickinventoryapp.data.SetAnleger {
                override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Double?, condition: String?,
                                     ownerUserId: Int?, storage: String?) =
                    kotlinx.coroutines.flow.emptyFlow<ch.brickinventoryapp.data.SetAnlegenSchritt>()
            }))
        zeige(schrift) {
            ch.brickinventoryapp.ui.screens.GalleryRoute(vm = vm, erfassung = erfassung,
                imageLoader = bilder, onScanBarcode = {}, onSetClick = {})
        }
        warte("Galerie") { vm.galleryState.value.sets.isNotEmpty() && !vm.galleryState.value.galleryLoading }
    }

    /**
     * Wie viele der [namen] stehen ganz im Raster? Ungekürzte Lage statt boundsInRoot: Das
     * Raster schneidet eine halb sichtbare Kachel ab, und abgeschnitten läge sie scheinbar drin.
     */
    private fun ganzSichtbar(namen: List<String>): Int {
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
    private fun erfassenNichtUeberListe(beschreibung: String): List<androidx.compose.ui.geometry.Rect> {
        val liste = compose.onNode(androidx.compose.ui.test.hasScrollToNodeAction()).fetchSemanticsNode().boundsInRoot
        val knoepfe = compose.onAllNodesWithContentDescription(beschreibung).fetchSemanticsNodes().map { it.boundsInRoot }
        assertTrue("Erfassen ist da", knoepfe.isNotEmpty())
        return knoepfe.filter { it.bottom > liste.top + 0.5f }
    }

    /**
     * Bei 200 % Schrift ist eine Kachel eine Listenzeile, und Erfassen steht über der Liste:
     * Mit dem Bild über die volle Breite stand ein Set je Bildschirm, und der schwebende
     * Knopf lag auf dem Text der untersten Kachel.
     */
    @Test
    fun `Galerie bei 200 Prozent zeigt mehrere Sets ganz und Erfassen liegt auf keinem`() {
        val welt = Beispiele.Welt(KontextTexte())
        try {
            galerieMit(welt, coil3.ImageLoader.Builder(ctx).build(), schrift = 2f)
            val namen = listOf("Millennium Falcon", "Titanic", "Baumhaus")
            val ganz = ganzSichtbar(namen)
            assertTrue("Nur $ganz Set(s) ganz sichtbar", ganz >= 2)
            val daneben = erfassenNichtUeberListe(ctx.getString(R.string.gallery_add_set))
            assertTrue("Erfassen steht nicht über der Liste: $daneben", daneben.isEmpty())
        } finally {
            welt.close()
        }
    }

    @Test
    fun `Teile bei 200 Prozent zeigen mehrere Teile ganz und Erfassen liegt auf keinem`() {
        val welt = Beispiele.Welt(KontextTexte())
        try {
            val vm = welt.teile().also { it.loadParts() }
            zeige(schrift = 2f) {
                ch.brickinventoryapp.ui.screens.PartsRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build())
            }
            warte("Teile") { vm.partsState.value.parts.isNotEmpty() }
            val namen = vm.partsState.value.parts.mapNotNull { it.partName }
            assertTrue(namen.size >= 3)
            val ganz = ganzSichtbar(namen)
            assertTrue("Nur $ganz Teil(e) ganz sichtbar", ganz >= 2)
            val daneben = erfassenNichtUeberListe(ctx.getString(R.string.parts_add))
            assertTrue("Erfassen steht nicht über der Liste: $daneben", daneben.isEmpty())
        } finally {
            welt.close()
        }
    }

    /**
     * Vergleich und Bauliste erreicht man über „Mehr“: Dort bleibt „Mehr“ gewählt, und der
     * Pfeil oben führt dorthin zurück wie auf den übrigen Mehr-Unterseiten.
     */
    @Test
    fun `Vergleich und Bauliste markieren Mehr und fuehren mit Zurueck dorthin`() {
        val mehr = ctx.getString(R.string.nav_more)
        zeige {
            val nav = rememberNavController()
            val reiter = remember {
                listOf<Triple<Screen, @Composable () -> Unit, String>>(
                    Triple(Screen.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"),
                    Triple(Screen.Mehr, { Icon(Icons.Default.ViewInAr, null) }, mehr))
            }
            MainScaffold(
                title = "Seite", navController = nav, bottomNavItems = reiter,
                snackbarHostState = remember { SnackbarHostState() },
                csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                onCsvAbbrechen = {}, serverUrl = "", onTabAngetippt = {},
            ) {
                NavHost(nav, startDestination = Screen.Gallery) {
                    composable<Screen.Gallery> { }
                    composable<Screen.Mehr> { MehrBildschirm(nav::oeffneVonMehr, isAdmin = false, updateVerfuegbar = false, onAbmelden = {}) }
                    composable<Screen.Comparison> { Text("Vergleichsseite") }
                    composable<Screen.PartsList> { Text("Baulistenseite") }
                }
            }
        }
        val zurueck = ctx.getString(R.string.common_back)
        // Auf einem Reiter selbst kein Zurück: Er ist eine Wurzel.
        compose.onAllNodesWithContentDescription(zurueck).assertCountEquals(0)
        for ((eintrag, inhalt) in listOf(R.string.nav_comparison to "Vergleichsseite", R.string.nav_partslist to "Baulistenseite")) {
            compose.onNode(hasText(mehr) and hasClickAction()).performClick()
            compose.waitForIdle()
            compose.onNodeWithText(ctx.getString(eintrag)).performClick()
            compose.waitForIdle()
            compose.onNodeWithText(inhalt).fetchSemanticsNode()
            compose.onNode(hasText(mehr) and androidx.compose.ui.test.isSelected())
                .fetchSemanticsNode("„Mehr“ ist auf ${ctx.getString(eintrag)} nicht gewählt")
            compose.onNodeWithContentDescription(zurueck).performClick()
            compose.waitForIdle()
            // Zurück auf „Mehr“: dessen Einträge stehen wieder da.
            compose.onNodeWithText(ctx.getString(R.string.vouchers_title)).fetchSemanticsNode()
        }
    }

    private fun ersatzbilder() = compose.onAllNodes(
        androidx.compose.ui.test.hasTestTag(ch.brickinventoryapp.ui.components.BILD_ERSATZ), useUnmergedTree = true)
        .fetchSemanticsNodes().size

    @Test
    fun `Galerie zeigt ohne Bild das Ersatzbild auf jeder Kachel`() {
        val welt = Beispiele.Welt(KontextTexte())
        try {
            // Jede Anfrage scheitert, wie offline oder bei fehlender Vorschau.
            val kaputt = coil3.ImageLoader.Builder(ctx).components {
                add(object : coil3.intercept.Interceptor {
                    override suspend fun intercept(chain: coil3.intercept.Interceptor.Chain) =
                        coil3.request.ErrorResult(null, chain.request, IllegalStateException("kein Bild"))
                })
            }.build()
            galerieMit(welt, kaputt)
            val kacheln = compose.onAllNodes(hasClickAction() and hasText("Millennium Falcon", substring = true))
                .fetchSemanticsNodes().size
            assertTrue("Die erste Kachel ist sichtbar", kacheln >= 1)
            val namen = listOf("Millennium Falcon", "Titanic", "Baumhaus")
            val sichtbar = namen.count { compose.onAllNodesWithText(it, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
            assertEquals("Ersatzbild je sichtbarer Kachel", sichtbar, ersatzbilder())
        } finally {
            welt.close()
        }
    }

    @Test
    fun `Galerie zeigt mit Bild kein Ersatzbild`() {
        val welt = Beispiele.Welt(KontextTexte())
        try {
            galerieMit(welt, Beispielbilder.loader(ctx))
            warte("Bilder") { ersatzbilder() == 0 }
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
                ch.brickinventoryapp.ui.screens.GalleryRoute(vm = vm, erfassung = erfassung,
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
    fun `Teile bei 200 Prozent kuerzen keinen Namen`() {
        val welt = Beispiele.Welt(KontextTexte())
        try {
            val vm = welt.teile().also { it.loadParts() }
            zeige(schrift = 2f) {
                ch.brickinventoryapp.ui.screens.PartsRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build())
            }
            warte("Teile") { vm.partsState.value.parts.isNotEmpty() }
            val namen = vm.partsState.value.parts.mapNotNull { it.partName }
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
            welt.close()
        }
    }

    /**
     * Farben auf Deutsch wie in der Webapp („Trans-Klar“), Teilenamen bleiben englisch,
     * sind aber als Englisch ausgezeichnet, damit TalkBack sie richtig ausspricht.
     */
    @Test
    fun `Teile nennen Farben auf Deutsch und Namen als Englisch`() {
        val welt = Beispiele.Welt(KontextTexte())
        try {
            val vm = welt.teile().also { it.loadParts() }
            zeige { ch.brickinventoryapp.ui.screens.PartsRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
            warte("Teile") { vm.partsState.value.parts.isNotEmpty() }
            compose.onAllNodesWithText("Trans-Klar", useUnmergedTree = true).fetchSemanticsNodes().let {
                assertTrue("Trans-Klar steht da", it.isNotEmpty())
            }
            compose.onAllNodesWithText("Trans-Clear", useUnmergedTree = true).assertCountEquals(0)
            val name = compose.onNodeWithText("Brick 2 x 4", useUnmergedTree = true).fetchSemanticsNode()
                .config[androidx.compose.ui.semantics.SemanticsProperties.Text].single()
            assertTrue("Teilename als Englisch ausgezeichnet: ${name.spanStyles}",
                name.spanStyles.any { it.item.localeList == androidx.compose.ui.text.intl.LocaleList("en") })
        } finally {
            welt.close()
        }
    }

    @Test
    fun `Finanzen stehen auf dem Tablet in zwei Spalten`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        val welt = Beispiele.Welt(KontextTexte())
        try {
            val vm = welt.finanzen().also { it.loadValuation(); it.loadPortfolioHistory("week") }
            zeige { ch.brickinventoryapp.ui.screens.FinanceRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
            warte("Finanzen") { vm.financeState.value.let { it.valuation != null && !it.historyLoading } }
            val verlauf = compose.onNodeWithText(ctx.getString(R.string.chart_portfolio_value), useUnmergedTree = true)
                .fetchSemanticsNode().boundsInRoot
            val falcon = compose.onNodeWithText("Millennium Falcon", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
            assertTrue("Die Zeilen stehen rechts neben dem Verlauf ($verlauf / $falcon)",
                falcon.left > verlauf.right)
        } finally {
            welt.close()
        }
    }

    /**
     * Jeder Gutschein trägt EIN Menü (statt fünf Symbole in unregelmässigen Abständen);
     * Menü und Einträge nennen die Nummer, die PIN-Zeile ist 48 dp hoch.
     */
    @Test
    fun `Gutschein-Knoepfe nennen die Nummer und der PIN hat 48 dp`() {
        zeige { Gutscheine() }
        val nummer = ch.brickinventoryapp.util.inVierergruppen("6061 2345 6789")
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
    fun `Gutschein hinzufuegen oeffnet das Formular erst auf Wunsch`() {
        zeige { Gutscheine() }
        compose.onAllNodesWithText(ctx.getString(R.string.vouchers_number)).assertCountEquals(0)
        compose.onNode(hasText(ctx.getString(R.string.vouchers_add)) and hasClickAction()).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(ctx.getString(R.string.vouchers_number)).fetchSemanticsNode()
    }

    /**
     * Ein Bauteil je Entscheidungstyp: Der Zustand ist eine Einfachwahl und steht als
     * Segmentschaltfläche da (gleich breite, aneinanderstossende Segmente mit der
     * Rolle RadioButton); die Sortierung ist ein Menü hinter einem Symbol.
     */
    @Test
    fun `Merkliste waehlt den Zustand mit Segmenten und sortiert ueber ein Menue`() {
        val welt = Beispiele.Welt(KontextTexte())
        try {
            val vm = welt.merkliste().also { it.ladeMerkliste() }
            zeige { MerklisteRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build(), onScan = {}, onOeffnenEinzeln = { _, _ -> }) }
            warte("Merkliste") { vm.merklisteState.value.merkposten.isNotEmpty() }
            val segmente = listOf(R.string.filter_condition_all, R.string.condition_new, R.string.condition_used).map {
                compose.onNode(hasText(ctx.getString(it)) and
                    androidx.compose.ui.test.SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.Role,
                        androidx.compose.ui.semantics.Role.RadioButton)).fetchSemanticsNode().boundsInRoot
            }
            val dichte = ctx.resources.displayMetrics.density
            segmente.zipWithNext().forEach { (a, b) ->
                assertTrue("Segmente stossen aneinander (${a.right / dichte} / ${b.left / dichte} dp)",
                    kotlin.math.abs(b.left - a.right) <= 2 * dichte && kotlin.math.abs(a.top - b.top) < 1f)
            }
            // Die Sortierung steht nicht als Chip mit ihrem Namen da, sondern hinter dem Symbol.
            val vorgabe = ctx.getString(R.string.gallery_sort_added_desc)
            compose.onAllNodesWithText(vorgabe).assertCountEquals(0)
            compose.onNodeWithContentDescription(ctx.getString(R.string.sort_menu_cd, vorgabe)).performClick()
            compose.waitForIdle()
            compose.onNodeWithText(ctx.getString(R.string.gallery_sort_name)).fetchSemanticsNode()
        } finally {
            welt.close()
        }
    }

    /**
     * List-Detail auf dem Tablet: Der geöffnete Merkposten steht rechts neben der
     * Liste, die Liste bleibt sichtbar, und seine Karte ist als gewählt markiert. Oben
     * im Detail steht Schliessen statt eines Zurück-Pfeils, der eine Seite versprach.
     */
    @Test
    fun `Tablet zeigt Merkliste und Detail nebeneinander`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        val welt = Beispiele.Welt(KontextTexte())
        try {
            val vm = welt.merkliste().also { it.ladeMerkliste() }
            zeige {
                ch.brickinventoryapp.ui.screens.MerklisteRoute(vm = vm,
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), nebeneinander = true,
                    onScan = {}, onOeffnenEinzeln = { _, _ -> error("auf dem Tablet keine eigene Seite") })
            }
            warte("Merkliste") { vm.merklisteState.value.merkposten.isNotEmpty() }
            val karte = compose.onNode(hasText("Titanic", substring = true) and hasClickAction())
            karte.performClick()
            compose.waitForIdle()
            compose.onAllNodesWithContentDescription(ctx.getString(R.string.common_back)).assertCountEquals(0)
            val zurueck = compose.onNodeWithContentDescription(ctx.getString(R.string.detail_close)).fetchSemanticsNode().boundsInRoot
            val liste = compose.onNode(hasText("Lion Knights' Castle", substring = true) and hasClickAction()).fetchSemanticsNode().boundsInRoot
            assertTrue("Das Detail steht rechts der Liste ($liste / $zurueck)", zurueck.left >= liste.right)
            compose.onNode(hasText("Titanic", substring = true) and hasClickAction() and
                androidx.compose.ui.test.SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.Selected, true))
                .fetchSemanticsNode()
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
            zeige { MerklisteRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build(), onScan = {}, onOeffnenEinzeln = { _, _ -> }) }
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
            // Nur diese beiden Wege: kein schwebender Knopf und kein Scan-Symbol darüber.
            compose.onAllNodesWithContentDescription(ctx.getString(R.string.wanted_add_title)).assertCountEquals(0)
            compose.onAllNodesWithContentDescription(ctx.getString(R.string.gallery_scan_barcode)).assertCountEquals(0)
        } finally {
            welt.close()
        }
    }

    /** Text ganz in einer Zeile: weder umgebrochen noch ausgelassen. */
    private fun ganzEineZeile(text: String) {
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
    fun `Einfachwahl bricht bei 200 Prozent kein Wort um`() {
        val zustaende = listOf(R.string.filter_condition_all, R.string.condition_new, R.string.condition_used)
            .map { ctx.getString(it) }
        val zeitraum = listOf(R.string.chart_period_week, R.string.chart_period_month, R.string.chart_period_year,
            R.string.chart_period_max).map { ctx.getString(it) }
        zeige(schrift = 2f) {
            androidx.compose.foundation.layout.Column(Modifier.width(360.dp).padding(horizontal = 16.dp)) {
                ch.brickinventoryapp.ui.components.SegmentWahl(zustaende.map { it to it }, zustaende[0], {})
                ch.brickinventoryapp.ui.components.SegmentWahl(zeitraum.map { it to it }, zeitraum[0], {})
            }
        }
        (zustaende + zeitraum).forEach { ganzEineZeile(it) }
    }

    /**
     * Kacheln einer Reihe sind gleich hoch, auch wenn bei einer Thema, Teilezahl und
     * Preis fehlen und der Name kurz ist.
     */
    @Test
    fun `Kacheln einer Reihe sind gleich hoch`() {
        val bilder = coil3.ImageLoader.Builder(ctx).build()
        val voll = SetAnsicht(setNumber = "10294-1", name = "Titanic mit sehr langem Namen über zwei Zeilen",
            theme = "Icons", pieces = 9090, condition = "N")
        val karg = SetAnsicht(setNumber = "1-1", name = "Box")
        zeige {
            androidx.compose.foundation.layout.Row(Modifier.width(380.dp)) {
                Box(Modifier.weight(1f)) {
                    SetCard(voll, "", bilder, {}, preis = KachelPreis(449.95, 12.5), waehrung = "CHF")
                }
                Box(Modifier.weight(1f)) { SetCard(karg, "", bilder, {}, waehrung = "CHF") }
            }
        }
        val a = compose.onNode(hasText("10294-1") and hasClickAction()).fetchSemanticsNode().boundsInRoot
        val b = compose.onNode(hasText("1-1") and hasClickAction()).fetchSemanticsNode().boundsInRoot
        assertEquals("Kacheln einer Reihe gleich hoch", a.height, b.height, 1f)
    }

    /** Titanic ×2: Marktwert und Kauf beide für zwei Stück, der Gewinn auch als Betrag. */
    @Test
    fun `Finanzen nennen bei zwei Stueck den Kauf gesamt und den Gewinn als Betrag`() {
        val welt = Beispiele.Welt(KontextTexte())
        try {
            val vm = welt.finanzen().also { it.loadValuation() }
            zeige { ch.brickinventoryapp.ui.screens.FinanceRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
            warte("Finanzen") { vm.financeState.value.let { it.valuation != null && !it.valuationLoading } }
            val zeile = ch.brickinventoryapp.ui.setZeilen(vm.financeState.value.valuation!!.sets).map { it.second }
                .first { it.menge > 1 && it.kaufpreis != null && it.wert != null }
            // Selbst gerechnet, nicht aus kaufGesamt/gewinn: Sonst prüfte der Test die Rechnung mit sich selbst.
            val gesamt = java.math.BigDecimal.valueOf(zeile.kaufpreis!!).multiply(java.math.BigDecimal(zeile.menge)).toDouble()
            val kauf = ctx.getString(R.string.finance_purchase_total, fmtMoney(gesamt, "CHF"))
            compose.onNodeWithText(kauf, useUnmergedTree = true).fetchSemanticsNode()
            val gewinn = java.math.BigDecimal.valueOf(zeile.wert!!).subtract(java.math.BigDecimal.valueOf(gesamt)).toDouble()
            compose.onAllNodesWithText(fmtMoney(gewinn, "CHF"), substring = true, useUnmergedTree = true)
                .fetchSemanticsNodes().let { assertTrue("Gewinn als Betrag steht da", it.isNotEmpty()) }
        } finally {
            welt.close()
        }
    }

    private fun stehtDa(text: String, substring: Boolean = false) =
        compose.onAllNodesWithText(text, substring = substring, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()

    /**
     * Die Kopfkarte zeigt Einstand, G/V und Marktwert aus einer Basis, so dass sie
     * aufgehen, und nennt darunter die Position ohne Marktpreis — wie das Web.
     */
    @Test
    fun `Finanzkopf zeigt Einstand plus G und V gleich Marktwert und die Basiszeile`() {
        val welt = Beispiele.Welt(KontextTexte())
        try {
            val vm = welt.finanzen().also { it.loadValuation() }
            zeige { ch.brickinventoryapp.ui.screens.FinanceRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
            warte("Finanzen") { vm.financeState.value.let { it.valuation != null && it.pnl != null && !it.valuationLoading } }
            compose.waitForIdle()
            // Die Zahlen der Beispiele, nicht aus finanzKopf: Sonst prüfte der Test die Rechnung mit sich selbst.
            val einstand = java.math.BigDecimal("1500.00")
            val guv = java.math.BigDecimal("212.40")
            val wert = java.math.BigDecimal("1712.40")
            assertEquals(0, einstand.add(guv).compareTo(wert))
            val einstandText = ctx.getString(R.string.finance_einstand_zeile, fmtMoney(einstand.toDouble(), "CHF"))
            assertTrue(einstandText, stehtDa(einstandText))
            val guvText = ctx.getString(R.string.finance_guv_zeile, "+" + fmtMoney(guv.toDouble(), "CHF"))
            assertTrue(guvText, stehtDa(guvText))
            assertTrue("Marktwert", stehtDa(fmtMoney(wert.toDouble(), "CHF")))
            // Der Einstand ALLER Positionen (mit dem Baumhaus) stünde neben einem Marktwert ohne es.
            val alle = ctx.getString(R.string.finance_einstand_zeile, fmtMoney(1680.0, "CHF"))
            assertTrue("kein Einstand aller Positionen", !stehtDa(alle))
            val gerechnet = ctx.resources.getQuantityString(R.plurals.finance_basis_gerechnet, 3, 2, 3)
            val ohne = ctx.resources.getQuantityString(R.plurals.finance_basis_ohne_markt, 1, 1, fmtMoney(180.0, "CHF"))
            assertTrue(gerechnet, stehtDa(gerechnet, substring = true))
            assertTrue(ohne, stehtDa(ohne, substring = true))
        } finally {
            welt.close()
        }
    }

    /** Ohne Marktpreis liefert der Server den Kaufpreis (kachel_quelle "kauf"); die Kachel sagt es. */
    @Test
    fun `Galeriekachel nennt den Kaufpreis als Kaufpreis`() {
        val bilder = coil3.ImageLoader.Builder(ctx).build()
        val markt = ctx.getString(R.string.gallery_card_market)
        val kauf = ctx.getString(R.string.gallery_card_paid)
        zeige {
            androidx.compose.foundation.layout.Row(Modifier.width(380.dp)) {
                Box(Modifier.weight(1f)) {
                    SetCard(SetAnsicht(setNumber = "21318-1", name = "Baumhaus"), "", bilder, {},
                        preis = KachelPreis(180.0, null, "kauf"), waehrung = "CHF")
                }
                // Ältere Server ohne kachel_quelle lieferten nur Marktpreise.
                Box(Modifier.weight(1f)) {
                    SetCard(SetAnsicht(setNumber = "75192-1", name = "Millennium Falcon"), "", bilder, {},
                        preis = KachelPreis(812.5, 16.1), waehrung = "CHF")
                }
            }
        }
        compose.onAllNodesWithText(kauf, useUnmergedTree = true).assertCountEquals(1)
        compose.onAllNodesWithText(markt, useUnmergedTree = true).assertCountEquals(1)
        assertTrue(stehtDa(fmtMoney(180.0, "CHF")))
    }
}
