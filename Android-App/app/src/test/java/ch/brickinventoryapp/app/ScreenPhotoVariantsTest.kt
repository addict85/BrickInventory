package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.testing.text
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.domain.Katalogsortierung
import ch.brickinventoryapp.parts.ui.PartsListAndDetailRoute
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.model.domain.Zustand
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.navigation.NavDestination.Companion.hasRoute
import android.os.Looper
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Density
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.compose.runtime.getValue
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.resources.R
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.testing.testMinifigsRepository
import ch.brickinventoryapp.testing.testFinancesRepository
import ch.brickinventoryapp.testing.testHouseholdRepository
import ch.brickinventoryapp.testing.testCatalogRepository
import ch.brickinventoryapp.testing.testSetsRepository
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.login.ui.AnmeldeFormular
import ch.brickinventoryapp.app.csv.CsvImportUiState
import ch.brickinventoryapp.finances.ui.screens.FinanceRoute
import ch.brickinventoryapp.collection.ui.screens.GalleryRoute
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.collection.ui.screens.WantedRoute
import ch.brickinventoryapp.parts.ui.screens.MinifigsRoute
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.parts.ui.PlPart
import ch.brickinventoryapp.parts.ui.PlSet
import ch.brickinventoryapp.collection.ui.screens.SetDetailRoute
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.coroutines.runBlocking
import ch.brickinventoryapp.data.VorwaermNetwork
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale
import ch.brickinventoryapp.catalog.ui.CatalogUiState
import ch.brickinventoryapp.account.ui.AccountUiState
import ch.brickinventoryapp.parts.ui.TeilelisteUiState
import ch.brickinventoryapp.account.ui.ZweiterFaktorUiState
import ch.brickinventoryapp.ui.components.OfflineHint
import ch.brickinventoryapp.model.domain.BrickLinkView
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.domain.KatalogSetAnsicht
import ch.brickinventoryapp.collection.ui.screens.AddSetDialog
import ch.brickinventoryapp.collection.ui.screens.GalleryAndDetail
import ch.brickinventoryapp.catalog.ui.screens.CatalogDetailScreen
import ch.brickinventoryapp.catalog.ui.screens.CatalogScreen
import ch.brickinventoryapp.collection.ui.screens.ComparisonScreen
import ch.brickinventoryapp.account.ui.screens.CsvImportRoute
import ch.brickinventoryapp.account.ui.screens.HouseholdRoute
import ch.brickinventoryapp.account.ui.screens.AccountRoute
import ch.brickinventoryapp.account.ui.screens.LocationsRoute
import ch.brickinventoryapp.parts.ui.screens.PartsListScreen
import ch.brickinventoryapp.account.ui.screens.PreisalarmeRoute
import ch.brickinventoryapp.login.ui.screens.SetupScreen
import ch.brickinventoryapp.account.ui.screens.StartPasswordMask
import ch.brickinventoryapp.account.ui.screens.ZweiterFaktorPflichtMaske
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.GalleryViewModel
import ch.brickinventoryapp.account.ui.viewmodel.HouseholdViewModel
import ch.brickinventoryapp.catalog.ui.viewmodel.KatalogAktionen
import ch.brickinventoryapp.account.ui.viewmodel.AccountViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailViewModel
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.view.ViewGroup
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.SnackbarDuration
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.ViewRootForTest
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.TextLayoutResult
import java.time.Duration
import org.junit.Assert
import org.robolectric.Shadows
import org.robolectric.shadows.ShadowDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.test.performScrollTo
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.LagerUiState
import ch.brickinventoryapp.account.ui.UpdateUiState
import ch.brickinventoryapp.management.ui.ManagementUiState
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeDialogZustand
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeResultDialog
import ch.brickinventoryapp.collection.ui.screens.AcquisitionManagementRoute
import ch.brickinventoryapp.collection.ui.screens.BarcodeScannerScreen
import ch.brickinventoryapp.management.ui.screens.CacheEvents
import ch.brickinventoryapp.app.ui.components.CsvImportBanner
import ch.brickinventoryapp.account.ui.screens.EinstellungenZustand
import ch.brickinventoryapp.finances.ui.screens.VouchersRoute
import ch.brickinventoryapp.ui.screens.CameraPermissionHint
import ch.brickinventoryapp.parts.ui.screens.ManualItemDetailRoute
import ch.brickinventoryapp.management.ui.screens.MonitoringScreen
import ch.brickinventoryapp.management.ui.screens.MonitoringState
import ch.brickinventoryapp.account.ui.screens.SettingsScreen
import ch.brickinventoryapp.state.ui.viewmodel.DarstellungAktionen
import ch.brickinventoryapp.finances.ui.viewmodel.GutscheinViewModel
import ch.brickinventoryapp.state.ui.viewmodel.KaeufeViewModel
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
import ch.brickinventoryapp.account.ui.viewmodel.UpdateAktionen
import ch.brickinventoryapp.update.util.UpdateBeschreibung
import ch.brickinventoryapp.testing.testVouchersRepository
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.SessionFake
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.app.nav.AppTarget
import ch.brickinventoryapp.collection.ui.SammlungZiel
import ch.brickinventoryapp.account.ui.dialogs.UpdateRoute
import ch.brickinventoryapp.app.ui.components.CertificateDialog
import ch.brickinventoryapp.security.CertificateUnresolved
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.test.performSemanticsAction

/**
 * What ScreenPhotoTest does not cover, once each instead of in the full grid (the
 * run time grows with every image): the three remaining designs, English (en-GB),
 * font 130 % and 200 %, the scaffold with app bar and the page “More”,
 * dialogs, loading, error and empty state, the detail with four-digit amounts
 * on 360 dp, list and detail on the tablet as well as the subpages storage locations,
 * household, CSV import and the build list. As there in German (de-CH),
 * where `-en` does not stand in the name. Names as there:
 * `<bildschirm>[-variant]_<design>_<hell|dunkel>_<gerät>.png`; device `quer` is the
 * phone in landscape. Plus the catalog as a list, empty and failed tabs,
 * tablet at 200 % and the sign-in in landscape and at 200 %.
 *
 * Counter-check as with ScreenPhotoTest only possible with checked-in references
 * (change a color in Theme.kt → verifyRoborazziDebug red); not measurable
 * here without the Android SDK. The dialogs at 200 % additionally check that the font
 * arrives in the dialog window — counter-check dialog-schrift-nur-lokal: without
 * setFontScale → red “dialogSetAddSchrift200” (font does not reach the dialog).
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

    private val world = Examples.Welt(ContextTexts())
    private val bilder = SampleImages.loader(ApplicationProvider.getApplicationContext())
    private val vorher = Locale.getDefault()

    @After
    fun zu() {
        Locale.setDefault(vorher)
        world.close()
    }

    /** Like ScreenPhotoTest.bereitstellen: drive the main looper until the world rests. */
    private fun bereitstellen(name: String, bereit: () -> Boolean, zustand: () -> Any?) {
        driveUntil(name, requests = { world.paths.requests.size }, zustand = zustand, bereit = bereit)
    }

    // Workbench is a dark design without a light version; „hell“ in the name was misleading.
    private fun pfad(name: String, design: String, dunkel: Boolean, geraet: String) =
        "src/test/bildschirmfotos/${name}_${design}_${if (dunkel || design == "werkbank") "dunkel" else "hell"}_$geraet.png"

    /**
     * Shows [inhalt] and waits for the data; the caller takes the photo so that
     * it can tap before (More, dialog) or stop the clock (loading).
     */
    private fun zeige(
        name: String, design: String = "classic", dunkel: Boolean = false, geraet: String = "telefon",
        sprache: String? = GERMAN, schrift: Float = 1f, bereit: () -> Boolean = { true }, zustand: () -> Any? = { null },
        warten: Boolean = true, inhalt: @Composable () -> Unit,
    ) {
        val mask = when (geraet) {
            "tablet" -> "w1280dp-h800dp-land-xhdpi"
            "schmal" -> "w360dp-h740dp-port-xxhdpi"
            "quer" -> "w891dp-h411dp-land-xxhdpi"
            else -> "w411dp-h891dp-port-xxhdpi"
        }
        RuntimeEnvironment.setQualifiers(if (sprache != null) "$sprache-$mask" else mask)
        // The font in the configuration too: a dialog has its own window and
        // takes the density from there, LocalDensity below does not reach into it.
        if (schrift != 1f) RuntimeEnvironment.setFontScale(schrift)
        if (sprache != null) Locale.setDefault(Locale.forLanguageTag(sprache.replace("-r", "-")))
        if (warten) bereitstellen(name, bereit, zustand)
        compose.setContent {
            BrickInventoryManagerTheme(theme = checkNotNull(Design.aus(design)) { design }, dunkel = dunkel) {
                val dichte = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(dichte.density, schrift)) {
                    Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
                }
            }
        }
        if (warten) {
            bereitstellen("$name (angezeigt)", bereit, zustand)
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

    private fun photo(name: String, design: String = "classic", dunkel: Boolean = false, geraet: String = "telefon") =
        compose.onRoot().captureRoboImage(pfad(name, design, dunkel, geraet))

    private fun erfassung() = world.t.merke(EntryViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise, testSetsRepository(world.t.api), world.t.setCatalog(), world.t.merkliste(),
        testCatalogRepository(world.t.api),
        object : SetCreator {
            override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Geld?, condition: Zustand?,
                                 ownerUserId: Int?, storage: String?): Flow<SetCreateStep> = emptyFlow()
        }))

    private fun galleryDone(vm: GalleryViewModel) =
        { vm.galleryState.value.let { it.sets.isNotEmpty() && it.stats != null && !it.abruf.laedt } }

    private fun detailDone(vm: SetDetailViewModel) = {
        vm.setDetailState.value.let { s ->
            s.setDetail != null && s.setPrice != null && s.priceHistory != null && s.acquisitions.isNotEmpty() &&
                !s.detailFetch.laedt && !s.priceFetch.laedt && !s.historyFetch.laedt && !s.purchasesFetch.laedt }
    }

    @Composable
    private fun Galerie(vm: GalleryViewModel) =
        GalleryRoute(vm = vm, erfassung = erfassung(), imageLoader = bilder, onScanBarcode = {}, onSetClick = {})

    @Composable
    private fun Detail(vm: SetDetailViewModel) =
        SetDetailRoute(setNumber = Examples.SET, vm = vm, serverUrl = "", imageLoader = bilder, onBack = {}, onDelete = {})

    private fun galleryPhoto(name: String, design: String = "classic", dunkel: Boolean = false,
                            sprache: String? = GERMAN, schrift: Float = 1f) {
        val vm = world.galerie().also { it.loadSets(); it.loadStats() }
        zeige(name, design, dunkel, sprache = sprache, schrift = schrift, bereit = galleryDone(vm),
            zustand = { vm.galleryState.value }) { Galerie(vm) }
        photo(name, design, dunkel)
    }

    private fun detailPhoto(name: String, design: String = "classic", dunkel: Boolean = false,
                           sprache: String? = GERMAN, schrift: Float = 1f) {
        val vm = world.setDetail()
        zeige(name, design, dunkel, sprache = sprache, schrift = schrift, bereit = detailDone(vm),
            zustand = { vm.setDetailState.value }) { Detail(vm) }
        photo(name, design, dunkel)
    }

    private fun signInPhoto(name: String, schrift: Float) {
        zeige(name, schrift = schrift) {
            LoginScreen(
                serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = false,
                formular = AnmeldeFormular.ANMELDEN, registrierungOffen = true, kontoLaeuft = false,
                kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> }, onFormular = {},
                onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
            )
        }
        photo(name)
    }

    // ── The three designs the grid in ScreenPhotoTest does not carry ──
    // One test each, because a Compose rule may draw only once per test.

    @Test fun galleryColorSlotsLight() = galleryPhoto("galerie", "farbfaecher")
    @Test fun galleryColorSlotsDark() = galleryPhoto("galerie", "farbfaecher", dunkel = true)
    @Test fun galleryGlossyLight() = galleryPhoto("galerie", "hochglanz")
    @Test fun galleryGlossyDark() = galleryPhoto("galerie", "hochglanz", dunkel = true)
    @Test fun galleryWorkbench() = galleryPhoto("galerie", "werkbank")
    @Test fun detailColorSlots() = detailPhoto("set-detail", "farbfaecher")
    @Test fun detailGlossyDark() = detailPhoto("set-detail", "hochglanz", dunkel = true)
    @Test fun detailWorkbench() = detailPhoto("set-detail", "werkbank")

    // ── Four-digit amounts on a narrow phone (360 dp) ──
    // A purchase price above CHF 1’000 in the value tiles: there „CHF 700.0 / 0“
    // wrapped, and with four digits it only got tighter.

    // All numbers of a set fit together: market price 1’249.90, purchase price 1’049.00,
    // i.e. +19.2 %. Previously purchase price 700 and +16.1 % stood next to the expensive market price.
    private fun detailExpensivePhoto(name: String, schrift: Float) {
        world.paths.antworten["/api/v1/sets/75192-1/price"] =
            """{"success":true,"set_number":"75192-1","currency":"CHF","avg_price":1249.9,"min_price":1180.0,"max_price":1320.0,"qty_avg_price":1249.9}"""
        world.paths.antworten["/api/v1/sets/75192-1/acquisitions"] = """{"success":true,"acquisitions":[
            {"id":1,"quantity":1,"purchase_price":1049.0,"condition":"N","currency":"CHF","created_at":"2026-03-14T10:00:00Z"}]}"""
        world.paths.antworten["/api/v1/sets/75192-1"] = """{"success":true,"quantity":1,"set":{"set_number":"75192-1",
            "image_local":"/beispiel/set1.png","name":"Millennium Falcon","year":2017,"theme":"Star Wars","quantity":1,
            "num_parts":7541,"minifigs":7,"added_at":"2026-03-14T10:00:00Z","avg_purchase_price":1049.0}}"""
        world.paths.antworten["/api/v1/sets/75192-1/price-history"] = """{"success":true,"set_number":"75192-1","currency":"CHF",
            "by_condition":{"N":{"market_price":1249.9,"purchase_price":1049.0,"pnl_pct":"19.2","pnl_prozent":19.2}},
            "chart":{"values":[{"name":"N","values":[{"x":"2026-08-01","y":1210.0},{"x":"2026-09-01","y":1231.0},{"x":"2026-10-01","y":1249.9}],"firstRealIndex":0}],
                     "x":["2026-08-01","2026-09-01","2026-10-01"]},
            "pnl_prozent":19.2,"purchase_price":1049.0}"""
        val vm = world.setDetail()
        zeige(name, geraet = "schmal", schrift = schrift, bereit = detailDone(vm), zustand = { vm.setDetailState.value }) { Detail(vm) }
        pause()
        photo(name, geraet = "schmal")
    }

    @Test fun detailFourDigitNarrow() = detailExpensivePhoto("set-detail-vierstellig", 1f)
    @Test fun detailFourDigitNarrowSchrift200() = detailExpensivePhoto("set-detail-vierstellig-schrift200", 2f)

    // ── English (en-GB): texts, numbers, amounts and axes ──

    @Test fun galleryEnglish() = galleryPhoto("galerie-en", sprache = ENGLISH)
    @Test fun detailEnglish() = detailPhoto("set-detail-en", sprache = ENGLISH)

    @Test
    fun financesEnglish() = financesPhoto("finanzen-en", sprache = ENGLISH)

    private fun financesPhoto(name: String, sprache: String? = GERMAN, schrift: Float = 1f) {
        val vm = world.finanzen().also { it.loadValuation(); it.loadPortfolioHistory("week") }
        zeige(name, sprache = sprache, schrift = schrift, bereit = { vm.financeState.value.let { it.valuation != null &&
            it.pnl != null && it.historyPoints.isNotEmpty() && !it.bewertung.laedt && !it.verlauf.laedt } },
            zustand = { vm.financeState.value }) { FinanceRoute(vm = vm, imageLoader = bilder) }
        photo(name)
    }

    // ── Large font: 130 % and 200 % ──

    @Test fun signInSchrift130() = signInPhoto("anmelden-schrift130", 1.3f)
    @Test fun signInSchrift200() = signInPhoto("anmelden-schrift200", 2.0f)
    @Test fun gallerySchrift130() = galleryPhoto("galerie-schrift130", schrift = 1.3f)
    @Test fun gallerySchrift200() = galleryPhoto("galerie-schrift200", schrift = 2.0f)
    @Test fun detailSchrift130() = detailPhoto("set-detail-schrift130", schrift = 1.3f)
    @Test fun detailSchrift200() = detailPhoto("set-detail-schrift200", schrift = 2.0f)
    @Test fun financesSchrift200() = financesPhoto("finanzen-schrift200", schrift = 2.0f)

    @Test
    fun wantedSchrift200() {
        val vm = world.merkliste().also { it.loadWanted() }
        zeige("merkliste-schrift200", schrift = 2.0f, bereit = { vm.wantedState.value.merkposten.isNotEmpty() },
            zustand = { vm.wantedState.value }) {
            WantedRoute(vm = vm, imageLoader = bilder, onScan = {}, onOpenSingle = { _, _ -> })
        }
        photo("merkliste-schrift200")
    }

    @Test
    fun partsEnglish() {
        val vm = world.teile().also { it.loadParts() }
        zeige("teile-en", sprache = ENGLISH, bereit = { vm.teileState.value.parts.isNotEmpty() },
            zustand = { vm.teileState.value }) { PartsRoute(vm = vm, imageLoader = bilder) }
        photo("teile-en")
    }

    @Test
    fun partsSchrift200() {
        val vm = world.teile().also { it.loadParts() }
        zeige("teile-schrift200", schrift = 2.0f, bereit = { vm.teileState.value.parts.isNotEmpty() },
            zustand = { vm.teileState.value }) { PartsRoute(vm = vm, imageLoader = bilder) }
        photo("teile-schrift200")
    }

    /** The figure grid grows with the font (ReadableColumns): long names fully readable. */
    @Test
    fun minifigsSchrift200() {
        val vm = world.figuren().also { it.loadMinifigs() }
        zeige("figuren-schrift200", schrift = 2.0f, bereit = { vm.minifigsState.value.minifigs.isNotEmpty() },
            zustand = { vm.minifigsState.value }) { MinifigsRoute(vm = vm, imageLoader = bilder) }
        photo("figuren-schrift200")
    }

    @Test
    fun vouchersSchrift200() {
        zeige("gutscheine-schrift200", schrift = 2.0f) { Gutscheine() }
        photo("gutscheine-schrift200")
    }

    // ── Scaffold: app bar with four inventory destinations and “More” ──

    @Composable
    private fun Scaffold(
        galerie: GalleryViewModel,
        snackbar: SnackbarHostState = remember { SnackbarHostState() },
        offeneAenderungen: Int = 0,
        offlineStatus: Long? = null,
    ) {
        val nav = rememberNavController()
        // The same tabs as the app, from the resources: fixed German names stood
        // in the English photo too.
        val tab = tabTheBar()
        // The title follows the destination as in the app (ToolsGraph sets nav_more): a fixed
        // „Sammlung“ showed the photo of “More” with the wrong title.
        val ziel by nav.currentBackStackEntryAsState()
        val titel = stringResource(if (ziel?.destination?.hasRoute<AppTarget.Mehr>() == true) R.string.nav_more else R.string.nav_collection)
        MainScaffold(
            title = titel, navController = nav, bottomNavItems = tab,
            snackbarHostState = snackbar,
            csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
            onCsvAbbrechen = {}, updateVerfuegbar = true, onTabAngetippt = {},
            offeneAenderungen = offeneAenderungen,
        ) {
            NavHost(nav, startDestination = SammlungZiel.Gallery) {
                composable<SammlungZiel.Gallery> {
                    Column {
                        OfflineHint(offlineStatus)
                        Galerie(galerie)
                    }
                }
                composable<AppTarget.Mehr> {
                    MehrBildschirm(onTarget = nav::openOfMore, isAdmin = true, updateVerfuegbar = true, onAbmelden = {})
                }
            }
        }
    }

    private fun scaffoldPhoto(geraet: String) {
        val galerie = world.galerie().also { it.loadSets(); it.loadStats() }
        zeige("geruest", geraet = geraet, bereit = galleryDone(galerie), zustand = { galerie.galleryState.value }) { Scaffold(galerie) }
        photo("geruest", geraet = geraet)
    }

    @Test fun scaffoldPhone() = scaffoldPhoto("telefon")
    @Test fun scaffoldTablet() = scaffoldPhoto("tablet")

    /** The switcher Sets | Parts | Minifigures at 200 %: segments, scrollable sideways, no word broken. */
    @Test
    fun scaffoldSchrift200() {
        val galerie = world.galerie().also { it.loadSets(); it.loadStats() }
        zeige("geruest-schrift200", schrift = 2.0f, bereit = galleryDone(galerie),
            zustand = { galerie.galleryState.value }) { Scaffold(galerie) }
        pause()
        photo("geruest-schrift200")
    }

    /** The page “More”: all other destinations grouped, with the dot for a new version. */
    private fun morePhoto(geraet: String, dunkel: Boolean, name: String = "mehr", schrift: Float = 1f,
                         sprache: String? = GERMAN) {
        val galerie = world.galerie().also { it.loadSets(); it.loadStats() }
        zeige(name, dunkel = dunkel, geraet = geraet, sprache = sprache, schrift = schrift, bereit = galleryDone(galerie),
            zustand = { galerie.galleryState.value }) { Scaffold(galerie) }
        // At large font only the selected destination is labelled; the others carry their name as description.
        val mehr = ApplicationProvider.getApplicationContext<Context>().getString(R.string.nav_more)
        compose.onNode((hasText(mehr) or hasContentDescription(mehr)) and hasClickAction()).performClick()
        compose.waitForIdle()
        photo(name, dunkel = dunkel, geraet = geraet)
    }

    @Test fun morePhone() = morePhoto("telefon", dunkel = true)
    @Test fun moreTablet() = morePhoto("tablet", dunkel = false)
    @Test fun moreSchrift200() = morePhoto("telefon", dunkel = false, name = "mehr-schrift200", schrift = 2f)
    @Test fun moreEnglish() = morePhoto("telefon", dunkel = false, name = "mehr-en", sprache = ENGLISH)

    // ── Dialoge ──

    /**
     * Photographs the open dialog. At large font it first checks that the font
     * arrives in the dialog window: with LocalDensity alone the 200 % photo was
     * byte-identical to the 100 % photo and proved nothing.
     */
    private fun dialogPhoto(name: String, design: String, dunkel: Boolean, geraet: String, schrift: Float) {
        if (schrift == 1f) {
            compose.onNode(isDialog()).captureRoboImage(pfad(name, design, dunkel, geraet))
            return
        }
        // A Material text field in the dialog window never comes to rest under Robolectric from 130 % font
        // (also with Android 13; in the main window it does). That is why measure and photograph
        // at the window itself here instead of via Compose's synchronization.
        val looper = shadowOf(Looper.getMainLooper())
        repeat(10) { compose.mainClock.advanceTimeBy(50); looper.idle() }
        val fenster = ShadowDialog.getLatestDialog().window!!.decorView
        val root = composeRoot(fenster) ?: error("$name: kein Compose im Dialogfenster")
        val scales = mutableListOf<Float>()
        fun collect(n: SemanticsNode) {
            val ergebnis = mutableListOf<TextLayoutResult>()
            n.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(ergebnis)
            ergebnis.firstOrNull()?.layoutInput?.density?.fontScale?.let { scales += it }
            n.children.forEach { collect(it) }
        }
        collect(root.semanticsOwner.unmergedRootSemanticsNode)
        Assert.assertTrue("$name: Schrift erreicht den Dialog nicht (Skalen $scales)",
            scales.isNotEmpty() && scales.all { it >= schrift - 0.05f })
        // Drawn ourselves: captureRoboImage(View) looks for the view via Espresso in the
        // activity and does not find the dialog window there.
        val bild = Bitmap.createBitmap(fenster.width, fenster.height, Bitmap.Config.ARGB_8888)
        fenster.draw(Canvas(bild))
        bild.captureRoboImage(pfad(name, design, dunkel, geraet))
    }

    /**
     * A dialog with a text field never comes to rest under Robolectric if it is already there
     * during construction. Therefore as with tapping: first the surface, then with the clock stopped
     * open on the UI thread and advance step by step; the window arises via the
     * main looper, not via the Compose clock.
     */
    private fun showDialog(
        name: String, dunkel: Boolean = false, geraet: String = "telefon", schrift: Float = 1f,
        dialog: @Composable () -> Unit,
    ) {
        val offen = mutableStateOf(false)
        zeige(name, dunkel = dunkel, geraet = geraet, schrift = schrift, warten = false) { if (offen.value) dialog() }
        compose.mainClock.autoAdvance = false
        compose.runOnUiThread {
            offen.value = true
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

    private fun dialogSetDeletePhoto(name: String, schrift: Float) {
        val vm = world.setDetail()
        zeige(name, design = "noppe", schrift = schrift, bereit = detailDone(vm), zustand = { vm.setDetailState.value }) { Detail(vm) }
        compose.onNodeWithContentDescription("Millennium Falcon löschen").performClick()
        compose.waitForIdle()
        dialogPhoto(name, "noppe", false, "telefon", schrift)
    }

    @Test fun deleteDialogSet() = dialogSetDeletePhoto("dialog-set-loeschen", 1f)
    @Test fun dialogSetDeleteSchrift200() = dialogSetDeletePhoto("dialog-set-loeschen-schrift200", 2f)

    /** The confirmation before sign-out — the same design as when deleting a set. */
    private fun dialogSignOutPhoto(name: String, dunkel: Boolean, geraet: String, schrift: Float) {
        zeige(name, dunkel = dunkel, geraet = geraet, schrift = schrift) {
            MehrBildschirm({}, isAdmin = false, updateVerfuegbar = true, onAbmelden = {})
        }
        compose.onNodeWithText("Abmelden").performClick()
        compose.waitForIdle()
        dialogPhoto(name, "classic", dunkel, geraet, schrift)
    }

    @Test fun signOutDialog() = dialogSignOutPhoto("dialog-abmelden", true, "telefon", 1f)
    @Test fun dialogSignOutSchrift200() = dialogSignOutPhoto("dialog-abmelden-schrift200", false, "telefon", 2f)
    @Test fun dialogSignOutTablet() = dialogSignOutPhoto("dialog-abmelden", false, "tablet", 1f)

    private fun dialogWantedItemPhoto(name: String, dunkel: Boolean, schrift: Float) {
        val vm = world.merkliste().also { it.loadWanted() }
        zeige(name, dunkel = dunkel, schrift = schrift, bereit = { vm.wantedState.value.merkposten.isNotEmpty() },
            zustand = { vm.wantedState.value }) {
            WantedRoute(vm = vm, imageLoader = bilder, onScan = {}, onOpenSingle = { _, _ -> })
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
        dialogPhoto(name, "classic", dunkel, "telefon", schrift)
    }

    @Test fun createDialogWantedItem() = dialogWantedItemPhoto("dialog-merkposten", true, 1f)
    @Test fun dialogWantedItemSchrift200() = dialogWantedItemPhoto("dialog-merkposten-schrift200", false, 2f)

    // ── List and detail side by side (tablet) ──

    @Test
    fun wantedWithDetailTablet() {
        // The detail shows the same price as the row next to it (449.95), instead of „wird geladen“.
        world.paths.antworten["/api/v1/wanted/10294-1/preise"] = """{"success":true,"currency":"CHF",
            "current":{"N":{"condition":"N","avg_price":449.95,"min_price":420.0,"max_price":480.0}}}"""
        world.paths.antworten["/api/v1/catalog/sets/10294-1"] = """{"success":true,"set":{"set_number":"10294-1",
            "name":"Titanic","year":2021,"theme_name":"Icons","num_parts":9090,"image_local":"/beispiel/set2.png","minifigs":0}}"""
        world.paths.antworten["/api/v1/sets/10294-1/price-history"] = """{"success":true,"set_number":"10294-1","currency":"CHF",
            "by_condition":{"N":{"market_price":449.95}},
            "chart":{"values":[{"name":"N","values":[{"x":"2026-08-01","y":431.0},{"x":"2026-09-01","y":440.0},{"x":"2026-10-01","y":449.95}],"firstRealIndex":0}],
                     "x":["2026-08-01","2026-09-01","2026-10-01"]}}"""
        val vm = world.merkliste().also { it.loadWanted() }
        zeige("merkliste-detail", geraet = "tablet", bereit = { vm.wantedState.value.merkposten.isNotEmpty() },
            zustand = { vm.wantedState.value }) {
            WantedRoute(vm = vm, imageLoader = bilder, sideBySide = true,
                onScan = {}, onOpenSingle = { _, _ -> })
        }
        compose.onNode(androidx.compose.ui.test.hasText("Titanic", substring = true) and
            androidx.compose.ui.test.hasClickAction()).performClick()
        // Erst komponieren: Das Detail startet sein Laden selbst (LaunchedEffect).
        compose.waitForIdle()
        // Photograph only when price and history are there — otherwise „Preis wird geladen“ stood
        // next to the price in the list.
        bereitstellen("merkliste-detail (offen)", { vm.wantedItemDetailState.value.let { !it.abruf.laedt && it.preise != null } },
            { vm.wantedItemDetailState.value })
        compose.waitForIdle()
        pause()
        photo("merkliste-detail", geraet = "tablet")
    }

    /** Gallery and set detail side by side, as the tablet shows them after a tap. */
    @Test
    fun galleryWithDetailTablet() {
        val galerie = world.galerie().also { it.loadSets(); it.loadStats() }
        val detail = world.setDetail()
        zeige("galerie-mit-detail", geraet = "tablet", bereit = { galleryDone(galerie)() && detailDone(detail)() },
            zustand = { galerie.galleryState.value }) {
            GalleryAndDetail(galerie, erfassung(), bilder, offen = Examples.SET, onSetClick = {}, onScanBarcode = {}) {
                Detail(detail)
            }
        }
        pause()
        photo("galerie-mit-detail", geraet = "tablet")
    }

    // ── Subpages and adding that had no photo before (I2) ──

    private fun einstellungen() = world.t.merke(SettingsViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise, world.t.sync,
        testAccountRepository(world.t.api, world.t.io), testManagementRepository(world.t.api),
        world.t.alerts(), testPartsRepository(world.t.api),
        object : FileReader {
            override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null
        }))

    @Test fun lagerorte() = locationsPhoto("lagerorte", 1f)
    @Test fun locationsSchrift200() = locationsPhoto("lagerorte-schrift200", 2f)

    private fun locationsPhoto(name: String, schrift: Float) {
        world.paths.antworten["/api/v1/storage/locations"] = """{"success":true,"orte":[
            {"id":3,"name":"Keller"},{"id":4,"name":"Estrich"},{"id":5,"name":"Regal Wohnzimmer"}]}"""
        // Load before showing: zeige() already waits for the data before setContent, and
        // without a call here only the screen itself would ask.
        val vm = einstellungen().also { it.loadOwnLocations() }
        zeige(name, schrift = schrift, bereit = { vm.storageState.value.eigene.size == 3 }, zustand = { vm.storageState.value }) {
            LocationsRoute(vm, remember { SnackbarHostState() }, onZurueck = {})
        }
        pause()
        photo(name)
    }

    @Test
    fun csvImport() {
        val vm = einstellungen()
        zeige("csv-import") {
            CsvImportRoute(vm, remember { SnackbarHostState() }, onZurueck = {})
        }
        pause()
        photo("csv-import")
    }

    @Test
    fun haushalt() {
        world.paths.antworten["/api/v1/settings/household"] = """{"success":true,"is_main":true,"currency":"CHF",
            "sub_accounts":[{"id":2,"username":"lena"},{"id":3,"username":"tim"}],"open_invites":1}"""
        val vm = world.t.merke(HouseholdViewModel(world.t.sitzung, world.t.filter(), world.t.sync,
            testHouseholdRepository(world.t.api), testAccountRepository(world.t.api, world.t.io))).also { it.loadHousehold() }
        zeige("haushalt", bereit = { vm.householdState.value.status != null }, zustand = { vm.householdState.value }) {
            HouseholdRoute(vm, remember { SnackbarHostState() }, onZurueck = {})
        }
        pause()
        photo("haushalt")
    }

    @Test fun bauliste() = buildListPhoto("bauliste", TeilelisteUiState(), 1f)
    @Test fun buildListWithContent() = buildListPhoto("bauliste-inhalt", buildListFilled, 1f)
    @Test fun buildListWithContentSchrift200() = buildListPhoto("bauliste-inhalt-schrift200", buildListFilled, 2f)

    /** Two sets, generated, with stock: color groups, quantities and „vorhanden“ stand in the image. */
    private val buildListFilled = TeilelisteUiState(
        sets = listOf(PlSet("75192-1", "Millennium Falcon"), PlSet("21318-1", "Baumhaus")),
        parts = listOf(
            PlPart(partNumber = "3001", partName = "Brick 2 x 4", colorName = "Red", colorHex = "C91A09",
                colorId = 4, quantity = 12, imageUrl = null, imageLocal = "/beispiel/teil1.png", vorhanden = 8),
            PlPart(partNumber = "3020", partName = "Plate 2 x 4", colorName = "Light Bluish Gray", colorHex = "A0A5A9",
                colorId = 71, quantity = 30, imageUrl = null, vorhanden = 30),
            PlPart(partNumber = "sw0001", partName = "Luke Skywalker", colorName = "", colorHex = null,
                quantity = 1, imageUrl = null, isFig = true, vorhanden = 0),
        ),
        generated = true,
    )

    private fun buildListPhoto(name: String, zustand: TeilelisteUiState, schrift: Float) {
        zeige(name, schrift = schrift) {
            PartsListScreen(zustand, serverUrl = "", imageLoader = bilder, onScanBarcode = {})
        }
        pause()
        photo(name)
    }

    @Test fun addDialogPart() = addPhoto("dialog-teil-erfassen", figur = false, schrift = 1f)
    @Test fun dialogPartAddSchrift200() = addPhoto("dialog-teil-erfassen-schrift200", figur = false, schrift = 2f)
    @Test fun addDialogMinifig() = addPhoto("dialog-figur-erfassen", figur = true, schrift = 1f)
    @Test fun dialogMinifigAddSchrift200() = addPhoto("dialog-figur-erfassen-schrift200", figur = true, schrift = 2f)

    /**
     * Adding part and figure are internal to the area; opened as by hand via the
     * add button. Afterwards stop the clock: a dialog with a text field otherwise never comes to rest.
     */
    private fun addPhoto(name: String, figur: Boolean, schrift: Float) {
        val teile = if (figur) null else world.teile().also { it.loadParts() }
        val figuren = if (figur) world.figuren().also { it.loadMinifigs() } else null
        zeige(name, schrift = schrift,
            bereit = { figuren?.minifigsState?.value?.minifigs?.isNotEmpty() ?: teile!!.teileState.value.parts.isNotEmpty() },
            zustand = { figuren?.minifigsState?.value ?: teile!!.teileState.value }) {
            if (figuren != null) MinifigsRoute(vm = figuren, imageLoader = bilder) else PartsRoute(vm = teile!!, imageLoader = bilder)
        }
        val button = ApplicationProvider.getApplicationContext<Context>()
            .getString(if (figur) R.string.minifigs_add else R.string.parts_add)
        compose.onAllNodes((hasText(button) or hasContentDescription(button)) and hasClickAction())[0].performClick()
        compose.mainClock.autoAdvance = false
        repeat(3) {
            compose.mainClock.advanceTimeBy(200)
            Shadows.shadowOf(Looper.getMainLooper()).idle()
        }
        dialogPhoto(name, "classic", false, "telefon", schrift)
    }

    /** Adding: the gallery's dialog with number, quantity, price, condition and storage location. */
    @Test fun addDialogSet() = dialogSetAddPhoto("dialog-set-erfassen", 1f)

    /** At 200 % condition and storage location stand as chips or full row, nothing breaks within a word. */
    @Test fun dialogSetAddSchrift200() = dialogSetAddPhoto("dialog-set-erfassen-schrift200", 2f)

    /** On the tablet the dialog stands in its Material width above the surface. */
    @Test fun dialogSetAddTablet() = dialogSetAddPhoto("dialog-set-erfassen", 1f, geraet = "tablet")

    private fun dialogSetAddPhoto(name: String, schrift: Float, geraet: String = "telefon") {
        showDialog(name, geraet = geraet, schrift = schrift) {
            AddSetDialog(onDismiss = {},
                onAdd = {}, lagerorte = listOf("Keller", "Estrich"), immediatelyFocus = false)
        }
        dialogPhoto(name, "classic", false, geraet, schrift)
        if (schrift == 1f && geraet == "telefon") {
            // One pattern for all adding dialogs: the storage location is as wide as the set number.
            // Measured at the dialog window like the photo: the synchronization waited forever.
            val ctx = ApplicationProvider.getApplicationContext<Context>()
            val root = composeRoot(ShadowDialog.getLatestDialog().window!!.decorView) ?: error("kein Compose im Dialog")
            fun breite(label: Int): Float {
                val gesucht = ctx.getString(label)
                fun suche(n: SemanticsNode): SemanticsNode? =
                    if (SemanticsActions.SetText in n.config &&
                        n.config.getOrNull(SemanticsProperties.Text)?.any { it.text == gesucht } == true) n
                    else n.children.firstNotNullOfOrNull { suche(it) }
                return checkNotNull(suche(root.semanticsOwner.rootSemanticsNode)) { "kein Feld „$gesucht“" }.boundsInRoot.width
            }
            Assert.assertEquals("Lagerort so breit wie die Set-Nummer",
                breite(R.string.gallery_set_number),
                breite(R.string.detail_storage), 1f)
        }
    }

    // ── Laden, Fehler, leer ──

    @Test
    fun galleryLoads() {
        // The response stays away; the clock stands so that the loading animation gives a fixed image.
        world.paths.ausbleibend += "/api/v1/sets"
        val galerie = world.galerie().also { it.loadSets() }
        compose.mainClock.autoAdvance = false
        zeige("galerie-laedt", warten = false) { Galerie(galerie) }
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
        val galerie = world.galerie().also { it.loadSets() }
        zeige("galerie-fehler", bereit = { galerie.galleryState.value.let { !it.abruf.laedt && it.abruf is Laden.Fehler } },
            zustand = { galerie.galleryState.value }) { Galerie(galerie) }
        pause()
        photo("galerie-fehler")
    }

    @Test
    fun wantedEmpty() {
        world.paths.antworten["/api/v1/wanted"] = """{"success":true,"merkposten":[]}"""
        val vm = world.merkliste().also { it.loadWanted() }
        zeige("merkliste-leer", dunkel = true, bereit = { vm.wantedState.value.let { !it.abruf.laedt && it.abruf !is Laden.Fehler } },
            zustand = { vm.wantedState.value }) {
            WantedRoute(vm = vm, imageLoader = bilder, onScan = {}, onOpenSingle = { _, _ -> })
        }
        photo("merkliste-leer", dunkel = true)
    }

    // ── Screens that had no photo so far ──

    private val catalogDetail = CatalogDetailView(
        setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022, themeId = 721, themeName = "Icons",
        numParts = 4514, imageLocal = "/beispiel/set1.png", minifigs = 22,
        bricklink = BrickLinkView(number = "10305-1",
            url = "https://www.bricklink.com/v2/catalog/catalogitem.page?S=10305-1"))

    private fun catalogDetailPhoto(dunkel: Boolean, geraet: String, schrift: Float = 1f, name: String = "katalog-detail") {
        zeige(name, dunkel = dunkel, geraet = geraet, schrift = schrift) {
            CatalogDetailScreen(setNumber = "10305-1", geladen = Laden.Daten(catalogDetail),
                imageLoader = bilder, serverUrl = "", onLoad = {},
                onAddToGallery = {}, onWish = {},
                onOpenInGallery = {}, onBack = {})
        }
        pause()
        photo(name, dunkel = dunkel, geraet = geraet)
    }

    @Test fun catalogDetailPhone() = catalogDetailPhoto(false, "telefon")
    /** Both actions below each other and fully readable, also at 200 %. */
    @Test fun catalogDetailSchrift200() = catalogDetailPhoto(false, "telefon", 2f, "katalog-detail-schrift200")
    @Test fun catalogDetailTabletDark() = catalogDetailPhoto(true, "tablet")

    @Test fun vergleich() = comparisonPhoto("vergleich", 1f)
    @Test fun comparisonSchrift200() = comparisonPhoto("vergleich-schrift200", 2f)

    private fun comparisonPhoto(name: String, schrift: Float) {
        zeige(name, schrift = schrift) { ComparisonScreen() }
        pause()
        photo(name)
    }

    /** Account: profile, design, second factor and two signed-in devices; on request with a requested address. */
    private fun accountPhoto(dunkel: Boolean, geraet: String, name: String = "konto", emailNew: String? = null) {
        val neu = emailNew?.let { ""","new_email":"$it"""" } ?: ""
        world.paths.antworten["/api/v1/auth/profile"] = """{"success":true,"user":{"id":1,"username":"marco",
            "email":"marco@example.org","first_name":"Marco","last_name":"Muster","email_verified":true$neu}}"""
        world.paths.antworten["/api/v1/auth/zweiter-faktor"] = """{"success":true,"aktiv":true,"codes_uebrig":8}"""
        world.paths.antworten["/api/v1/settings/theme"] = """{"success":true,"theme":"classic","vorgabe":"classic"}"""
        world.paths.antworten["/api/v1/settings/tokens"] = """{"success":true,"tokens":[
            {"token_id":"a1","label":"Pixel 8","created_at":"2026-09-01T10:00:00Z","last_used":"2026-11-02T18:00:00Z","aktuell":true,"scope":"app"},
            {"token_id":"b2","label":"Galaxy Tab","created_at":"2026-06-12T10:00:00Z","last_used":"2026-10-20T08:00:00Z","scope":"app"}]}"""
        val konto = world.t.merke(AccountViewModel(
            testAccountRepository(world.t.api, world.t.io),
            world.t.meldungen, world.t.sitzung, SessionFake()))
        zeige(name, dunkel = dunkel, geraet = geraet) {
            AccountRoute(snackbarHostState = remember { SnackbarHostState() },
                konto = konto, onZurueck = {})
        }
        pause()
        photo(name, dunkel = dunkel, geraet = geraet)
    }

    @Test fun accountPhone() = accountPhoto(false, "telefon")
    @Test fun accountTabletDark() = accountPhoto(true, "tablet")
    /** The new address waits for its link: the field shows the current one, below it the requested one. */
    @Test fun accountEmailPending() = accountPhoto(false, "telefon", "konto-email-ausstehend", "marco.neu@example.org")

    /** Price alerts: one armed, one already triggered — in the normal case with name and image. */
    private fun priceAlertsPhoto(dunkel: Boolean, geraet: String, schrift: Float = 1f, name: String = "preisalarme") {
        world.paths.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[
            {"set_number":"75192-1","condition":"N","direction":"unter","threshold":750.0,"currency_code":"CHF",
             "name":"Millennium Falcon","image_local":"/beispiel/set1.png"},
            {"set_number":"10294-1","condition":"N","direction":"ueber","threshold":440.0,"currency_code":"CHF",
             "triggered":true,"last_triggered_at":"2026-10-30T09:00:00Z","last_price":449.95,
             "name":"Titanic","image_local":"/beispiel/set2.png","besitzt":false}]}"""
        val vm = einstellungen()
        zeige(name, dunkel = dunkel, geraet = geraet, schrift = schrift) {
            PreisalarmeRoute(vm = vm, imageLoader = bilder, serverUrl = "",
                snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onZurueck = {}, reportToggle = {})
        }
        pause()
        photo(name, dunkel = dunkel, geraet = geraet)
    }

    @Test fun priceAlertsPhone() = priceAlertsPhoto(false, "telefon")
    /** The triggered alert at 200 %: badge and last price wrap, no single character on its own. */
    @Test fun priceAlertsSchrift200() = priceAlertsPhoto(false, "telefon", 2f, "preisalarme-schrift200")
    @Test fun priceAlertsTabletDark() = priceAlertsPhoto(true, "tablet")

    /** Part from sets: on the tablet to the right of the list, on the phone as a dialog. */
    private fun partDetailPhoto(geraet: String, dunkel: Boolean) {
        world.paths.antworten["/api/v1/parts/3001/5/sets"] = """{"success":true,
            "item":{"nummer":"3001","name":"Brick 2 x 4","color_id":5,"color_name":"Red","category_name":"Bricks",
                    "image_local":"/beispiel/teil1.png","total_quantity":12},
            "sets":[{"set_number":"75192-1","set_name":"Millennium Falcon","quantity":8,"image_local":"/beispiel/set1.png","owner_user_id":1},
                    {"set_number":"21318-1","set_name":"Baumhaus","quantity":4,"image_local":"/beispiel/set3.png","owner_user_id":1}]}"""
        val vm = world.teile().also { it.loadParts() }
        zeige("teil-detail", dunkel = dunkel, geraet = geraet, bereit = { vm.teileState.value.parts.isNotEmpty() },
            zustand = { vm.teileState.value }) {
            PartsListAndDetailRoute(vm, bilder, "", { _, _, _, _ -> }, {}, { _, _, _, _ -> }) { _ ->
                PartsRoute(vm = vm, imageLoader = bilder)
            }
        }
        compose.onNode(androidx.compose.ui.test.hasText("Brick 2 x 4", substring = true) and
            androidx.compose.ui.test.hasClickAction()).performClick()
        bereitstellen("teil-detail (offen)", { !vm.setItemState.value.abruf.laedt }, { vm.setItemState.value })
        pause()
        if (geraet == "telefon") sheetPhoto(R.string.setitem_used_in, "teil-detail", "classic", dunkel, geraet)
        else photo("teil-detail", dunkel = dunkel, geraet = geraet)
    }

    /**
     * A sheet from below (ModalBottomSheet) has its own window without dialog semantics:
     * photographed is the root that carries [kennung].
     */
    private fun sheetPhoto(kennung: Int, name: String, design: String, dunkel: Boolean, geraet: String) {
        val text = ApplicationProvider.getApplicationContext<Context>().getString(kennung)
        compose.onNode(androidx.compose.ui.test.isRoot() and
            androidx.compose.ui.test.hasAnyDescendant(androidx.compose.ui.test.hasText(text)))
            .captureRoboImage(pfad(name, design, dunkel, geraet))
    }

    /**
     * The collection's filter sheet with storage location and theme. The sample data had
     * neither theme list nor storage locations, the sheet showed only handle and title.
     */
    @Test
    fun filterblattGallery() {
        world.paths.antworten["/api/v1/sets"] = Examples.RESPONSES.first { it.first == "/api/v1/sets" }.second
            .replaceFirst("\"total\":3,", "\"total\":3,\"themes\":[\"Icons\",\"Ideas\",\"Star Wars\"],")
        world.paths.antworten["/api/v1/storage"] = """{"success":true,"orte":[
            {"ort":"Keller","sets":2,"teile":40},{"ort":"Regal Wohnzimmer","sets":1,"teile":0}]}"""
        val vm = world.galerie().also { it.aktualisieren() }
        zeige("filter-galerie", bereit = { galleryDone(vm)() && vm.storageState.value.orte.isNotEmpty() &&
            vm.galleryState.value.galleryThemes.isNotEmpty() }, zustand = { vm.galleryState.value }) { Galerie(vm) }
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
    fun startPasswordSchrift200() {
        zeige("startpasswort-schrift200", schrift = 2.0f) {
            StartPasswordMask(AccountUiState(), { _, _, _ -> }, {})
        }
        photo("startpasswort-schrift200")
    }

    @Test
    fun secondFactorSchrift200() {
        zeige("zweiter-faktor-schrift200", schrift = 2.0f) {
            ZweiterFaktorPflichtMaske(
                ZweiterFaktorUiState(aktiv = false), {}, {}, {}, {})
        }
        photo("zweiter-faktor-schrift200")
    }

    /** Step 3: the emergency codes, „Weiter“ only after the check mark. */
    @Test
    fun secondFactorCodes() {
        zeige("zweiter-faktor-codes", dunkel = true) {
            ZweiterFaktorPflichtMaske(
                ZweiterFaktorUiState(aktiv = true,
                    codes = listOf("a1b2-c3d4", "e5f6-g7h8", "i9j0-k1l2", "m3n4-o5p6")), {}, {}, {}, {})
        }
        photo("zweiter-faktor-codes", dunkel = true)
    }

    @Test fun partDetailPhone() = partDetailPhoto("telefon", false)
    @Test fun partDetailTablet() = partDetailPhoto("tablet", false)

    /**
     * The message after deleting with „Rückgängig“ — above the bottom bar. The set is
     * marked for deletion and thus already out of the grid, as in the app.
     */
    private fun snackbarPhoto(geraet: String, dunkel: Boolean) {
        val galerie = world.galerie().also { it.loadSets(); it.loadStats() }
        bereitstellen("snackbar (geladen)", galleryDone(galerie)) { galerie.galleryState.value }
        galerie.loeschenVormerken(Examples.SET, "Millennium Falcon")
        val meldung = SnackbarHostState()
        zeige("snackbar", dunkel = dunkel, geraet = geraet, bereit = galleryDone(galerie),
            zustand = { galerie.galleryState.value }) {
            Scaffold(galerie, snackbar = meldung)
            LaunchedEffect(Unit) {
                meldung.showSnackbar("„Millennium Falcon“ gelöscht", actionLabel = "Rückgängig",
                    duration = SnackbarDuration.Indefinite)
            }
        }
        pause()
        photo("snackbar", dunkel = dunkel, geraet = geraet)
    }

    @Test fun snackbarPhone() = snackbarPhoto("telefon", false)
    @Test fun snackbarTabletDark() = snackbarPhoto("tablet", true)

    // ── Catalog, empty and error per tab, tablet 200 %, landscape ──

    private val catalogSets = (1..6).map { i ->
        KatalogSetAnsicht(setNumber = "1030$i-1", name = "Beispielset $i",
            year = 2020 + i, numParts = 500 * i, imageLocal = "/beispiel/set${(i - 1) % 3 + 1}.png",
            owned = i == 2, ownedQuantity = if (i == 2) 2 else 0)
    }

    private object NoCatalogActions : KatalogAktionen {
        override fun loadCatalogMeta() = Unit
        override fun loadCatalogSets() = Unit
        override fun catalogVisible(firstPage: Int, lastPage: Int) = Unit
        override fun scrollCatalogTo(nummer: Int) = Unit
        override fun catalogScrollConsumed() = Unit
        override fun setCatalogQuery(q: String) = Unit
        override fun setCatalogTheme(themeId: Int?) = Unit
        override fun setCatalogYear(year: Int?) = Unit
        override fun setCatalogSort(sort: Katalogsortierung) = Unit
    }

    private fun catalogPhoto(
        dunkel: Boolean, geraet: String, name: String = "katalog", schrift: Float = 1f,
        zustand: CatalogUiState =
            CatalogUiState(loadedPages = mapOf(1 to catalogSets), total = catalogSets.size),
    ) {
        zeige(name, dunkel = dunkel, geraet = geraet, schrift = schrift) {
            CatalogScreen(zustand, serverUrl = "", katalog = NoCatalogActions,
                imageLoader = bilder, onSetClick = {})
        }
        pause()
        photo(name, dunkel = dunkel, geraet = geraet)
    }

    @Test fun catalogPhone() = catalogPhoto(false, "telefon")
    @Test fun catalogTabletDark() = catalogPhoto(true, "tablet")
    @Test fun catalogSchrift200() = catalogPhoto(false, "telefon", "katalog-schrift200", 2f)
    @Test fun catalogEmpty() = catalogPhoto(false, "telefon", "katalog-leer", zustand = CatalogUiState())
    @Test fun catalogError() = catalogPhoto(true, "telefon", "katalog-fehler",
        zustand = CatalogUiState(abruf = Laden.Fehler(Fehlerklasse.UNBEKANNT, Meldung.Text("Serverfehler (500)"))))

    @Test
    fun wantedError() {
        loadGermanBeforeThe()
        world.paths.codes["/api/v1/wanted"] = 500
        val vm = world.merkliste().also { it.loadWanted() }
        zeige("merkliste-fehler", bereit = { vm.wantedState.value.let { !it.abruf.laedt && it.abruf is Laden.Fehler } },
            zustand = { vm.wantedState.value }) {
            WantedRoute(vm = vm, imageLoader = bilder, onScan = {}, onOpenSingle = { _, _ -> })
        }
        pause()
        photo("merkliste-fehler")
    }

    @Test
    fun partsEmpty() {
        world.paths.antworten["/api/v1/parts"] = """{"success":true,"total":0,"parts":[]}"""
        val vm = world.teile().also { it.loadParts() }
        zeige("teile-leer", bereit = { vm.teileState.value.let { it.partsFetch is Laden.Daten } },
            zustand = { vm.teileState.value }) { PartsRoute(vm = vm, imageLoader = bilder) }
        pause()
        photo("teile-leer")
    }

    @Test
    fun partsError() {
        loadGermanBeforeThe()
        world.paths.codes["/api/v1/parts"] = 500
        val vm = world.teile().also { it.loadParts() }
        zeige("teile-fehler", dunkel = true, bereit = { vm.teileState.value.let { it.partsFetch is Laden.Fehler } },
            zustand = { vm.teileState.value }) { PartsRoute(vm = vm, imageLoader = bilder) }
        pause()
        photo("teile-fehler", dunkel = true)
    }

    @Test
    fun financesError() {
        loadGermanBeforeThe()
        world.paths.codes["/api/v1/finance/valuation"] = 500
        val vm = world.finanzen().also { it.loadValuation() }
        zeige("finanzen-fehler", bereit = { vm.financeState.value.let { !it.bewertung.laedt && !it.verlauf.laedt && it.bewertung is Laden.Fehler } },
            zustand = { vm.financeState.value }) { FinanceRoute(vm = vm, imageLoader = bilder) }
        pause()
        photo("finanzen-fehler")
    }

    @Test
    fun galleryTabletSchrift200() {
        val vm = world.galerie().also { it.loadSets(); it.loadStats() }
        zeige("galerie-schrift200", geraet = "tablet", schrift = 2f, bereit = galleryDone(vm),
            zustand = { vm.galleryState.value }) { Galerie(vm) }
        photo("galerie-schrift200", geraet = "tablet")
    }

    @Test
    fun galleryAcross() {
        val vm = world.galerie().also { it.loadSets(); it.loadStats() }
        zeige("galerie", geraet = "quer", bereit = galleryDone(vm), zustand = { vm.galleryState.value }) { Galerie(vm) }
        photo("galerie", geraet = "quer")
    }

    private fun loginPhoto(name: String, formular: AnmeldeFormular, geraet: String, schrift: Float) {
        zeige(name, geraet = geraet, schrift = schrift) {
            LoginScreen(
                serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = false,
                formular = formular, registrierungOffen = true, kontoLaeuft = false,
                kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> }, onFormular = {},
                onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
            )
        }
        photo(name, geraet = geraet)
    }

    @Test fun signInAcross() = loginPhoto("anmelden", AnmeldeFormular.ANMELDEN, "quer", 1f)
    @Test fun registerSchrift200() = loginPhoto("registrieren-schrift200", AnmeldeFormular.REGISTER, "telefon", 2f)

    @Test
    fun setUpAcross() {
        zeige("einrichten", geraet = "quer") {
            SetupScreen(currentUrl = "https://brick.fritz.box", onSave = {}, entwicklung = false)
        }
        photo("einrichten", geraet = "quer")
    }

    /** Without network: hint with state above the list, three changes wait in the outbox. */
    @Test fun offline() = offlinePhoto("offline", 1f)
    @Test fun offlineSchrift200() = offlinePhoto("offline-schrift200", 2f)

    private fun offlinePhoto(name: String, schrift: Float) {
        val galerie = world.galerie().also { it.loadSets(); it.loadStats() }
        zeige(name, schrift = schrift, bereit = galleryDone(galerie), zustand = { galerie.galleryState.value }) {
            Scaffold(galerie, offeneAenderungen = 3, offlineStatus = 1_793_000_000_000L)
        }
        pause()
        photo(name)
    }

    // ── Flows that had no photo otherwise: settings, update, scanner, barcode,
    // purchase prices, single part, background work, voucher, invitation, CSV import ──

    private val noUpdate = object : UpdateAktionen {
        override fun pruefeAufUpdate(still: Boolean) = Unit
        override fun pruefeBeimStart() = Unit
        override fun setStartpruefung(an: Boolean) = Unit
        override fun closeUpdateHint() = Unit
        override fun ladeUpdate() = Unit
        override fun cancelLoad() = Unit
        override fun startInstallation() = Unit
    }

    private val noRendering = object : DarstellungAktionen {
        override fun setLanguage(languageCode: String) = Unit
        override fun setHelligkeit(wahl: String) = Unit
        override fun setSystemfarben(an: Boolean) = Unit
        override fun setVorschauVerbergen(an: Boolean) = Unit
        override fun setWidgetValues(an: Boolean) = Unit
    }

    private fun settingsPhoto(name: String, dunkel: Boolean, geraet: String, update: UpdateUiState = UpdateUiState(),
                                  schrift: Float = 1f, sprache: String? = GERMAN) {
        val vm = einstellungen()
        zeige(name, dunkel = dunkel, geraet = geraet, schrift = schrift, sprache = sprache) {
            SettingsScreen(
                zustand = EinstellungenZustand(AppUiState(serverUrl = "https://brick.example.org"), update,
                    "system", Design.CLASSIC, false, false, false, false),
                aktionen = vm, update = noUpdate, darstellung = noRendering, onNutzerCa = {},
                onLogout = {}, onServerWechseln = {}, scrollState = androidx.compose.foundation.rememberScrollState(),
            )
        }
        // The update card stands further down: without scrolling the progress was missing from the image.
        update.fortschritt?.let { p ->
            compose.onNodeWithText(ApplicationProvider.getApplicationContext<Context>()
                .getString(R.string.update_downloading, p)).performScrollTo()
        }
        pause()
        photo(name, dunkel = dunkel, geraet = geraet)
    }

    @Test fun settingsPhone() = settingsPhoto("einstellungen", false, "telefon")
    @Test fun settingsTabletDark() = settingsPhoto("einstellungen", true, "tablet")
    @Test fun settingsSchrift200() = settingsPhoto("einstellungen-schrift200", false, "telefon", schrift = 2f)
    @Test fun settingsEnglish() = settingsPhoto("einstellungen-en", false, "telefon", sprache = ENGLISH)

    @Test fun updateLoads() = settingsPhoto("update-laedt", false, "telefon",
        UpdateUiState(geprueft = true, fortschritt = 42,
            newerVersion = UpdateBeschreibung(versionCode = 240, versionName = "2.4.0", apkUrl = "https://brick.example.org/app.apk")))

    // Without a camera only the overlay: frame, hint, light and close.
    private fun scannerPhoto(geraet: String) {
        zeige("scanner", geraet = geraet, warten = false) {
            BarcodeScannerScreen(onResult = {}, onDismiss = {}, ohneKamera = true)
        }
        pause()
        photo("scanner", dunkel = true, geraet = geraet)
    }

    @Test fun scannerPhone() = scannerPhoto("telefon")
    @Test fun scannerTablet() = scannerPhoto("tablet")

    @Test
    fun scannerPermission() {
        zeige("scanner-erlaubnis", warten = false) {
            Box(Modifier.fillMaxSize()
                .background(Color.Black)) {
                CameraPermissionHint(stringResource(R.string.scanner_camera_zweck_barcode),
                    stringResource(R.string.scanner_nummer_eintippen), typeInOn = {}, onAllow = {})
            }
        }
        pause()
        photo("scanner-erlaubnis", dunkel = true)
    }

    private fun barcodePhoto(dunkel: Boolean) {
        val zustand = BarcodeDialogZustand(AppUiState(), ScopeUiState(),
            BarcodeUiState(result = "75192-1", setName = "Millennium Falcon", ownershipQuantity = 1), LagerUiState())
        showDialog("dialog-barcode-ergebnis", dunkel = dunkel) { BarcodeResultDialog(zustand, erfassung(), bilder) }
        dialogPhoto("dialog-barcode-ergebnis", "classic", dunkel, "telefon", 1f)
    }

    @Test fun dialogBarcodeResult() = barcodePhoto(false)
    @Test fun dialogBarcodeResultDark() = barcodePhoto(true)

    private fun kaeufe() = world.t.merke(KaeufeViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise, world.t.changes,
        testHouseholdRepository(world.t.api), world.t.sets(),
        testFinancesRepository(world.t.api), testPartsRepository(world.t.api),
        testMinifigsRepository(world.t.api)))

    private fun purchasePricesPhoto(dunkel: Boolean, geraet: String) {
        val vm = kaeufe()
        zeige("kaufpreise", dunkel = dunkel, geraet = geraet) {
            AcquisitionManagementRoute(vm, type = Postenart.SET, id = Examples.SET, title = "Millennium Falcon", onBack = {})
        }
        pause()
        photo("kaufpreise", dunkel = dunkel, geraet = geraet)
    }

    @Test fun purchasePricesPhone() = purchasePricesPhoto(false, "telefon")
    @Test fun purchasePricesTabletDark() = purchasePricesPhoto(true, "tablet")

    // A manually added part with two purchases: the sample data has no manual parts.
    private fun singlePartPhoto(dunkel: Boolean, geraet: String) {
        world.paths.antworten["/api/v1/parts/manual"] = """{"success":true,"parts":[{"id":9,"part_number":"3001",
            "part_name":"Brick 2 x 4","color_id":5,"color_name":"Red","quantity":12,"image_local":"/beispiel/teil1.png",
            "avg_price":0.18,"avg_purchase_price":0.12}]}"""
        world.paths.antworten["/api/v1/parts/3001/5/acquisitions"] = """{"success":true,"acquisitions":[
            {"id":21,"quantity":8,"purchase_price":0.96,"condition":"N","created_at":"2026-05-02T10:00:00Z"},
            {"id":22,"quantity":4,"purchase_price":0.48,"condition":"U","created_at":"2026-09-12T10:00:00Z"}],
            "totals":{"quantity":12,"amount":1.44,"priced_rows":2}}"""
        val vm = kaeufe()
        val teile = world.teile()
        zeige("einzelteil-detail", dunkel = dunkel, geraet = geraet) {
            ManualItemDetailRoute(vm, teile, world.figuren(), type = Postenart.PART, id = "3001", colorId = 5, fallbackTitle = "Brick 2 x 4",
                imageLoader = bilder, onBack = {}, onNavigateToAcqMgmt = { _, _, _, _ -> })
        }
        pause()
        photo("einzelteil-detail", dunkel = dunkel, geraet = geraet)
    }

    @Test fun singlePartDetailPhone() = singlePartPhoto(false, "telefon")
    @Test fun singlePartDetailTabletDark() = singlePartPhoto(true, "tablet")

    // The same response as in BackgroundWorkTest: one running and one failed job.
    private fun backgroundPhoto(dunkel: Boolean, geraet: String) {
        world.paths.antworten["/api/v1/admin/auftraege"] = """{"success":true,
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
        val vm = MonitoringViewModel(testManagementRepository(api), testAccountRepository(api), world.t.meldungen)
        runBlocking { vm.loadBackground() }
        val events = CacheEvents({}, {}, { _, _ -> }, {}, {}, {}, { _, _, _ -> })
        zeige("hintergrundarbeiten", dunkel = dunkel, geraet = geraet, warten = false) {
            // Wi-Fi allowed, the others not: both switch positions in the image.
            MonitoringScreen(MonitoringState(MonitoringUiState(), vm.hintergrund.value, ManagementUiState(),
                mapOf(VorwaermNetwork.WLAN to true), Design.CLASSIC, 0L), vm, events)
        }
        pause()
        photo("hintergrundarbeiten", dunkel = dunkel, geraet = geraet)
    }

    @Test fun backgroundWorkPhone() = backgroundPhoto(false, "telefon")
    @Test fun backgroundWorkTabletDark() = backgroundPhoto(true, "tablet")

    @Test
    fun voucherForm() {
        world.paths.antworten["/api/v1/vouchers"] = """{"success":true,"vouchers":[]}"""
        val vm = world.t.merke(GutscheinViewModel(testVouchersRepository(world.t.api), ContextTexts(),
            object : FileReader {
                override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null
            }, world.t.meldungen))
        zeige("gutschein-formular") {
            VouchersRoute(vm, remember { SnackbarHostState() }, onZurueck = {})
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
        world.paths.antworten["/api/v1/settings/household"] = """{"success":true,"is_main":true,"currency":"CHF",
            "sub_accounts":[{"id":2,"username":"lena"}],"open_invites":0}"""
        world.paths.antworten["/api/v1/settings/household/invite"] = """{"success":true,"code":"K7QF-2M9X","expires_in":86400}"""
        val vm = world.t.merke(HouseholdViewModel(world.t.sitzung, world.t.filter(), world.t.sync,
            testHouseholdRepository(world.t.api), testAccountRepository(world.t.api))).also { it.jetzt = { FIXED_TIME }; it.loadHousehold() }
        zeige("haushalt-code", bereit = { vm.householdState.value.status != null }, zustand = { vm.householdState.value }) {
            HouseholdRoute(vm, remember { SnackbarHostState() }, onZurueck = {})
        }
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        compose.onNodeWithText(ctx.getString(R.string.household_invite_create)).performScrollTo().performClick()
        bereitstellen("haushalt-code (Code)", { vm.householdState.value.inviteCode != null }, { vm.householdState.value })
        compose.onNodeWithText(ctx.getString(R.string.household_invite_teilen)).performScrollTo()
        pause()
        photo("haushalt-code")
    }

    private fun csvRunningPhoto(dunkel: Boolean, geraet: String) {
        zeige("csv-import-laeuft", dunkel = dunkel, geraet = geraet, warten = false) {
            Column {
                CsvImportBanner(done = 37, total = 120, current = "75192-1 Millennium Falcon",
                    ok = 35, warn = 1, err = 1, running = true, onAbbrechen = {})
            }
        }
        pause()
        photo("csv-import-laeuft", dunkel = dunkel, geraet = geraet)
    }

    @Test fun csvImportRunningPhone() = csvRunningPhoto(false, "telefon")
    @Test fun csvImportRunningTabletDark() = csvRunningPhoto(true, "tablet")

    // ── What had no reference image yet, each light, dark and 200 % ──
    // Name with „-schrift200“ at large font, otherwise as above. Everything with fixed data:
    // the images are created in CI and must be the same on every run.

    private fun stufe(name: String, schrift: Float) = if (schrift == 2f) "$name-schrift200" else name

    /** Sign in with the passkey button; with [code] the second stage including „Passkey statt Code“. */
    private fun signInPasskeyPhoto(code: Boolean, dunkel: Boolean, schrift: Float) {
        val name = stufe(if (code) "anmelden-code" else "anmelden-passkey", schrift)
        zeige(name, dunkel = dunkel, schrift = schrift) {
            LoginScreen(
                serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = code,
                formular = AnmeldeFormular.ANMELDEN, registrierungOffen = true, kontoLaeuft = false,
                kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> }, onFormular = {},
                onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
                onPasskey = {}, onPasskeyStattCode = { _, _ -> },
            )
        }
        pause()
        photo(name, dunkel = dunkel)
    }

    @Test fun signInPasskeyLight() = signInPasskeyPhoto(false, false, 1f)
    @Test fun signInPasskeyDark() = signInPasskeyPhoto(false, true, 1f)
    @Test fun signInPasskeySchrift200() = signInPasskeyPhoto(false, false, 2f)
    @Test fun signInCodeLight() = signInPasskeyPhoto(true, false, 1f)
    @Test fun signInCodeDark() = signInPasskeyPhoto(true, true, 1f)
    @Test fun signInCodeSchrift200() = signInPasskeyPhoto(true, false, 2f)

    /** The QR scanner during setup without a camera: Robolectric grants no permission, the hint stands there. */
    private fun setUpQrPhoto(dunkel: Boolean, schrift: Float) {
        val name = stufe("einrichten-qr", schrift)
        zeige(name, dunkel = dunkel, schrift = schrift) {
            SetupScreen(currentUrl = "", onSave = {}, entwicklung = false)
        }
        compose.onNodeWithText(ApplicationProvider.getApplicationContext<Context>().getString(R.string.setup_scan_qr))
            .performScrollTo().performClick()
        compose.waitForIdle()
        pause()
        photo(name, dunkel = dunkel)
    }

    @Test fun setUpQrLight() = setUpQrPhoto(false, 1f)
    @Test fun setUpQrDark() = setUpQrPhoto(true, 1f)
    @Test fun setUpQrSchrift200() = setUpQrPhoto(false, 2f)

    /** The hint about a new version, as the app shows it after the check. */
    private fun updateDialogPhoto(dunkel: Boolean, schrift: Float) {
        val name = stufe("dialog-update", schrift)
        val zustand = MutableStateFlow(UpdateUiState(geprueft = true,
            newerVersion = UpdateBeschreibung(versionCode = 240, versionName = "2.4.0", apkUrl = "https://brick.example.org/app.apk")))
        val quelle = object : UpdateAktionen.WithState, UpdateAktionen by noUpdate {
            override val zustand = zustand
        }
        showDialog(name, dunkel = dunkel, schrift = schrift) { UpdateRoute(quelle) }
        dialogPhoto(name, "classic", dunkel, "telefon", schrift)
    }

    @Test fun dialogUpdateLight() = updateDialogPhoto(false, 1f)
    @Test fun dialogUpdateDark() = updateDialogPhoto(true, 1f)
    @Test fun dialogUpdateSchrift200() = updateDialogPhoto(false, 2f)

    /** The question about a new server certificate with a fingerprint to compare. */
    private fun certificatePhoto(dunkel: Boolean, schrift: Float) {
        val name = stufe("dialog-zertifikat", schrift)
        val frage = CertificateUnresolved("brick.example.org:443",
            "3F:A1:09:7C:22:5D:E8:41:9B:0C:66:D2:7A:13:F4:88:51:2E:C9:07:B6:4D:30:9A:E1:75:2C:68:0F:D3:4B:91",
            CertificateUnresolved.Art.ERSTKONTAKT)
        showDialog(name, dunkel = dunkel, schrift = schrift) {
            CertificateDialog(frage, userCaAn = false, trustOn = { true }, onNutzerCa = {}, onAbbrechen = {})
        }
        dialogPhoto(name, "classic", dunkel, "telefon", schrift)
    }

    @Test fun dialogCertificateLight() = certificatePhoto(false, 1f)
    @Test fun dialogCertificateDark() = certificatePhoto(true, 1f)
    @Test fun dialogCertificateSchrift200() = certificatePhoto(false, 2f)

    /** Account, scrolled to [section]: the list of devices or the second factor. */
    private fun accountSectionPhoto(name: String, section: Int, dunkel: Boolean, schrift: Float) {
        world.paths.antworten["/api/v1/auth/profile"] = """{"success":true,"user":{"id":1,"username":"marco",
            "email":"marco@example.org","first_name":"Marco","last_name":"Muster","email_verified":true}}"""
        world.paths.antworten["/api/v1/auth/zweiter-faktor"] = """{"success":true,"aktiv":true,"codes_uebrig":8}"""
        world.paths.antworten["/api/v1/settings/theme"] = """{"success":true,"theme":"classic","vorgabe":"classic"}"""
        world.paths.antworten["/api/v1/settings/tokens"] = """{"success":true,"tokens":[
            {"token_id":"a1","label":"Pixel 8","created_at":"2026-09-01T10:00:00Z","last_used":"2026-11-02T18:00:00Z","aktuell":true,"scope":"app"},
            {"token_id":"b2","label":"Galaxy Tab","created_at":"2026-06-12T10:00:00Z","last_used":"2026-10-20T08:00:00Z","scope":"app"}]}"""
        val konto = world.t.merke(AccountViewModel(testAccountRepository(world.t.api, world.t.io),
            world.t.meldungen, world.t.sitzung, SessionFake()))
        val voll = stufe(name, schrift)
        zeige(voll, dunkel = dunkel, schrift = schrift) {
            AccountRoute(snackbarHostState = remember { SnackbarHostState() }, konto = konto, onZurueck = {})
        }
        compose.onNodeWithText(ApplicationProvider.getApplicationContext<Context>().getString(section)).performScrollTo()
        pause()
        photo(voll, dunkel = dunkel)
    }

    @Test fun accountDevicesLight() = accountSectionPhoto("konto-geraete", R.string.tokens_title, false, 1f)
    @Test fun accountDevicesDark() = accountSectionPhoto("konto-geraete", R.string.tokens_title, true, 1f)
    @Test fun accountDevicesSchrift200() = accountSectionPhoto("konto-geraete", R.string.tokens_title, false, 2f)
    @Test fun accountSecondFactorLight() = accountSectionPhoto("konto-zweiter-faktor", R.string.zf_title, false, 1f)
    @Test fun accountSecondFactorDark() = accountSectionPhoto("konto-zweiter-faktor", R.string.zf_title, true, 1f)
    @Test fun accountSecondFactorSchrift200() = accountSectionPhoto("konto-zweiter-faktor", R.string.zf_title, false, 2f)

    // ── Leer ──

    private fun financesEmptyPhoto(dunkel: Boolean, schrift: Float) {
        val name = stufe("finanzen-leer", schrift)
        world.paths.antworten["/api/v1/finance/valuation"] = """{"success":true,"currency":"CHF","sets":[],
            "totals":{"min":"0.00","avg":"0.00","max":"0.00","qty_avg":"0.00"}}"""
        world.paths.antworten["/api/v1/finance/pnl"] = """{"success":true,"currency":"CHF","totals":{"purchase":"0.00","current":"0.00",
            "grand_total":"0.00","sets_purchase":"0.00","positionen":0,"positionen_bewertet":0},"sets":[]}"""
        world.paths.antworten["/api/v1/finance/portfolio-history"] = """{"success":true,"currency":"CHF","period":"week","points":[]}"""
        val vm = world.finanzen().also { it.loadValuation(); it.loadPortfolioHistory("week") }
        zeige(name, dunkel = dunkel, schrift = schrift, bereit = { vm.financeState.value.let { !it.bewertung.laedt && !it.verlauf.laedt } },
            zustand = { vm.financeState.value }) { FinanceRoute(vm = vm, imageLoader = bilder) }
        pause()
        photo(name, dunkel = dunkel)
    }

    @Test fun financesEmptyLight() = financesEmptyPhoto(false, 1f)
    @Test fun financesEmptyDark() = financesEmptyPhoto(true, 1f)
    @Test fun financesEmptySchrift200() = financesEmptyPhoto(false, 2f)

    private fun minifigsPhoto(name: String, dunkel: Boolean, schrift: Float, fehler: Boolean) {
        val voll = stufe(name, schrift)
        if (fehler) {
            loadGermanBeforeThe()
            world.paths.codes["/api/v1/minifigs"] = 500
        } else {
            world.paths.antworten["/api/v1/minifigs"] = """{"success":true,"figs":[]}"""
        }
        val vm = world.figuren().also { it.loadMinifigs() }
        zeige(voll, dunkel = dunkel, schrift = schrift, bereit = { !vm.minifigsState.value.minifigsFetch.laedt },
            zustand = { vm.minifigsState.value }) { MinifigsRoute(vm = vm, imageLoader = bilder) }
        pause()
        photo(voll, dunkel = dunkel)
    }

    @Test fun minifigsEmptyLight() = minifigsPhoto("figuren-leer", false, 1f, fehler = false)
    @Test fun minifigsEmptyDark() = minifigsPhoto("figuren-leer", true, 1f, fehler = false)
    @Test fun minifigsEmptySchrift200() = minifigsPhoto("figuren-leer", false, 2f, fehler = false)
    @Test fun minifigsErrorLight() = minifigsPhoto("figuren-fehler", false, 1f, fehler = true)
    @Test fun minifigsErrorDark() = minifigsPhoto("figuren-fehler", true, 1f, fehler = true)
    @Test fun minifigsErrorSchrift200() = minifigsPhoto("figuren-fehler", false, 2f, fehler = true)

    private fun locationsEmptyPhoto(dunkel: Boolean, schrift: Float) {
        val name = stufe("lagerorte-leer", schrift)
        world.paths.antworten["/api/v1/storage/locations"] = """{"success":true,"orte":[]}"""
        val vm = einstellungen().also { it.loadOwnLocations() }
        zeige(name, dunkel = dunkel, schrift = schrift) { LocationsRoute(vm, remember { SnackbarHostState() }, onZurueck = {}) }
        pause()
        photo(name, dunkel = dunkel)
    }

    @Test fun locationsEmptyLight() = locationsEmptyPhoto(false, 1f)
    @Test fun locationsEmptyDark() = locationsEmptyPhoto(true, 1f)
    @Test fun locationsEmptySchrift200() = locationsEmptyPhoto(false, 2f)

    private fun priceAlertsEmptyPhoto(dunkel: Boolean, schrift: Float) {
        val name = stufe("preisalarme-leer", schrift)
        world.paths.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[]}"""
        val vm = einstellungen()
        zeige(name, dunkel = dunkel, schrift = schrift) {
            PreisalarmeRoute(vm = vm, imageLoader = bilder, serverUrl = "",
                snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onZurueck = {}, reportToggle = {})
        }
        pause()
        photo(name, dunkel = dunkel)
    }

    @Test fun priceAlertsEmptyLight() = priceAlertsEmptyPhoto(false, 1f)
    @Test fun priceAlertsEmptyDark() = priceAlertsEmptyPhoto(true, 1f)
    @Test fun priceAlertsEmptySchrift200() = priceAlertsEmptyPhoto(false, 2f)

    /** A main account without linked accounts and without an open invitation. */
    private fun householdEmptyPhoto(dunkel: Boolean, schrift: Float) {
        val name = stufe("haushalt-leer", schrift)
        world.paths.antworten["/api/v1/settings/household"] = """{"success":true,"is_main":true,"currency":"CHF",
            "sub_accounts":[],"open_invites":0}"""
        val vm = world.t.merke(HouseholdViewModel(world.t.sitzung, world.t.filter(), world.t.sync,
            testHouseholdRepository(world.t.api), testAccountRepository(world.t.api, world.t.io))).also { it.loadHousehold() }
        zeige(name, dunkel = dunkel, schrift = schrift, bereit = { vm.householdState.value.status != null },
            zustand = { vm.householdState.value }) {
            HouseholdRoute(vm, remember { SnackbarHostState() }, onZurueck = {})
        }
        pause()
        photo(name, dunkel = dunkel)
    }

    @Test fun householdEmptyLight() = householdEmptyPhoto(false, 1f)
    @Test fun householdEmptyDark() = householdEmptyPhoto(true, 1f)
    @Test fun householdEmptySchrift200() = householdEmptyPhoto(false, 2f)

    // ── Fehler ──

    private fun accountErrorPhoto(dunkel: Boolean, schrift: Float) {
        val name = stufe("konto-fehler", schrift)
        loadGermanBeforeThe()
        world.paths.codes["/api/v1/auth/profile"] = 500
        val konto = world.t.merke(AccountViewModel(testAccountRepository(world.t.api, world.t.io),
            world.t.meldungen, world.t.sitzung, SessionFake()))
        zeige(name, dunkel = dunkel, schrift = schrift) {
            AccountRoute(snackbarHostState = remember { SnackbarHostState() }, konto = konto, onZurueck = {})
        }
        pause()
        photo(name, dunkel = dunkel)
    }

    @Test fun accountErrorLight() = accountErrorPhoto(false, 1f)
    @Test fun accountErrorDark() = accountErrorPhoto(true, 1f)
    @Test fun accountErrorSchrift200() = accountErrorPhoto(false, 2f)

    private fun vouchersErrorPhoto(dunkel: Boolean, schrift: Float) {
        val name = stufe("gutscheine-fehler", schrift)
        loadGermanBeforeThe()
        world.paths.codes["/api/v1/vouchers"] = 500
        val vm = world.t.merke(GutscheinViewModel(testVouchersRepository(world.t.api), ContextTexts(),
            object : FileReader {
                override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null
            }, world.t.meldungen))
        zeige(name, dunkel = dunkel, schrift = schrift) { VouchersRoute(vm, remember { SnackbarHostState() }, onZurueck = {}) }
        pause()
        photo(name, dunkel = dunkel)
    }

    @Test fun vouchersErrorLight() = vouchersErrorPhoto(false, 1f)
    @Test fun vouchersErrorDark() = vouchersErrorPhoto(true, 1f)
    @Test fun vouchersErrorSchrift200() = vouchersErrorPhoto(false, 2f)

    /** Added without network: hint with state, one pending change and the message for it. */
    private fun addOfflinePhoto(dunkel: Boolean, schrift: Float) {
        val name = stufe("erfassen-offline", schrift)
        val galerie = world.galerie().also { it.loadSets(); it.loadStats() }
        val meldung = SnackbarHostState()
        val text = ApplicationProvider.getApplicationContext<Context>().resources
            .getQuantityString(R.plurals.offline_ausgang, 1, 1)
        zeige(name, dunkel = dunkel, schrift = schrift, bereit = galleryDone(galerie), zustand = { galerie.galleryState.value }) {
            Scaffold(galerie, snackbar = meldung, offeneAenderungen = 1, offlineStatus = 1_793_000_000_000L)
            LaunchedEffect(Unit) { meldung.showSnackbar(text, duration = SnackbarDuration.Indefinite) }
        }
        pause()
        photo(name, dunkel = dunkel)
    }

    @Test fun addOfflineLight() = addOfflinePhoto(false, 1f)
    @Test fun addOfflineDark() = addOfflinePhoto(true, 1f)
    @Test fun addOfflineSchrift200() = addOfflinePhoto(false, 2f)

    /** The frame around the destination with keyboard focus, here the price comparison on the page “More”. */
    private fun focusPhoto(dunkel: Boolean, schrift: Float) {
        val name = stufe("fokusrahmen", schrift)
        zeige(name, dunkel = dunkel, schrift = schrift) {
            val mode = LocalInputModeManager.current
            LaunchedEffect(Unit) { mode.requestInputMode(InputMode.Keyboard) }
            MehrBildschirm({}, isAdmin = false, updateVerfuegbar = false, onAbmelden = {})
        }
        val ziel = ApplicationProvider.getApplicationContext<Context>().getString(R.string.nav_comparison)
        compose.onNode(hasText(ziel) and hasClickAction()).performSemanticsAction(SemanticsActions.RequestFocus)
        compose.waitForIdle()
        pause()
        photo(name, dunkel = dunkel)
    }

    @Test fun focusFrameLight() = focusPhoto(false, 1f)
    @Test fun focusFrameDark() = focusPhoto(true, 1f)
    @Test fun focusFrameSchrift200() = focusPhoto(false, 2f)
}

/** A fixed point in time for images that show a date (5.11.2026, 23:33 UTC). */
private const val FIXED_TIME = 1_793_921_600_000L
