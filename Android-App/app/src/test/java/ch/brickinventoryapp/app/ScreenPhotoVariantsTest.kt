package ch.brickinventoryapp.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.platform.ViewRootForTest
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.account.ui.AccountUiState
import ch.brickinventoryapp.account.ui.SecondFactorUiState
import ch.brickinventoryapp.account.ui.UpdateUiState
import ch.brickinventoryapp.account.ui.dialogs.UpdateRoute
import ch.brickinventoryapp.account.ui.screens.AccountRoute
import ch.brickinventoryapp.account.ui.screens.CsvImportRoute
import ch.brickinventoryapp.account.ui.screens.HouseholdRoute
import ch.brickinventoryapp.account.ui.screens.LocationsRoute
import ch.brickinventoryapp.account.ui.screens.PriceAlarmsRoute
import ch.brickinventoryapp.account.ui.screens.SecondFactorRequiredMask
import ch.brickinventoryapp.account.ui.screens.SettingsExits
import ch.brickinventoryapp.account.ui.screens.SettingsScreen
import ch.brickinventoryapp.account.ui.screens.SettingsState
import ch.brickinventoryapp.account.ui.screens.StartPasswordMask
import ch.brickinventoryapp.account.ui.viewmodel.AccountViewModel
import ch.brickinventoryapp.account.ui.viewmodel.HouseholdViewModel
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.account.ui.viewmodel.UpdateActions
import ch.brickinventoryapp.app.nav.AppTarget
import ch.brickinventoryapp.app.ui.components.CertificateDialog
import ch.brickinventoryapp.app.ui.components.CsvImportBanner
import ch.brickinventoryapp.app.ui.components.CsvProgress
import ch.brickinventoryapp.catalog.ui.CatalogUiState
import ch.brickinventoryapp.catalog.ui.screens.CatalogDetailActions
import ch.brickinventoryapp.catalog.ui.screens.CatalogDetailScreen
import ch.brickinventoryapp.catalog.ui.screens.CatalogScreen
import ch.brickinventoryapp.catalog.ui.viewmodel.CatalogActions
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.collection.ui.CollectionTarget
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeDialogState
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeResultDialog
import ch.brickinventoryapp.collection.ui.screens.AcquisitionManagementRoute
import ch.brickinventoryapp.collection.ui.screens.AddSetDialog
import ch.brickinventoryapp.collection.ui.screens.BarcodeScannerScreen
import ch.brickinventoryapp.collection.ui.screens.ComparisonScreen
import ch.brickinventoryapp.collection.ui.screens.GalleryAndDetail
import ch.brickinventoryapp.collection.ui.screens.GalleryRoute
import ch.brickinventoryapp.collection.ui.screens.SetDetailRoute
import ch.brickinventoryapp.collection.ui.screens.WantedRoute
import ch.brickinventoryapp.collection.ui.viewmodel.ComparisonActions
import ch.brickinventoryapp.collection.ui.viewmodel.ComparisonUiState
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.GalleryViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.data.PrewarmNetwork
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testCatalogRepository
import ch.brickinventoryapp.data.testing.testFinancesRepository
import ch.brickinventoryapp.data.testing.testHouseholdRepository
import ch.brickinventoryapp.data.testing.testManagementRepository
import ch.brickinventoryapp.data.testing.testMinifigsRepository
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.data.testing.testSetsRepository
import ch.brickinventoryapp.data.testing.testVouchersRepository
import ch.brickinventoryapp.data.testing.text
import ch.brickinventoryapp.finances.ui.screens.FinanceRoute
import ch.brickinventoryapp.finances.ui.screens.VouchersRoute
import ch.brickinventoryapp.finances.ui.viewmodel.VoucherViewModel
import ch.brickinventoryapp.login.ui.LoginForm
import ch.brickinventoryapp.login.ui.screens.LoginActions
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.login.ui.screens.LoginScreenState
import ch.brickinventoryapp.login.ui.screens.SetupScreen
import ch.brickinventoryapp.management.ui.ManagementUiState
import ch.brickinventoryapp.management.ui.screens.CacheEvents
import ch.brickinventoryapp.management.ui.screens.MonitoringScreen
import ch.brickinventoryapp.management.ui.screens.MonitoringState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
import ch.brickinventoryapp.model.domain.BrickLinkView
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.domain.CatalogSetView
import ch.brickinventoryapp.model.domain.CatalogSort
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.ui.ErrorClass
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.parts.ui.PartListUiState
import ch.brickinventoryapp.parts.ui.PartsListAndDetailRoute
import ch.brickinventoryapp.parts.ui.PlPart
import ch.brickinventoryapp.parts.ui.PlSet
import ch.brickinventoryapp.parts.ui.screens.ManualItemDetailRoute
import ch.brickinventoryapp.parts.ui.screens.MinifigsRoute
import ch.brickinventoryapp.parts.ui.screens.PartsListScreen
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.security.CertificateUnresolved
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.testing.SessionFake
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.state.ui.viewmodel.AppearanceActions
import ch.brickinventoryapp.state.ui.viewmodel.PurchasesViewModel
import ch.brickinventoryapp.ui.components.OfflineHint
import ch.brickinventoryapp.ui.screens.CameraPermissionHint
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.update.util.UpdateDescription
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowDialog
import java.time.Duration
import java.util.Locale

/**
 * What ScreenPhotoTest does not cover, once each instead of in the full grid (the
 * run time grows with every image): the three remaining designs, English (en-GB),
 * font 130 % and 200 %, the scaffold with app bar and the page “More”,
 * dialogs, loading, error and empty state, the detail with four-digit amounts
 * on 360 dp, list and detail on the tablet as well as the subpages storage locations,
 * household, CSV import and the build list. As there in German (de-CH),
 * where `-en` does not stand in the name. Names as there:
 * `<screen>[-variant]_<design>_<light|dark>_<gerät>.png`; device `quer` is the
 * phone in landscape. Plus the catalog as a list, empty and failed tabs,
 * tablet at 200 % and the sign-in in landscape and at 200 %.
 *
 * Counter-check as with ScreenPhotoTest only possible with checked-in references
 * (change a color in Theme.kt → verifyRoborazziDebug red); not measurable
 * here without the Android SDK. The dialogs at 200 % additionally check that the font
 * arrives in the dialog window — counter-check dialog-schrift-nur-lokal: without
 * setFontScale → red “dialogSetAddFont200” (font does not reach the dialog).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ScreenPhotoVariantsTest {

    private companion object {
        const val GERMAN = "de-rCH"
        const val ENGLISH = "en-rGB"
    }

    @get:Rule
    val compose = createComposeRule()

    private val world = Examples.World(ContextTexts())
    private val images = SampleImages.loader(ApplicationProvider.getApplicationContext())
    private val before = Locale.getDefault()

    @After
    fun tearDown() {
        Locale.setDefault(before)
        world.close()
    }

    /** Like ScreenPhotoTest's provide step: drive the main looper until the world rests. */
    private fun provide(name: String, ready: () -> Boolean, condition: () -> Any?) {
        driveUntil(name, requests = { world.paths.requests.size }, condition = condition, ready = ready)
    }

    // Workbench is a dark design without a light version; „hell“ in the name was misleading.
    private fun path(name: String, design: String, dark: Boolean, device: String) =
        "src/test/screenshots/${name}_${design}_${if (dark || design == "werkbank") "dunkel" else "hell"}_$device.png"

    /**
     * Shows [content] and waits for the data; the caller takes the photo so that
     * it can tap before (More, dialog) or stop the clock (loading).
     */
    private fun show(
        name: String, design: String = "classic", dark: Boolean = false, device: String = "telefon",
        language: String? = GERMAN, font: Float = 1f, ready: () -> Boolean = { true }, condition: () -> Any? = { null },
        wait: Boolean = true, content: @Composable () -> Unit,
    ) {
        val mask = when (device) {
            "tablet" -> "w1280dp-h800dp-land-xhdpi"
            "schmal" -> "w360dp-h740dp-port-xxhdpi"
            "quer" -> "w891dp-h411dp-land-xxhdpi"
            else -> "w411dp-h891dp-port-xxhdpi"
        }
        RuntimeEnvironment.setQualifiers(if (language != null) "$language-$mask" else mask)
        // The font in the configuration too: a dialog has its own window and
        // takes the density from there, LocalDensity below does not reach into it.
        if (font != 1f) RuntimeEnvironment.setFontScale(font)
        if (language != null) Locale.setDefault(Locale.forLanguageTag(language.replace("-r", "-")))
        if (wait) provide(name, ready, condition)
        compose.setContent {
            BrickInventoryManagerTheme(theme = checkNotNull(Design.from(design)) { design }, dark = dark) {
                val density = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(density.density, font)) {
                    Surface(color = MaterialTheme.colorScheme.background) { content() }
                }
            }
        }
        if (wait) {
            provide("$name (angezeigt)", ready, condition)
            compose.waitForIdle()
        }
    }

    /**
     * Stop the clock and advance in fixed steps: the image then does not depend
     * on how far an animation (loading circle, fade-in, retraction of the pull indicator)
     * was when triggering. galerie-fehler deviated between recording and verification.
     */
    private fun pause() {
        compose.mainClock.autoAdvance = false
        repeat(20) {
            compose.mainClock.advanceTimeBy(100)
            shadowOf(Looper.getMainLooper()).idle()
        }
    }

    private fun photo(name: String, design: String = "classic", dark: Boolean = false, device: String = "telefon") =
        compose.onRoot().captureRoboImage(path(name, design, dark, device))

    private fun entryVm() = world.t.track(EntryViewModel(world.t.session, world.t.filter(), world.t.hints, testSetsRepository(world.t.api), world.t.setCatalog(), world.t.wantedList(),
        testCatalogRepository(world.t.api),
        object : SetCreator {
            override fun create(setNumber: String, quantity: Int, purchasePrice: Money?, condition: Condition?,
                                 ownerUserId: Int?, storage: String?): Flow<SetCreateStep> = emptyFlow()
        }))

    private fun galleryDone(vm: GalleryViewModel) =
        { vm.galleryState.value.let { it.sets.isNotEmpty() && it.stats != null && !it.fetch.loading } }

    private fun detailDone(vm: SetDetailViewModel) = {
        vm.setDetailState.value.let { s ->
            s.setDetail != null && s.setPrice != null && s.priceHistory != null && s.acquisitions.isNotEmpty() &&
                !s.detailFetch.loading && !s.priceFetch.loading && !s.historyFetch.loading && !s.purchasesFetch.loading }
    }

    @Composable
    private fun Gallery(vm: GalleryViewModel) =
        GalleryRoute(vm = vm, entryVm = entryVm(), imageLoader = images, onScanBarcode = {}, onSetClick = {})

    @Composable
    private fun Detail(vm: SetDetailViewModel) =
        SetDetailRoute(setNumber = Examples.SET, vm = vm, serverUrl = "", imageLoader = images, onBack = {}, onDelete = {})

    private fun galleryPhoto(name: String, design: String = "classic", dark: Boolean = false,
                            language: String? = GERMAN, font: Float = 1f) {
        val vm = world.gallery().also { it.loadSets(); it.loadStats() }
        show(name, design, dark, language = language, font = font, ready = galleryDone(vm),
            condition = { vm.galleryState.value }) { Gallery(vm) }
        photo(name, design, dark)
    }

    private fun detailPhoto(name: String, design: String = "classic", dark: Boolean = false,
                           language: String? = GERMAN, font: Float = 1f) {
        val vm = world.setDetail()
        show(name, design, dark, language = language, font = font, ready = detailDone(vm),
            condition = { vm.setDetailState.value }) { Detail(vm) }
        photo(name, design, dark)
    }

    private fun loginPhoto(name: String, font: Float) {
        show(name, font = font) {
            LoginScreen(
                LoginScreenState(serverUrl = "https://brick.example.org", registrationOpen = true),
                object : LoginActions {},
            )
        }
        photo(name)
    }

    // ── The three designs the grid in ScreenPhotoTest does not carry ──
    // One test each, because a Compose rule may draw only once per test.

    @Test fun galleryColorSlotsLight() = galleryPhoto("galerie", "farbfaecher")
    @Test fun galleryColorSlotsDark() = galleryPhoto("galerie", "farbfaecher", dark = true)
    @Test fun galleryGlossyLight() = galleryPhoto("galerie", "hochglanz")
    @Test fun galleryGlossyDark() = galleryPhoto("galerie", "hochglanz", dark = true)
    @Test fun galleryWorkbench() = galleryPhoto("galerie", "werkbank")
    @Test fun detailColorSlots() = detailPhoto("set-detail", "farbfaecher")
    @Test fun detailGlossyDark() = detailPhoto("set-detail", "hochglanz", dark = true)
    @Test fun detailWorkbench() = detailPhoto("set-detail", "werkbank")

    // ── Four-digit amounts on a narrow phone (360 dp) ──
    // A purchase price above CHF 1’000 in the value tiles: there „CHF 700.0 / 0“
    // wrapped, and with four digits it only got tighter.

    // All numbers of a set fit together: market price 1’249.90, purchase price 1’049.00,
    // i.e. +19.2 %. Previously purchase price 700 and +16.1 % stood next to the expensive market price.
    private fun detailExpensivePhoto(name: String, font: Float) {
        world.paths.responses["/api/v1/sets/75192-1/price"] =
            """{"success":true,"set_number":"75192-1","currency":"CHF","avg_price":1249.9,"min_price":1180.0,"max_price":1320.0,"qty_avg_price":1249.9}"""
        world.paths.responses["/api/v1/sets/75192-1/acquisitions"] = """{"success":true,"acquisitions":[
            {"id":1,"quantity":1,"purchase_price":1049.0,"condition":"N","currency":"CHF","created_at":"2026-03-14T10:00:00Z"}]}"""
        world.paths.responses["/api/v1/sets/75192-1"] = """{"success":true,"quantity":1,"set":{"set_number":"75192-1",
            "image_local":"/beispiel/set1.png","name":"Millennium Falcon","year":2017,"theme":"Star Wars","quantity":1,
            "num_parts":7541,"minifigs":7,"added_at":"2026-03-14T10:00:00Z","avg_purchase_price":1049.0}}"""
        world.paths.responses["/api/v1/sets/75192-1/price-history"] = """{"success":true,"set_number":"75192-1","currency":"CHF",
            "by_condition":{"N":{"market_price":1249.9,"purchase_price":1049.0,"pnl_pct":"19.2","pnl_prozent":19.2}},
            "chart":{"values":[{"name":"N","values":[{"x":"2026-08-01","y":1210.0},{"x":"2026-09-01","y":1231.0},{"x":"2026-10-01","y":1249.9}],"firstRealIndex":0}],
                     "x":["2026-08-01","2026-09-01","2026-10-01"]},
            "pnl_prozent":19.2,"purchase_price":1049.0}"""
        val vm = world.setDetail()
        show(name, device = "schmal", font = font, ready = detailDone(vm), condition = { vm.setDetailState.value }) { Detail(vm) }
        pause()
        photo(name, device = "schmal")
    }

    @Test fun detailFourDigitNarrow() = detailExpensivePhoto("set-detail-vierstellig", 1f)
    @Test fun detailFourDigitNarrowFont200() = detailExpensivePhoto("set-detail-vierstellig-schrift200", 2f)

    // ── English (en-GB): texts, numbers, amounts and axes ──

    @Test fun galleryEnglish() = galleryPhoto("galerie-en", language = ENGLISH)
    @Test fun detailEnglish() = detailPhoto("set-detail-en", language = ENGLISH)

    @Test
    fun financesEnglish() = financesPhoto("finanzen-en", language = ENGLISH)

    private fun financesPhoto(name: String, language: String? = GERMAN, font: Float = 1f) {
        val vm = world.finances().also { it.loadValuation(); it.loadPortfolioHistory("week") }
        show(name, language = language, font = font, ready = { vm.financeState.value.let { it.valuation != null &&
            it.pnl != null && it.historyPoints.isNotEmpty() && !it.valuationLoad.loading && !it.history.loading } },
            condition = { vm.financeState.value }) { FinanceRoute(vm = vm, imageLoader = images) }
        photo(name)
    }

    // ── Large font: 130 % and 200 % ──

    @Test fun loginFont130() = loginPhoto("anmelden-schrift130", 1.3f)
    @Test fun loginFont200() = loginPhoto("anmelden-schrift200", 2.0f)
    @Test fun galleryFont130() = galleryPhoto("galerie-schrift130", font = 1.3f)
    @Test fun galleryFont200() = galleryPhoto("galerie-schrift200", font = 2.0f)
    @Test fun detailFont130() = detailPhoto("set-detail-schrift130", font = 1.3f)
    @Test fun detailFont200() = detailPhoto("set-detail-schrift200", font = 2.0f)
    @Test fun financesFont200() = financesPhoto("finanzen-schrift200", font = 2.0f)

    @Test
    fun wantedFont200() {
        val vm = world.wantedList().also { it.loadWanted() }
        show("merkliste-schrift200", font = 2.0f, ready = { vm.wantedState.value.wantedItem.isNotEmpty() },
            condition = { vm.wantedState.value }) {
            WantedRoute(vm = vm, imageLoader = images, onScan = {}, onOpenSingle = { _, _ -> })
        }
        photo("merkliste-schrift200")
    }

    @Test
    fun partsEnglish() {
        val vm = world.parts().also { it.loadParts() }
        show("teile-en", language = ENGLISH, ready = { vm.partsState.value.parts.isNotEmpty() },
            condition = { vm.partsState.value }) { PartsRoute(vm = vm, imageLoader = images) }
        photo("teile-en")
    }

    @Test
    fun partsFont200() {
        val vm = world.parts().also { it.loadParts() }
        show("teile-schrift200", font = 2.0f, ready = { vm.partsState.value.parts.isNotEmpty() },
            condition = { vm.partsState.value }) { PartsRoute(vm = vm, imageLoader = images) }
        photo("teile-schrift200")
    }

    /** The figure grid grows with the font (ReadableColumns): long names fully readable. */
    @Test
    fun minifigsFont200() {
        val vm = world.figures().also { it.loadMinifigs() }
        show("figuren-schrift200", font = 2.0f, ready = { vm.minifigsState.value.minifigs.isNotEmpty() },
            condition = { vm.minifigsState.value }) { MinifigsRoute(vm = vm, imageLoader = images) }
        photo("figuren-schrift200")
    }

    @Test
    fun vouchersFont200() {
        show("gutscheine-schrift200", font = 2.0f) { Vouchers() }
        photo("gutscheine-schrift200")
    }

    // ── Scaffold: app bar with four inventory destinations and “More” ──

    @Composable
    private fun Scaffold(
        gallery: GalleryViewModel,
        snackbar: SnackbarHostState = remember { SnackbarHostState() },
        pendingChanges: Int = 0,
        offlineStatus: Long? = null,
    ) {
        val nav = rememberNavController()
        // The same tabs as the app, from the resources: fixed German names stood
        // in the English photo too.
        val tab = tabTheBar()
        // The title follows the destination as in the app (ToolsGraph sets nav_more): a fixed
        // „Sammlung“ showed the photo of “More” with the wrong title.
        val target by nav.currentBackStackEntryAsState()
        val title = stringResource(if (target?.destination?.hasRoute<AppTarget.More>() == true) R.string.nav_more else R.string.nav_collection)
        MainScaffold(
            title = title, navController = nav, bottomNavItems = tab,
            snackbarHostState = snackbar,
            updateAvailable = true, onTabTapped = {},
            pendingChanges = pendingChanges,
        ) {
            NavHost(nav, startDestination = CollectionTarget.Gallery) {
                composable<CollectionTarget.Gallery> {
                    Column {
                        OfflineHint(offlineStatus)
                        Gallery(gallery)
                    }
                }
                composable<AppTarget.More> {
                    MoreScreen(onTarget = nav::openOfMore, isAdmin = true, updateAvailable = true, onLogout = {})
                }
            }
        }
    }

    private fun scaffoldPhoto(device: String) {
        val gallery = world.gallery().also { it.loadSets(); it.loadStats() }
        show("geruest", device = device, ready = galleryDone(gallery), condition = { gallery.galleryState.value }) { Scaffold(gallery) }
        photo("geruest", device = device)
    }

    @Test fun scaffoldPhone() = scaffoldPhoto("telefon")
    @Test fun scaffoldTablet() = scaffoldPhoto("tablet")

    /** The switcher Sets | Parts | Minifigures at 200 %: segments, scrollable sideways, no word broken. */
    @Test
    fun scaffoldFont200() {
        val gallery = world.gallery().also { it.loadSets(); it.loadStats() }
        show("geruest-schrift200", font = 2.0f, ready = galleryDone(gallery),
            condition = { gallery.galleryState.value }) { Scaffold(gallery) }
        pause()
        photo("geruest-schrift200")
    }

    /** The page “More”: all other destinations grouped, with the dot for a new version. */
    private fun morePhoto(device: String, dark: Boolean, name: String = "mehr", font: Float = 1f,
                         language: String? = GERMAN) {
        val gallery = world.gallery().also { it.loadSets(); it.loadStats() }
        show(name, dark = dark, device = device, language = language, font = font, ready = galleryDone(gallery),
            condition = { gallery.galleryState.value }) { Scaffold(gallery) }
        // At large font only the selected destination is labelled; the others carry their name as description.
        val more = ApplicationProvider.getApplicationContext<Context>().getString(R.string.nav_more)
        compose.onNode((hasText(more) or hasContentDescription(more)) and hasClickAction()).performClick()
        compose.waitForIdle()
        photo(name, dark = dark, device = device)
    }

    @Test fun morePhone() = morePhoto("telefon", dark = true)
    @Test fun moreTablet() = morePhoto("tablet", dark = false)
    @Test fun moreFont200() = morePhoto("telefon", dark = false, name = "mehr-schrift200", font = 2f)
    @Test fun moreEnglish() = morePhoto("telefon", dark = false, name = "mehr-en", language = ENGLISH)

    // ── Dialoge ──

    /**
     * Photographs the open dialog. At large font it first checks that the font
     * arrives in the dialog window: with LocalDensity alone the 200 % photo was
     * byte-identical to the 100 % photo and proved nothing.
     */
    private fun dialogPhoto(name: String, design: String, dark: Boolean, device: String, font: Float) {
        if (font == 1f) {
            compose.onNode(isDialog()).captureRoboImage(path(name, design, dark, device))
            return
        }
        // A Material text field in the dialog window never comes to rest under Robolectric from 130 % font
        // (also with Android 13; in the main window it does). That is why measure and photograph
        // at the window itself here instead of via Compose's synchronization.
        val looper = shadowOf(Looper.getMainLooper())
        repeat(10) { compose.mainClock.advanceTimeBy(50); looper.idle() }
        val window = ShadowDialog.getLatestDialog().window!!.decorView
        val root = composeRoot(window) ?: error("$name: kein Compose im Dialogfenster")
        val scales = mutableListOf<Float>()
        fun collect(n: SemanticsNode) {
            val outcome = mutableListOf<TextLayoutResult>()
            n.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(outcome)
            outcome.firstOrNull()?.layoutInput?.density?.fontScale?.let { scales += it }
            n.children.forEach { collect(it) }
        }
        collect(root.semanticsOwner.unmergedRootSemanticsNode)
        Assert.assertTrue("$name: Schrift erreicht den Dialog nicht (Skalen $scales)",
            scales.isNotEmpty() && scales.all { it >= font - 0.05f })
        // Drawn ourselves: captureRoboImage(View) looks for the view via Espresso in the
        // activity and does not find the dialog window there.
        val image = Bitmap.createBitmap(window.width, window.height, Bitmap.Config.ARGB_8888)
        window.draw(Canvas(image))
        image.captureRoboImage(path(name, design, dark, device))
    }

    /**
     * A dialog with a text field never comes to rest under Robolectric if it is already there
     * during construction. Therefore as with tapping: first the surface, then with the clock stopped
     * open on the UI thread and advance step by step; the window arises via the
     * main looper, not via the Compose clock.
     */
    private fun showDialog(
        name: String, dark: Boolean = false, device: String = "telefon", font: Float = 1f,
        dialog: @Composable () -> Unit,
    ) {
        val open = mutableStateOf(false)
        show(name, dark = dark, device = device, font = font, wait = false) { if (open.value) dialog() }
        compose.mainClock.autoAdvance = false
        compose.runOnUiThread {
            open.value = true
            Snapshot.sendApplyNotifications()
        }
        repeat(3) {
            compose.mainClock.advanceTimeBy(200)
            Shadows.shadowOf(Looper.getMainLooper()).idle()
        }
    }

    /** The Compose root in a window tree, without waiting for rest. */
    private fun composeRoot(v: View): ViewRootForTest? = when (v) {
        is ViewRootForTest -> v
        is ViewGroup -> (0 until v.childCount).firstNotNullOfOrNull { composeRoot(v.getChildAt(it)) }
        else -> null
    }

    private fun dialogSetDeletePhoto(name: String, font: Float) {
        val vm = world.setDetail()
        show(name, design = "noppe", font = font, ready = detailDone(vm), condition = { vm.setDetailState.value }) { Detail(vm) }
        compose.onNodeWithContentDescription("Millennium Falcon löschen").performClick()
        compose.waitForIdle()
        dialogPhoto(name, "noppe", false, "telefon", font)
    }

    @Test fun deleteDialogSet() = dialogSetDeletePhoto("dialog-set-loeschen", 1f)
    @Test fun dialogSetDeleteFont200() = dialogSetDeletePhoto("dialog-set-loeschen-schrift200", 2f)

    /** The confirmation before sign-out — the same design as when deleting a set. */
    private fun dialogLogoutPhoto(name: String, dark: Boolean, device: String, font: Float) {
        show(name, dark = dark, device = device, font = font) {
            MoreScreen({}, isAdmin = false, updateAvailable = true, onLogout = {})
        }
        compose.onNodeWithText("Abmelden").performClick()
        compose.waitForIdle()
        dialogPhoto(name, "classic", dark, device, font)
    }

    @Test fun logoutDialog() = dialogLogoutPhoto("dialog-abmelden", true, "telefon", 1f)
    @Test fun dialogLogoutFont200() = dialogLogoutPhoto("dialog-abmelden-schrift200", false, "telefon", 2f)
    @Test fun dialogLogoutTablet() = dialogLogoutPhoto("dialog-abmelden", false, "tablet", 1f)

    private fun dialogWantedItemPhoto(name: String, dark: Boolean, font: Float) {
        val vm = world.wantedList().also { it.loadWanted() }
        show(name, dark = dark, font = font, ready = { vm.wantedState.value.wantedItem.isNotEmpty() },
            condition = { vm.wantedState.value }) {
            WantedRoute(vm = vm, imageLoader = images, onScan = {}, onOpenSingle = { _, _ -> })
        }
        // The dialog focuses its first field; the blinking cursor never lets
        // Compose come to rest. That is why stop the clock and advance deliberately.
        compose.mainClock.autoAdvance = false
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        compose.onNodeWithContentDescription(ctx.getString(R.string.wanted_add_title)).performClick()
        // The dialog window arises via the main looper, not via the Compose clock.
        repeat(3) {
            compose.mainClock.advanceTimeBy(200)
            Shadows.shadowOf(Looper.getMainLooper()).idle()
        }
        dialogPhoto(name, "classic", dark, "telefon", font)
    }

    @Test fun createDialogWantedItem() = dialogWantedItemPhoto("dialog-merkposten", true, 1f)
    @Test fun dialogWantedItemFont200() = dialogWantedItemPhoto("dialog-merkposten-schrift200", false, 2f)

    // ── List and detail side by side (tablet) ──

    @Test
    fun wantedWithDetailTablet() {
        // The detail shows the same price as the row next to it (449.95), instead of „wird geladen“.
        world.paths.responses["/api/v1/wanted/10294-1/preise"] = """{"success":true,"currency":"CHF",
            "current":{"N":{"condition":"N","avg_price":449.95,"min_price":420.0,"max_price":480.0}}}"""
        world.paths.responses["/api/v1/catalog/sets/10294-1"] = """{"success":true,"set":{"set_number":"10294-1",
            "name":"Titanic","year":2021,"theme_name":"Icons","num_parts":9090,"image_local":"/beispiel/set2.png","minifigs":0}}"""
        world.paths.responses["/api/v1/sets/10294-1/price-history"] = """{"success":true,"set_number":"10294-1","currency":"CHF",
            "by_condition":{"N":{"market_price":449.95}},
            "chart":{"values":[{"name":"N","values":[{"x":"2026-08-01","y":431.0},{"x":"2026-09-01","y":440.0},{"x":"2026-10-01","y":449.95}],"firstRealIndex":0}],
                     "x":["2026-08-01","2026-09-01","2026-10-01"]}}"""
        val vm = world.wantedList().also { it.loadWanted() }
        show("merkliste-detail", device = "tablet", ready = { vm.wantedState.value.wantedItem.isNotEmpty() },
            condition = { vm.wantedState.value }) {
            WantedRoute(vm = vm, imageLoader = images, sideBySide = true,
                onScan = {}, onOpenSingle = { _, _ -> })
        }
        compose.onNode(androidx.compose.ui.test.hasText("Titanic", substring = true) and
            androidx.compose.ui.test.hasClickAction()).performClick()
        // Compose first: the detail starts its own loading (LaunchedEffect).
        compose.waitForIdle()
        // Photograph only when price and history are there — otherwise „Preis wird geladen“ stood
        // next to the price in the list.
        provide("merkliste-detail (offen)", { vm.wantedItemDetailState.value.let { !it.fetch.loading && it.prices != null } },
            { vm.wantedItemDetailState.value })
        compose.waitForIdle()
        pause()
        photo("merkliste-detail", device = "tablet")
    }

    /** Gallery and set detail side by side, as the tablet shows them after a tap. */
    @Test
    fun galleryWithDetailTablet() {
        val gallery = world.gallery().also { it.loadSets(); it.loadStats() }
        val detail = world.setDetail()
        show("galerie-mit-detail", device = "tablet", ready = { galleryDone(gallery)() && detailDone(detail)() },
            condition = { gallery.galleryState.value }) {
            GalleryAndDetail(gallery, entryVm(), images, open = Examples.SET, onSetClick = {}, onScanBarcode = {}) {
                Detail(detail)
            }
        }
        pause()
        photo("galerie-mit-detail", device = "tablet")
    }

    // ── Subpages and adding that had no photo before (I2) ──

    private fun settings() = world.t.track(SettingsViewModel(world.t.session, world.t.filter(), world.t.hints, world.t.sync,
        testAccountRepository(world.t.api, world.t.io), testManagementRepository(world.t.api),
        world.t.alerts(), testPartsRepository(world.t.api),
        object : FileReader {
            override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null
        }))

    @Test fun storageLocations() = locationsPhoto("lagerorte", 1f)
    @Test fun locationsFont200() = locationsPhoto("lagerorte-schrift200", 2f)

    private fun locationsPhoto(name: String, font: Float) {
        world.paths.responses["/api/v1/storage/locations"] = """{"success":true,"orte":[
            {"id":3,"name":"Keller"},{"id":4,"name":"Estrich"},{"id":5,"name":"Regal Wohnzimmer"}]}"""
        // Load before showing: show() already waits for the data before setContent, and
        // without a call here only the screen itself would ask.
        val vm = settings().also { it.loadOwnLocations() }
        show(name, font = font, ready = { vm.storageState.value.own.size == 3 }, condition = { vm.storageState.value }) {
            LocationsRoute(vm, remember { SnackbarHostState() }, onBack = {})
        }
        pause()
        photo(name)
    }

    @Test
    fun csvImport() {
        val vm = settings()
        show("csv-import") {
            CsvImportRoute(vm, remember { SnackbarHostState() }, onBack = {})
        }
        pause()
        photo("csv-import")
    }

    @Test
    fun household() {
        world.paths.responses["/api/v1/settings/household"] = """{"success":true,"is_main":true,"currency":"CHF",
            "sub_accounts":[{"id":2,"username":"lena"},{"id":3,"username":"tim"}],"open_invites":1}"""
        val vm = world.t.track(HouseholdViewModel(world.t.session, world.t.filter(), world.t.sync,
            testHouseholdRepository(world.t.api), testAccountRepository(world.t.api, world.t.io))).also { it.loadHousehold() }
        show("haushalt", ready = { vm.householdState.value.status != null }, condition = { vm.householdState.value }) {
            HouseholdRoute(vm, remember { SnackbarHostState() }, onBack = {})
        }
        pause()
        photo("haushalt")
    }

    @Test fun buildList() = buildListPhoto("bauliste", PartListUiState(), 1f)
    @Test fun buildListWithContent() = buildListPhoto("bauliste-inhalt", buildListFilled, 1f)
    @Test fun buildListWithContentFont200() = buildListPhoto("bauliste-inhalt-schrift200", buildListFilled, 2f)

    /** Two sets, generated, with stock: color groups, quantities and „vorhanden“ stand in the image. */
    private val buildListFilled = PartListUiState(
        sets = listOf(PlSet("75192-1", "Millennium Falcon"), PlSet("21318-1", "Baumhaus")),
        parts = listOf(
            PlPart(partNumber = "3001", partName = "Brick 2 x 4", colorName = "Red", colorHex = "C91A09",
                colorId = 4, quantity = 12, imageUrl = null, imageLocal = "/beispiel/teil1.png", present = 8),
            PlPart(partNumber = "3020", partName = "Plate 2 x 4", colorName = "Light Bluish Gray", colorHex = "A0A5A9",
                colorId = 71, quantity = 30, imageUrl = null, present = 30),
            PlPart(partNumber = "sw0001", partName = "Luke Skywalker", colorName = "", colorHex = null,
                quantity = 1, imageUrl = null, isFig = true, present = 0),
        ),
        generated = true,
    )

    private fun buildListPhoto(name: String, condition: PartListUiState, font: Float) {
        show(name, font = font) {
            PartsListScreen(condition, serverUrl = "", imageLoader = images, onScanBarcode = {})
        }
        pause()
        photo(name)
    }

    @Test fun addDialogPart() = addPhoto("dialog-teil-erfassen", figure = false, font = 1f)
    @Test fun dialogPartAddFont200() = addPhoto("dialog-teil-erfassen-schrift200", figure = false, font = 2f)
    @Test fun addDialogMinifig() = addPhoto("dialog-figur-erfassen", figure = true, font = 1f)
    @Test fun dialogMinifigAddFont200() = addPhoto("dialog-figur-erfassen-schrift200", figure = true, font = 2f)

    /**
     * Adding part and figure are internal to the area; opened as by hand via the
     * add button. Afterwards stop the clock: a dialog with a text field otherwise never comes to rest.
     */
    private fun addPhoto(name: String, figure: Boolean, font: Float) {
        val parts = if (figure) null else world.parts().also { it.loadParts() }
        val figures = if (figure) world.figures().also { it.loadMinifigs() } else null
        show(name, font = font,
            ready = { figures?.minifigsState?.value?.minifigs?.isNotEmpty() ?: parts!!.partsState.value.parts.isNotEmpty() },
            condition = { figures?.minifigsState?.value ?: parts!!.partsState.value }) {
            if (figures != null) MinifigsRoute(vm = figures, imageLoader = images) else PartsRoute(vm = parts!!, imageLoader = images)
        }
        val button = ApplicationProvider.getApplicationContext<Context>()
            .getString(if (figure) R.string.minifigs_add else R.string.parts_add)
        compose.onAllNodes((hasText(button) or hasContentDescription(button)) and hasClickAction())[0].performClick()
        compose.mainClock.autoAdvance = false
        repeat(3) {
            compose.mainClock.advanceTimeBy(200)
            Shadows.shadowOf(Looper.getMainLooper()).idle()
        }
        dialogPhoto(name, "classic", false, "telefon", font)
    }

    /** Adding: the gallery's dialog with number, quantity, price, condition and storage location. */
    @Test fun addDialogSet() = dialogSetAddPhoto("dialog-set-erfassen", 1f)

    /** At 200 % condition and storage location stand as chips or full row, nothing breaks within a word. */
    @Test fun dialogSetAddFont200() = dialogSetAddPhoto("dialog-set-erfassen-schrift200", 2f)

    /** On the tablet the dialog stands in its Material width above the surface. */
    @Test fun dialogSetAddTablet() = dialogSetAddPhoto("dialog-set-erfassen", 1f, device = "tablet")

    private fun dialogSetAddPhoto(name: String, font: Float, device: String = "telefon") {
        showDialog(name, device = device, font = font) {
            AddSetDialog(onDismiss = {},
                onAdd = {}, storageLocations = listOf("Keller", "Estrich"), immediatelyFocus = false)
        }
        dialogPhoto(name, "classic", false, device, font)
        if (font == 1f && device == "telefon") {
            // One pattern for all adding dialogs: the storage location is as wide as the set number.
            // Measured at the dialog window like the photo: the synchronization waited forever.
            val ctx = ApplicationProvider.getApplicationContext<Context>()
            val root = composeRoot(ShadowDialog.getLatestDialog().window!!.decorView) ?: error("kein Compose im Dialog")
            fun width(label: Int): Float {
                val searched = ctx.getString(label)
                fun search(n: SemanticsNode): SemanticsNode? =
                    if (SemanticsActions.SetText in n.config &&
                        n.config.getOrNull(SemanticsProperties.Text)?.any { it.text == searched } == true) n
                    else n.children.firstNotNullOfOrNull { search(it) }
                return checkNotNull(search(root.semanticsOwner.rootSemanticsNode)) { "kein Feld „$searched“" }.boundsInRoot.width
            }
            Assert.assertEquals("Lagerort so breit wie die Set-Nummer",
                width(R.string.gallery_set_number),
                width(R.string.detail_storage), 1f)
        }
    }

    // ── Loading, error, empty ──

    @Test
    fun galleryLoads() {
        // The response stays away; the clock stands so that the loading animation gives a fixed image.
        world.paths.missing += "/api/v1/sets"
        val gallery = world.gallery().also { it.loadSets() }
        compose.mainClock.autoAdvance = false
        show("galerie-laedt", wait = false) { Gallery(gallery) }
        compose.mainClock.advanceTimeBy(300)
        photo("galerie-laedt")
    }

    /**
     * The photo's language already before loading: a ViewModel that forms its sentence when
     * loading otherwise did that in English, and the German photo showed an English error.
     */
    private fun loadGermanBeforeThe() {
        RuntimeEnvironment.setQualifiers(GERMAN)
        Locale.setDefault(Locale.forLanguageTag("de-CH"))
    }

    @Test
    fun galleryError() {
        loadGermanBeforeThe()
        world.paths.codes["/api/v1/sets"] = 500
        val gallery = world.gallery().also { it.loadSets() }
        show("galerie-fehler", ready = { gallery.galleryState.value.let { !it.fetch.loading && it.fetch is Load.Failure } },
            condition = { gallery.galleryState.value }) { Gallery(gallery) }
        pause()
        photo("galerie-fehler")
    }

    @Test
    fun wantedEmpty() {
        world.paths.responses["/api/v1/wanted"] = """{"success":true,"merkposten":[]}"""
        val vm = world.wantedList().also { it.loadWanted() }
        show("merkliste-leer", dark = true, ready = { vm.wantedState.value.let { !it.fetch.loading && it.fetch !is Load.Failure } },
            condition = { vm.wantedState.value }) {
            WantedRoute(vm = vm, imageLoader = images, onScan = {}, onOpenSingle = { _, _ -> })
        }
        photo("merkliste-leer", dark = true)
    }

    // ── Screens that had no photo so far ──

    private val catalogDetail = CatalogDetailView(
        setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022, themeId = 721, themeName = "Icons",
        numParts = 4514, imageLocal = "/beispiel/set1.png", minifigs = 22,
        bricklink = BrickLinkView(number = "10305-1",
            url = "https://www.bricklink.com/v2/catalog/catalogitem.page?S=10305-1"))

    private fun catalogDetailPhoto(dark: Boolean, device: String, font: Float = 1f, name: String = "katalog-detail") {
        show(name, dark = dark, device = device, font = font) {
            CatalogDetailScreen(setNumber = "10305-1", loaded = Load.Data(catalogDetail), imageLoader = images, serverUrl = "",
                actions = object : CatalogDetailActions {})
        }
        pause()
        photo(name, dark = dark, device = device)
    }

    @Test fun catalogDetailPhone() = catalogDetailPhoto(false, "telefon")
    /** Both actions below each other and fully readable, also at 200 %. */
    @Test fun catalogDetailFont200() = catalogDetailPhoto(false, "telefon", 2f, "katalog-detail-schrift200")
    @Test fun catalogDetailTabletDark() = catalogDetailPhoto(true, "tablet")

    @Test fun comparison() = comparisonPhoto("vergleich", 1f)
    @Test fun comparisonFont200() = comparisonPhoto("vergleich-schrift200", 2f)

    private fun comparisonPhoto(name: String, font: Float) {
        show(name, font = font) { ComparisonScreen(ComparisonUiState(), NoComparison) }
        pause()
        photo(name)
    }

    /** Account: profile, design, second factor and two signed-in devices; on request with a requested address. */
    private fun accountPhoto(dark: Boolean, device: String, name: String = "konto", emailNew: String? = null) {
        val newValue = emailNew?.let { ""","new_email":"$it"""" } ?: ""
        world.paths.responses["/api/v1/auth/profile"] = """{"success":true,"user":{"id":1,"username":"marco",
            "email":"marco@example.org","first_name":"Marco","last_name":"Muster","email_verified":true$newValue}}"""
        world.paths.responses["/api/v1/auth/zweiter-faktor"] = """{"success":true,"aktiv":true,"codes_uebrig":8}"""
        world.paths.responses["/api/v1/settings/theme"] = """{"success":true,"theme":"classic","vorgabe":"classic"}"""
        world.paths.responses["/api/v1/settings/tokens"] = """{"success":true,"tokens":[
            {"token_id":"a1","label":"Pixel 8","created_at":"2026-09-01T10:00:00Z","last_used":"2026-11-02T18:00:00Z","aktuell":true,"scope":"app"},
            {"token_id":"b2","label":"Galaxy Tab","created_at":"2026-06-12T10:00:00Z","last_used":"2026-10-20T08:00:00Z","scope":"app"}]}"""
        val account = world.t.track(AccountViewModel(
            testAccountRepository(world.t.api, world.t.io),
            world.t.messages, world.t.session, SessionFake()))
        show(name, dark = dark, device = device) {
            AccountRoute(snackbarHostState = remember { SnackbarHostState() },
                account = account, onBack = {})
        }
        pause()
        photo(name, dark = dark, device = device)
    }

    @Test fun accountPhone() = accountPhoto(false, "telefon")
    @Test fun accountTabletDark() = accountPhoto(true, "tablet")
    /** The new address waits for its link: the field shows the current one, below it the requested one. */
    @Test fun accountEmailPending() = accountPhoto(false, "telefon", "konto-email-ausstehend", "marco.neu@example.org")

    /** Price alerts: one armed, one already triggered — in the normal case with name and image. */
    private fun priceAlertsPhoto(dark: Boolean, device: String, font: Float = 1f, name: String = "preisalarme") {
        world.paths.responses["/api/v1/alerts"] = """{"success":true,"alerts":[
            {"set_number":"75192-1","condition":"N","direction":"unter","threshold":750.0,"currency_code":"CHF",
             "name":"Millennium Falcon","image_local":"/beispiel/set1.png"},
            {"set_number":"10294-1","condition":"N","direction":"ueber","threshold":440.0,"currency_code":"CHF",
             "triggered":true,"last_triggered_at":"2026-10-30T09:00:00Z","last_price":449.95,
             "name":"Titanic","image_local":"/beispiel/set2.png","besitzt":false}]}"""
        val vm = settings()
        show(name, dark = dark, device = device, font = font) {
            PriceAlarmsRoute(vm = vm, imageLoader = images, serverUrl = "",
                snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onBack = {}, reportToggle = {})
        }
        pause()
        photo(name, dark = dark, device = device)
    }

    @Test fun priceAlertsPhone() = priceAlertsPhoto(false, "telefon")
    /** The triggered alert at 200 %: badge and last price wrap, no single character on its own. */
    @Test fun priceAlertsFont200() = priceAlertsPhoto(false, "telefon", 2f, "preisalarme-schrift200")
    @Test fun priceAlertsTabletDark() = priceAlertsPhoto(true, "tablet")

    /** Part from sets: on the tablet to the right of the list, on the phone as a dialog. */
    private fun partDetailPhoto(device: String, dark: Boolean) {
        world.paths.responses["/api/v1/parts/3001/5/sets"] = """{"success":true,
            "item":{"nummer":"3001","name":"Brick 2 x 4","color_id":5,"color_name":"Red","category_name":"Bricks",
                    "image_local":"/beispiel/teil1.png","total_quantity":12},
            "sets":[{"set_number":"75192-1","set_name":"Millennium Falcon","quantity":8,"image_local":"/beispiel/set1.png","owner_user_id":1},
                    {"set_number":"21318-1","set_name":"Baumhaus","quantity":4,"image_local":"/beispiel/set3.png","owner_user_id":1}]}"""
        val vm = world.parts().also { it.loadParts() }
        show("teil-detail", dark = dark, device = device, ready = { vm.partsState.value.parts.isNotEmpty() },
            condition = { vm.partsState.value }) {
            PartsListAndDetailRoute(vm, images, "", { _, _, _, _ -> }, {}, { _, _, _, _ -> }) { _ ->
                PartsRoute(vm = vm, imageLoader = images)
            }
        }
        compose.onNode(androidx.compose.ui.test.hasText("Brick 2 x 4", substring = true) and
            androidx.compose.ui.test.hasClickAction()).performClick()
        provide("teil-detail (offen)", { !vm.setItemState.value.fetch.loading }, { vm.setItemState.value })
        pause()
        if (device == "telefon") sheetPhoto(R.string.setitem_used_in, "teil-detail", "classic", dark, device)
        else photo("teil-detail", dark = dark, device = device)
    }

    /**
     * A sheet from below (ModalBottomSheet) has its own window without dialog semantics:
     * photographed is the root that carries [identifier].
     */
    private fun sheetPhoto(identifier: Int, name: String, design: String, dark: Boolean, device: String) {
        val text = ApplicationProvider.getApplicationContext<Context>().getString(identifier)
        compose.onNode(androidx.compose.ui.test.isRoot() and
            androidx.compose.ui.test.hasAnyDescendant(androidx.compose.ui.test.hasText(text)))
            .captureRoboImage(path(name, design, dark, device))
    }

    /**
     * The collection's filter sheet with storage location and theme. The sample data had
     * neither theme list nor storage locations, the sheet showed only handle and title.
     */
    @Test
    fun filterSheetGallery() {
        world.paths.responses["/api/v1/sets"] = Examples.RESPONSES.first { it.first == "/api/v1/sets" }.second
            .replaceFirst("\"total\":3,", "\"total\":3,\"themes\":[\"Icons\",\"Ideas\",\"Star Wars\"],")
        world.paths.responses["/api/v1/storage"] = """{"success":true,"orte":[
            {"ort":"Keller","sets":2,"teile":40},{"ort":"Regal Wohnzimmer","sets":1,"teile":0}]}"""
        val vm = world.gallery().also { it.refresh() }
        show("filter-galerie", ready = { galleryDone(vm)() && vm.storageState.value.locations.isNotEmpty() &&
            vm.galleryState.value.galleryThemes.isNotEmpty() }, condition = { vm.galleryState.value }) { Gallery(vm) }
        compose.onNodeWithContentDescription(ApplicationProvider.getApplicationContext<Context>()
            .getString(R.string.filter_button)).performClick()
        compose.waitForIdle()
        sheetRaise()
        sheetPhoto(R.string.filter_title, "filter-galerie", "classic", false, "telefon")
    }

    /**
     * The sheet slides up in its own window, and its frame rendering depends on the
     * looper's system clock: the Compose clock alone left it halfway.
     */
    private fun sheetRaise() {
        compose.mainClock.autoAdvance = false
        repeat(30) {
            compose.mainClock.advanceTimeBy(50)
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(50))
        }
    }

    // ── Mandatory forms at 200 % and the last step of the second factor ──

    @Test
    fun startPasswordFont200() {
        show("startpasswort-schrift200", font = 2.0f) {
            StartPasswordMask(AccountUiState(), { _, _, _ -> }, {})
        }
        photo("startpasswort-schrift200")
    }

    @Test
    fun secondFactorFont200() {
        show("zweiter-faktor-schrift200", font = 2.0f) {
            SecondFactorRequiredMask(
                SecondFactorUiState(active = false), {}, {}, {}, {})
        }
        photo("zweiter-faktor-schrift200")
    }

    /** Step 3: the emergency codes, „Weiter“ only after the check mark. */
    @Test
    fun secondFactorCodes() {
        show("zweiter-faktor-codes", dark = true) {
            SecondFactorRequiredMask(
                SecondFactorUiState(active = true,
                    codes = listOf("a1b2-c3d4", "e5f6-g7h8", "i9j0-k1l2", "m3n4-o5p6")), {}, {}, {}, {})
        }
        photo("zweiter-faktor-codes", dark = true)
    }

    @Test fun partDetailPhone() = partDetailPhoto("telefon", false)
    @Test fun partDetailTablet() = partDetailPhoto("tablet", false)

    /**
     * The message after deleting with „Rückgängig“ — above the bottom bar. The set is
     * marked for deletion and thus already out of the grid, as in the app.
     */
    private fun snackbarPhoto(device: String, dark: Boolean) {
        val gallery = world.gallery().also { it.loadSets(); it.loadStats() }
        provide("snackbar (geladen)", galleryDone(gallery)) { gallery.galleryState.value }
        gallery.markForDeletion(Examples.SET, "Millennium Falcon")
        val message = SnackbarHostState()
        show("snackbar", dark = dark, device = device, ready = galleryDone(gallery),
            condition = { gallery.galleryState.value }) {
            Scaffold(gallery, snackbar = message)
            LaunchedEffect(Unit) {
                message.showSnackbar("„Millennium Falcon“ gelöscht", actionLabel = "Rückgängig",
                    duration = SnackbarDuration.Indefinite)
            }
        }
        pause()
        photo("snackbar", dark = dark, device = device)
    }

    @Test fun snackbarPhone() = snackbarPhoto("telefon", false)
    @Test fun snackbarTabletDark() = snackbarPhoto("tablet", true)

    // ── Catalog, empty and error per tab, tablet 200 %, landscape ──

    private val catalogSets = (1..6).map { i ->
        CatalogSetView(setNumber = "1030$i-1", name = "Beispielset $i",
            year = 2020 + i, numParts = 500 * i, imageLocal = "/beispiel/set${(i - 1) % 3 + 1}.png",
            owned = i == 2, ownedQuantity = if (i == 2) 2 else 0)
    }

    private object NoCatalogActions : CatalogActions {
        override fun loadCatalogMeta() = Unit
        override fun loadCatalogSets() = Unit
        override fun catalogVisible(firstPage: Int, lastPage: Int) = Unit
        override fun scrollCatalogTo(number: Int) = Unit
        override fun catalogScrollConsumed() = Unit
        override fun setCatalogQuery(q: String) = Unit
        override fun setCatalogTheme(themeId: Int?) = Unit
        override fun setCatalogYear(year: Int?) = Unit
        override fun setCatalogSort(sort: CatalogSort) = Unit
    }

    private fun catalogPhoto(
        dark: Boolean, device: String, name: String = "katalog", font: Float = 1f,
        condition: CatalogUiState =
            CatalogUiState(loadedPages = mapOf(1 to catalogSets), total = catalogSets.size),
    ) {
        show(name, dark = dark, device = device, font = font) {
            CatalogScreen(condition, serverUrl = "", catalog = NoCatalogActions,
                imageLoader = images, onSetClick = {})
        }
        pause()
        photo(name, dark = dark, device = device)
    }

    @Test fun catalogPhone() = catalogPhoto(false, "telefon")
    @Test fun catalogTabletDark() = catalogPhoto(true, "tablet")
    @Test fun catalogFont200() = catalogPhoto(false, "telefon", "katalog-schrift200", 2f)
    @Test fun catalogEmpty() = catalogPhoto(false, "telefon", "katalog-leer", condition = CatalogUiState())
    @Test fun catalogError() = catalogPhoto(true, "telefon", "katalog-fehler",
        condition = CatalogUiState(fetch = Load.Failure(ErrorClass.UNKNOWN, Message.Text("Serverfehler (500)"))))

    @Test
    fun wantedError() {
        loadGermanBeforeThe()
        world.paths.codes["/api/v1/wanted"] = 500
        val vm = world.wantedList().also { it.loadWanted() }
        show("merkliste-fehler", ready = { vm.wantedState.value.let { !it.fetch.loading && it.fetch is Load.Failure } },
            condition = { vm.wantedState.value }) {
            WantedRoute(vm = vm, imageLoader = images, onScan = {}, onOpenSingle = { _, _ -> })
        }
        pause()
        photo("merkliste-fehler")
    }

    @Test
    fun partsEmpty() {
        world.paths.responses["/api/v1/parts"] = """{"success":true,"total":0,"parts":[]}"""
        val vm = world.parts().also { it.loadParts() }
        show("teile-leer", ready = { vm.partsState.value.let { it.partsFetch is Load.Data } },
            condition = { vm.partsState.value }) { PartsRoute(vm = vm, imageLoader = images) }
        pause()
        photo("teile-leer")
    }

    @Test
    fun partsError() {
        loadGermanBeforeThe()
        world.paths.codes["/api/v1/parts"] = 500
        val vm = world.parts().also { it.loadParts() }
        show("teile-fehler", dark = true, ready = { vm.partsState.value.let { it.partsFetch is Load.Failure } },
            condition = { vm.partsState.value }) { PartsRoute(vm = vm, imageLoader = images) }
        pause()
        photo("teile-fehler", dark = true)
    }

    @Test
    fun financesError() {
        loadGermanBeforeThe()
        world.paths.codes["/api/v1/finance/valuation"] = 500
        val vm = world.finances().also { it.loadValuation() }
        show("finanzen-fehler", ready = { vm.financeState.value.let { !it.valuationLoad.loading && !it.history.loading && it.valuationLoad is Load.Failure } },
            condition = { vm.financeState.value }) { FinanceRoute(vm = vm, imageLoader = images) }
        pause()
        photo("finanzen-fehler")
    }

    @Test
    fun galleryTabletFont200() {
        val vm = world.gallery().also { it.loadSets(); it.loadStats() }
        show("galerie-schrift200", device = "tablet", font = 2f, ready = galleryDone(vm),
            condition = { vm.galleryState.value }) { Gallery(vm) }
        photo("galerie-schrift200", device = "tablet")
    }

    @Test
    fun galleryAcross() {
        val vm = world.gallery().also { it.loadSets(); it.loadStats() }
        show("galerie", device = "quer", ready = galleryDone(vm), condition = { vm.galleryState.value }) { Gallery(vm) }
        photo("galerie", device = "quer")
    }

    private fun loginPhoto(name: String, form: LoginForm, device: String, font: Float) {
        show(name, device = device, font = font) {
            LoginScreen(
                LoginScreenState(serverUrl = "https://brick.example.org", form = form, registrationOpen = true),
                object : LoginActions {},
            )
        }
        photo(name, device = device)
    }

    @Test fun loginAcross() = loginPhoto("anmelden", LoginForm.LOGIN, "quer", 1f)
    @Test fun registerFont200() = loginPhoto("registrieren-schrift200", LoginForm.REGISTER, "telefon", 2f)

    @Test
    fun setUpAcross() {
        show("einrichten", device = "quer") {
            SetupScreen(currentUrl = "https://brick.fritz.box", onSave = {}, development = false)
        }
        photo("einrichten", device = "quer")
    }

    /** Without network: hint with state above the list, three changes wait in the outbox. */
    @Test fun offline() = offlinePhoto("offline", 1f)
    @Test fun offlineFont200() = offlinePhoto("offline-schrift200", 2f)

    private fun offlinePhoto(name: String, font: Float) {
        val gallery = world.gallery().also { it.loadSets(); it.loadStats() }
        show(name, font = font, ready = galleryDone(gallery), condition = { gallery.galleryState.value }) {
            Scaffold(gallery, pendingChanges = 3, offlineStatus = 1_793_000_000_000L)
        }
        pause()
        photo(name)
    }

    // ── Flows that had no photo otherwise: settings, update, scanner, barcode,
    // purchase prices, single part, background work, voucher, invitation, CSV import ──

    private val noUpdate = object : UpdateActions {
        override fun checkOnUpdate(still: Boolean) = Unit
        override fun checkOnStart() = Unit
        override fun setStartCheck(an: Boolean) = Unit
        override fun closeUpdateHint() = Unit
        override fun loadUpdate() = Unit
        override fun cancelLoad() = Unit
        override fun startInstallation() = Unit
    }

    private val noRendering = object : AppearanceActions {
        override fun setLanguage(languageCode: String) = Unit
        override fun setBrightness(choice: String) = Unit
        override fun setSystemColors(an: Boolean) = Unit
        override fun setPreviewHidden(an: Boolean) = Unit
        override fun setWidgetValues(an: Boolean) = Unit
    }

    private val noExits = object : SettingsExits {
        override fun logout() = Unit
        override fun switchServer() = Unit
        override fun setUserCa(on: Boolean) = Unit
    }

    private fun settingsPhoto(name: String, dark: Boolean, device: String, update: UpdateUiState = UpdateUiState(),
                                  font: Float = 1f, language: String? = GERMAN) {
        val vm = settings()
        show(name, dark = dark, device = device, font = font, language = language) {
            SettingsScreen(
                condition = SettingsState(AppUiState(serverUrl = "https://brick.example.org"), update,
                    "system", Design.CLASSIC, false, false, false, false),
                actions = vm, update = noUpdate, appearance = noRendering, exits = noExits, scrollState = androidx.compose.foundation.rememberScrollState(),
            )
        }
        // The update card stands further down: without scrolling the progress was missing from the image.
        update.progress?.let { p ->
            compose.onNodeWithText(ApplicationProvider.getApplicationContext<Context>()
                .getString(R.string.update_downloading, p)).performScrollTo()
        }
        pause()
        photo(name, dark = dark, device = device)
    }

    @Test fun settingsPhone() = settingsPhoto("einstellungen", false, "telefon")
    @Test fun settingsTabletDark() = settingsPhoto("einstellungen", true, "tablet")
    @Test fun settingsFont200() = settingsPhoto("einstellungen-schrift200", false, "telefon", font = 2f)
    @Test fun settingsEnglish() = settingsPhoto("einstellungen-en", false, "telefon", language = ENGLISH)

    @Test fun updateLoads() = settingsPhoto("update-laedt", false, "telefon",
        UpdateUiState(checked = true, progress = 42,
            newerVersion = UpdateDescription(versionCode = 240, versionName = "2.4.0", apkUrl = "https://brick.example.org/app.apk")))

    // Without a camera only the overlay: frame, hint, light and close.
    private fun scannerPhoto(device: String) {
        show("scanner", device = device, wait = false) {
            BarcodeScannerScreen(onResult = {}, onDismiss = {}, withoutCamera = true)
        }
        pause()
        photo("scanner", dark = true, device = device)
    }

    @Test fun scannerPhone() = scannerPhoto("telefon")
    @Test fun scannerTablet() = scannerPhoto("tablet")

    @Test
    fun scannerPermission() {
        show("scanner-erlaubnis", wait = false) {
            Box(Modifier.fillMaxSize()
                .background(Color.Black)) {
                CameraPermissionHint(stringResource(R.string.scanner_camera_purpose_barcode),
                    stringResource(R.string.scanner_number_type_in), typeInOn = {}, onAllow = {})
            }
        }
        pause()
        photo("scanner-erlaubnis", dark = true)
    }

    private fun barcodePhoto(dark: Boolean) {
        val condition = BarcodeDialogState(AppUiState(), ScopeUiState(),
            BarcodeUiState(result = "75192-1", setName = "Millennium Falcon", ownershipQuantity = 1), StorageUiState())
        showDialog("dialog-barcode-ergebnis", dark = dark) { BarcodeResultDialog(condition, entryVm(), images) }
        dialogPhoto("dialog-barcode-ergebnis", "classic", dark, "telefon", 1f)
    }

    @Test fun dialogBarcodeResult() = barcodePhoto(false)
    @Test fun dialogBarcodeResultDark() = barcodePhoto(true)

    private fun purchases() = world.t.track(PurchasesViewModel(world.t.session, world.t.filter(), world.t.hints, world.t.changes,
        testHouseholdRepository(world.t.api), world.t.sets(),
        testFinancesRepository(world.t.api), testPartsRepository(world.t.api),
        testMinifigsRepository(world.t.api)))

    private fun purchasePricesPhoto(dark: Boolean, device: String) {
        val vm = purchases()
        show("kaufpreise", dark = dark, device = device) {
            AcquisitionManagementRoute(vm, type = ItemKind.SET, id = Examples.SET, title = "Millennium Falcon", onBack = {})
        }
        pause()
        photo("kaufpreise", dark = dark, device = device)
    }

    @Test fun purchasePricesPhone() = purchasePricesPhoto(false, "telefon")
    @Test fun purchasePricesTabletDark() = purchasePricesPhoto(true, "tablet")

    // A manually added part with two purchases: the sample data has no manual parts.
    private fun singlePartPhoto(dark: Boolean, device: String) {
        world.paths.responses["/api/v1/parts/manual"] = """{"success":true,"parts":[{"id":9,"part_number":"3001",
            "part_name":"Brick 2 x 4","color_id":5,"color_name":"Red","quantity":12,"image_local":"/beispiel/teil1.png",
            "avg_price":0.18,"avg_purchase_price":0.12}]}"""
        world.paths.responses["/api/v1/parts/3001/5/acquisitions"] = """{"success":true,"acquisitions":[
            {"id":21,"quantity":8,"purchase_price":0.96,"condition":"N","created_at":"2026-05-02T10:00:00Z"},
            {"id":22,"quantity":4,"purchase_price":0.48,"condition":"U","created_at":"2026-09-12T10:00:00Z"}],
            "totals":{"quantity":12,"amount":1.44,"priced_rows":2}}"""
        val vm = purchases()
        val parts = world.parts()
        show("einzelteil-detail", dark = dark, device = device) {
            ManualItemDetailRoute(vm, parts, world.figures(), type = ItemKind.PART, id = "3001", colorId = 5, fallbackTitle = "Brick 2 x 4",
                imageLoader = images, onBack = {}, onNavigateToAcqMgmt = { _, _, _, _ -> })
        }
        pause()
        photo("einzelteil-detail", dark = dark, device = device)
    }

    @Test fun singlePartDetailPhone() = singlePartPhoto(false, "telefon")
    @Test fun singlePartDetailTabletDark() = singlePartPhoto(true, "tablet")

    // The same response as in BackgroundWorkTest: one running and one failed job.
    private fun backgroundPhoto(dark: Boolean, device: String) {
        world.paths.responses["/api/v1/admin/auftraege"] = """{"success":true,
            "auftraege":[
              {"id":"17","type":"bilder","status":"laeuft","attempts":1,"max_attempts":5,"due_at":"2026-10-30T10:00:00Z",
               "deadline_at":null,"started_at":"2026-10-30T10:00:05Z","created_at":"2026-10-30T09:59:00Z","updated_at":null,
               "progress":{"erledigt":3,"gesamt":12,"text":"Bilder"},"error_message":null,"user_id":4,"geplant":false,"set_number":"75192-1"},
              {"id":"18","type":"preise","status":"fehler","attempts":3,"max_attempts":3,"due_at":"2026-10-30T11:00:00Z",
               "deadline_at":null,"started_at":null,"created_at":"2026-10-30T09:00:00Z","updated_at":null,
               "progress":null,"error_message":"BrickLink antwortet nicht","user_id":null,"geplant":true,"set_number":null}],
            "zusammenfassung":[{"type":"bilder","status":"laeuft","anzahl":1}],
            "pausen":[{"type":"preise","until_at":"2026-10-30T12:00:00Z","reason":"Kontingent"}],
            "bildbedarf":7,
            "job_prozess":{"lebenszeichen":null,"alter_sekunden":null,"laeuft":true}}"""
        val api = world.t.api
        val vm = MonitoringViewModel(testManagementRepository(api), testAccountRepository(api), world.t.messages)
        runBlocking { vm.loadBackground() }
        val events = CacheEvents({}, {}, { _, _ -> }, {}, {}, {}, { _, _, _ -> })
        val background = vm.background.value
        show("hintergrundarbeiten", dark = dark, device = device, wait = false) {
            // Wi-Fi allowed, the others not: both switch positions in the image.
            MonitoringScreen(MonitoringState(MonitoringUiState(), background, ManagementUiState(),
                mapOf(PrewarmNetwork.WIFI to true), Design.CLASSIC, 0L), vm, events)
        }
        pause()
        photo("hintergrundarbeiten", dark = dark, device = device)
    }

    @Test fun backgroundWorkPhone() = backgroundPhoto(false, "telefon")
    @Test fun backgroundWorkTabletDark() = backgroundPhoto(true, "tablet")

    @Test
    fun voucherForm() {
        world.paths.responses["/api/v1/vouchers"] = """{"success":true,"vouchers":[]}"""
        val vm = world.t.track(VoucherViewModel(testVouchersRepository(world.t.api), ContextTexts(),
            object : FileReader {
                override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null
            }, world.t.messages))
        show("gutschein-formular") {
            VouchersRoute(vm, remember { SnackbarHostState() }, onBack = {})
        }
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        compose.onNode(androidx.compose.ui.test.hasText(ctx.getString(R.string.vouchers_add)) and
            androidx.compose.ui.test.hasClickAction()).performClick()
        compose.waitForIdle()
        sheetRaise()
        // Recognized by the PIN field: the sheet's title also stands on the button below.
        sheetPhoto(R.string.vouchers_pin, "gutschein-formular", "classic", false, "telefon")
    }

    @Test
    fun householdCode() {
        world.paths.responses["/api/v1/settings/household"] = """{"success":true,"is_main":true,"currency":"CHF",
            "sub_accounts":[{"id":2,"username":"lena"}],"open_invites":0}"""
        world.paths.responses["/api/v1/settings/household/invite"] = """{"success":true,"code":"K7QF-2M9X","expires_in":86400}"""
        val vm = world.t.track(HouseholdViewModel(world.t.session, world.t.filter(), world.t.sync,
            testHouseholdRepository(world.t.api), testAccountRepository(world.t.api))).also { it.now = { FIXED_TIME }; it.loadHousehold() }
        show("haushalt-code", ready = { vm.householdState.value.status != null }, condition = { vm.householdState.value }) {
            HouseholdRoute(vm, remember { SnackbarHostState() }, onBack = {})
        }
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        compose.onNodeWithText(ctx.getString(R.string.household_invite_create)).performScrollTo().performClick()
        provide("haushalt-code (Code)", { vm.householdState.value.inviteCode != null }, { vm.householdState.value })
        compose.onNodeWithText(ctx.getString(R.string.household_invite_share)).performScrollTo()
        pause()
        photo("haushalt-code")
    }

    private fun csvRunningPhoto(dark: Boolean, device: String) {
        show("csv-import-laeuft", dark = dark, device = device, wait = false) {
            Column {
                CsvImportBanner(CsvProgress(done = 37, total = 120, current = "75192-1 Millennium Falcon",
                    ok = 35, warn = 1, err = 1), running = true, onCancel = {})
            }
        }
        pause()
        photo("csv-import-laeuft", dark = dark, device = device)
    }

    @Test fun csvImportRunningPhone() = csvRunningPhoto(false, "telefon")
    @Test fun csvImportRunningTabletDark() = csvRunningPhoto(true, "tablet")

    // ── What had no reference image yet, each light, dark and 200 % ──
    // Name with „-schrift200“ at large font, otherwise as above. Everything with fixed data:
    // the images are created in CI and must be the same on every run.

    private fun level(name: String, font: Float) = if (font == 2f) "$name-schrift200" else name

    /** Sign in with the passkey button; with [code] the second stage including „Passkey statt Code“. */
    private fun loginPasskeyPhoto(code: Boolean, dark: Boolean, font: Float) {
        val name = level(if (code) "anmelden-code" else "anmelden-passkey", font)
        show(name, dark = dark, font = font) {
            LoginScreen(
                LoginScreenState(serverUrl = "https://brick.example.org", codeNeeded = code, registrationOpen = true),
                object : LoginActions {
                    override val offersPasskey get() = true
                },
            )
        }
        pause()
        photo(name, dark = dark)
    }

    @Test fun loginPasskeyLight() = loginPasskeyPhoto(false, false, 1f)
    @Test fun loginPasskeyDark() = loginPasskeyPhoto(false, true, 1f)
    @Test fun loginPasskeyFont200() = loginPasskeyPhoto(false, false, 2f)
    @Test fun loginCodeLight() = loginPasskeyPhoto(true, false, 1f)
    @Test fun loginCodeDark() = loginPasskeyPhoto(true, true, 1f)
    @Test fun loginCodeFont200() = loginPasskeyPhoto(true, false, 2f)

    /** The QR scanner during setup without a camera: Robolectric grants no permission, the hint stands there. */
    private fun setUpQrPhoto(dark: Boolean, font: Float) {
        val name = level("einrichten-qr", font)
        show(name, dark = dark, font = font) {
            SetupScreen(currentUrl = "", onSave = {}, development = false)
        }
        compose.onNodeWithText(ApplicationProvider.getApplicationContext<Context>().getString(R.string.setup_scan_qr))
            .performScrollTo().performClick()
        compose.waitForIdle()
        pause()
        photo(name, dark = dark)
    }

    @Test fun setUpQrLight() = setUpQrPhoto(false, 1f)
    @Test fun setUpQrDark() = setUpQrPhoto(true, 1f)
    @Test fun setUpQrFont200() = setUpQrPhoto(false, 2f)

    /** The hint about a new version, as the app shows it after the check. */
    private fun updateDialogPhoto(dark: Boolean, font: Float) {
        val name = level("dialog-update", font)
        val updateState = MutableStateFlow(UpdateUiState(checked = true,
            newerVersion = UpdateDescription(versionCode = 240, versionName = "2.4.0", apkUrl = "https://brick.example.org/app.apk")))
        val source = object : UpdateActions.WithState, UpdateActions by noUpdate {
            override val uiState = updateState
        }
        showDialog(name, dark = dark, font = font) { UpdateRoute(source) }
        dialogPhoto(name, "classic", dark, "telefon", font)
    }

    @Test fun dialogUpdateLight() = updateDialogPhoto(false, 1f)
    @Test fun dialogUpdateDark() = updateDialogPhoto(true, 1f)
    @Test fun dialogUpdateFont200() = updateDialogPhoto(false, 2f)

    /** The question about a new server certificate with a fingerprint to compare. */
    private fun certificatePhoto(dark: Boolean, font: Float) {
        val name = level("dialog-zertifikat", font)
        val question = CertificateUnresolved("brick.example.org:443",
            "3F:A1:09:7C:22:5D:E8:41:9B:0C:66:D2:7A:13:F4:88:51:2E:C9:07:B6:4D:30:9A:E1:75:2C:68:0F:D3:4B:91",
            CertificateUnresolved.Kind.FIRST_CONTACT)
        showDialog(name, dark = dark, font = font) {
            CertificateDialog(question, userCaEnabled = false, trustOn = { true }, onUserCa = {}, onCancel = {})
        }
        dialogPhoto(name, "classic", dark, "telefon", font)
    }

    @Test fun dialogCertificateLight() = certificatePhoto(false, 1f)
    @Test fun dialogCertificateDark() = certificatePhoto(true, 1f)
    @Test fun dialogCertificateFont200() = certificatePhoto(false, 2f)

    /** Account, scrolled to [section]: the list of devices or the second factor. */
    private fun accountSectionPhoto(name: String, section: Int, dark: Boolean, font: Float) {
        world.paths.responses["/api/v1/auth/profile"] = """{"success":true,"user":{"id":1,"username":"marco",
            "email":"marco@example.org","first_name":"Marco","last_name":"Muster","email_verified":true}}"""
        world.paths.responses["/api/v1/auth/zweiter-faktor"] = """{"success":true,"aktiv":true,"codes_uebrig":8}"""
        world.paths.responses["/api/v1/settings/theme"] = """{"success":true,"theme":"classic","vorgabe":"classic"}"""
        world.paths.responses["/api/v1/settings/tokens"] = """{"success":true,"tokens":[
            {"token_id":"a1","label":"Pixel 8","created_at":"2026-09-01T10:00:00Z","last_used":"2026-11-02T18:00:00Z","aktuell":true,"scope":"app"},
            {"token_id":"b2","label":"Galaxy Tab","created_at":"2026-06-12T10:00:00Z","last_used":"2026-10-20T08:00:00Z","scope":"app"}]}"""
        val account = world.t.track(AccountViewModel(testAccountRepository(world.t.api, world.t.io),
            world.t.messages, world.t.session, SessionFake()))
        val full = level(name, font)
        show(full, dark = dark, font = font) {
            AccountRoute(snackbarHostState = remember { SnackbarHostState() }, account = account, onBack = {})
        }
        compose.onNodeWithText(ApplicationProvider.getApplicationContext<Context>().getString(section)).performScrollTo()
        pause()
        photo(full, dark = dark)
    }

    @Test fun accountDevicesLight() = accountSectionPhoto("konto-geraete", R.string.tokens_title, false, 1f)
    @Test fun accountDevicesDark() = accountSectionPhoto("konto-geraete", R.string.tokens_title, true, 1f)
    @Test fun accountDevicesFont200() = accountSectionPhoto("konto-geraete", R.string.tokens_title, false, 2f)
    @Test fun accountSecondFactorLight() = accountSectionPhoto("konto-zweiter-faktor", R.string.zf_title, false, 1f)
    @Test fun accountSecondFactorDark() = accountSectionPhoto("konto-zweiter-faktor", R.string.zf_title, true, 1f)
    @Test fun accountSecondFactorFont200() = accountSectionPhoto("konto-zweiter-faktor", R.string.zf_title, false, 2f)

    // ── Leer ──

    private fun financesEmptyPhoto(dark: Boolean, font: Float) {
        val name = level("finanzen-leer", font)
        world.paths.responses["/api/v1/finance/valuation"] = """{"success":true,"currency":"CHF","sets":[],
            "totals":{"min":"0.00","avg":"0.00","max":"0.00","qty_avg":"0.00"}}"""
        world.paths.responses["/api/v1/finance/pnl"] = """{"success":true,"currency":"CHF","totals":{"purchase":"0.00","current":"0.00",
            "grand_total":"0.00","sets_purchase":"0.00","positionen":0,"positionen_bewertet":0},"sets":[]}"""
        world.paths.responses["/api/v1/finance/portfolio-history"] = """{"success":true,"currency":"CHF","period":"week","points":[]}"""
        val vm = world.finances().also { it.loadValuation(); it.loadPortfolioHistory("week") }
        show(name, dark = dark, font = font, ready = { vm.financeState.value.let { !it.valuationLoad.loading && !it.history.loading } },
            condition = { vm.financeState.value }) { FinanceRoute(vm = vm, imageLoader = images) }
        pause()
        photo(name, dark = dark)
    }

    @Test fun financesEmptyLight() = financesEmptyPhoto(false, 1f)
    @Test fun financesEmptyDark() = financesEmptyPhoto(true, 1f)
    @Test fun financesEmptyFont200() = financesEmptyPhoto(false, 2f)

    private fun minifigsPhoto(name: String, dark: Boolean, font: Float, error: Boolean) {
        val full = level(name, font)
        if (error) {
            loadGermanBeforeThe()
            world.paths.codes["/api/v1/minifigs"] = 500
        } else {
            world.paths.responses["/api/v1/minifigs"] = """{"success":true,"figs":[]}"""
        }
        val vm = world.figures().also { it.loadMinifigs() }
        show(full, dark = dark, font = font, ready = { !vm.minifigsState.value.minifigsFetch.loading },
            condition = { vm.minifigsState.value }) { MinifigsRoute(vm = vm, imageLoader = images) }
        pause()
        photo(full, dark = dark)
    }

    @Test fun minifigsEmptyLight() = minifigsPhoto("figuren-leer", false, 1f, error = false)
    @Test fun minifigsEmptyDark() = minifigsPhoto("figuren-leer", true, 1f, error = false)
    @Test fun minifigsEmptyFont200() = minifigsPhoto("figuren-leer", false, 2f, error = false)
    @Test fun minifigsErrorLight() = minifigsPhoto("figuren-fehler", false, 1f, error = true)
    @Test fun minifigsErrorDark() = minifigsPhoto("figuren-fehler", true, 1f, error = true)
    @Test fun minifigsErrorFont200() = minifigsPhoto("figuren-fehler", false, 2f, error = true)

    private fun locationsEmptyPhoto(dark: Boolean, font: Float) {
        val name = level("lagerorte-leer", font)
        world.paths.responses["/api/v1/storage/locations"] = """{"success":true,"orte":[]}"""
        val vm = settings().also { it.loadOwnLocations() }
        show(name, dark = dark, font = font) { LocationsRoute(vm, remember { SnackbarHostState() }, onBack = {}) }
        pause()
        photo(name, dark = dark)
    }

    @Test fun locationsEmptyLight() = locationsEmptyPhoto(false, 1f)
    @Test fun locationsEmptyDark() = locationsEmptyPhoto(true, 1f)
    @Test fun locationsEmptyFont200() = locationsEmptyPhoto(false, 2f)

    private fun priceAlertsEmptyPhoto(dark: Boolean, font: Float) {
        val name = level("preisalarme-leer", font)
        world.paths.responses["/api/v1/alerts"] = """{"success":true,"alerts":[]}"""
        val vm = settings()
        show(name, dark = dark, font = font) {
            PriceAlarmsRoute(vm = vm, imageLoader = images, serverUrl = "",
                snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onBack = {}, reportToggle = {})
        }
        pause()
        photo(name, dark = dark)
    }

    @Test fun priceAlertsEmptyLight() = priceAlertsEmptyPhoto(false, 1f)
    @Test fun priceAlertsEmptyDark() = priceAlertsEmptyPhoto(true, 1f)
    @Test fun priceAlertsEmptyFont200() = priceAlertsEmptyPhoto(false, 2f)

    /** A main account without linked accounts and without an open invitation. */
    private fun householdEmptyPhoto(dark: Boolean, font: Float) {
        val name = level("haushalt-leer", font)
        world.paths.responses["/api/v1/settings/household"] = """{"success":true,"is_main":true,"currency":"CHF",
            "sub_accounts":[],"open_invites":0}"""
        val vm = world.t.track(HouseholdViewModel(world.t.session, world.t.filter(), world.t.sync,
            testHouseholdRepository(world.t.api), testAccountRepository(world.t.api, world.t.io))).also { it.loadHousehold() }
        show(name, dark = dark, font = font, ready = { vm.householdState.value.status != null },
            condition = { vm.householdState.value }) {
            HouseholdRoute(vm, remember { SnackbarHostState() }, onBack = {})
        }
        pause()
        photo(name, dark = dark)
    }

    @Test fun householdEmptyLight() = householdEmptyPhoto(false, 1f)
    @Test fun householdEmptyDark() = householdEmptyPhoto(true, 1f)
    @Test fun householdEmptyFont200() = householdEmptyPhoto(false, 2f)

    // ── Fehler ──

    private fun accountErrorPhoto(dark: Boolean, font: Float) {
        val name = level("konto-fehler", font)
        loadGermanBeforeThe()
        world.paths.codes["/api/v1/auth/profile"] = 500
        val account = world.t.track(AccountViewModel(testAccountRepository(world.t.api, world.t.io),
            world.t.messages, world.t.session, SessionFake()))
        show(name, dark = dark, font = font) {
            AccountRoute(snackbarHostState = remember { SnackbarHostState() }, account = account, onBack = {})
        }
        pause()
        photo(name, dark = dark)
    }

    @Test fun accountErrorLight() = accountErrorPhoto(false, 1f)
    @Test fun accountErrorDark() = accountErrorPhoto(true, 1f)
    @Test fun accountErrorFont200() = accountErrorPhoto(false, 2f)

    private fun vouchersErrorPhoto(dark: Boolean, font: Float) {
        val name = level("gutscheine-fehler", font)
        loadGermanBeforeThe()
        world.paths.codes["/api/v1/vouchers"] = 500
        val vm = world.t.track(VoucherViewModel(testVouchersRepository(world.t.api), ContextTexts(),
            object : FileReader {
                override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null
            }, world.t.messages))
        show(name, dark = dark, font = font) { VouchersRoute(vm, remember { SnackbarHostState() }, onBack = {}) }
        pause()
        photo(name, dark = dark)
    }

    @Test fun vouchersErrorLight() = vouchersErrorPhoto(false, 1f)
    @Test fun vouchersErrorDark() = vouchersErrorPhoto(true, 1f)
    @Test fun vouchersErrorFont200() = vouchersErrorPhoto(false, 2f)

    /** Added without network: hint with state, one pending change and the message for it. */
    private fun addOfflinePhoto(dark: Boolean, font: Float) {
        val name = level("erfassen-offline", font)
        val gallery = world.gallery().also { it.loadSets(); it.loadStats() }
        val message = SnackbarHostState()
        val text = ApplicationProvider.getApplicationContext<Context>().resources
            .getQuantityString(R.plurals.offline_outbox, 1, 1)
        show(name, dark = dark, font = font, ready = galleryDone(gallery), condition = { gallery.galleryState.value }) {
            Scaffold(gallery, snackbar = message, pendingChanges = 1, offlineStatus = 1_793_000_000_000L)
            LaunchedEffect(Unit) { message.showSnackbar(text, duration = SnackbarDuration.Indefinite) }
        }
        pause()
        photo(name, dark = dark)
    }

    @Test fun addOfflineLight() = addOfflinePhoto(false, 1f)
    @Test fun addOfflineDark() = addOfflinePhoto(true, 1f)
    @Test fun addOfflineFont200() = addOfflinePhoto(false, 2f)

    /** The frame around the destination with keyboard focus, here the price comparison on the page “More”. */
    private fun focusPhoto(dark: Boolean, font: Float) {
        val name = level("fokusrahmen", font)
        show(name, dark = dark, font = font) {
            val mode = LocalInputModeManager.current
            LaunchedEffect(Unit) { mode.requestInputMode(InputMode.Keyboard) }
            MoreScreen({}, isAdmin = false, updateAvailable = false, onLogout = {})
        }
        val target = ApplicationProvider.getApplicationContext<Context>().getString(R.string.nav_comparison)
        compose.onNode(hasText(target) and hasClickAction()).performSemanticsAction(SemanticsActions.RequestFocus)
        compose.waitForIdle()
        pause()
        photo(name, dark = dark)
    }

    @Test fun focusFrameLight() = focusPhoto(false, 1f)
    @Test fun focusFrameDark() = focusPhoto(true, 1f)
    @Test fun focusFrameFont200() = focusPhoto(false, 2f)
}

/** A fixed point in time for images that show a date (5.11.2026, 23:33 UTC). */
private const val FIXED_TIME = 1_793_921_600_000L

/** The photo shows the empty page; nothing on it is pressed. */
private object NoComparison : ComparisonActions {
    override fun setSearch(text: String) = Unit
    override fun clearSearch() = Unit
    override fun openScanner() = Unit
    override fun closeScanner() = Unit
    override fun scanned(barcode: String) = Unit
    override fun search() = Unit
    override fun queryOpened() = Unit
}
