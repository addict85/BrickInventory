package ch.brickinventoryapp.app.testing

import android.content.Context
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.account.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.app.BrickInventoryRoute
import ch.brickinventoryapp.app.Examples
import ch.brickinventoryapp.app.csv.CsvImportCoordinator
import ch.brickinventoryapp.app.csv.CsvImportViewModel
import ch.brickinventoryapp.app.nav.ActivityState
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.data.AppearanceStore
import ch.brickinventoryapp.data.CsvImportRepository
import ch.brickinventoryapp.data.LoginState
import ch.brickinventoryapp.data.PasswordRequired
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.data.TrustStore
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.finances.ui.viewmodel.VoucherViewModel
import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.util.AppVersion
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
import ch.brickinventoryapp.update.data.UpdateRepository
import ch.brickinventoryapp.update.util.UPDATE_RELEASE_BASE
import ch.brickinventoryapp.update.util.UpdateDescription
import ch.brickinventoryapp.update.util.UpdateDevice
import ch.brickinventoryapp.update.util.UpdateStatus
import ch.brickinventoryapp.update.util.UpdateStatusStore
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
import java.io.File
import java.io.IOException
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature
import java.util.Base64

/**
 * The whole app on the sample world: [BrickInventoryRoute] with the activity's ViewModels, every
 * destination's ViewModel from [Examples.World] via `hiltViewModel()`. Signed in on [SERVER]; the
 * update check finds what [updates] offers. Tests drive it like a user, through the bar and the rows.
 */
class TestApp(texts: Texts = NumbersTexts, val images: ImageLoader = noImages(), val updates: TestUpdates = TestUpdates()) : AutoCloseable {
    val world = Examples.World(texts)
    private val t = world.t

    val activity: ActivityState
    val viewModels = ViewModelFactories()

    init {
        t.session.loginChanged(SERVER, true)
        activity = ActivityState(
            app = t.track(AppViewModel(NoSession, t.messages, t.session, t.viewport, t.scrollMemory, NoOutbox,
                PasswordRequired(), SecondFactorRequired())),
            update = t.track(UpdateViewModel(updates, updates, updates, updates, Dispatchers.Main)),
            csvImport = t.track(CsvImportViewModel(CsvImportCoordinator(NoCsvImport, NoCsvImport, t.sync), NoCsvImport, texts,
                t.messages, t.session)),
            appearance = t.track(AppearanceViewModel(InMemoryAppearance, t.session) {}),
            trust = t.track(TrustViewModel(InMemoryTrust(), {}, CertificateQuestion())),
        )
        viewModels.apply {
            put { world.gallery(it) }
            put<EntryViewModel> { world.entry() }
            put { world.setDetail(it) }
            put { world.wantedList(it) }
            put { world.parts(it) }
            put { world.figures(it) }
            put<PartListViewModel> { world.buildList(it) }
            put { world.finances(it) }
            put<VoucherViewModel> { world.vouchers() }
            put<SettingsViewModel> { world.settings() }
            put<PurchasesViewModel> { world.purchases() }
        }
    }

    /** Draws the app in [compose]'s activity; the destinations find their ViewModels there. */
    fun show(compose: AndroidComposeTestRule<*, HiltTestActivity>) {
        compose.activity.viewModels = viewModels
        compose.setContent { BrickInventoryManagerTheme(theme = Design.CLASSIC) { BrickInventoryRoute(activity, images) } }
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

/**
 * The update path without network: a description signed with the test's own key for version
 * [offered]; null means nothing newer is published. [loads] records every download.
 */
class TestUpdates(var offered: Int? = null) : UpdateRepository, UpdateDevice, UpdateStatusStore, LoginState {
    private val key: KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()
    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-testapp-${System.nanoTime()}")

    val loads = mutableListOf<UpdateDescription>()
    val fetches = mutableListOf<Long>()
    var checkAtStart = true
    private var status: UpdateStatus? = null

    override val runningVersion = AppVersion("2.10", 10)
    override val authTokenState: StateFlow<String?> = MutableStateFlow("token")

    override suspend fun fetchDescription(): String {
        fetches += System.nanoTime()
        val code = offered ?: throw IOException("nothing published")
        val now = System.currentTimeMillis() / 1000
        val data = """{"versionCode":$code,"versionName":"2.$code","apkUrl":"$UPDATE_RELEASE_BASE/BrickInventory.apk",""" +
            """"apkSize":4,"apkSha256":"","ausgestellt":${now - 60},"gueltigBis":${now + 86_400}}"""
        val signature = Signature.getInstance("SHA256withECDSA").run { initSign(key.private); update(data.toByteArray()); sign() }
        val b64 = Base64.getEncoder()
        return """{"daten":"${b64.encodeToString(data.toByteArray())}","beschreibungssignatur":"${b64.encodeToString(signature)}"}"""
    }

    override fun loadApk(description: UpdateDescription, target: File): Flow<Int> { loads += description; return emptyFlow() }

    override fun descriptionKey() = listOf(key.public.encoded)
    override fun updateFile() = File(folder, "BrickInventory.apk")
    override fun signatureFits(apk: File) = false
    override fun apkVersion(apk: File): Long? = null
    override fun installMay() = false
    override fun install(apk: File) = error("the test installs nothing")

    override suspend fun updateStatus() = status
    override suspend fun rememberUpdateStatus(state: UpdateStatus) { status = state }
    override fun startCheckEnabled() = checkAtStart
    override fun setStartCheck(an: Boolean) { checkAtStart = an }
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
