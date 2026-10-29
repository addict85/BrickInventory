package ch.brickinventoryapp

import android.app.Application
import android.os.Bundle
import kotlinx.coroutines.flow.first
import androidx.activity.ComponentActivity
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
import ch.brickinventoryapp.R
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
class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    // Hier gehalten und nicht ueber hiltViewModel() geholt: Katalogliste und
    // Katalogdetail sind zwei NavHost-Ziele, und an den Backstack-Eintrag
    // gebunden waeren es zwei Instanzen — das Detail setzt „besitze ich“,
    // und die Liste bekaeme es nie zu sehen.
    private val katalogVm: CatalogViewModel by viewModels()

    // Ebenso: Eine Guthabenabfrage über alle Karten soll weiterlaufen, wenn
    // man die Gutschein-Seite verlässt.
    private val gutscheinVm: ch.brickinventoryapp.ui.viewmodel.GutscheinViewModel by viewModels()

    // ImageLoader als Hilt-Singleton aus NetzModule — eine Instanz je Prozess statt je
    // Activity: Sonst verlöre jede Drehung den Memory-Cache, und zwei
    // DiskCache-Instanzen liefen auf demselben Verzeichnis.
    @Inject lateinit var imageLoader: ImageLoader

    /**
     * Beim Nach-vorn-Kommen einmal nach ausgelösten Preisalarmen fragen — sonst
     * erführe man es erst durch den stündlichen Auftrag (PreisalarmWorker). Die Webapp
     * fragt ebenso beim Anmelden (zeigeOffeneAlarme()).
     *
     * onStart statt onCreate: onCreate läuft einmal je Activity; wer nach einer Woche
     * aus dem Hintergrund zurückkommt, durchläuft es nicht, und gerade dann ist die
     * Frage am interessantesten.
     *
     * Keine doppelten Meldungen, dafür sorgt die Marke: Jeder Durchgang fragt „was hat
     * seit `marke` ausgelöst?“ und schreibt den Zeitpunkt des Servers zurück (siehe
     * PreisalarmWorker.durchgang()). lifecycleScope, weil die Antwort niemandem nützt,
     * wenn die Activity vorher weggeht — der stündliche Auftrag fragt ohnehin weiter.
     */
    /**
     * Eine angetippte Preisalarm-Meldung, waehrend die App schon laeuft.
     *
     * launchMode="singleTop" im Manifest sorgt dafuer, dass hier gelandet wird
     * statt in einer zweiten Instanz. setIntent() ist noetig, weil getIntent()
     * sonst weiter den ALTEN Intent liefert — eine zweite angetippte Meldung
     * oeffnete dann wieder das erste Set.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        meldungsZielUebernehmen(intent)
    }

    /** Traegt das Set aus dem Intent in den Zustand — der NavHost holt es dort ab. */
    private fun meldungsZielUebernehmen(intent: Intent?) {
        vm.setAusMeldungAnfordern(
            intent?.getStringExtra(ch.brickinventoryapp.alarm.PreisalarmWorker.EXTRA_SET))
    }

    override fun onStart() {
        super.onStart()
        lifecycleScope.launch {
            runCatching { ch.brickinventoryapp.alarm.PreisalarmWorker.durchgang(applicationContext) }
                .onFailure { android.util.Log.w("Preisalarm", "Abruf beim Oeffnen fehlgeschlagen", it) }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Vor super.onCreate(): Das Startbild ersetzt das Fenster-Theme, bis
        // Compose das erste Bild gezeichnet hat — kein weisses Aufblitzen.
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Die App war zu: Der Intent, der sie gestartet hat, traegt das Ziel.
        meldungsZielUebernehmen(intent)

        setContent {
            // Global vom Admin gewähltes Design. Bewusst NUR dieses Feld
            // sammeln: Der komplette AppUiState an dieser Stelle hätte bei
            // jeder Zustandsänderung die Wurzel der Composition invalidiert
            // und darüber die ganze App rekomponiert.
            val theme by vm.appTheme.collectAsStateWithLifecycle()
            val dunkel by vm.dunkelNachSystem.collectAsStateWithLifecycle()
            val darstellung = darstellung(theme, dunkel, isSystemInDarkTheme())
            BrickInventoryManagerTheme(theme = darstellung.design, dunkel = darstellung.dunkel) {
                BrickInventoryManagerApp(vm, katalogVm, gutscheinVm, imageLoader)
            }
        }
    }
}

