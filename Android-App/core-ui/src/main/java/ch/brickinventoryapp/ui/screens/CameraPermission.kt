package ch.brickinventoryapp.ui.screens

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing

/** Whether the camera is allowed, and how to ask for it (see [rememberCameraPermission]). */
@Stable
class CameraPermission(
    private val uiState: State<Boolean>,
    private val locked: State<Boolean>,
    private val question: () -> Unit,
    private val settings: () -> Unit,
) {
    val granted: Boolean get() = uiState.value

    /** The system no longer shows a prompt; it can only be allowed in the app's own settings now. */
    val permanentDenied: Boolean get() = !uiState.value && locked.value

    /** The system's prompt — also when opening the scanner, which is why never settings. */
    fun requests() = question()

    /** The button in the hint: if the prompt is locked out, it leads into settings instead of nowhere. */
    fun allow() = if (permanentDenied) settings() else question()
}

/**
 * The camera permission via the platform's ActivityResult; accompanist-permissions
 * is no longer maintained. Re-read on every return: it may have been
 * granted or revoked in system settings in the meantime. A denial without the system's
 * wish for a rationale means „don't ask again“: then the prompt
 * returns immediately with no, and only settings can help further.
 */
@Composable
fun rememberCameraPermission(): CameraPermission {
    val context = LocalContext.current
    val activity = LocalActivity.current
    val granted = remember { mutableStateOf(cameraGranted(context)) }
    val locked = remember { mutableStateOf(false) }
    val starter = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { yes ->
        granted.value = yes
        locked.value = !yes && activity != null &&
            !ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.CAMERA)
    }
    LifecycleResumeEffect(context) {
        granted.value = cameraGranted(context)
        onPauseOrDispose { }
    }
    return remember(starter, context) {
        CameraPermission(granted, locked, { starter.launch(Manifest.permission.CAMERA) }) { openAppSettings(context) }
    }
}

private fun cameraGranted(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

/** This app's page in system settings; if it's missing (quirky devices), nothing happens. */
private fun openAppSettings(context: Context) {
    runCatching {
        context.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}

/**
 * „The camera is needed“ — the fallback when permission is missing; shared
 * by the barcode scanner and SetupScreen. White text on the black camera image.
 * It says what the camera is for, and offers the path without it: whoever doesn't
 * want to allow it shouldn't be stuck in a dead end.
 *
 * @param zweck what the camera is for (barcode, QR code)
 * @param eintippen label for the path without the camera, [typeInOn] follows it
 * @param verweigert [CameraPermission.permanentDenied]: then the hint says where to
 *        allow it, otherwise „Allow“ would look like a dead button.
 * @param onAllow [CameraPermission.allow]
 */
@Composable
fun CameraPermissionHint(
    purpose: String,
    typeIn: String,
    typeInOn: () -> Unit,
    denied: Boolean = false,
    onAllow: () -> Unit,
) {
    Box(Modifier.fillMaxSize(), Alignment.Center) {
        Column(Modifier.padding(Spacing.large), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stringResource(R.string.scanner_camera_needed),
                color = Color.White, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Spacer(Modifier.height(Spacing.small))
            Text(purpose, color = Color.White, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
            if (denied) {
                Spacer(Modifier.height(Spacing.small))
                Text(stringResource(R.string.scanner_camera_locked), Modifier.announce(),
                    color = Color.White, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
            }
            Spacer(Modifier.height(Spacing.medium))
            Button(onClick = onAllow) {
                Text(stringResource(if (denied) R.string.scanner_camera_settings else R.string.scanner_allow))
            }
            TextButton(onClick = typeInOn, colors = ButtonDefaults.textButtonColors(contentColor = Color.White)) {
                Text(typeIn)
            }
        }
    }
}

/**
 * The overlay over the camera image: a frame in the middle, below it a dark banner with
 * the hint text — one design for barcode scanner and QR setup (weight 0.2 / 0.8,
 * so the frame sits slightly above center; black at 72% opacity, Formen.kachel,
 * white text at 13 sp).
 */
@Composable
fun CameraOverlay(
    hint: String,
    bottom: @Composable ColumnScope.() -> Unit = {},
    frame: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(Modifier.weight(0.2f))
        frame()
        Spacer(Modifier.height(Spacing.large))
        Surface(color = Color.Black.copy(alpha = 0.72f), shape = Shapes.tile) {
            Text(
                hint,
                Modifier.padding(horizontal = 18.dp, vertical = 10.dp).announce(),
                color = Color.White, style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
        }
        bottom()
        Spacer(Modifier.weight(0.8f))
    }
}
