package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.components.announce
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
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.TextButton
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

/** Ob die Kamera erlaubt ist, und wie man danach fragt (siehe [rememberCameraPermission]). */
@Stable
class KameraErlaubnis(
    private val zustand: State<Boolean>,
    private val gesperrt: State<Boolean>,
    private val frage: () -> Unit,
    private val einstellungen: () -> Unit,
) {
    val granted: Boolean get() = zustand.value

    /** Das System zeigt keine Frage mehr; erlauben lässt sich nur noch in den App-Einstellungen. */
    val permanentDenied: Boolean get() = !zustand.value && gesperrt.value

    /** Die Frage des Systems — auch beim Öffnen des Scanners, darum nie die Einstellungen. */
    fun requests() = frage()

    /** Der Knopf im Hinweis: Ist die Frage gesperrt, führt er in die Einstellungen statt ins Leere. */
    fun erlauben() = if (permanentDenied) einstellungen() else frage()
}

/**
 * Die Kamera-Erlaubnis über ActivityResult der Plattform; accompanist-permissions
 * wird nicht mehr gepflegt. Bei jeder Rückkehr neu gelesen: Sie kann inzwischen in
 * den Systemeinstellungen erteilt oder entzogen worden sein. Eine Ablehnung ohne
 * Begründungswunsch des Systems heisst „nicht mehr fragen“: Dann kehrt die Frage
 * sofort mit Nein zurück, und nur die Einstellungen helfen weiter.
 */
@Composable
fun rememberCameraPermission(): KameraErlaubnis {
    val context = LocalContext.current
    val aktivitaet = LocalActivity.current
    val granted = remember { mutableStateOf(cameraGranted(context)) }
    val gesperrt = remember { mutableStateOf(false) }
    val starter = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ja ->
        granted.value = ja
        gesperrt.value = !ja && aktivitaet != null &&
            !ActivityCompat.shouldShowRequestPermissionRationale(aktivitaet, Manifest.permission.CAMERA)
    }
    LifecycleResumeEffect(context) {
        granted.value = cameraGranted(context)
        onPauseOrDispose { }
    }
    return remember(starter, context) {
        KameraErlaubnis(granted, gesperrt, { starter.launch(Manifest.permission.CAMERA) }) { openAppSettings(context) }
    }
}

private fun cameraGranted(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

/** Die Seite dieser App in den Systemeinstellungen; fehlt sie (eigenwillige Geräte), geschieht nichts. */
private fun openAppSettings(context: Context) {
    runCatching {
        context.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}

/**
 * „Die Kamera wird gebraucht“ — der Rückfall, wenn die Erlaubnis fehlt; gemeinsam
 * für Barcodescanner und SetupScreen. Weisse Schrift vor dem schwarzen Kamerabild.
 * Er sagt, wozu die Kamera dient, und bietet den Weg ohne sie: Wer nicht erlauben
 * will, soll nicht in einer Sackgasse stehen.
 *
 * @param zweck wozu die Kamera dient (Barcode, QR-Code)
 * @param eintippen Beschriftung des Wegs ohne Kamera, [typeInOn] geht ihn
 * @param verweigert [KameraErlaubnis.permanentDenied]: Dann sagt der Hinweis, wo man
 *        erlaubt, sonst wirkte „Erlauben“ wie ein toter Knopf.
 * @param onAllow [KameraErlaubnis.erlauben]
 */
@Composable
fun CameraPermissionHint(
    zweck: String,
    eintippen: String,
    typeInOn: () -> Unit,
    denied: Boolean = false,
    onAllow: () -> Unit,
) {
    Box(Modifier.fillMaxSize(), Alignment.Center) {
        Column(Modifier.padding(Abstaende.gross), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stringResource(R.string.scanner_camera_needed),
                color = Color.White, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Spacer(Modifier.height(Abstaende.klein))
            Text(zweck, color = Color.White, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
            if (denied) {
                Spacer(Modifier.height(Abstaende.klein))
                Text(stringResource(R.string.scanner_camera_gesperrt), Modifier.announce(),
                    color = Color.White, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
            }
            Spacer(Modifier.height(Abstaende.mittel))
            Button(onClick = onAllow) {
                Text(stringResource(if (denied) R.string.scanner_camera_einstellungen else R.string.scanner_allow))
            }
            TextButton(onClick = typeInOn, colors = ButtonDefaults.textButtonColors(contentColor = Color.White)) {
                Text(eintippen)
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
fun CameraOverlay(
    hinweis: String,
    unten: @Composable ColumnScope.() -> Unit = {},
    frame: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(Modifier.weight(0.2f))
        frame()
        Spacer(Modifier.height(Abstaende.gross))
        Surface(color = Color.Black.copy(alpha = 0.72f), shape = Formen.kachel) {
            Text(
                hinweis,
                Modifier.padding(horizontal = 18.dp, vertical = 10.dp).announce(),
                color = Color.White, style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
        }
        unten()
        Spacer(Modifier.weight(0.8f))
    }
}
