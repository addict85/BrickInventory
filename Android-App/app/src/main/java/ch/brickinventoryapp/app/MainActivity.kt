package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import android.os.Bundle
import android.widget.Toast
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
import ch.brickinventoryapp.anmeldung.ui.*
import ch.brickinventoryapp.finanzen.ui.*
import ch.brickinventoryapp.katalog.ui.*
import ch.brickinventoryapp.konto.ui.*
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.sammlung.ui.*
import ch.brickinventoryapp.teile.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.verwaltung.ui.*
import ch.brickinventoryapp.zustand.ui.*
import ch.brickinventoryapp.anmeldung.ui.screens.*
import ch.brickinventoryapp.finanzen.ui.screens.*
import ch.brickinventoryapp.katalog.ui.screens.*
import ch.brickinventoryapp.konto.ui.screens.*
import ch.brickinventoryapp.sammlung.ui.screens.*
import ch.brickinventoryapp.teile.ui.screens.*
import ch.brickinventoryapp.ui.screens.*
import ch.brickinventoryapp.verwaltung.ui.screens.*
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.theme.darstellung
import androidx.compose.foundation.isSystemInDarkTheme
import coil3.ImageLoader
import androidx.compose.runtime.CompositionLocalProvider
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.components.LocalAppFassung
import ch.brickinventoryapp.model.util.AppFassung
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.content.Intent
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import ch.brickinventoryapp.dienste.alarm.PreisalarmRepository
import ch.brickinventoryapp.zustand.ui.Meldungseingang
import ch.brickinventoryapp.ui.components.GeraeteSchrittschutz
import ch.brickinventoryapp.model.schritt.Schrittbindung
import ch.brickinventoryapp.ui.components.LocalSchrittschutz
import ch.brickinventoryapp.ui.components.AppSperre
import ch.brickinventoryapp.ui.components.AppSperreSchirm
import ch.brickinventoryapp.ui.components.LocalAppSperre
import ch.brickinventoryapp.ui.components.entsperreMitGeraetesperre
import android.os.SystemClock
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import ch.brickinventoryapp.app.ui.components.NutzerCaDialog
import ch.brickinventoryapp.ui.components.OhneSperreWarnung
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.ui.components.TastaturOhneLernen
import ch.brickinventoryapp.app.ui.components.ZertifikatDialog
import ch.brickinventoryapp.konto.ui.screens.StartpasswortMaske
import ch.brickinventoryapp.konto.ui.screens.ZweiterFaktorPflichtMaske
import ch.brickinventoryapp.zustand.ui.viewmodel.DarstellungViewModel
import ch.brickinventoryapp.konto.ui.viewmodel.KontoViewModel
import ch.brickinventoryapp.zustand.ui.viewmodel.VertrauenViewModel
import ch.brickinventoryapp.app.csv.CsvImportViewModel
import ch.brickinventoryapp.konto.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.app.nav.AktivitaetsZustand
import ch.brickinventoryapp.sicherheit.GeheimeZwischenablage
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.netz.util.Protokoll
import ch.brickinventoryapp.BuildConfig

@AndroidEntryPoint
class MainActivity : NurLauncherStart() {
    private val vm: AppViewModel by viewModels()
    private val darstellung: DarstellungViewModel by viewModels()
    private val vertrauen: VertrauenViewModel by viewModels()
    private val selbstUpdate: UpdateViewModel by viewModels()
    private val csvImport: CsvImportViewModel by viewModels()

    /** Einmal hier geholt, damit kein Ziel selbst im ViewModelStore der Activity sucht. */
    private fun aktivitaetsZustand() = AktivitaetsZustand(
        app = vm, update = selbstUpdate, csvImport = csvImport, darstellung = darstellung, vertrauen = vertrauen,
    )

    // Nur für die Pflichtmasken (Startpasswort, zweiter Faktor), die über allem liegen.
    private val startKontoVm: KontoViewModel by viewModels()

    // ImageLoader als Hilt-Singleton aus NetzModule — eine Instanz je Prozess statt je
    // Activity: Sonst verlöre jede Drehung den Memory-Cache, und zwei
    // DiskCache-Instanzen liefen auf demselben Verzeichnis.
    @Inject lateinit var imageLoader: ImageLoader

    /** Rückfrage per Gerätesperre vor heiklen Schritten; gilt bis die App in den Hintergrund geht. */
    private val schrittschutz by lazy {
        GeraeteSchrittschutz(this, keinSchluessel = {
            android.widget.Toast.makeText(this, LanguageManager.localizedContext(this).getString(R.string.schritt_kein_schluessel),
                android.widget.Toast.LENGTH_LONG).show()
        }, bindung = schrittbindung, abgelehnt = { meldung ->
            // Der Satz des Servers sagt, was zu tun ist (neu anmelden, Displaysperre einrichten).
            Toast.makeText(this, meldung ?: LanguageManager.localizedContext(this).getString(R.string.schritt_server_fehler),
                Toast.LENGTH_LONG).show()
        }, ohneAttestation = {
            Toast.makeText(this, LanguageManager.localizedContext(this).getString(R.string.schritt_ohne_attestation),
                Toast.LENGTH_LONG).show()
        }) {
            LanguageManager.localizedContext(this)
                .getString(R.string.schritt_untertitel)
        }
    }

    /** Optional, Vorgabe aus: nach N Minuten im Hintergrund erst nach der Gerätesperre weiter. */
    private val appSperre by lazy { AppSperre(SystemClock::elapsedRealtime, AppSperreAblage(this)) { geraeteStarts(this) } }

    /** Bindet den Schrittschutz an den Server (routes/api_v1/geraet.ts). */
    @Inject lateinit var schrittbindung: Schrittbindung

    /** Das Ziel einer angetippten Meldung; abgelegt nur vom nicht exportierten MeldungsEinstieg. */
    @Inject lateinit var meldungseingang: Meldungseingang

    @Inject lateinit var preisalarme: PreisalarmRepository

    /**
     * Eine angetippte Meldung, waehrend die App schon laeuft (singleTop). Das
     * Ziel liegt im Meldungseingang; NurLauncherStart hat Extras und Daten des
     * Intents schon entfernt, denn jede App kann diese Activity starten.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        meldungsZielUebernehmen()
    }

    /** Traegt das abgelegte Set in den Zustand — der NavHost holt es dort ab. */
    private fun meldungsZielUebernehmen() {
        vm.setAusMeldungAnfordern(meldungseingang.abholen())
    }

    /**
     * Beim Nach-vorn-Kommen einmal nach ausgelösten Preisalarmen fragen, nicht erst
     * im stündlichen Auftrag. onStart, weil onCreate bei der Rückkehr aus dem
     * Hintergrund nicht läuft; die Marke des Servers verhindert doppelte Meldungen.
     */
    override fun onStart() {
        super.onStart()
        appSperre.imVordergrund()
        lifecycleScope.launch {
            fangeAusserAbbruch { preisalarme.durchgang() }
                .onFailure { Protokoll.warnung("Preisalarm", "Abruf beim Oeffnen fehlgeschlagen", it) }
        }
    }

    override fun onResume() {
        super.onResume()
        vm.imVordergrund()
    }

    override fun onStop() {
        super.onStop()
        schrittschutz.vergiss()
        appSperre.imHintergrund()
    }

    /** Ein abgelaufenes Geheimnis lässt sich ab Android 10 erst mit Fokus aus der Zwischenablage nehmen. */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) GeheimeZwischenablage.pruefe(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Vor super.onCreate(): Das Startbild ersetzt das Fenster-Theme, bis
        // Compose das erste Bild gezeichnet hat — kein weisses Aufblitzen.
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Die App war zu: Der MeldungsEinstieg hat das Ziel vor dem Start abgelegt.
        meldungsZielUebernehmen()
        // Den Geräteschlüssel gleich nach der Anmeldung hinterlegen: Später nimmt der Server keinen an.
        lifecycleScope.launch {
            vm.state.map { it.isLoggedIn }.distinctUntilChanged().filter { it }.collect { schrittschutz.bindeAnServer() }
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
            val vorschauVerbergen by darstellung.vorschauVerbergen.collectAsStateWithLifecycle()
            if (vorschauVerbergen) Sichtschutz(ueberdeckung = false)
            val sicht = darstellung(theme, helligkeit, isSystemInDarkTheme(), systemfarben, android.os.Build.VERSION.SDK_INT)
            BrickInventoryManagerTheme(theme = sicht.design, dunkel = sicht.dunkel, systemfarben = sicht.systemfarben) {
                // Die Fassung kennt nur dieses Modul; die Bereiche lesen sie hier.
                CompositionLocalProvider(
                    LocalAppFassung provides AppFassung(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE),
                    LocalSchrittschutz provides schrittschutz,
                    LocalAppSperre provides appSperre,
                ) { TastaturOhneLernen {
                    // App-weit: Gutschein-Nummer und PIN, Passwörter, Codes und
                    // Einladungen; Setnamen lernt die Tastatur dafür auch nicht mit.
                    val gesperrt by appSperre.gesperrt.collectAsStateWithLifecycle()
                    // Gesperrt liest auch TalkBack nichts darunter vor.
                    Box(if (gesperrt) Modifier.clearAndSetSemantics {} else Modifier) {
                        BrickInventoryRoute(aktivitaetsZustand(), imageLoader)
                    }
                    // Ohne Displaysperre fragt der Schrittschutz hier nach, statt still durchzulassen.
                    OhneSperreWarnung(schrittschutz.ohneSperre)
                    // Mit Startpasswort weist der Server alles ab: nur die Maske, bis es ersetzt ist.
                    val startpasswort by vm.startpasswortNoetig.collectAsStateWithLifecycle()
                    // Startwert false: Die Maske erscheint erst mit beiden Zuständen,
                    // und StateFlow.value in der Komposition verbietet Lint.
                    val angemeldet by remember { vm.state.map { it.isLoggedIn }.distinctUntilChanged() }
                        .collectAsStateWithLifecycle(false)
                    // Ebenso Verwalterrechte ohne zweiten Faktor; das Startpasswort kommt zuerst.
                    val faktorPflicht by vm.zweiterFaktorNoetig.collectAsStateWithLifecycle()
                    if (startpasswort && angemeldet) {
                        val kontoZustand by startKontoVm.kontoState.collectAsStateWithLifecycle()
                        StartpasswortMaske(
                            kontoZustand = kontoZustand,
                            onErsetzen = { alt, neu, code -> startKontoVm.aenderePasswort(alt, neu, code) },
                            onAbmelden = { vm.logout() },
                        )
                    } else if (faktorPflicht && angemeldet) {
                        val faktorZustand by startKontoVm.zweiterFaktorState.collectAsStateWithLifecycle()
                        LaunchedEffect(Unit) { startKontoVm.ladeZweitenFaktor() }
                        ZweiterFaktorPflichtMaske(
                            zustand = faktorZustand,
                            onEinrichten = startKontoVm::richteZweitenFaktorEin,
                            onBestaetigen = startKontoVm::bestaetigeZweitenFaktor,
                            onWeiter = { startKontoVm.zweiterFaktorZurueck(); vm.zweiterFaktorEingerichtet() },
                            onAbmelden = { startKontoVm.zweiterFaktorZurueck(); vm.logout() },
                        )
                    }
                    // Über allem: Ein unbekanntes Zertifikat kann jeder Abruf treffen.
                    val zertifikat by vertrauen.zertifikat.collectAsStateWithLifecycle()
                    val nutzerCa by vertrauen.nutzerCa.an.collectAsStateWithLifecycle()
                    zertifikat?.let { frage ->
                        ZertifikatDialog(
                            frage = frage,
                            nutzerCaAn = nutzerCa,
                            onVertrauen = vertrauen::zertifikatVertrauen,
                            onNutzerCa = { vertrauen.nutzerCa.anfragen(); vertrauen.zertifikatVerwerfen() },
                            onAbbrechen = vertrauen::zertifikatVerwerfen,
                        )
                    }
                    // Hier und nicht in den Einstellungen: Auch der Zertifikatsdialog fragt an.
                    val nutzerCaFrage by vertrauen.nutzerCa.frage.collectAsStateWithLifecycle()
                    if (nutzerCaFrage) {
                        NutzerCaDialog(
                            onJa = vertrauen.nutzerCa::bestaetigen,
                            onAbbrechen = vertrauen.nutzerCa::abbrechen,
                        )
                    }
                    // Zuoberst: Die App-Sperre deckt auch die Pflichtmasken ab.
                    if (gesperrt) AppSperreSchirm {
                        val texte = LanguageManager.localizedContext(this@MainActivity)
                        entsperreMitGeraetesperre(this@MainActivity, texte.getString(R.string.app_sperre_gesperrt),
                            texte.getString(R.string.schritt_untertitel)) { appSperre.entsperrt() }
                    }
                } }
            }
        }
    }
}
