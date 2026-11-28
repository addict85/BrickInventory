package ch.brickinventoryapp.app

import android.content.Context
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.ViewInAr
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.ViewRootForTest
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.lifecycle.SavedStateHandle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.account.ui.screens.PriceAlarmsRoute
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.app.nav.AppTarget
import ch.brickinventoryapp.app.nav.Tab
import ch.brickinventoryapp.app.testing.Examples
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.collection.ui.CollectionTarget
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeDialogState
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeResultDialog
import ch.brickinventoryapp.collection.ui.screens.AcquisitionManagementRoute
import ch.brickinventoryapp.collection.ui.screens.AddSetDialog
import ch.brickinventoryapp.collection.ui.screens.BarcodeScannerScreen
import ch.brickinventoryapp.collection.ui.screens.GalleryAndDetail
import ch.brickinventoryapp.collection.ui.screens.SetDetailRoute
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testCatalogRepository
import ch.brickinventoryapp.data.testing.testFinancesRepository
import ch.brickinventoryapp.data.testing.testHouseholdRepository
import ch.brickinventoryapp.data.testing.testManagementRepository
import ch.brickinventoryapp.data.testing.testMinifigsRepository
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.data.testing.testSetsRepository
import ch.brickinventoryapp.dataapi.collection.SetCreateStep
import ch.brickinventoryapp.dataapi.collection.SetCreator
import ch.brickinventoryapp.dataapi.device.PrewarmNetwork
import ch.brickinventoryapp.management.ui.ManagementUiState
import ch.brickinventoryapp.management.ui.screens.CacheEvents
import ch.brickinventoryapp.management.ui.screens.MonitoringScreen
import ch.brickinventoryapp.management.ui.screens.MonitoringState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.network.util.NetworkAddressRules
import ch.brickinventoryapp.parts.ui.PartListUiState
import ch.brickinventoryapp.parts.ui.PlSet
import ch.brickinventoryapp.parts.ui.screens.PartsListScreen
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.shared.ui.EntryFields
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.state.ui.viewmodel.PurchasesViewModel
import ch.brickinventoryapp.ui.components.LocalAddressRules
import ch.brickinventoryapp.ui.components.ProductImage
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.uistate.loading
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowDialog
import java.util.Locale
import android.graphics.Color as Color

/**
 * Forms, margins and bars, checked as behavior — phone 411 dp, de-CH: field labels,
 * help lines, distances to the window edge, tablet side by side.
 *
 * Counter-checks (patches under counter-checks/, measured only in CI — Robolectric):
 *   purchase-prices-column-headers        column header „Zustand“ again above the rows → red “the purchase prices carry field labels …”
 *   capture-quantity-without-help-line  quantity field help line only on error → red “adding parts names …”
 *   barcode-badge-before-number     „Schon in deiner Sammlung“ again between name and number
 *                                   → red “barcode names the number …”
 *   price-store-indented       price cache again with its own page margin → red “background work with a title, …” (indent)
 *   background-title-twice       card again with the page name → red “background work with a title, …” (twice)
 *   background-title-in-content     page name again above the content → red “background work with a title, …”
 *   networks-without-switch             networks without switch role → red “background work with a title, …”
 *   vouchers-create-on-top         „Gutschein hinzufügen“ again above the list → red “creating vouchers floats, balance …” (does not float)
 *   build-list-number-in-text           „(2 Sets)“ again as a second text in the button → red “creating a build list stays on …”
 *   alarm-field-names-direction       threshold field again labelled „Fällt unter“ → red “price alerts name the direction …”
 *   alarm-field-narrow               fields also on the phone at most 320 dp wide → red “price alerts name the direction …” (edge)
 *   voucher-create-without-text     button again with text/icon (text taken from the semantics)
 *                                   → red “creating vouchers floats, balance …”
 *   image-surface-light-in-dark     image background white in the dark too → red “in the dark the image lies …”
 *   bar-without-border                bar again without margin → red “the bar keeps distance to the screen edge at 200 percent …”
 *   scanner-close-on-right       close again at the top right → red “the scanner closes top left …”
 *   dialog-without-border                confirmation and adding without own margin → red “confirmation and adding keep …” (borderless)
 *   language-translated              in German again „Englisch“ → red “the languages are called in …”
 *   portfolio-in-title              „Wertentwicklung Portfolio“ back → red “the value development is named after …”
 *   gallery-without-detail-pane      next to an open set only the detail → red “on the tablet gallery …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class FormsAndMarginsTest {

    @get:Rule
    val compose = createComposeRule()

    private val before = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val world = Examples.World(ContextTexts())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun tearDown() {
        Locale.setDefault(before)
        world.close()
    }

    private fun text(id: Int, vararg values: Any): String = if (values.isEmpty()) ctx.getString(id) else ctx.getString(id, *values)

    private fun show(font: Float = 1f, content: @Composable () -> Unit) {
        compose.setContent { CompositionLocalProvider(LocalAddressRules provides NetworkAddressRules) {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                val d = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(d.density, font)) {
                    Surface(color = MaterialTheme.colorScheme.background) { content() }
                }
            }
         } }
        compose.waitForIdle()
    }

    /** Drive the main looper until [done] holds; the world responds in ticks. */
    private fun wait(name: String, done: () -> Boolean) {
        driveUntil(name, requests = { world.paths.requests.size }, ready = done)
        compose.waitForIdle()
    }

    /**
     * Opens [dialog] like a tap with the clock stopped and returns the root of its
     * window: a dialog with a text field otherwise never comes to rest under Robolectric
     * (like ScreenPhotoVariantsTest.showDialog).
     */
    private fun openDialog(dialog: @Composable () -> Unit): SemanticsNode {
        val open = mutableStateOf(false)
        show { if (open.value) dialog() }
        compose.mainClock.autoAdvance = false
        compose.runOnUiThread {
            open.value = true
            Snapshot.sendApplyNotifications()
        }
        repeat(5) {
            compose.mainClock.advanceTimeBy(200)
            shadowOf(Looper.getMainLooper()).idle()
        }
        val window = ShadowDialog.getLatestDialog().window!!.decorView
        return checkNotNull(composeRoot(window)) { "no Compose in the dialog window" }.semanticsOwner.unmergedRootSemanticsNode
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

    private fun situation(texts: List<Pair<String, Rect>>, searched: String): Rect =
        texts.firstOrNull { it.first == searched }?.second ?: error("“$searched” missing in ${texts.map { it.first }}")

    private fun entryVm() = world.t.track(EntryViewModel(world.t.session, world.t.filter(), world.t.hints,
        testSetsRepository(world.t.api), world.t.setCatalog(), world.t.wantedList(), testCatalogRepository(world.t.api),
        object : SetCreator {
            override fun create(setNumber: String, quantity: Int, purchasePrice: Money?, condition: Condition?,
                                 ownerUserId: Int?, storage: String?): Flow<SetCreateStep> = emptyFlow()
        }, SavedStateHandle()))

    // ── Kaufpreise ──

    @Test
    fun `the purchase prices carry field labels instead of column headers`() {
        val vm = world.t.track(PurchasesViewModel(world.t.session, world.t.filter(), world.t.hints, world.t.changes,
            testHouseholdRepository(world.t.api), world.t.sets(), testFinancesRepository(world.t.api), testPartsRepository(world.t.api),
            testMinifigsRepository(world.t.api)))
        show {
            AcquisitionManagementRoute(vm, type = ItemKind.SET, id = Examples.SET, title = "Millennium Falcon", onBack = {})
        }
        wait("purchase prices") { vm.manDetailState.value.acquisitions.isNotEmpty() }
        val rows = vm.manDetailState.value.acquisitions.size
        assertEquals("quantity as a label per row", rows,
            compose.onAllNodes(hasSetTextAction() and hasText(text(R.string.common_quantity))).fetchSemanticsNodes().size)
        assertEquals("purchase price as a label per row", rows,
            compose.onAllNodes(hasSetTextAction() and hasText(text(R.string.detail_purchase_price))).fetchSemanticsNodes().size)
        assertEquals("the column header “Zustand” is still shown", 0,
            compose.onAllNodesWithText(text(R.string.common_condition)).fetchSemanticsNodes().size)
    }

    // ── Erfassen-Formulare ──

    /**
     * What every form says below price and storage location, and below a typed quantity what
     * is counted; sets count with the stepper ([countHint] null) and need no such line.
     */
    private fun checkHints(name: String, texts: List<String>, countHint: Int?) {
        for (hint in listOfNotNull(countHint?.let { text(it) }, text(R.string.common_unit_price_placeholder), text(R.string.detail_storage_ph)))
            assertTrue("$name: hint “$hint” missing", hint in texts)
    }

    @Test
    fun `adding a set names quantity, price and storage location with a help line`() {
        val root = openDialog { AddSetDialog(onDismiss = {}, onAdd = {}, storageLocations = listOf("Keller"), immediatelyFocus = false) }
        checkHints("Set", texts(root).map { it.first }, null)
    }

    @Test
    fun `adding parts names quantity, price per piece and storage location with a help line`() {
        show {
            Column {
                EntryFields(count = "1", onCount = {}, countHint = text(R.string.parts_quantity_hint),
                    price = "", onPrice = {}, condition = Condition.NEW, onUiState = {})
            }
        }
        val all = texts(compose.onRoot(useUnmergedTree = true).fetchSemanticsNode()).map { it.first }
        checkHints("Teil", all, R.string.parts_quantity_hint)
        assertTrue("price per piece spelled out", text(R.string.common_unit_price) in all)
    }

    @Test
    fun `barcode names the number by its name and has the same help lines`() {
        val condition = BarcodeDialogState(AppUiState(), ScopeUiState(),
            BarcodeUiState(result = "75192-1", setName = "Millennium Falcon", ownershipQuantity = 1), StorageUiState())
        val root = openDialog { BarcodeResultDialog(condition, entryVm(), SampleImages.loader(ctx)) }
        val all = texts(root)
        checkHints("Barcode", all.map { it.first }, null)
        val name = situation(all, "Millennium Falcon")
        val number = situation(all, "75192-1")
        val badge = situation(all, text(R.string.barcode_already_owned, 1))
        assertTrue("barcode: number right below the name ($name / $number / $badge)",
            name.bottom <= number.top && number.bottom <= badge.top)
    }

    // ── Hintergrundarbeiten ──

    @Test
    fun `background work with a title, flush cards, own display and switches`() {
        world.paths.responses["/api/v2/admin/job-queue"] = """{"success":true,
            "jobs":[{"id":"17","type":"images","status":"running","attempts":1,"max_attempts":5,
               "due_at":"2026-10-30T10:00:00Z","deadline_at":null,"started_at":null,"created_at":"2026-10-30T09:59:00Z",
               "updated_at":null,"progress":null,"error_message":null,"user_id":4,"scheduled":false,"set_number":"75192-1"}],
            "summary":[],"pauses":[],"image_demand":0,
            "job_process":{"heartbeat":null,"age_seconds":null,"running":true}}"""
        val vm = MonitoringViewModel(testManagementRepository(world.t.api), testAccountRepository(world.t.api, world.t.io), world.t.messages, SavedStateHandle())
        runBlocking { vm.loadBackground() }
        val networks = mapOf(PrewarmNetwork.WIFI to true, PrewarmNetwork.MOBILE to false, PrewarmNetwork.ROAMING to false)
        val background = vm.background.value
        show {
            MonitoringScreen(MonitoringState(MonitoringUiState(), background, ManagementUiState(),
                networks, Design.CLASSIC, 0L), vm, CacheEvents({}, {}, { _, _ -> }, {}, {}, {}, { _, _, _ -> }))
        }
        // The one title stands in the bar (VerwaltungGraph); the content does not repeat it.
        assertEquals("“Hintergrundarbeiten” once more below the bar", 0,
            compose.onAllNodesWithText(text(R.string.nav_monitoring)).fetchSemanticsNodes().size)
        fun links(id: Int) = compose.onNode(hasText(text(id)), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot.left
        val jobs = links(R.string.background_jobs)
        for (id in listOf(R.string.monitoring_price_cache, R.string.monitoring_appearance_default))
            assertEquals("Einzug von „${text(id)}“", jobs, links(id), 1f)
        for ((network, an) in listOf(R.string.monitoring_prewarm_wifi to ToggleableState.On,
                                  R.string.monitoring_prewarm_mobile to ToggleableState.Off)) {
            val node = compose.onNode(hasText(text(network))).fetchSemanticsNode()
            assertEquals("${text(network)} is not a switch", Role.Switch, node.config.getOrNull(SemanticsProperties.Role))
            assertEquals("${text(network)} does not show whether it is on", an, node.config.getOrNull(SemanticsProperties.ToggleableState))
        }
    }

    // ── Gutscheine ──

    @Test
    fun `creating vouchers floats, balance and PDF are in the bar's menu`() {
        show { Vouchers() }
        for (id in listOf(R.string.vouchers_balance_all, R.string.vouchers_export))
            assertEquals("“${text(id)}” stands without a menu", 0, compose.onAllNodesWithText(text(id)).fetchSemanticsNodes().size)
        val create = compose.onNode(hasText(text(R.string.vouchers_add)) and hasClickAction()).fetchSemanticsNode().boundsInRoot
        val height = ctx.resources.displayMetrics.heightPixels
        assertTrue("create does not float at the bottom (${create.bottom} of $height)", create.bottom > height * 0.8f)
        compose.onNodeWithContentDescription(text(R.string.vouchers_menu_cd)).performClick()
        compose.waitForIdle()
        for (id in listOf(R.string.vouchers_balance_all, R.string.vouchers_export))
            compose.onNodeWithText(text(id)).fetchSemanticsNode("„${text(id)}“ fehlt im Menü")
    }

    // ── Tablet with list and detail ──

    /** Gallery and set detail on the tablet (1280 dp); without [open] the hint stands on the right. */
    private fun galleryAndDetail(open: String?) {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        val gallery = world.gallery().also { it.loadSets(); it.loadStats() }
        val detail = world.setDetail()
        show {
            GalleryAndDetail(gallery, entryVm(), SampleImages.loader(ctx), open = open, onSetClick = {}, onScanBarcode = {}) {
                SetDetailRoute(setNumber = Examples.SET, vm = detail, serverUrl = "", imageLoader = SampleImages.loader(ctx),
                    onBack = {}, onDelete = {})
            }
        }
        wait("gallery and detail") {
            gallery.galleryState.value.sets.isNotEmpty() &&
                (open == null || detail.setDetailState.value.let { it.setDetail != null && !it.detailFetch.loading })
        }
    }

    @Test
    fun `on the tablet gallery and set detail stand side by side at the same time`() {
        galleryAndDetail(Examples.SET)
        val width = ctx.resources.displayMetrics.widthPixels
        val tile = compose.onNode(hasText("Titanic", substring = true) and hasClickAction()).fetchSemanticsNode().boundsInRoot
        val value = compose.onNode(hasText(text(R.string.detail_pnl_tile)), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertTrue("detail not right of the list ($tile / $value)", tile.right <= value.left)
        assertTrue("detail outside the window ($value / $width)", value.right <= width + 1f && tile.left >= 0f)
    }

    @Test
    fun `on the tablet without a selected set a hint stands next to the gallery on the right`() {
        galleryAndDetail(null)
        val tile = compose.onNode(hasText("Titanic", substring = true) and hasClickAction()).fetchSemanticsNode().boundsInRoot
        val hint = compose.onNode(hasText(text(R.string.gallery_detail_empty))).fetchSemanticsNode().boundsInRoot
        assertTrue("hint not right of the list ($tile / $hint)", tile.right <= hint.left)
    }

    // ── Build list at 200 % ──

    @Test
    fun `creating a build list stays on one line at 200 percent and names the number of sets`() {
        val sets = listOf(PlSet("75192-1", "Millennium Falcon"), PlSet("21318-1", "Baumhaus"))
        show(font = 2f) { PartsListScreen(PartListUiState(sets = sets), serverUrl = "", imageLoader = SampleImages.loader(ctx), onScanBarcode = {}) }
        val button = compose.onNode(hasText(text(R.string.partslist_generate)) and hasClickAction()).fetchSemanticsNode()
        fun rows(n: SemanticsNode): List<Int> {
            val layouts = mutableListOf<TextLayoutResult>()
            n.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(layouts)
            return layouts.map { it.lineCount } + n.children.flatMap { rows(it) }
        }
        val bottom = compose.onNode(hasText(text(R.string.partslist_generate)), useUnmergedTree = true).fetchSemanticsNode()
        assertTrue("“Bauliste erstellen” wraps: ${rows(bottom)}", rows(bottom).all { it == 1 })
        val count = ctx.resources.getQuantityString(R.plurals.partslist_generate_count, 2, 2)
        assertTrue("the number of sets is missing on the button",
            compose.onAllNodes(hasContentDescription(count), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
        assertTrue("the number stands as a second text in the button",
            button.config.getOrNull(SemanticsProperties.Text).orEmpty().none { it.text == count })
    }

    // ── Preisalarme ──

    @Test
    fun `price alerts name the direction once and end at the edge of the card`() {
        world.paths.responses["/api/v2/alerts"] = """{"success":true,"alerts":[
            {"set_number":"75192-1","condition":"N","direction":"below","threshold":750.0,"currency_code":"CHF"}]}"""
        val vm = world.t.track(SettingsViewModel(world.t.session, world.t.filter(), world.t.hints, world.t.sync,
            testAccountRepository(world.t.api, world.t.io), testManagementRepository(world.t.api), world.t.alerts(), testPartsRepository(world.t.api),
            object : FileReader {
                override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null
            })).also { it.loadAlarmOverview() }
        show {
            PriceAlarmsRoute(vm = vm, imageLoader = SampleImages.loader(ctx), serverUrl = "",
                snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onBack = {}, reportToggle = {})
        }
        wait("price alerts") { vm.alarmOverview.value.loaded && vm.alarmOverview.value.alerts.isNotEmpty() }
        // One choice each in the alert and in the creation form, not once more as a field name.
        assertEquals("“Fällt unter” twice", 2,
            compose.onAllNodes(hasText(text(R.string.detail_alert_chip_below)), useUnmergedTree = true)
                .fetchSemanticsNodes().count { it.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null })
        val front = text(R.string.alerts_delete_for, "§").substringBefore("§")
        val delete = compose.onAllNodes(SemanticsMatcher("Löschen eines Alarms") { n ->
            n.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty().any { it.startsWith(front) }
        }).fetchSemanticsNodes().first().boundsInRoot
        val field = compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().first().boundsInRoot
        // The edge is the end of the 48 dp tap area of the delete button; its visible area
        // (40 dp, centered within) ends 4 dp before.
        val density = ctx.resources.displayMetrics.density
        val edge = delete.center.x + 24 * density
        assertEquals("field does not end at the card edge (${field.right} / $edge)", edge, field.right, density)
    }

    // ── dark designs ──

    @Test
    fun `in the dark the image lies on a dark surface`() {
        compose.setContent { CompositionLocalProvider(LocalAddressRules provides NetworkAddressRules) {
            BrickInventoryManagerTheme(theme = Design.CLASSIC, dark = true) {
                ProductImage(model = "/beispiel/set1.png", imageLoader = SampleImages.loader(ctx), contentDescription = "Bild",
                    modifier = Modifier.size(300.dp, 100.dp), imageBackground = true)
            }
         } }
        compose.waitForIdle()
        val image = compose.onNodeWithContentDescription("Bild").captureToImage().asAndroidBitmap()
        // Left of the image, which stands centered with „Fit“: only the surface.
        val point = image.getPixel(2, image.height / 2)
        val light = (Color.red(point) + Color.green(point) + Color.blue(point)) / 3
        assertTrue("image area light in the dark (grey value $light)", light < 80)
    }

    // ── Bar at 200 %, scanner ──

    @Test
    fun `the bar keeps distance to the screen edge at 200 percent`() {
        show(font = 2f) {
            val nav = rememberNavController()
            val tab = remember {
                listOf(Tab(CollectionTarget.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"),
                    Tab(AppTarget.More, { Icon(Icons.Default.MoreHoriz, null) }, "Mehr"))
            }
            MainScaffold(
                title = "Sammlung", navController = nav, bottomNavItems = tab,
                snackbarHostState = remember { SnackbarHostState() },
                onTabTapped = {},
            ) {
                NavHost(nav, startDestination = CollectionTarget.Gallery) { composable<CollectionTarget.Gallery> { } }
            }
        }
        val density = ctx.resources.displayMetrics.density
        val width = ctx.resources.displayMetrics.widthPixels
        val more = compose.onNode((hasText("Mehr") or hasContentDescription("Mehr")) and hasClickAction())
            .fetchSemanticsNode().boundsInRoot
        assertTrue("“Mehr” ends ${(width - more.right) / density} dp before the edge", width - more.right >= 6 * density)
    }

    @Test
    fun `the scanner closes top left and switches the light via a button`() {
        show { BarcodeScannerScreen(onResult = {}, onDismiss = {}, withoutCamera = true) }
        val width = ctx.resources.displayMetrics.widthPixels
        val too = compose.onNodeWithContentDescription(text(R.string.scanner_close)).fetchSemanticsNode().boundsInRoot
        assertTrue("close not on the left (${too.left} of $width)", too.right < width / 2f)
        compose.onNode(hasText(text(R.string.scanner_torch_on)) and hasClickAction()).fetchSemanticsNode("Licht ist kein Knopf")
    }

    // ── Dialogs with margin ──

    /** The frame of the dialog: the node with its window name. */
    private fun frame(n: SemanticsNode, title: String): Rect? =
        if (n.config.getOrNull(SemanticsProperties.PaneTitle) == title) n.boundsInRoot
        else n.children.firstNotNullOfOrNull { frame(it, title) }

    private fun checkEdge(name: String, root: SemanticsNode, title: String) {
        val density = ctx.resources.displayMetrics.density
        val width = ctx.resources.displayMetrics.widthPixels
        val r = checkNotNull(frame(root, title)) { "$name: no window “$title”" }
        assertTrue("$name randlos (${r.left / density} / ${(width - r.right) / density} dp)",
            r.left >= 23 * density && width - r.right >= 23 * density)
    }

    @Test
    fun `confirmation and adding keep distance to the window edge`() {
        val root = openDialog {
            Prompt(title = "Set löschen?", text = "Millennium Falcon wird entfernt.", confirm = "Löschen",
                onConfirm = {}, onCancel = {})
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
        for (language in listOf("de-rCH", "en-rGB")) {
            RuntimeEnvironment.setQualifiers(language)
            assertEquals("($language)", listOf("English", "Deutsch"),
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
