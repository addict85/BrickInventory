package ch.brickinventoryapp

import android.app.Application
import android.os.Bundle
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material3.*
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.ui.window.Dialog
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.AppUiState
import ch.brickinventoryapp.ui.screens.*
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.theme.darstellung
import androidx.compose.foundation.isSystemInDarkTheme
import coil3.ImageLoader
import androidx.compose.foundation.Image
import androidx.compose.ui.res.painterResource
import androidx.compose.runtime.CompositionLocalProvider
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.components.LocalAppFassung
import ch.brickinventoryapp.util.AppFassung
import ch.brickinventoryapp.ui.viewmodel.CatalogViewModel
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.LinearProgressIndicator
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.content.Intent
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import dagger.hilt.android.AndroidEntryPoint
import androidx.compose.ui.res.stringResource
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject


@AndroidEntryPoint
class MainActivity : NurLauncherStart() {
    private val vm: AppViewModel by viewModels()

    // Hier gehalten und nicht ueber hiltViewModel() geholt: Katalogliste und
    // Katalogdetail sind zwei NavHost-Ziele, und an den Backstack-Eintrag
    // gebunden waeren es zwei Instanzen — das Detail setzt „besitze ich“,
    // und die Liste bekaeme es nie zu sehen.
    private val katalogVm: CatalogViewModel by viewModels()

    // Ebenso: Eine Guthabenabfrage über alle Karten soll weiterlaufen, wenn
    // man die Gutschein-Seite verlässt.
    private val gutscheinVm: ch.brickinventoryapp.ui.viewmodel.GutscheinViewModel by viewModels()
    // Nur für die Maske „Startpasswort ersetzen“, die über allem liegt.
    private val startKontoVm: ch.brickinventoryapp.ui.viewmodel.KontoViewModel by viewModels()

    // ImageLoader als Hilt-Singleton aus NetzModule — eine Instanz je Prozess statt je
    // Activity: Sonst verlöre jede Drehung den Memory-Cache, und zwei
    // DiskCache-Instanzen liefen auf demselben Verzeichnis.
    @Inject lateinit var imageLoader: ImageLoader

    /** Rückfrage per Gerätesperre vor heiklen Schritten; gilt bis die App in den Hintergrund geht. */
    private val schrittschutz by lazy { ch.brickinventoryapp.ui.components.GeraeteSchrittschutz(this) }

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
            val theme by vm.appTheme.collectAsStateWithLifecycle()
            val helligkeit by vm.helligkeit.collectAsStateWithLifecycle()
            val systemfarben by vm.systemfarben.collectAsStateWithLifecycle()
            // Über den Zähler von Sichtschutz, damit ein Bildschirm, der ihn selbst
            // setzt, beim Verlassen den Wunsch des Nutzers nicht aufhebt.
            val vorschauVerbergen by vm.vorschauVerbergen.collectAsStateWithLifecycle()
            if (vorschauVerbergen) ch.brickinventoryapp.ui.components.Sichtschutz()
            val sicht = darstellung(theme, helligkeit, isSystemInDarkTheme(), systemfarben, android.os.Build.VERSION.SDK_INT)
            BrickInventoryManagerTheme(theme = sicht.design, dunkel = sicht.dunkel, systemfarben = sicht.systemfarben) {
                // Die Fassung kennt nur dieses Modul; die Bereiche lesen sie hier.
                CompositionLocalProvider(
                    LocalAppFassung provides AppFassung(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE),
                    ch.brickinventoryapp.ui.components.LocalSchrittschutz provides schrittschutz,
                ) {
                    BrickInventoryManagerApp(vm, katalogVm, gutscheinVm, imageLoader)
                    // Mit Startpasswort weist der Server alles ab: nur die Maske, bis es ersetzt ist.
                    val startpasswort by vm.passwortPflicht.noetig.collectAsStateWithLifecycle()
                    // Startwert false: Die Maske erscheint erst mit beiden Zuständen,
                    // und StateFlow.value in der Komposition verbietet Lint.
                    val angemeldet by remember { vm.state.map { it.isLoggedIn }.distinctUntilChanged() }
                        .collectAsStateWithLifecycle(false)
                    if (startpasswort && angemeldet) {
                        val kontoZustand by startKontoVm.kontoState.collectAsStateWithLifecycle()
                        ch.brickinventoryapp.ui.screens.StartpasswortMaske(
                            kontoZustand = kontoZustand,
                            onErsetzen = { alt, neu, code -> startKontoVm.aenderePasswort(alt, neu, code) { vm.logout() } },
                            onAbmelden = { vm.logout() },
                        )
                    }
                    // Über allem: Ein unbekanntes Zertifikat kann jeder Abruf treffen.
                    val zertifikat by vm.zertifikatsFrage.offen.collectAsStateWithLifecycle()
                    val nutzerCa by vm.nutzerCa.an.collectAsStateWithLifecycle()
                    zertifikat?.let { frage ->
                        ch.brickinventoryapp.ui.components.ZertifikatDialog(
                            frage = frage,
                            nutzerCaAn = nutzerCa,
                            onVertrauen = vm::zertifikatVertrauen,
                            onNutzerCa = { vm.nutzerCa.anfragen(); vm.zertifikatsFrage.verwerfen() },
                            onAbbrechen = vm.zertifikatsFrage::verwerfen,
                        )
                    }
                    // Hier und nicht in den Einstellungen: Auch der Zertifikatsdialog fragt an.
                    val nutzerCaFrage by vm.nutzerCa.frage.collectAsStateWithLifecycle()
                    if (nutzerCaFrage) {
                        ch.brickinventoryapp.ui.components.NutzerCaDialog(
                            onJa = vm.nutzerCa::bestaetigen,
                            onAbbrechen = vm.nutzerCa::abbrechen,
                        )
                    }
                }
            }
        }
    }
}

