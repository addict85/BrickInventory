package ch.brickinventoryapp.app

import android.app.KeyguardManager
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.glance.appwidget.updateAll
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.navigation.compose.*
import ch.brickinventoryapp.BuildConfig
import ch.brickinventoryapp.account.ui.screens.SecondFactorRequiredMask
import ch.brickinventoryapp.account.ui.screens.StartPasswordMask
import ch.brickinventoryapp.account.ui.viewmodel.AccountViewModel
import ch.brickinventoryapp.account.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.app.csv.CsvImportViewModel
import ch.brickinventoryapp.app.nav.ActivityState
import ch.brickinventoryapp.app.ui.components.CertificateDialog
import ch.brickinventoryapp.app.ui.components.UserCaDialog
import ch.brickinventoryapp.app.widget.CollectionWidget
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.model.step.StepBinding
import ch.brickinventoryapp.model.util.AppVersion
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import ch.brickinventoryapp.network.util.AppLog
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.security.CertificateUnresolved
import ch.brickinventoryapp.services.alarm.PriceAlertRepository
import ch.brickinventoryapp.state.ui.AppViewModel
import ch.brickinventoryapp.state.ui.MessageInbox
import ch.brickinventoryapp.state.ui.viewmodel.AppearanceViewModel
import ch.brickinventoryapp.state.ui.viewmodel.TrustViewModel
import ch.brickinventoryapp.ui.components.AppLock
import ch.brickinventoryapp.ui.components.AppLockScreen
import ch.brickinventoryapp.ui.components.AppOverviewProtection
import ch.brickinventoryapp.ui.components.DevicesStepProtection
import ch.brickinventoryapp.ui.components.KeyboardWithoutLearn
import ch.brickinventoryapp.ui.components.LocalAppLock
import ch.brickinventoryapp.ui.components.LocalAppVersion
import ch.brickinventoryapp.ui.components.LocalStepGuard
import ch.brickinventoryapp.ui.components.PrivacyShield
import ch.brickinventoryapp.ui.components.WithoutLockWarning
import ch.brickinventoryapp.ui.components.unlockWithDevicesLock
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.theme.appearance
import ch.brickinventoryapp.ui.util.SecretClipboard
import coil3.ImageLoader
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : OnlyLauncherStart() {
    private val vm: AppViewModel by viewModels()
    private val appearance: AppearanceViewModel by viewModels()
    private val trust: TrustViewModel by viewModels()
    private val selfUpdate: UpdateViewModel by viewModels()
    private val csvImport: CsvImportViewModel by viewModels()

    /** Fetched here once so that no destination searches the activity's ViewModelStore itself. */
    private fun activityState() = ActivityState(
        app = vm, update = selfUpdate, csvImport = csvImport, appearance = appearance, trust = trust,
    )

    // Only for the mandatory forms (start password, second factor) that lie above everything.
    private val startAccountVm: AccountViewModel by viewModels()

    // ImageLoader as a Hilt singleton from NetworkModule — one instance per process instead of per
    // activity: otherwise every rotation would lose the memory cache, and two
    // DiskCache instances would run on the same directory.
    @Inject lateinit var imageLoader: ImageLoader

    /** Confirmation via device lock before sensitive steps; valid until the app goes to the background. */
    private val stepGuard by lazy {
        DevicesStepProtection(this, noKey = {
            android.widget.Toast.makeText(this, LanguageManager.localizedContext(this).getString(R.string.step_no_key),
                android.widget.Toast.LENGTH_LONG).show()
        }, binding = stepBinding, declined = { message ->
            // The server's sentence says what to do (sign in again, set up a screen lock).
            Toast.makeText(this, message ?: LanguageManager.localizedContext(this).getString(R.string.step_server_error),
                Toast.LENGTH_LONG).show()
        }, withoutAttestation = {
            Toast.makeText(this, LanguageManager.localizedContext(this).getString(R.string.step_without_attestation),
                Toast.LENGTH_LONG).show()
        }) {
            LanguageManager.localizedContext(this)
                .getString(R.string.step_subtitle)
        }
    }

    /** Optional, default off: after N minutes in the background continue only after the device lock. */
    private val appLock by lazy { AppLock(SystemClock::elapsedRealtime, AppLockStore(this)) { devicesStarts(this) } }

    /** Binds the step guard to the server (`routes/api/device.ts`). */
    @Inject lateinit var stepBinding: StepBinding

    /** The target of a tapped notification; stored only by the non-exported MessageEntryPoint. */
    @Inject lateinit var messageInbox: MessageInbox

    @Inject lateinit var priceAlarms: PriceAlertRepository

    /**
     * A tapped notification while the app is already running (singleTop). The
     * target lies in the Meldungseingang; OnlyLauncherStart has already removed extras and data
     * of the intent, because any app can start this activity.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        adoptMessageTarget()
    }

    /** Carries the stored set into the state — the NavHost picks it up there. */
    private fun adoptMessageTarget() {
        vm.setFromMessageRequest(messageInbox.pickUp())
    }

    /**
     * When coming to the front, ask once for triggered price alerts, not only
     * in the hourly job. onStart, because onCreate does not run when returning from the
     * background; the server's mark prevents duplicate notifications.
     */
    override fun onStart() {
        super.onStart()
        appLock.inForeground()
        drawWidgetNew()
        lifecycleScope.launch {
            catchUnlessCancelled { priceAlarms.pass() }
                .onFailure { AppLog.warning("Preisalarm", "Abruf beim Oeffnen fehlgeschlagen", it) }
        }
    }

    override fun onResume() {
        super.onResume()
        vm.inForeground()
    }

    override fun onStop() {
        super.onStop()
        stepGuard.forgetNow()
        appLock.inBackground()
        drawWidgetNew()
    }

    private fun deviceSecure(): Boolean = getSystemService(KeyguardManager::class.java)?.isDeviceSecure == true

    /**
     * A new server key from Android 16: the yes counts only after the screen lock (signature
     * of the app lock's key). The dialog stays open until then; cancelling changes nothing.
     */
    private fun trustCertificate(question: CertificateUnresolved, input: String?): Boolean {
        if (!question.deviceConfirmationNeeded || !deviceSecure()) return trust.trustCertificate(input)
        val texts = LanguageManager.localizedContext(this)
        unlockWithDevicesLock(this, texts.getString(R.string.cert_device_title), question.key.substringBeforeLast(':')) {
            // Without a lock unlockWithDevicesLock lets through unasked; then the transcript must count.
            trust.trustCertificate(input, deviceConfirmed = deviceSecure())
        }
        return true
    }

    /** The widget hides its amounts depending on the app lock (AppLock.hiddenWidget); it redraws only when prompted. */
    private fun drawWidgetNew() {
        val ctx = applicationContext
        lifecycleScope.launch {
            catchUnlessCancelled { CollectionWidget().updateAll(ctx) }
                .onFailure { AppLog.warning("Widget", "Neuzeichnen fehlgeschlagen", it) }
        }
    }

    /** From Android 10 an expired secret can be removed from the clipboard only with focus. */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) SecretClipboard.check(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Before super.onCreate(): the splash screen replaces the window theme until
        // Compose has drawn the first frame — no white flash.
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // The app was closed: the MessageEntryPoint stored the target before the start.
        adoptMessageTarget()
        // Register the device key right after the sign-in: later the server accepts none.
        lifecycleScope.launch {
            vm.state.map { it.isLoggedIn }.distinctUntilChanged().filter { it }.collect { stepGuard.bindAnServer() }
        }

        setContent {
            // Design chosen globally by the admin. Deliberately collect ONLY this field:
            // the complete AppUiState at this place would have invalidated the root
            // of the composition on every state change
            // and recomposed the whole app through it.
            val theme by appearance.appTheme.collectAsStateWithLifecycle()
            val brightness by appearance.brightness.collectAsStateWithLifecycle()
            val systemColors by appearance.systemColors.collectAsStateWithLifecycle()
            // Via the privacy screen counter, so that a screen that sets it itself
            // does not cancel the user's wish when leaving.
            val hidePreview by appearance.hidePreview.collectAsStateWithLifecycle()
            if (hidePreview) PrivacyShield(coverage = false)
            AppOverviewProtection(appLock)
            val view = appearance(theme, brightness, isSystemInDarkTheme(), systemColors, android.os.Build.VERSION.SDK_INT)
            BrickInventoryManagerTheme(theme = view.design, dark = view.dark, systemColors = view.systemColors) {
                // Only this module knows the version; the areas read it here.
                CompositionLocalProvider(
                    LocalAppVersion provides AppVersion(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE),
                    LocalStepGuard provides stepGuard,
                    LocalAppLock provides appLock,
                ) { KeyboardWithoutLearn {
                    // App-wide: voucher number and PIN, passwords, codes and
                    // invitations; the keyboard therefore does not learn set names either.
                    val locked by appLock.locked.collectAsStateWithLifecycle()
                    // Locked, TalkBack reads nothing underneath either.
                    Box(if (locked) Modifier.clearAndSetSemantics {} else Modifier) {
                        BrickInventoryRoute(activityState(), imageLoader)
                    }
                    // Without a screen lock the step guard asks here instead of silently letting through.
                    WithoutLockWarning(stepGuard.withoutLock)
                    MandatoryForms()
                    TrustDialogs()
                    // Topmost: the app lock also covers the mandatory forms.
                    if (locked) AppLockScreen {
                        val texts = LanguageManager.localizedContext(this@MainActivity)
                        unlockWithDevicesLock(this@MainActivity, texts.getString(R.string.app_lock_locked),
                            texts.getString(R.string.step_subtitle)) { appLock.unlocked(); drawWidgetNew() }
                    }
                } }
            }
        }
    }

    /** With a start password the server rejects everything: only the form until it is replaced. */
    @Composable
    private fun MandatoryForms() {
        val startPassword by vm.startPasswordNeeded.collectAsStateWithLifecycle()
        // Initial value false: the form appears only with both states,
        // and Lint forbids StateFlow.value in the composition.
        val loggedIn by remember { vm.state.map { it.isLoggedIn }.distinctUntilChanged() }
            .collectAsStateWithLifecycle(false)
        // Likewise admin rights without a second factor; the start password comes first.
        val factorRequired by vm.secondFactorNeeded.collectAsStateWithLifecycle()
        if (startPassword && loggedIn) {
            val accountUiState by startAccountVm.accountState.collectAsStateWithLifecycle()
            StartPasswordMask(
                accountUiState = accountUiState,
                onReplace = { old, newValue, code -> startAccountVm.changePassword(old, newValue, code) },
                onLogout = { vm.logout() },
            )
        } else if (factorRequired && loggedIn) {
            val factorState by startAccountVm.secondFactorState.collectAsStateWithLifecycle()
            SecondFactorRequiredMask(
                condition = factorState,
                onSetUp = startAccountVm::setUpSecondFactorOne,
                onConfirm = startAccountVm::confirmSecondFactor,
                onNext = { startAccountVm.secondFactorBack(); vm.secondFactorConfigured() },
                onLogout = { startAccountVm.secondFactorBack(); vm.logout() },
            )
        }
    }

    /** Above everything: any fetch can hit an unknown certificate. */
    @Composable
    private fun TrustDialogs() {
        val certificate by trust.certificate.collectAsStateWithLifecycle()
        val userCa by trust.userCa.an.collectAsStateWithLifecycle()
        certificate?.let { question ->
            CertificateDialog(
                question = question,
                userCaEnabled = userCa,
                trustOn = { input -> trustCertificate(question, input) },
                onUserCa = { trust.userCa.requests(); trust.discardCertificate() },
                onCancel = trust::discardCertificate,
                deviceSecure = deviceSecure(),
            )
        }
        // Here and not in the settings: the certificate dialog asks too.
        val userCaQuestion by trust.userCa.question.collectAsStateWithLifecycle()
        if (userCaQuestion) {
            UserCaDialog(
                onYes = trust.userCa::confirm,
                onCancel = trust.userCa::cancel,
            )
        }
    }
}
