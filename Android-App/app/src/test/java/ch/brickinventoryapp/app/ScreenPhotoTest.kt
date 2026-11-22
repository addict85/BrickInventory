package ch.brickinventoryapp.app

import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.account.ui.AccountUiState
import ch.brickinventoryapp.account.ui.SecondFactorUiState
import ch.brickinventoryapp.account.ui.screens.SecondFactorRequiredMask
import ch.brickinventoryapp.account.ui.screens.StartPasswordMask
import ch.brickinventoryapp.collection.ui.screens.GalleryRoute
import ch.brickinventoryapp.collection.ui.screens.SetDetailRoute
import ch.brickinventoryapp.collection.ui.screens.WantedRoute
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.contract.Gutschein
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.testing.testCatalogRepository
import ch.brickinventoryapp.data.testing.testSetsRepository
import ch.brickinventoryapp.finances.ui.VoucherUiState
import ch.brickinventoryapp.finances.ui.screens.FinanceRoute
import ch.brickinventoryapp.finances.ui.screens.VoucherCardActions
import ch.brickinventoryapp.finances.ui.screens.VouchersCard
import ch.brickinventoryapp.finances.ui.screens.VouchersPage
import ch.brickinventoryapp.login.ui.LoginForm
import ch.brickinventoryapp.login.ui.screens.LoginActions
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.login.ui.screens.LoginScreenState
import ch.brickinventoryapp.login.ui.screens.SetupScreen
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.parts.ui.screens.MinifigsRoute
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.state.ui.errorTextArgument
import ch.brickinventoryapp.state.ui.errorTextId
import ch.brickinventoryapp.state.ui.viewmodel.Texts
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * Screenshots of the main screens with sample data (Beispiele), each in
 * three designs, light and dark, on phone and tablet, in German (de-CH) like
 * most users; English is photographed by ScreenPhotoVariantsTest. If reference images lie
 * in src/test/screenshots, CI compares against them (verifyRoborazziDebug),
 * otherwise it records; they are checked in via workflow (screenshots=true).
 *
 * The vouchers stand as their own page under “More”; photographed is their
 * building block (VouchersCard), because the page gets its ViewModel via Hilt.
 *
 * Counter-check: a photo that compares nothing cannot turn red. It is
 * only possible with checked-in references (change a color in Theme.kt →
 * verifyRoborazziDebug red) and not measurable here without the Android SDK; until then
 * SampleDataTest checks that the images show content.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ScreenPhotoTest(private val design: String, private val dark: Boolean, private val device: String) {

    companion object {
        private val DEVICES = mapOf(
            "telefon" to "w411dp-h891dp-port-xxhdpi",
            "tablet" to "w1280dp-h800dp-land-xhdpi",
        )

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-{1}-{2}")
        fun cases(): List<Array<Any>> =
            listOf("classic", "brick", "noppe").flatMap { d ->
                listOf(false, true).flatMap { dk -> DEVICES.keys.map { g -> arrayOf<Any>(d, dk, g) } }
            }
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

    /** The data comes before the screen; the world responds in ticks. */
    private fun provide(name: String, ready: () -> Boolean, condition: () -> Any?) {
        driveUntil(name, requests = { world.paths.requests.size }, condition = condition, ready = ready)
    }

    private fun photo(name: String, ready: () -> Boolean = { true }, condition: () -> Any? = { null },
                     content: @Composable () -> Unit) {
        RuntimeEnvironment.setQualifiers("de-rCH-" + DEVICES.getValue(device))
        Locale.setDefault(Locale.forLanguageTag("de-CH"))
        provide(name, ready, condition)
        compose.setContent {
            BrickInventoryManagerTheme(theme = checkNotNull(Design.from(design)) { design }, dark = dark) {
                Surface(color = MaterialTheme.colorScheme.background) { content() }
            }
        }
        // The screen partly loads more on appearing (e.g. the purchases). These
        // responses also come via the main looper, so drive it again.
        provide("$name (angezeigt)", ready, condition)
        compose.waitForIdle()
        val light = if (dark) "dunkel" else "hell"
        compose.onRoot().captureRoboImage("src/test/screenshots/${name}_${design}_${light}_$device.png")
    }

    private fun entryVm() = world.t.track(EntryViewModel(world.t.session, world.t.filter(), world.t.hints, testSetsRepository(world.t.api), world.t.setCatalog(), world.t.wantedList(),
        testCatalogRepository(world.t.api),
        object : SetCreator {
            override fun create(setNumber: String, quantity: Int, purchasePrice: Money?, condition: Condition?,
                                 ownerUserId: Int?, storage: String?): Flow<SetCreateStep> = emptyFlow()
        }))

    @Test
    fun gallery() {
        val vm = world.gallery().also { it.loadSets(); it.loadStats() }
        photo("galerie", { vm.galleryState.value.let { it.sets.isNotEmpty() && it.stats != null && !it.fetch.loading } }, { vm.galleryState.value }) {
            GalleryRoute(vm = vm, entryVm = entryVm(), imageLoader = images, onScanBarcode = {}, onSetClick = {})
        }
    }

    @Test
    fun setDetail() {
        val vm = world.setDetail()
        // All sections, not only the set: price, history and purchases come
        // in separate fetches, and a photo in the middle of loading deviates from the reference image.
        val done = { vm.setDetailState.value.let { s ->
            s.setDetail != null && s.setPrice != null && s.priceHistory != null && s.acquisitions.isNotEmpty() &&
                !s.detailFetch.loading && !s.priceFetch.loading && !s.historyFetch.loading && !s.purchasesFetch.loading } }
        photo("set-detail", done, { vm.setDetailState.value }) {
            SetDetailRoute(setNumber = Examples.SET, vm = vm, serverUrl = "", imageLoader = images,
                onBack = {}, onDelete = {})
        }
    }

    @Test
    fun parts() {
        val vm = world.parts().also { it.loadParts() }
        photo("teile", { vm.partsState.value.parts.isNotEmpty() }, { vm.partsState.value }) {
            PartsRoute(vm = vm, imageLoader = images)
        }
    }

    @Test
    fun figures() {
        val vm = world.figures().also { it.loadMinifigs() }
        photo("figuren", { vm.minifigsState.value.minifigs.isNotEmpty() }, { vm.minifigsState.value }) {
            MinifigsRoute(vm = vm, imageLoader = images)
        }
    }

    @Test
    fun finances() {
        val vm = world.finances().also { it.loadValuation(); it.loadPortfolioHistory("week") }
        // loadValuation() loads parts, figures and P&L only after the valuation.
        photo("finanzen", { vm.financeState.value.let { it.valuation != null && it.partsValuation != null &&
            it.figsValuation != null && it.pnl != null && it.historyPoints.isNotEmpty() &&
            !it.valuationLoad.loading && !it.history.loading } }, { vm.financeState.value }) {
            FinanceRoute(vm = vm, imageLoader = images)
        }
    }

    @Test
    fun wantedList() {
        val vm = world.wantedList().also { it.loadWanted() }
        photo("merkliste", { vm.wantedState.value.wantedItem.isNotEmpty() }, { vm.wantedState.value }) {
            WantedRoute(vm = vm, imageLoader = images, onScan = {}, onOpenSingle = { _, _ -> })
        }
    }

    @Test
    fun logIn() {
        photo("anmelden") {
            LoginScreen(
                LoginScreenState(serverUrl = "https://brick.example.org", registrationOpen = true),
                object : LoginActions {},
            )
        }
    }

    @Test
    fun setUp() {
        photo("einrichten") { SetupScreen(currentUrl = "https://brick.fritz.box", onSave = {}, development = false) }
    }

    /** A saved http address from an older version: at the top the instructions for https. */
    @Test
    fun setUpLegacyStock() {
        photo("einrichten-altbestand") { SetupScreen(currentUrl = "http://nas:3000", onSave = {}, development = false) }
    }

    @Test
    fun vouchers() {
        photo("gutscheine") { Vouchers() }
    }

    @Test
    fun register() {
        photo("registrieren") {
            LoginScreen(
                LoginScreenState(serverUrl = "https://brick.example.org", form = LoginForm.REGISTER, registrationOpen = true),
                object : LoginActions {},
            )
        }
    }

    /** The mandatory forms are dead ends until the end — hence in every design. */
    @Test
    fun startPassword() {
        photo("startpasswort") { StartPasswordMask(AccountUiState(), { _, _, _ -> }, {}) }
    }

    @Test
    fun secondFactor() {
        photo("zweiter-faktor") { SecondFactorRequiredMask(SecondFactorUiState(active = false), {}, {}, {}, {}) }
    }
}

/**
 * Two vouchers, one with PIN and balance, one without — the two row forms —
 * on their page with a menu in the bar and the floating button for creating.
 */
@Composable
internal fun Vouchers() {
    val vouchers = VoucherUiState(vouchers = listOf(
        Gutschein(id = 1, number = "6061 2345 6789", pin = "4711", amount = 50.0, currency = CurrencyCode("CHF")).asView(),
        Gutschein(id = 2, number = "6061 9876 5432", amount = 20.0, currency = CurrencyCode("CHF")).asView()))
    VouchersPage(vouchers, remember { SnackbarHostState() }, onBack = {}, onBalanceAll = {}, exportOn = {}) { newValue, onNew ->
        VouchersCard(
            condition = vouchers, actions = object : VoucherCardActions {}, newValue = newValue, onNew = onNew,
        )
    }
}

/**
 * Texts of the ViewModels from the real resources, so that a photo shows „Serverfehler (500)“
 * instead of the placeholder „fehler“ of the JVM tests (NumbersTexts).
 */
internal class ContextTexts(
    private val ctx: Context = ApplicationProvider.getApplicationContext(),
) : Texts {
    override fun text(id: Int, vararg args: Any?): String =
        if (args.isEmpty()) ctx.getString(id) else ctx.getString(id, *args)
    override fun quantity(id: Int, count: Int, vararg args: Any?): String =
        ctx.resources.getQuantityString(id, count, *args)
    override fun message(error: Outcome.Failure): String {
        if (error.message.isNotBlank()) return error.message
        val id = errorTextId(error)
        return errorTextArgument(error)?.let { text(id, it) } ?: text(id)
    }
    override fun loggedIn() = true
}
