package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.ui.laedt
import android.content.Context
import android.graphics.Color as Farbe
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.ViewRootForTest
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Density
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.shared.ui.ErfassungsFelder
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeDialogZustand
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeResultDialog
import ch.brickinventoryapp.collection.ui.screens.AcquisitionManagementRoute
import ch.brickinventoryapp.collection.ui.screens.AddSetDialog
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.testing.testMinifigsRepository
import ch.brickinventoryapp.testing.testFinancesRepository
import ch.brickinventoryapp.testing.testHouseholdRepository
import ch.brickinventoryapp.testing.testCatalogRepository
import ch.brickinventoryapp.testing.testSetsRepository
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.LagerUiState
import ch.brickinventoryapp.state.ui.viewmodel.KaeufeViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowDialog
import java.util.Locale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.state.ToggleableState
import ch.brickinventoryapp.data.VorwaermNetwork
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.management.ui.ManagementUiState
import ch.brickinventoryapp.management.ui.screens.CacheEvents
import ch.brickinventoryapp.management.ui.screens.MonitoringScreen
import ch.brickinventoryapp.management.ui.screens.MonitoringState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
import kotlinx.coroutines.runBlocking
import ch.brickinventoryapp.ui.components.Prompt
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.ViewInAr
import androidx.compose.material3.Icon
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import ch.brickinventoryapp.app.csv.CsvImportUiState
import ch.brickinventoryapp.app.nav.AppTarget
import ch.brickinventoryapp.app.nav.Reiter
import ch.brickinventoryapp.collection.ui.SammlungZiel
import ch.brickinventoryapp.collection.ui.screens.BarcodeScannerScreen
import kotlinx.coroutines.flow.MutableStateFlow
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.components.ProduktBild
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.remember
import ch.brickinventoryapp.account.ui.screens.PreisalarmeRoute
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.SemanticsMatcher
import ch.brickinventoryapp.parts.ui.PlSet
import ch.brickinventoryapp.parts.ui.TeilelisteUiState
import ch.brickinventoryapp.parts.ui.screens.PartsListScreen
import ch.brickinventoryapp.collection.ui.screens.GalleryAndDetail
import ch.brickinventoryapp.collection.ui.screens.SetDetailRoute
import org.robolectric.RuntimeEnvironment

/**
 * Forms, margins and bars, checked as behavior — phone 411 dp, de-CH: field labels,
 * help lines, distances to the window edge, tablet side by side.
 *
 * Counter-checks (patches under gegenproben/, measured only in CI — Robolectric):
 *   kaufpreise-spaltenkoepfe        column header „Zustand“ again above the rows → red “the purchase prices carry field labels …”
 *   barcode-felder-ohne-hinweis     barcode dialog without help line below the quantity → red “barcode names the number …”
 *   barcode-plakette-vor-nummer     „Schon in deiner Sammlung“ again between name and number
 *                                   → red “barcode names the number …”
 *   preisspeicher-eingerueckt       price cache again with its own page margin → red “background work with a title, …” (indent)
 *   hintergrund-titel-doppelt       card again with the page name → red “background work with a title, …” (twice)
 *   hintergrund-titel-im-inhalt     page name again above the content → red “background work with a title, …”
 *   netze-ohne-schalter             networks without switch role → red “background work with a title, …”
 *   gutscheine-anlegen-oben         „Gutschein hinzufügen“ again above the list → red “creating vouchers floats, balance …” (does not float)
 *   bauliste-zahl-im-text           „(2 Sets)“ again as a second text in the button → red “creating a build list stays on …”
 *   alarm-feld-nennt-richtung       threshold field again labelled „Fällt unter“ → red “price alerts name the direction …”
 *   alarm-feld-schmal               fields also on the phone at most 320 dp wide → red “price alerts name the direction …” (edge)
 *   gutschein-anlegen-ohne-text     button again with text/icon (text taken from the semantics)
 *                                   → red “creating vouchers floats, balance …”
 *   bildflaeche-hell-im-dunkeln     image background white in the dark too → red “in the dark the image lies …”
 *   leiste-ohne-rand                bar again without margin → red “the bar keeps distance to the screen edge at 200 percent …”
 *   scanner-schliessen-rechts       close again at the top right → red “the scanner closes top left …”
 *   dialog-ohne-rand                confirmation and adding without own margin → red “confirmation and adding keep …” (borderless)
 *   sprache-uebersetzt              in German again „Englisch“ → red “the languages are called in …”
 *   portfolio-im-titel              „Wertentwicklung Portfolio“ back → red “the value development is named after …”
 *   galerie-ohne-detailflaeche      next to an open set only the detail → red “on the tablet gallery …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class FormsAndMarginsTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val world = Examples.Welt(ContextTexts())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() {
        Locale.setDefault(vorher)
        world.close()
    }

    private fun text(id: Int, vararg werte: Any): String = if (werte.isEmpty()) ctx.getString(id) else ctx.getString(id, *werte)

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

    /** Drive the main looper until [fertig] holds; the world responds in ticks. */
    private fun wait(name: String, fertig: () -> Boolean) {
        driveUntil(name, requests = { world.paths.requests.size }, bereit = fertig)
        compose.waitForIdle()
    }

    /**
     * Opens [dialog] like a tap with the clock stopped and returns the root of its
     * window: a dialog with a text field otherwise never comes to rest under Robolectric
     * (like ScreenPhotoVariantsTest.showDialog).
     */
    private fun openDialog(dialog: @Composable () -> Unit): SemanticsNode {
        val offen = mutableStateOf(false)
        zeige { if (offen.value) dialog() }
        compose.mainClock.autoAdvance = false
        compose.runOnUiThread {
            offen.value = true
            Snapshot.sendApplyNotifications()
        }
        repeat(5) {
            compose.mainClock.advanceTimeBy(200)
            shadowOf(Looper.getMainLooper()).idle()
        }
        val fenster = ShadowDialog.getLatestDialog().window!!.decorView
        return checkNotNull(composeRoot(fenster)) { "kein Compose im Dialogfenster" }.semanticsOwner.unmergedRootSemanticsNode
    }

    private fun composeRoot(v: View): ViewRootForTest? = when (v) {
        is ViewRootForTest -> v
        is ViewGroup -> (0 until v.childCount).firstNotNullOfOrNull { composeRoot(v.getChildAt(it)) }
        else -> null
    }

    /** All texts below [n] with their position in the window. */
    private fun texts(n: SemanticsNode): List<Pair<String, Rect>> =
        n.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text to n.boundsInRoot } +
            n.children.flatMap { texts(it) }

    private fun situation(texts: List<Pair<String, Rect>>, gesucht: String): Rect =
        texts.firstOrNull { it.first == gesucht }?.second ?: error("„$gesucht“ fehlt in ${texts.map { it.first }}")

    private fun erfassung() = world.t.merke(EntryViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise,
        testSetsRepository(world.t.api), world.t.setCatalog(), world.t.merkliste(), testCatalogRepository(world.t.api),
        object : SetCreator {
            override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Geld?, condition: Zustand?,
                                 ownerUserId: Int?, storage: String?): Flow<SetCreateStep> = emptyFlow()
        }))

    // ── Kaufpreise ──

    @Test
    fun `the purchase prices carry field labels instead of column headers`() {
        val vm = world.t.merke(KaeufeViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise, world.t.changes,
            testHouseholdRepository(world.t.api), world.t.sets(), testFinancesRepository(world.t.api), testPartsRepository(world.t.api),
            testMinifigsRepository(world.t.api)))
        zeige {
            AcquisitionManagementRoute(vm, type = Postenart.SET, id = Examples.SET, title = "Millennium Falcon", onBack = {})
        }
        wait("Kaufpreise") { vm.manDetailState.value.acquisitions.isNotEmpty() }
        val zeilen = vm.manDetailState.value.acquisitions.size
        assertEquals("Anzahl als Beschriftung je Zeile", zeilen,
            compose.onAllNodes(hasSetTextAction() and hasText(text(R.string.common_quantity))).fetchSemanticsNodes().size)
        assertEquals("Kaufpreis als Beschriftung je Zeile", zeilen,
            compose.onAllNodes(hasSetTextAction() and hasText(text(R.string.detail_purchase_price))).fetchSemanticsNodes().size)
        assertEquals("Spaltenkopf „Zustand“ steht noch da", 0,
            compose.onAllNodesWithText(text(R.string.common_condition)).fetchSemanticsNodes().size)
    }

    // ── Erfassen-Formulare ──

    /** What every form says below quantity, price and storage location; the quantity per item. */
    private fun checkHints(name: String, texts: List<String>, countHint: Int) {
        for (hinweis in listOf(text(countHint), text(R.string.common_unit_price_placeholder), text(R.string.detail_storage_ph)))
            assertTrue("$name: Hinweis „$hinweis“ fehlt", hinweis in texts)
    }

    @Test
    fun `adding a set names quantity, price and storage location with a help line`() {
        val root = openDialog { AddSetDialog(onDismiss = {}, onAdd = {}, lagerorte = listOf("Keller"), immediatelyFocus = false) }
        checkHints("Set", texts(root).map { it.first }, R.string.gallery_quantity_hint)
    }

    @Test
    fun `adding parts names quantity, price per piece and storage location with a help line`() {
        zeige {
            Column {
                ErfassungsFelder(anzahl = "1", onCount = {}, countHint = text(R.string.parts_quantity_hint),
                    preis = "", onPrice = {}, zustand = Zustand.NEU, onZustand = {})
            }
        }
        val alle = texts(compose.onRoot(useUnmergedTree = true).fetchSemanticsNode()).map { it.first }
        checkHints("Teil", alle, R.string.parts_quantity_hint)
        assertTrue("Preis je Stück ausgeschrieben", text(R.string.common_unit_price) in alle)
    }

    @Test
    fun `barcode names the number by its name and has the same help lines`() {
        val zustand = BarcodeDialogZustand(AppUiState(), ScopeUiState(),
            BarcodeUiState(result = "75192-1", setName = "Millennium Falcon", ownershipQuantity = 1), LagerUiState())
        val root = openDialog { BarcodeResultDialog(zustand, erfassung(), SampleImages.loader(ctx)) }
        val alle = texts(root)
        checkHints("Barcode", alle.map { it.first }, R.string.gallery_quantity_hint)
        val name = situation(alle, "Millennium Falcon")
        val nummer = situation(alle, "75192-1")
        val badge = situation(alle, text(R.string.barcode_schon_besessen, 1))
        assertTrue("Barcode: Nummer gleich unter dem Namen ($name / $nummer / $badge)",
            name.bottom <= nummer.top && nummer.bottom <= badge.top)
    }

    // ── Hintergrundarbeiten ──

    @Test
    fun `background work with a title, flush cards, own display and switches`() {
        world.paths.antworten["/api/v1/admin/auftraege"] = """{"success":true,
            "auftraege":[{"id":"17","type":"bilder","status":"laeuft","attempts":1,"max_attempts":5,
               "due_at":"2026-10-30T10:00:00Z","deadline_at":null,"started_at":null,"created_at":"2026-10-30T09:59:00Z",
               "updated_at":null,"progress":null,"error_message":null,"user_id":4,"geplant":false,"set_number":"75192-1"}],
            "zusammenfassung":[],"pausen":[],"bildbedarf":0,
            "job_prozess":{"lebenszeichen":null,"alter_sekunden":null,"laeuft":true}}"""
        val vm = MonitoringViewModel(testManagementRepository(world.t.api), testAccountRepository(world.t.api, world.t.io), world.t.meldungen)
        runBlocking { vm.loadBackground() }
        val networks = mapOf(VorwaermNetwork.WLAN to true, VorwaermNetwork.MOBILE to false, VorwaermNetwork.ROAMING to false)
        zeige {
            MonitoringScreen(MonitoringState(MonitoringUiState(), vm.hintergrund.value, ManagementUiState(),
                networks, Design.CLASSIC, 0L), vm, CacheEvents({}, {}, { _, _ -> }, {}, {}, {}, { _, _, _ -> }))
        }
        // The one title stands in the bar (VerwaltungGraph); the content does not repeat it.
        assertEquals("„Hintergrundarbeiten“ unter der Leiste noch einmal", 0,
            compose.onAllNodesWithText(text(R.string.nav_monitoring)).fetchSemanticsNodes().size)
        fun links(id: Int) = compose.onNode(hasText(text(id)), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot.left
        val auftraege = links(R.string.hintergrund_auftraege)
        for (id in listOf(R.string.monitoring_price_cache, R.string.monitoring_darstellung_vorgabe))
            assertEquals("Einzug von „${text(id)}“", auftraege, links(id), 1f)
        for ((netz, an) in listOf(R.string.monitoring_vorwaermen_wlan to ToggleableState.On,
                                  R.string.monitoring_vorwaermen_mobil to ToggleableState.Off)) {
            val node = compose.onNode(hasText(text(netz))).fetchSemanticsNode()
            assertEquals("${text(netz)} ist kein Schalter", Role.Switch, node.config.getOrNull(SemanticsProperties.Role))
            assertEquals("${text(netz)} zeigt nicht, ob an", an, node.config.getOrNull(SemanticsProperties.ToggleableState))
        }
    }

    // ── Gutscheine ──

    @Test
    fun `creating vouchers floats, balance and PDF are in the bar's menu`() {
        zeige { Gutscheine() }
        for (id in listOf(R.string.vouchers_balance_all, R.string.vouchers_export))
            assertEquals("„${text(id)}“ steht ohne Menü da", 0, compose.onAllNodesWithText(text(id)).fetchSemanticsNodes().size)
        val anlegen = compose.onNode(hasText(text(R.string.vouchers_add)) and hasClickAction()).fetchSemanticsNode().boundsInRoot
        val hoehe = ctx.resources.displayMetrics.heightPixels
        assertTrue("Anlegen schwebt nicht unten (${anlegen.bottom} von $hoehe)", anlegen.bottom > hoehe * 0.8f)
        compose.onNodeWithContentDescription(text(R.string.vouchers_menu_cd)).performClick()
        compose.waitForIdle()
        for (id in listOf(R.string.vouchers_balance_all, R.string.vouchers_export))
            compose.onNodeWithText(text(id)).fetchSemanticsNode("„${text(id)}“ fehlt im Menü")
    }

    // ── Tablet with list and detail ──

    /** Gallery and set detail on the tablet (1280 dp); without [offen] the hint stands on the right. */
    private fun galleryAndDetail(offen: String?) {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        val galerie = world.galerie().also { it.loadSets(); it.loadStats() }
        val detail = world.setDetail()
        zeige {
            GalleryAndDetail(galerie, erfassung(), SampleImages.loader(ctx), offen = offen, onSetClick = {}, onScanBarcode = {}) {
                SetDetailRoute(setNumber = Examples.SET, vm = detail, serverUrl = "", imageLoader = SampleImages.loader(ctx),
                    onBack = {}, onDelete = {})
            }
        }
        wait("Galerie und Detail") {
            galerie.galleryState.value.sets.isNotEmpty() &&
                (offen == null || detail.setDetailState.value.let { it.setDetail != null && !it.detailFetch.laedt })
        }
    }

    @Test
    fun `on the tablet gallery and set detail stand side by side at the same time`() {
        galleryAndDetail(Examples.SET)
        val breite = ctx.resources.displayMetrics.widthPixels
        val kachel = compose.onNode(hasText("Titanic", substring = true) and hasClickAction()).fetchSemanticsNode().boundsInRoot
        val wert = compose.onNode(hasText(text(R.string.detail_pnl_tile)), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertTrue("Detail nicht rechts der Liste ($kachel / $wert)", kachel.right <= wert.left)
        assertTrue("Detail ausserhalb des Fensters ($wert / $breite)", wert.right <= breite + 1f && kachel.left >= 0f)
    }

    @Test
    fun `on the tablet without a selected set a hint stands next to the gallery on the right`() {
        galleryAndDetail(null)
        val kachel = compose.onNode(hasText("Titanic", substring = true) and hasClickAction()).fetchSemanticsNode().boundsInRoot
        val hinweis = compose.onNode(hasText(text(R.string.gallery_detail_leer))).fetchSemanticsNode().boundsInRoot
        assertTrue("Hinweis nicht rechts der Liste ($kachel / $hinweis)", kachel.right <= hinweis.left)
    }

    // ── Build list at 200 % ──

    @Test
    fun `creating a build list stays on one line at 200 percent and names the number of sets`() {
        val sets = listOf(PlSet("75192-1", "Millennium Falcon"), PlSet("21318-1", "Baumhaus"))
        zeige(schrift = 2f) { PartsListScreen(TeilelisteUiState(sets = sets), serverUrl = "", imageLoader = SampleImages.loader(ctx), onScanBarcode = {}) }
        val button = compose.onNode(hasText(text(R.string.partslist_generate)) and hasClickAction()).fetchSemanticsNode()
        fun zeilen(n: SemanticsNode): List<Int> {
            val layouts = mutableListOf<TextLayoutResult>()
            n.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(layouts)
            return layouts.map { it.lineCount } + n.children.flatMap { zeilen(it) }
        }
        val unten = compose.onNode(hasText(text(R.string.partslist_generate)), useUnmergedTree = true).fetchSemanticsNode()
        assertTrue("„Bauliste erstellen“ bricht um: ${zeilen(unten)}", zeilen(unten).all { it == 1 })
        val anzahl = ctx.resources.getQuantityString(R.plurals.partslist_generate_anzahl, 2, 2)
        assertTrue("Zahl der Sets fehlt am Knopf",
            compose.onAllNodes(hasContentDescription(anzahl), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
        assertTrue("Zahl steht als zweiter Text im Knopf",
            button.config.getOrNull(SemanticsProperties.Text).orEmpty().none { it.text == anzahl })
    }

    // ── Preisalarme ──

    @Test
    fun `price alerts name the direction once and end at the edge of the card`() {
        world.paths.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[
            {"set_number":"75192-1","condition":"N","direction":"unter","threshold":750.0,"currency_code":"CHF"}]}"""
        val vm = world.t.merke(SettingsViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise, world.t.sync,
            testAccountRepository(world.t.api, world.t.io), testManagementRepository(world.t.api), world.t.alerts(), testPartsRepository(world.t.api),
            object : FileReader {
                override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null
            })).also { it.loadAlarmOverview() }
        zeige {
            PreisalarmeRoute(vm = vm, imageLoader = SampleImages.loader(ctx), serverUrl = "",
                snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onZurueck = {}, reportToggle = {})
        }
        wait("Preisalarme") { vm.alarmOverview.value.geladen && vm.alarmOverview.value.alerts.isNotEmpty() }
        // One choice each in the alert and in the creation form, not once more as a field name.
        assertEquals("„Fällt unter“ doppelt", 2,
            compose.onAllNodes(hasText(text(R.string.detail_alert_chip_below)), useUnmergedTree = true)
                .fetchSemanticsNodes().count { it.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null })
        val vorn = text(R.string.alerts_delete_fuer, "§").substringBefore("§")
        val loeschen = compose.onAllNodes(SemanticsMatcher("Löschen eines Alarms") { n ->
            n.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty().any { it.startsWith(vorn) }
        }).fetchSemanticsNodes().first().boundsInRoot
        val feld = compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().first().boundsInRoot
        // The edge is the end of the 48 dp tap area of the delete button; its visible area
        // (40 dp, centered within) ends 4 dp before.
        val dichte = ctx.resources.displayMetrics.density
        val edge = loeschen.center.x + 24 * dichte
        assertEquals("Feld endet nicht am Rand der Karte (${feld.right} / $edge)", edge, feld.right, dichte)
    }

    // ── dunkle Designs ──

    @Test
    fun `in the dark the image lies on a dark surface`() {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC, dunkel = true) {
                ProduktBild(model = "/beispiel/set1.png", imageLoader = SampleImages.loader(ctx), contentDescription = "Bild",
                    modifier = Modifier.size(300.dp, 100.dp), bildgrund = true)
            }
        }
        compose.waitForIdle()
        val bild = compose.onNodeWithContentDescription("Bild").captureToImage().asAndroidBitmap()
        // Left of the image, which stands centered with „Fit“: only the surface.
        val point = bild.getPixel(2, bild.height / 2)
        val hell = (Farbe.red(point) + Farbe.green(point) + Farbe.blue(point)) / 3
        assertTrue("Bildfläche im Dunkeln hell (Grauwert $hell)", hell < 80)
    }

    // ── Bar at 200 %, scanner ──

    @Test
    fun `the bar keeps distance to the screen edge at 200 percent`() {
        zeige(schrift = 2f) {
            val nav = rememberNavController()
            val tab = remember {
                listOf(Reiter(SammlungZiel.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"),
                    Reiter(AppTarget.Mehr, { Icon(Icons.Default.MoreHoriz, null) }, "Mehr"))
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
        val dichte = ctx.resources.displayMetrics.density
        val breite = ctx.resources.displayMetrics.widthPixels
        val mehr = compose.onNode((hasText("Mehr") or hasContentDescription("Mehr")) and hasClickAction())
            .fetchSemanticsNode().boundsInRoot
        assertTrue("„Mehr“ endet ${(breite - mehr.right) / dichte} dp vor dem Rand", breite - mehr.right >= 6 * dichte)
    }

    @Test
    fun `the scanner closes top left and switches the light via a button`() {
        zeige { BarcodeScannerScreen(onResult = {}, onDismiss = {}, ohneKamera = true) }
        val breite = ctx.resources.displayMetrics.widthPixels
        val zu = compose.onNodeWithContentDescription(text(R.string.scanner_close)).fetchSemanticsNode().boundsInRoot
        assertTrue("Schliessen nicht links (${zu.left} von $breite)", zu.right < breite / 2f)
        compose.onNode(hasText(text(R.string.scanner_torch_on)) and hasClickAction()).fetchSemanticsNode("Licht ist kein Knopf")
    }

    // ── Dialogs with margin ──

    /** The frame of the dialog: the node with its window name. */
    private fun frame(n: SemanticsNode, titel: String): Rect? =
        if (n.config.getOrNull(SemanticsProperties.PaneTitle) == titel) n.boundsInRoot
        else n.children.firstNotNullOfOrNull { frame(it, titel) }

    private fun checkEdge(name: String, root: SemanticsNode, titel: String) {
        val dichte = ctx.resources.displayMetrics.density
        val breite = ctx.resources.displayMetrics.widthPixels
        val r = checkNotNull(frame(root, titel)) { "$name: kein Fenster „$titel“" }
        assertTrue("$name randlos (${r.left / dichte} / ${(breite - r.right) / dichte} dp)",
            r.left >= 23 * dichte && breite - r.right >= 23 * dichte)
    }

    @Test
    fun `confirmation and adding keep distance to the window edge`() {
        val root = openDialog {
            Prompt(titel = "Set löschen?", text = "Millennium Falcon wird entfernt.", bestaetigen = "Löschen",
                onBestaetigen = {}, onAbbrechen = {})
        }
        checkEdge("Rückfrage", root, "Set löschen?")
    }

    @Test
    fun `adding a set keeps distance to the window edge`() {
        val root = openDialog { AddSetDialog(onDismiss = {}, onAdd = {}, immediatelyFocus = false) }
        checkEdge("Set erfassen", root, text(R.string.gallery_add_set_title))
    }

    // ── Sprachauswahl ──

    /** Whoever has set the wrong language finds theirs by its own name. */
    @Test
    fun `the languages are called in both languages what they call themselves`() {
        for (sprache in listOf("de-rCH", "en-rGB")) {
            RuntimeEnvironment.setQualifiers(sprache)
            assertEquals("($sprache)", listOf("English", "Deutsch"),
                listOf(text(R.string.settings_language_en), text(R.string.settings_language_de)))
        }
    }

    // ── Collection instead of portfolio ──

    @Test
    fun `the value development is named after the collection`() {
        for (id in listOf(R.string.chart_portfolio_value, R.string.chart_summary, R.string.chart_summary_no_change))
            assertTrue("„${text(id)}“", "Sammlung" in text(id) && "Portfolio" !in text(id))
    }
}
