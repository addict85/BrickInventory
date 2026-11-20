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

    /** Einmal hier geholt, damit kein Ziel selbst im ViewModelStore der Activity sucht. */
    private fun activityState() = ActivityState(
        app = vm, update = selbstUpdate, csvImport = csvImport, darstellung = darstellung, vertrauen = vertrauen,
    )

    // Nur für die Pflichtmasken (Startpasswort, zweiter Faktor), die über allem liegen.
    private val startAccountVm: AccountViewModel by viewModels()

    // ImageLoader als Hilt-Singleton aus NetzModule — eine Instanz je Prozess statt je
    // Activity: Sonst verlöre jede Drehung den Memory-Cache, und zwei
    // DiskCache-Instanzen liefen auf demselben Verzeichnis.
    @Inject lateinit var imageLoader: ImageLoader

    /** Rückfrage per Gerätesperre vor heiklen Schritten; gilt bis die App in den Hintergrund geht. */
    private val schrittschutz by lazy {
        DevicesStepProtection(this, noKey = {
            android.widget.Toast.makeText(this, LanguageManager.localizedContext(this).getString(R.string.schritt_kein_schluessel),
                android.widget.Toast.LENGTH_LONG).show()
        }, bindung = schrittbindung, abgelehnt = { meldung ->
            // Der Satz des Servers sagt, was zu tun ist (neu anmelden, Displaysperre einrichten).
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

    /** Optional, Vorgabe aus: nach N Minuten im Hintergrund erst nach der Gerätesperre weiter. */
    private val appLock by lazy { AppLock(SystemClock::elapsedRealtime, AppLockStore(this)) { devicesStarts(this) } }

    /** Bindet den Schrittschutz an den Server (routes/api_v1/device.ts). */
    @Inject lateinit var schrittbindung: Schrittbindung

    /** Das Ziel einer angetippten Meldung; abgelegt nur vom nicht exportierten MeldungsEinstieg. */
    @Inject lateinit var meldungseingang: Meldungseingang

    @Inject lateinit var preisalarme: PriceAlertRepository

    /**
     * Eine angetippte Meldung, waehrend die App schon laeuft (singleTop). Das
     * Ziel liegt im Meldungseingang; OnlyLauncherStart hat Extras und Daten des
     * Intents schon entfernt, denn jede App kann diese Activity starten.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        adoptMessageTarget()
    }

    /** Traegt das abgelegte Set in den Zustand — der NavHost holt es dort ab. */
    private fun adoptMessageTarget() {
        vm.setFromMessageRequest(meldungseingang.abholen())
    }

    /**
     * Beim Nach-vorn-Kommen einmal nach ausgelösten Preisalarmen fragen, nicht erst
     * im stündlichen Auftrag. onStart, weil onCreate bei der Rückkehr aus dem
     * Hintergrund nicht läuft; die Marke des Servers verhindert doppelte Meldungen.
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

    /** Das Widget verdeckt seine Beträge je nach App-Sperre (AppLock.hiddenWidget); es zeichnet nur auf Anstoss neu. */
    private fun drawWidgetNew() {
        val ctx = applicationContext
        lifecycleScope.launch {
            fangeAusserAbbruch { SammlungsWidget().updateAll(ctx) }
                .onFailure { Protokoll.warnung("Widget", "Neuzeichnen fehlgeschlagen", it) }
        }
    }

    /** Ein abgelaufenes Geheimnis lässt sich ab Android 10 erst mit Fokus aus der Zwischenablage nehmen. */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) SecretClipboard.pruefe(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Vor super.onCreate(): Das Startbild ersetzt das Fenster-Theme, bis
        // Compose das erste Bild gezeichnet hat — kein weisses Aufblitzen.
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Die App war zu: Der MeldungsEinstieg hat das Ziel vor dem Start abgelegt.
        adoptMessageTarget()
        // Den Geräteschlüssel gleich nach der Anmeldung hinterlegen: Später nimmt der Server keinen an.
        lifecycleScope.launch {
            vm.state.map { it.isLoggedIn }.distinctUntilChanged().filter { it }.collect { schrittschutz.bindAnServer() }
        }

        setContent {
            // Global vom Admin gewähltes Design. Bewusst NUR dieses Feld
            // sammeln: Der komplette AppUiState an dieser Stelle hätte bei
            // jeder Zustandsänderung die Wurzel der Composition invalidiert
            // und darüber die ganze App rekomponiert.
            val theme by darstellung.appTheme.collectAsStateWithLifecycle()
            val helligkeit by darstellung.helligkeit.collectAsStateWithLifecycle()
            val systemfarben by darstellung.systemfarben.collectAsStateWithLifecycle()
            // Über den Zähler von Sichtschutz, damit ein Bildschirm, der ihn selbst
            // setzt, beim Verlassen den Wunsch des Nutzers nicht aufhebt.
            val hidePreview by darstellung.hidePreview.collectAsStateWithLifecycle()
            if (hidePreview) Sichtschutz(coverage = false)
            AppOverviewProtection(appLock)
            val view = darstellung(theme, helligkeit, isSystemInDarkTheme(), systemfarben, android.os.Build.VERSION.SDK_INT)
            BrickInventoryManagerTheme(theme = view.design, dunkel = view.dunkel, systemfarben = view.systemfarben) {
                // Die Fassung kennt nur dieses Modul; die Bereiche lesen sie hier.
                CompositionLocalProvider(
                    LocalAppVersion provides AppVersion(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE),
                    LocalSchrittschutz provides schrittschutz,
                    LocalAppLock provides appLock,
                ) { KeyboardWithoutLearn {
                    // App-weit: Gutschein-Nummer und PIN, Passwörter, Codes und
                    // Einladungen; Setnamen lernt die Tastatur dafür auch nicht mit.
                    val gesperrt by appLock.gesperrt.collectAsStateWithLifecycle()
                    // Gesperrt liest auch TalkBack nichts darunter vor.
                    Box(if (gesperrt) Modifier.clearAndSetSemantics {} else Modifier) {
                        BrickInventoryRoute(activityState(), imageLoader)
                    }
                    // Ohne Displaysperre fragt der Schrittschutz hier nach, statt still durchzulassen.
                    WithoutLockWarning(schrittschutz.withoutLock)
                    // Mit Startpasswort weist der Server alles ab: nur die Maske, bis es ersetzt ist.
                    val startpasswort by vm.startPasswordNeeded.collectAsStateWithLifecycle()
                    // Startwert false: Die Maske erscheint erst mit beiden Zuständen,
                    // und StateFlow.value in der Komposition verbietet Lint.
                    val angemeldet by remember { vm.state.map { it.isLoggedIn }.distinctUntilChanged() }
                        .collectAsStateWithLifecycle(false)
                    // Ebenso Verwalterrechte ohne zweiten Faktor; das Startpasswort kommt zuerst.
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
                    // Über allem: Ein unbekanntes Zertifikat kann jeder Abruf treffen.
                    val zertifikat by vertrauen.zertifikat.collectAsStateWithLifecycle()
                    val userCa by vertrauen.userCa.an.collectAsStateWithLifecycle()
                    zertifikat?.let { frage ->
                        CertificateDialog(
                            frage = frage,
                            userCaAn = userCa,
                            trustOn = vertrauen::trustCertificate,
                            onNutzerCa = { vertrauen.userCa.requests(); vertrauen.discardCertificate() },
                            onAbbrechen = vertrauen::discardCertificate,
                        )
                    }
                    // Hier und nicht in den Einstellungen: Auch der Zertifikatsdialog fragt an.
                    val userCaQuestion by vertrauen.userCa.frage.collectAsStateWithLifecycle()
                    if (userCaQuestion) {
                        UserCaDialog(
                            onJa = vertrauen.userCa::bestaetigen,
                            onAbbrechen = vertrauen.userCa::abbrechen,
                        )
                    }
                    // Zuoberst: Die App-Sperre deckt auch die Pflichtmasken ab.
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
