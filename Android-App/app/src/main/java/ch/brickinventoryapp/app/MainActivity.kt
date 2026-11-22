package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import android.os.Bundle
import android.widget.Toast
import androidx.glance.appwidget.updateAll
import ch.brickinventoryapp.app.widget.SammlungsWidget
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.navigation.compose.*
import ch.brickinventoryapp.state.ui.AppViewModel
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.theme.darstellung
import androidx.compose.foundation.isSystemInDarkTheme
import coil3.ImageLoader
import androidx.compose.runtime.CompositionLocalProvider
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.LocalAppVersion
import ch.brickinventoryapp.model.util.AppVersion
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.content.Intent
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import ch.brickinventoryapp.services.alarm.PriceAlertRepository
import ch.brickinventoryapp.state.ui.Meldungseingang
import ch.brickinventoryapp.ui.components.DevicesStepProtection
import ch.brickinventoryapp.model.step.Schrittbindung
import ch.brickinventoryapp.ui.components.LocalSchrittschutz
import ch.brickinventoryapp.ui.components.AppLock
import ch.brickinventoryapp.ui.components.AppLockScreen
import ch.brickinventoryapp.ui.components.AppOverviewProtection
import ch.brickinventoryapp.ui.components.LocalAppLock
import ch.brickinventoryapp.ui.components.unlockWithDevicesLock
import android.os.SystemClock
import android.app.KeyguardManager
import ch.brickinventoryapp.security.CertificateUnresolved
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import ch.brickinventoryapp.app.ui.components.UserCaDialog
import ch.brickinventoryapp.ui.components.WithoutLockWarning
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.ui.components.KeyboardWithoutLearn
import ch.brickinventoryapp.app.ui.components.CertificateDialog
import ch.brickinventoryapp.account.ui.screens.StartPasswordMask
import ch.brickinventoryapp.account.ui.screens.ZweiterFaktorPflichtMaske
import ch.brickinventoryapp.state.ui.viewmodel.DarstellungViewModel
import ch.brickinventoryapp.account.ui.viewmodel.AccountViewModel
import ch.brickinventoryapp.state.ui.viewmodel.VertrauenViewModel
import ch.brickinventoryapp.app.csv.CsvImportViewModel
import ch.brickinventoryapp.account.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.app.nav.ActivityState
import ch.brickinventoryapp.ui.util.SecretClipboard
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.network.util.Protokoll
import ch.brickinventoryapp.BuildConfig

@AndroidEntryPoint
class MainActivity : OnlyLauncherStart() {
    private val vm: AppViewModel by viewModels()
    private val darstellung: DarstellungViewModel by viewModels()
    private val vertrauen: VertrauenViewModel by viewModels()
    private val selbstUpdate: UpdateViewModel by viewModels()
    private val csvImport: CsvImportViewModel by viewModels()

    /** Fetched here once so that no destination searches the activity's ViewModelStore itself. */
    private fun activityState() = ActivityState(
        app = vm, update = selbstUpdate, csvImport = csvImport, darstellung = darstellung, vertrauen = vertrauen,
    )

    // Only for the mandatory forms (start password, second factor) that lie above everything.
    private val startAccountVm: AccountViewModel by viewModels()

    // ImageLoader as a Hilt singleton from NetzModule — one instance per process instead of per
    // activity: otherwise every rotation would lose the memory cache, and two
    // DiskCache instances would run on the same directory.
    @Inject lateinit var imageLoader: ImageLoader

    /** Confirmation via device lock before sensitive steps; valid until the app goes to the background. */
    private val schrittschutz by lazy {
        DevicesStepProtection(this, noKey = {
            android.widget.Toast.makeText(this, LanguageManager.localizedContext(this).getString(R.string.schritt_kein_schluessel),
                android.widget.Toast.LENGTH_LONG).show()
        }, bindung = schrittbindung, abgelehnt = { meldung ->
            // The server's sentence says what to do (sign in again, set up a screen lock).
            Toast.makeText(this, meldung ?: LanguageManager.localizedContext(this).getString(R.string.schritt_server_fehler),
                Toast.LENGTH_LONG).show()
        }, withoutAttestation = {
            Toast.makeText(this, LanguageManager.localizedContext(this).getString(R.string.schritt_ohne_attestation),
                Toast.LENGTH_LONG).show()
        }) {
            LanguageManager.localizedContext(this)
                .getString(R.string.schritt_untertitel)
        }
    }

    /** Optional, default off: after N minutes in the background continue only after the device lock. */
    private val appLock by lazy { AppLock(SystemClock::elapsedRealtime, AppLockStore(this)) { devicesStarts(this) } }

    /** Binds the step guard to the server (routes/api_v1/device.ts). */
    @Inject lateinit var schrittbindung: Schrittbindung

    /** The target of a tapped notification; stored only by the non-exported MeldungsEinstieg. */
    @Inject lateinit var meldungseingang: Meldungseingang

    @Inject lateinit var preisalarme: PriceAlertRepository

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
        vm.setFromMessageRequest(meldungseingang.abholen())
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
            fangeAusserAbbruch { preisalarme.pass() }
                .onFailure { Protokoll.warnung("Preisalarm", "Abruf beim Oeffnen fehlgeschlagen", it) }
        }
    }

    override fun onResume() {
        super.onResume()
        vm.inForeground()
    }

    override fun onStop() {
        super.onStop()
        schrittschutz.vergiss()
        appLock.inBackground()
        drawWidgetNew()
    }

    private fun deviceSecure(): Boolean = getSystemService(KeyguardManager::class.java)?.isDeviceSecure == true

    /**
     * A new server key from Android 16: the yes counts only after the screen lock (signature
     * of the app lock's key). The dialog stays open until then; cancelling changes nothing.
     */
    private fun trustCertificate(frage: CertificateUnresolved, eingabe: String?): Boolean {
        if (!frage.deviceConfirmationNeeded || !deviceSecure()) return vertrauen.trustCertificate(eingabe)
        val texts = LanguageManager.localizedContext(this)
        unlockWithDevicesLock(this, texts.getString(R.string.zert_geraet_titel), frage.schluessel.substringBeforeLast(':')) {
            // Without a lock unlockWithDevicesLock lets through unasked; then the transcript must count.
            vertrauen.trustCertificate(eingabe, deviceConfirmed = deviceSecure())
        }
        return true
    }

    /** The widget hides its amounts depending on the app lock (AppLock.hiddenWidget); it redraws only when prompted. */
    private fun drawWidgetNew() {
        val ctx = applicationContext
        lifecycleScope.launch {
            fangeAusserAbbruch { SammlungsWidget().updateAll(ctx) }
                .onFailure { Protokoll.warnung("Widget", "Neuzeichnen fehlgeschlagen", it) }
        }
    }

    /** From Android 10 an expired secret can be removed from the clipboard only with focus. */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) SecretClipboard.pruefe(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Before super.onCreate(): the splash screen replaces the window theme until
        // Compose has drawn the first frame — no white flash.
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // The app was closed: the MeldungsEinstieg stored the target before the start.
        adoptMessageTarget()
        // Register the device key right after the sign-in: later the server accepts none.
        lifecycleScope.launch {
            vm.state.map { it.isLoggedIn }.distinctUntilChanged().filter { it }.collect { schrittschutz.bindAnServer() }
        }

        setContent {
            // Design chosen globally by the admin. Deliberately collect ONLY this field:
            // the complete AppUiState at this place would have invalidated the root
            // of the composition on every state change
            // and recomposed the whole app through it.
            val theme by darstellung.appTheme.collectAsStateWithLifecycle()
            val helligkeit by darstellung.helligkeit.collectAsStateWithLifecycle()
            val systemfarben by darstellung.systemfarben.collectAsStateWithLifecycle()
            // Via the privacy screen counter, so that a screen that sets it itself
            // does not cancel the user's wish when leaving.
            val hidePreview by darstellung.hidePreview.collectAsStateWithLifecycle()
            if (hidePreview) Sichtschutz(coverage = false)
            AppOverviewProtection(appLock)
            val view = darstellung(theme, helligkeit, isSystemInDarkTheme(), systemfarben, android.os.Build.VERSION.SDK_INT)
            BrickInventoryManagerTheme(theme = view.design, dunkel = view.dunkel, systemfarben = view.systemfarben) {
                // Only this module knows the version; the areas read it here.
                CompositionLocalProvider(
                    LocalAppVersion provides AppVersion(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE),
                    LocalSchrittschutz provides schrittschutz,
                    LocalAppLock provides appLock,
                ) { KeyboardWithoutLearn {
                    // App-wide: voucher number and PIN, passwords, codes and
                    // invitations; the keyboard therefore does not learn set names either.
                    val gesperrt by appLock.gesperrt.collectAsStateWithLifecycle()
                    // Locked, TalkBack reads nothing underneath either.
                    Box(if (gesperrt) Modifier.clearAndSetSemantics {} else Modifier) {
                        BrickInventoryRoute(activityState(), imageLoader)
                    }
                    // Without a screen lock the step guard asks here instead of silently letting through.
                    WithoutLockWarning(schrittschutz.withoutLock)
                    // With a start password the server rejects everything: only the form until it is replaced.
                    val startpasswort by vm.startPasswordNeeded.collectAsStateWithLifecycle()
                    // Initial value false: the form appears only with both states,
                    // and Lint forbids StateFlow.value in the composition.
                    val angemeldet by remember { vm.state.map { it.isLoggedIn }.distinctUntilChanged() }
                        .collectAsStateWithLifecycle(false)
                    // Likewise admin rights without a second factor; the start password comes first.
                    val factorRequired by vm.secondFactorNeeded.collectAsStateWithLifecycle()
                    if (startpasswort && angemeldet) {
                        val kontoZustand by startAccountVm.kontoState.collectAsStateWithLifecycle()
                        StartPasswordMask(
                            kontoZustand = kontoZustand,
                            onReplace = { alt, neu, code -> startAccountVm.aenderePasswort(alt, neu, code) },
                            onAbmelden = { vm.logout() },
                        )
                    } else if (factorRequired && angemeldet) {
                        val factorState by startAccountVm.secondFactorState.collectAsStateWithLifecycle()
                        ZweiterFaktorPflichtMaske(
                            zustand = factorState,
                            onEinrichten = startAccountVm::setUpSecondFactorOne,
                            onBestaetigen = startAccountVm::bestaetigeZweitenFaktor,
                            onWeiter = { startAccountVm.secondFactorBack(); vm.secondFactorConfigured() },
                            onAbmelden = { startAccountVm.secondFactorBack(); vm.logout() },
                        )
                    }
                    // Above everything: any fetch can hit an unknown certificate.
                    val zertifikat by vertrauen.zertifikat.collectAsStateWithLifecycle()
                    val userCa by vertrauen.userCa.an.collectAsStateWithLifecycle()
                    zertifikat?.let { frage ->
                        CertificateDialog(
                            frage = frage,
                            userCaAn = userCa,
                            trustOn = { eingabe -> trustCertificate(frage, eingabe) },
                            onNutzerCa = { vertrauen.userCa.requests(); vertrauen.discardCertificate() },
                            onAbbrechen = vertrauen::discardCertificate,
                            deviceSecure = deviceSecure(),
                        )
                    }
                    // Here and not in the settings: the certificate dialog asks too.
                    val userCaQuestion by vertrauen.userCa.frage.collectAsStateWithLifecycle()
                    if (userCaQuestion) {
                        UserCaDialog(
                            onJa = vertrauen.userCa::bestaetigen,
                            onAbbrechen = vertrauen.userCa::abbrechen,
                        )
                    }
                    // Topmost: the app lock also covers the mandatory forms.
                    if (gesperrt) AppLockScreen {
                        val texts = LanguageManager.localizedContext(this@MainActivity)
                        unlockWithDevicesLock(this@MainActivity, texts.getString(R.string.app_sperre_gesperrt),
                            texts.getString(R.string.schritt_untertitel)) { appLock.entsperrt(); drawWidgetNew() }
                    }
                } }
            }
        }
    }
}
