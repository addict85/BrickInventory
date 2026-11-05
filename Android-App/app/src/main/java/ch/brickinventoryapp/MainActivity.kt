package ch.brickinventoryapp

import android.os.Bundle
import kotlinx.coroutines.flow.distinctUntilChanged
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
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.screens.*
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.theme.darstellung
import androidx.compose.foundation.isSystemInDarkTheme
import coil3.ImageLoader
import androidx.compose.runtime.CompositionLocalProvider
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.components.LocalAppFassung
import ch.brickinventoryapp.util.AppFassung
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.content.Intent
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : NurLauncherStart() {
    private val vm: AppViewModel by viewModels()
    private val darstellung: ch.brickinventoryapp.ui.viewmodel.DarstellungViewModel by viewModels()
    private val vertrauen: ch.brickinventoryapp.ui.viewmodel.VertrauenViewModel by viewModels()

    // Nur für die Pflichtmasken (Startpasswort, zweiter Faktor), die über allem liegen.
    private val startKontoVm: ch.brickinventoryapp.ui.viewmodel.KontoViewModel by viewModels()

    // ImageLoader als Hilt-Singleton aus NetzModule — eine Instanz je Prozess statt je
    // Activity: Sonst verlöre jede Drehung den Memory-Cache, und zwei
    // DiskCache-Instanzen liefen auf demselben Verzeichnis.
    @Inject lateinit var imageLoader: ImageLoader

    /** Rückfrage per Gerätesperre vor heiklen Schritten; gilt bis die App in den Hintergrund geht. */
    private val schrittschutz by lazy {
        ch.brickinventoryapp.ui.components.GeraeteSchrittschutz(this, keinSchluessel = {
            android.widget.Toast.makeText(this, ch.brickinventoryapp.util.LanguageManager.localizedContext(this).getString(R.string.schritt_kein_schluessel),
                android.widget.Toast.LENGTH_LONG).show()
        }) {
            ch.brickinventoryapp.util.LanguageManager.localizedContext(this)
                .getString(R.string.schritt_untertitel)
        }
    }

    /** Das Ziel einer angetippten Meldung; abgelegt nur vom nicht exportierten MeldungsEinstieg. */
    @Inject lateinit var meldungseingang: ch.brickinventoryapp.ui.Meldungseingang

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
        lifecycleScope.launch {
            runCatching { ch.brickinventoryapp.alarm.PreisalarmWorker.durchgang(applicationContext) }
                .onFailure { ch.brickinventoryapp.util.Protokoll.warnung("Preisalarm", "Abruf beim Oeffnen fehlgeschlagen", it) }
        }
    }

    override fun onStop() {
        super.onStop()
        schrittschutz.vergiss()
    }

    /** Ein abgelaufenes Geheimnis lässt sich ab Android 10 erst mit Fokus aus der Zwischenablage nehmen. */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) ch.brickinventoryapp.util.GeheimeZwischenablage.pruefe(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Vor super.onCreate(): Das Startbild ersetzt das Fenster-Theme, bis
        // Compose das erste Bild gezeichnet hat — kein weisses Aufblitzen.
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Die App war zu: Der MeldungsEinstieg hat das Ziel vor dem Start abgelegt.
        meldungsZielUebernehmen()

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
            if (vorschauVerbergen) ch.brickinventoryapp.ui.components.Sichtschutz(ueberdeckung = false)
            val sicht = darstellung(theme, helligkeit, isSystemInDarkTheme(), systemfarben, android.os.Build.VERSION.SDK_INT)
            BrickInventoryManagerTheme(theme = sicht.design, dunkel = sicht.dunkel, systemfarben = sicht.systemfarben) {
                // Die Fassung kennt nur dieses Modul; die Bereiche lesen sie hier.
                CompositionLocalProvider(
                    LocalAppFassung provides AppFassung(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE),
                    ch.brickinventoryapp.ui.components.LocalSchrittschutz provides schrittschutz,
                ) { ch.brickinventoryapp.ui.components.TastaturOhneLernen {
                    // App-weit (sec8 H4): Gutschein-Nummer und PIN, Passwörter, Codes und
                    // Einladungen; Setnamen lernt die Tastatur dafür auch nicht mit.
                    BrickInventoryRoute(vm, imageLoader)
                    // Ohne Displaysperre fragt der Schrittschutz hier nach, statt still durchzulassen (sec10 H3).
                    ch.brickinventoryapp.ui.components.OhneSperreWarnung(schrittschutz.ohneSperre)
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
                        ch.brickinventoryapp.ui.screens.StartpasswortMaske(
                            kontoZustand = kontoZustand,
                            onErsetzen = { alt, neu, code -> startKontoVm.aenderePasswort(alt, neu, code) { vm.logout() } },
                            onAbmelden = { vm.logout() },
                        )
                    } else if (faktorPflicht && angemeldet) {
                        val faktorZustand by startKontoVm.zweiterFaktorState.collectAsStateWithLifecycle()
                        LaunchedEffect(Unit) { startKontoVm.ladeZweitenFaktor() }
                        ch.brickinventoryapp.ui.screens.ZweiterFaktorPflichtMaske(
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
                        ch.brickinventoryapp.ui.components.ZertifikatDialog(
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
                        ch.brickinventoryapp.ui.components.NutzerCaDialog(
                            onJa = vertrauen.nutzerCa::bestaetigen,
                            onAbbrechen = vertrauen.nutzerCa::abbrechen,
                        )
                    }
                } }
            }
        }
    }
}
