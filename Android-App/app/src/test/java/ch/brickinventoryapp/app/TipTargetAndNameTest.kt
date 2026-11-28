package ch.brickinventoryapp.app

import ch.brickinventoryapp.ui.components.LocalAddressRules
import ch.brickinventoryapp.network.util.NetworkAddressRules
import androidx.compose.runtime.CompositionLocalProvider
import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.lifecycle.SavedStateHandle
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.account.ui.AccountUiState
import ch.brickinventoryapp.account.ui.SecondFactorUiState
import ch.brickinventoryapp.account.ui.screens.SecondFactorRequiredMask
import ch.brickinventoryapp.account.ui.screens.SettingsExits
import ch.brickinventoryapp.account.ui.screens.SettingsScreen
import ch.brickinventoryapp.account.ui.screens.SettingsState
import ch.brickinventoryapp.account.ui.screens.StartPasswordMask
import ch.brickinventoryapp.account.ui.viewmodel.SettingsActions
import ch.brickinventoryapp.app.testing.Examples
import ch.brickinventoryapp.catalog.ui.CatalogUiState
import ch.brickinventoryapp.catalog.ui.screens.CatalogScreen
import ch.brickinventoryapp.catalog.ui.viewmodel.CatalogActions
import ch.brickinventoryapp.collection.ui.screens.GalleryRoute
import ch.brickinventoryapp.collection.ui.screens.SetDetailRoute
import ch.brickinventoryapp.collection.ui.screens.WantedRoute
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.data.testing.testCatalogRepository
import ch.brickinventoryapp.data.testing.testSetsRepository
import ch.brickinventoryapp.finances.ui.screens.FinanceRoute
import ch.brickinventoryapp.login.ui.LoginForm
import ch.brickinventoryapp.login.ui.screens.LoginActions
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.login.ui.screens.LoginScreenState
import ch.brickinventoryapp.login.ui.screens.SetupScreen
import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.domain.CatalogSetView
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.parts.ui.screens.MinifigsRoute
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.state.ui.viewmodel.AppearanceActions
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.uistate.loading
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.lang.reflect.Proxy
import java.util.Locale

/**
 * Accessibility of the main screens with sample data: every tappable element has
 * a tap target of at least 48 × 48 dp (layout or tap area) and carries a name
 * (text, description or field); a role alone only says „Schaltfläche“, not which one.
 * Replaces the source search for small IconButtons (TouchTargetSizeTest).
 *
 * Counter-checks (patches under counter-checks/, measured only in CI — Robolectric):
 *   tap-target-small         “Sign out” in settings without heightIn, Material button 40 dp → red “settings”
 *                          (a 40 dp row without its own shape stayed green: touchBoundsInRoot stretches it to 48 dp)
 *   tap-target-without-name    add button without description → red “gallery” (without name)
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class TipTargetAndNameTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val world = Examples.World(ContextTexts())
    private val images = SampleImages.loader(ctx)
    private val before = Locale.getDefault()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun tearDown() {
        Locale.setDefault(before)
        world.close()
    }

    /** An interface whose calls do nothing; only returns without a value are needed. */
    private inline fun <reified T> none(): T =
        Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, _, _ -> null } as T

    /** Shows [content] as soon as [ready] holds, and checks every tappable element. */
    private fun check(name: String, ready: () -> Boolean = { true }, content: @Composable () -> Unit) {
        driveUntil(name, requests = { world.paths.requests.size }, ready = ready)
        compose.setContent { CompositionLocalProvider(LocalAddressRules provides NetworkAddressRules) { 
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) { content() }
            }
         }}
        driveUntil("$name (shown)", requests = { world.paths.requests.size }, ready = ready)
        compose.waitForIdle()
        val density = ctx.resources.displayMetrics.density
        val min = 48 * density - 0.5f
        val tappable = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.OnClick)).fetchSemanticsNodes()
        assertTrue("$name: nothing tappable found — does the search still apply?", tappable.isNotEmpty())
        val small = tappable.filter { n ->
            val target = n.touchBoundsInRoot
            maxOf(n.size.width.toFloat(), target.width) < min || maxOf(n.size.height.toFloat(), target.height) < min
        }.map { "${describe(it)} (${(it.size.width / density).toInt()}×${(it.size.height / density).toInt()} dp)" }
        val nameless = tappable.filter { !hasNames(it) }.map { describe(it) }
        assertTrue("$name: tap target below 48 dp: $small", small.isEmpty())
        assertTrue("$name: without a name: $nameless", nameless.isEmpty())
    }

    private fun hasNames(n: SemanticsNode): Boolean {
        val c = n.config
        return c.getOrNull(SemanticsProperties.Text).orEmpty().any { it.text.isNotBlank() } ||
            c.getOrNull(SemanticsProperties.ContentDescription).orEmpty().any { it.isNotBlank() } ||
            c.getOrNull(SemanticsProperties.EditableText) != null
    }

    private fun describe(n: SemanticsNode): String {
        val c = n.config
        val text = (c.getOrNull(SemanticsProperties.ContentDescription).orEmpty() +
            c.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text }).joinToString(" ").take(40)
        return "„$text“ #${n.id}"
    }

    private fun entryVm() = world.t.track(EntryViewModel(world.t.session, world.t.filter(), world.t.hints,
        testSetsRepository(world.t.api), world.t.setCatalog(), world.t.wantedList(), testCatalogRepository(world.t.api),
        object : SetCreator {
            override fun create(setNumber: String, quantity: Int, purchasePrice: Money?, condition: Condition?,
                                 ownerUserId: Int?, storage: String?): Flow<SetCreateStep> = emptyFlow()
        }, SavedStateHandle()))

    @Test
    fun gallery() {
        val vm = world.gallery().also { it.loadSets(); it.loadStats() }
        check("gallery", { vm.galleryState.value.sets.isNotEmpty() }) {
            GalleryRoute(vm = vm, entryVm = entryVm(), imageLoader = images, onScanBarcode = {}, onSetClick = {})
        }
    }

    @Test
    fun setDetail() {
        val vm = world.setDetail()
        check("set detail", { vm.setDetailState.value.let { it.setDetail != null && !it.priceFetch.loading } }) {
            SetDetailRoute(setNumber = Examples.SET, vm = vm, serverUrl = "", imageLoader = images, onBack = {}, onDelete = {})
        }
    }

    @Test
    fun parts() {
        val vm = world.parts().also { it.loadParts() }
        check("parts", { vm.partsState.value.parts.isNotEmpty() }) { PartsRoute(vm = vm, imageLoader = images) }
    }

    @Test
    fun figures() {
        val vm = world.figures().also { it.loadMinifigs() }
        check("figures", { vm.minifigsState.value.minifigs.isNotEmpty() }) { MinifigsRoute(vm = vm, imageLoader = images) }
    }

    @Test
    fun finances() {
        val vm = world.finances().also { it.loadValuation() }
        check("finances", { vm.financeState.value.valuation != null }) { FinanceRoute(vm = vm, imageLoader = images) }
    }

    @Test
    fun wantedList() {
        val vm = world.wantedList().also { it.loadWanted() }
        check("watchlist", { vm.wantedState.value.wantedItem.isNotEmpty() }) {
            WantedRoute(vm = vm, imageLoader = images, onScan = {}, onOpenSingle = { _, _ -> })
        }
    }

    @Test
    fun catalog() {
        val sets = (1..4).map { CatalogSetView(setNumber = "1030$it-1", name = "Beispielset $it", year = 2020 + it, numParts = 500 * it) }
        check("catalog") {
            CatalogScreen(CatalogUiState(loadedPages = mapOf(1 to sets), total = sets.size), serverUrl = "",
                catalog = none<CatalogActions>(), imageLoader = images, onSetClick = {})
        }
    }

    @Test
    fun vouchers() = check("vouchers") { Vouchers() }

    @Test
    fun settings() = check("settings") {
        SettingsScreen(
            condition = SettingsState(AppUiState(serverUrl = "https://brick.example.org"),
                "system", Design.CLASSIC, false, false, false, false),
            actions = none<SettingsActions>(),
            appearance = none<AppearanceActions>(), exits = none<SettingsExits>(),
            scrollState = androidx.compose.foundation.rememberScrollState(),
        )
    }

    @Test
    fun logIn() = check("sign in") { LoginContent(LoginForm.LOGIN) }

    @Test
    fun register() = check("register") { LoginContent(LoginForm.REGISTER) }

    @Test
    fun setUp() = check("set up") { SetupScreen(currentUrl = "https://brick.example.org", onSave = {}, development = false) }

    @Test
    fun startPassword() = check("start password") { StartPasswordMask(AccountUiState(), { _, _, _ -> }, {}) }

    @Test
    fun secondFactor() = check("second factor") { SecondFactorRequiredMask(SecondFactorUiState(active = false), {}, {}, {}, {}) }

    @Composable
    private fun LoginContent(form: LoginForm) = LoginScreen(
        LoginScreenState(serverUrl = "https://brick.example.org", form = form, registrationOpen = true),
        object : LoginActions {},
    )
}
