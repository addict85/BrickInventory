package ch.brickinventoryapp.app.testing

import ch.brickinventoryapp.ui.components.LocalAddressRules
import ch.brickinventoryapp.network.util.NetworkAddressRules
import androidx.compose.runtime.CompositionLocalProvider
import android.content.Context
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.app.BrickInventoryRoute
import ch.brickinventoryapp.app.csv.CsvImportCoordinator
import ch.brickinventoryapp.app.csv.CsvImportViewModel
import ch.brickinventoryapp.app.nav.ActivityState
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.data.AppearanceStore
import ch.brickinventoryapp.data.CsvImportRepository
import ch.brickinventoryapp.data.PasswordRequired
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.data.TrustStore
import ch.brickinventoryapp.finances.ui.viewmodel.VoucherViewModel
import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.parts.ui.PlPart
import ch.brickinventoryapp.parts.ui.viewmodel.PartListViewModel
import ch.brickinventoryapp.security.CertificateQuestion
import ch.brickinventoryapp.services.service.CsvImportRunner
import ch.brickinventoryapp.session.SessionRepository
import ch.brickinventoryapp.state.testing.NumbersTexts
import ch.brickinventoryapp.state.ui.AppViewModel
import ch.brickinventoryapp.state.ui.OutboxNotifier
import ch.brickinventoryapp.state.ui.viewmodel.AppearanceViewModel
import ch.brickinventoryapp.state.ui.viewmodel.PurchasesViewModel
import ch.brickinventoryapp.state.ui.viewmodel.Texts
import ch.brickinventoryapp.state.ui.viewmodel.TrustViewModel
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import coil3.ImageLoader
import coil3.intercept.Interceptor
import coil3.request.ErrorResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emptyFlow
import java.io.IOException

/**
 * The whole app on the sample world: [BrickInventoryRoute] with the activity's ViewModels, every
 * destination's ViewModel from [Examples.World] via `hiltViewModel()`. Signed in on [SERVER].
 * Tests drive it like a user, through the bar and the rows.
 */
class TestApp(
    texts: Texts = NumbersTexts,
    val images: ImageLoader = noImages(),
    /** Name and parts per set number for the parts list. */
    partLists: (String) -> Pair<String, List<PlPart>> = { error("no parts list in this test") },
) : AutoCloseable {
    val world = Examples.World(texts)
    private val t = world.t

    val activity: ActivityState
    val viewModels = ViewModelFactories()

    init {
        t.session.loginChanged(SERVER, true)
        activity = ActivityState(
            app = t.track(AppViewModel(NoSession, t.messages, t.session, t.viewport, t.scrollMemory, NoOutbox,
                PasswordRequired(), SecondFactorRequired())),
            csvImport = t.track(CsvImportViewModel(CsvImportCoordinator(NoCsvImport, NoCsvImport, t.sync), NoCsvImport, texts,
                t.messages, t.session)),
            appearance = t.track(AppearanceViewModel(InMemoryAppearance, t.session) {}),
            trust = t.track(TrustViewModel(InMemoryTrust(), {}, CertificateQuestion())),
        )
        viewModels.apply {
            put { world.gallery(it) }
            put<EntryViewModel> { world.entry(it) }
            put { world.setDetail(it) }
            put { world.wantedList(it) }
            put { world.parts(it) }
            put { world.figures(it) }
            put<PartListViewModel> { world.buildList(it, partLists) }
            put { world.finances(it) }
            put<VoucherViewModel> { world.vouchers(it) }
            put<SettingsViewModel> { world.settings() }
            put<PurchasesViewModel> { world.purchases() }
        }
    }

    /** Draws the app in [compose]'s activity; the destinations find their ViewModels there. */
    fun show(compose: AndroidComposeTestRule<*, HiltTestActivity>) {
        compose.activity.viewModels = viewModels
        compose.setContent { CompositionLocalProvider(LocalAddressRules provides NetworkAddressRules) {  BrickInventoryManagerTheme(theme = Design.CLASSIC) { BrickInventoryRoute(activity, images) }  }}
    }

    override fun close() = world.close()

    companion object {
        const val SERVER = "https://nas.example"

        /** Every image fails at once: no network, and the tiles show their placeholder. */
        fun noImages(ctx: Context = ApplicationProvider.getApplicationContext()): ImageLoader =
            ImageLoader.Builder(ctx).components {
                add(Interceptor { chain -> ErrorResult(null, chain.request, IOException("no images in the test")) })
            }.coroutineContext(Dispatchers.Main.immediate).interceptorCoroutineContext(Dispatchers.Main.immediate).build()
    }
}

private object NoSession : SessionRepository {
    override fun launch() = Unit
    override fun logout(): Job = Job().apply { complete() }
    override fun secondFactorConfigured() = Unit
    override fun loadSettings() = Unit
    override fun loadMembers() = Unit
    override fun fetchStorageLocations() = Unit
}

private object NoOutbox : OutboxNotifier {
    override val pending: StateFlow<Int> = MutableStateFlow(0)
    override fun launch(scope: CoroutineScope) = Unit
}

private object NoCsvImport : CsvImportRepository, CsvImportRunner {
    override fun observe(): Flow<CsvImportStatusView> = emptyFlow()
    override suspend fun cancel(): Outcome<Unit> = Outcome.Success(Unit)
    override fun start() = Unit
    override fun stop() = Unit
}

private object InMemoryAppearance : AppearanceStore {
    override fun rememberedDesign() = Design.CLASSIC
    override fun brightness() = "system"
    override fun applyBrightness(choice: String) = Unit
    override fun systemColors() = false
    override fun applySystemColors(an: Boolean) = Unit
    override fun hidePreview() = false
    override fun applyPreviewHidden(an: Boolean) = Unit
    override fun showWidgetValues() = false
    override fun showSetWidgetValues(an: Boolean) = Unit
    override suspend fun saveLanguage(lang: String) = Unit
}

private class InMemoryTrust : TrustStore {
    private val pins = mutableMapOf<String, String>()
    private var userCa = false
    override fun pin(key: String) = pins[key]
    override fun rememberPin(key: String, fingerprint: String) { pins[key] = fingerprint }
    override fun userCaAllowed() = userCa
    override fun setUserCa(an: Boolean) { userCa = an }
}
