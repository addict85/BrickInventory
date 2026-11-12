package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.components.ansagen
import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.LocalActivity
import androidx.core.app.ActivityCompat
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
class KameraErlaubnis(
    private val zustand: State<Boolean>,
    private val gesperrt: State<Boolean>,
    private val frage: () -> Unit,
    private val einstellungen: () -> Unit,
) {
    val erteilt: Boolean get() = zustand.value

    /** Das System zeigt keine Frage mehr; erlauben lässt sich nur noch in den App-Einstellungen. */
    val dauerhaftVerweigert: Boolean get() = !zustand.value && gesperrt.value

    /** Die Frage des Systems — auch beim Öffnen des Scanners, darum nie die Einstellungen. */
    fun anfragen() = frage()

    /** Der Knopf im Hinweis: Ist die Frage gesperrt, führt er in die Einstellungen statt ins Leere. */
    fun erlauben() = if (dauerhaftVerweigert) einstellungen() else frage()
}

/**
 * Die Kamera-Erlaubnis über ActivityResult der Plattform; accompanist-permissions
 * wird nicht mehr gepflegt. Bei jeder Rückkehr neu gelesen: Sie kann inzwischen in
 * den Systemeinstellungen erteilt oder entzogen worden sein. Eine Ablehnung ohne
 * Begründungswunsch des Systems heisst „nicht mehr fragen“: Dann kehrt die Frage
 * sofort mit Nein zurück, und nur die Einstellungen helfen weiter.
 */
@Composable
fun rememberKameraErlaubnis(): KameraErlaubnis {
    val kontext = LocalContext.current
    val aktivitaet = LocalActivity.current
    val erteilt = remember { mutableStateOf(kameraErteilt(kontext)) }
    val gesperrt = remember { mutableStateOf(false) }
    val starter = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ja ->
        erteilt.value = ja
        gesperrt.value = !ja && aktivitaet != null &&
            !ActivityCompat.shouldShowRequestPermissionRationale(aktivitaet, Manifest.permission.CAMERA)
    }
    LifecycleResumeEffect(kontext) {
        erteilt.value = kameraErteilt(kontext)
        onPauseOrDispose { }
    }
    return remember(starter, kontext) {
        KameraErlaubnis(erteilt, gesperrt, { starter.launch(Manifest.permission.CAMERA) }) { oeffneAppEinstellungen(kontext) }
    }
}

private fun kameraErteilt(kontext: Context): Boolean =
    ContextCompat.checkSelfPermission(kontext, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

/** Die Seite dieser App in den Systemeinstellungen; fehlt sie (eigenwillige Geräte), geschieht nichts. */
private fun oeffneAppEinstellungen(kontext: Context) {
    runCatching {
        kontext.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", kontext.packageName, null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}

/**
 * „Die Kamera wird gebraucht“ — der Rückfall, wenn die Erlaubnis fehlt; gemeinsam
 * für Barcodescanner und SetupScreen. Getrennt von KameraAufbau.kt, weil dort
 * bewusst kein Compose-Import steht: Die Bindung an CameraX soll ohne Oberfläche
 * prüfbar bleiben. Weisse Schrift, weil beide Ansichten den Hinweis vor einem
 * schwarzen Kamerabild zeigen.
 *
 * @param verweigert [KameraErlaubnis.dauerhaftVerweigert]: Dann sagt der Hinweis, wo man
 *        erlaubt, sonst wirkte „Erlauben“ wie ein toter Knopf.
 * @param onErlauben [KameraErlaubnis.erlauben]
 */
@Composable
fun KameraErlaubnisHinweis(verweigert: Boolean = false, onErlauben: () -> Unit) {
    Box(Modifier.fillMaxSize(), Alignment.Center) {
        Column(Modifier.padding(Abstaende.gross), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stringResource(R.string.scanner_camera_needed),
                color = Color.White, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            if (verweigert) {
                Spacer(Modifier.height(Abstaende.klein))
                Text(stringResource(R.string.scanner_camera_gesperrt), Modifier.ansagen(),
                    color = Color.White, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
            }
            Spacer(Modifier.height(Abstaende.mittel))
            Button(onClick = onErlauben) {
                Text(stringResource(if (verweigert) R.string.scanner_camera_einstellungen else R.string.scanner_allow))
            }
        }
    }
}

/**
 * Die Überlagerung über dem Kamerabild: Rahmen in der Mitte, darunter ein dunkles Schild mit
 * dem Hinweistext — eine Gestaltung für Barcode-Scanner und QR-Aufbau (Gewichtung 0.2 / 0.8,
 * damit der Rahmen etwas über der Mitte sitzt; Schwarz mit 72 % Deckung, Formen.kachel,
 * weisse Schrift in 13 sp).
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
                Modifier.padding(horizontal = 18.dp, vertical = 10.dp).ansagen(),
                color = Color.White, style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
        }
        unten()
        Spacer(Modifier.weight(0.8f))
    }
}
