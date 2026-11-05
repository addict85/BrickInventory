package ch.brickinventoryapp.ui.screens

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.ui.text.style.TextAlign
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende

/** Ob die Kamera erlaubt ist, und wie man danach fragt (siehe [rememberKameraErlaubnis]). */
@Stable
class KameraErlaubnis(private val zustand: State<Boolean>, private val frage: () -> Unit) {
    val erteilt: Boolean get() = zustand.value
    fun anfragen() = frage()
}

/**
 * Die Kamera-Erlaubnis über ActivityResult der Plattform; accompanist-permissions
 * wird nicht mehr gepflegt. Bei jeder Rückkehr neu gelesen: Sie kann inzwischen in
 * den Systemeinstellungen erteilt oder entzogen worden sein.
 */
@Composable
fun rememberKameraErlaubnis(): KameraErlaubnis {
    val kontext = LocalContext.current
    val erteilt = remember { mutableStateOf(kameraErteilt(kontext)) }
    val starter = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { erteilt.value = it }
    LifecycleResumeEffect(kontext) {
        erteilt.value = kameraErteilt(kontext)
        onPauseOrDispose { }
    }
    return remember(starter) { KameraErlaubnis(erteilt) { starter.launch(Manifest.permission.CAMERA) } }
}

private fun kameraErteilt(kontext: Context): Boolean =
    ContextCompat.checkSelfPermission(kontext, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

/**
 * „Die Kamera wird gebraucht“ — der Rückfall, wenn die Erlaubnis fehlt; gemeinsam
 * für Barcodescanner und SetupScreen. Getrennt von KameraAufbau.kt, weil dort
 * bewusst kein Compose-Import steht: Die Bindung an CameraX soll ohne Oberfläche
 * prüfbar bleiben. Weisse Schrift, weil beide Ansichten den Hinweis vor einem
 * schwarzen Kamerabild zeigen.
 *
 * @param onErlauben Fragt die Erlaubnis erneut an.
 */
@Composable
fun KameraErlaubnisHinweis(onErlauben: () -> Unit) {
    Box(Modifier.fillMaxSize(), Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stringResource(R.string.scanner_camera_needed),
                color = Color.White, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(Abstaende.mittel))
            Button(onClick = onErlauben) { Text(stringResource(R.string.scanner_allow)) }
        }
    }
}

/**
 * Die Überlagerung über dem Kamerabild: Rahmen in der Mitte, darunter ein dunkles Schild mit
 * dem Hinweistext — eine Gestaltung für Barcode-Scanner und QR-Aufbau (Gewichtung 0.2 / 0.8,
 * damit der Rahmen etwas über der Mitte sitzt; Schwarz mit 72 % Deckung, Formen.kachel,
 * weisse Schrift in 13 sp).
 * Ausführlich: docs/begruendungen/core-ui/ui/screens/KameraErlaubnis.kt.md#kameraueberlagerung
 */
@Composable
fun KameraUeberlagerung(
    hinweis: String,
    unten: @Composable ColumnScope.() -> Unit = {},
    rahmen: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(Modifier.weight(0.2f))
        rahmen()
        Spacer(Modifier.height(Abstaende.gross))
        Surface(color = Color.Black.copy(alpha = 0.72f), shape = Formen.kachel) {
            Text(
                hinweis,
                Modifier.padding(horizontal = 18.dp, vertical = 10.dp),
                color = Color.White, style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
        }
        unten()
        Spacer(Modifier.weight(0.8f))
    }
}
