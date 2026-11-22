package ch.brickinventoryapp.login.ui.screens

/*
 * Autofocus: CONTROL_AF_MODE_CONTINUOUS_PICTURE on both Preview AND ImageAnalysis, because
 * CameraX merges all use cases into one request; no periodic
 * startFocusAndMetering, which lets the focus drift. CameraFocusConfigTest checks
 * both — on red, fix the code, not the test.
 */

import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.fensterFlaeche
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.camera.core.*
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.compose.foundation.background
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.border
import androidx.compose.material.icons.filled.Close
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.common.InputImage
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.security.Transcript
import ch.brickinventoryapp.ui.components.Fingerabdruckfeld
import androidx.compose.ui.window.DialogProperties
import ch.brickinventoryapp.security.fingerprintStart
import ch.brickinventoryapp.security.fingerprintReadable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.text.font.FontFamily
import ch.brickinventoryapp.login.ui.QrLoginPayload
import ch.brickinventoryapp.login.ui.qrUebernehmbar
import ch.brickinventoryapp.login.ui.qrSwitchesServer
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.Role
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.ui.screens.CameraPermissionHint
import ch.brickinventoryapp.ui.screens.CameraOverlay
import ch.brickinventoryapp.ui.screens.imageAnalyse
import ch.brickinventoryapp.ui.screens.kameraBinden
import ch.brickinventoryapp.ui.screens.cameraPreview
import ch.brickinventoryapp.ui.screens.rememberCameraPermission
import ch.brickinventoryapp.ui.screens.tippZumFokus

/**
 * Confirmation prompt for a scanned code: it can come from anyone, so it names the
 * destination and lets the fingerprint be typed off if needed. [onUebernehmen] gets the
 * typed-off value, or null if there was nothing to type off.
 */
@Composable
internal fun QrVorschlagDialog(
    vorschlag: QrLoginPayload,
    currentUrl: String,
    entwicklung: Boolean,
    bisherigerPin: (url: String, fingerabdruck: String?) -> String?,
    mussAbtippen: (url: String, fingerabdruck: String?) -> Boolean,
    onAbbrechen: () -> Unit,
    onUebernehmen: (abgetippt: String?) -> Unit,
) {
    val qrLocked = NetworkPolicy.addressError(vorschlag.url, entwicklung) != null
    // A code with a different key than the confirmed one: like "certificate changed", with both values.
    val bisher = remember(vorschlag) { bisherigerPin(vorschlag.url, vorschlag.fingerabdruck) }
    val abtippen = remember(vorschlag) { mussAbtippen(vorschlag.url, vorschlag.fingerabdruck) }
    // Like CertificateDialog: a code can come from anyone, so have the new value typed off.
    var eingabe by remember(vorschlag) { mutableStateOf("") }
    var finding by remember(vorschlag) { mutableStateOf<Transcript?>(null) }
    var targetConfirmed by remember(vorschlag) { mutableStateOf(false) }
    val titel = stringResource(if (bisher != null) R.string.zert_titel_geaendert else R.string.setup_qr_titel)
    AlertDialog(
        containerColor = fensterFlaeche(),
        onDismissRequest = onAbbrechen,
        modifier = Modifier.semantics { paneTitle = titel },
        // Like CertificateDialog: tapping next to it discards nothing typed off, back only clears the field.
        properties = DialogProperties(dismissOnBackPress = eingabe.isEmpty(), dismissOnClickOutside = false),
        title = { Text(titel, Modifier.semantics { heading() }) },
        text = {
            // The confirmation sends the sign-in to this server: no tap through an overlay.
            Ueberdeckungsschutz()
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                // Parsed instead of raw: a code like `https://mein.server@fremd.example` or with
                // a line break would otherwise show a name that is not the destination.
                val ansicht = remember(vorschlag) { NetworkPolicy.ansicht(vorschlag.url) }
                val sofarHost = remember(vorschlag, currentUrl) { qrSwitchesServer(currentUrl, vorschlag.url) }
                Text(stringResource(R.string.setup_qr_ziel))
                if (ansicht != null) {
                    Text(ansicht.host, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.titleMedium)
                    Text(ansicht.adresse, fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (ansicht.international) Text(stringResource(R.string.setup_qr_international),
                        color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    Row(
                        Modifier.fillMaxWidth().toggleable(targetConfirmed, role = Role.Checkbox) { targetConfirmed = it },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(checked = targetConfirmed, onCheckedChange = null)
                        Text(stringResource(R.string.setup_qr_ziel_bestaetigen, ansicht.host), fontWeight = FontWeight.Bold)
                    }
                }
                Text(stringResource(R.string.setup_qr_hinweis))
                if (sofarHost != null) Text(stringResource(R.string.setup_qr_anderer_server, sofarHost),
                    color = MaterialTheme.colorScheme.error)
                val fp = vorschlag.fingerabdruck
                if (bisher != null && fp != null) {
                    Text(stringResource(R.string.setup_qr_pin_geaendert), color = MaterialTheme.colorScheme.error)
                    Text(stringResource(R.string.zert_bisher), style = MaterialTheme.typography.labelMedium)
                    Text(fingerprintReadable(bisher), fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    // Like CertificateDialog: the code itself names the new value, it is typed off
                    // from the web app; only its start stands here.
                    Text(stringResource(R.string.zert_beginnt_mit), style = MaterialTheme.typography.labelMedium)
                    Text(fingerprintStart(fp), fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                } else if (fp != null) {
                    // First setup: without typing it off, only a system root applies; a code
                    // from someone else could just as well name its own key.
                    Text(stringResource(if (abtippen) R.string.setup_qr_pin_abtippen else R.string.setup_qr_pin),
                        color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    Text(stringResource(R.string.zert_beginnt_mit), style = MaterialTheme.typography.labelMedium)
                    Text(fingerprintStart(fp), fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall)
                }
                if (abtippen && fp != null) {
                    Fingerabdruckfeld(
                        eingabe = eingabe,
                        onInput = { eingabe = it; finding = null },
                        noetig = Transcript.NEEDED,
                        help = stringResource(if (bisher != null) R.string.zert_geaendert_eingabe else R.string.zert_unbekannt_eingabe),
                        fehler = { gezaehlt ->
                            when (finding) {
                                null, Transcript.PASST -> null
                                Transcript.LEER, Transcript.TO_SHORT ->
                                    stringResource(R.string.zert_eingabe_zu_kurz, gezaehlt, Transcript.NEEDED)
                                Transcript.FITS_NOT -> stringResource(R.string.zert_eingabe_falsch)
                            }
                        },
                    )
                }
                if (qrLocked) Text(stringResource(R.string.setup_qr_klartext_abgelehnt), color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            TextButton(enabled = qrUebernehmbar(qrLocked, targetConfirmed, abtippen, eingabe), onClick = {
                val fp = vorschlag.fingerabdruck
                val check = if (abtippen) fp?.let { Transcript.von(eingabe, it) } ?: Transcript.FITS_NOT else Transcript.PASST
                if (check != Transcript.PASST) {
                    finding = check
                } else {
                    onUebernehmen(eingabe.takeIf { abtippen })
                }
            }) {
                Text(stringResource(if (bisher != null) R.string.setup_qr_pin_uebernehmen else R.string.setup_qr_uebernehmen),
                    color = if (bisher != null) MaterialTheme.colorScheme.error else androidx.compose.ui.graphics.Color.Unspecified)
            }
        },
        dismissButton = {
            TextButton(onClick = onAbbrechen) { Text(stringResource(R.string.common_cancel)) }
        },
    )
}

/** QR scanner for setup — reuses the proven CameraPreviewBarcode with QR_CODE format */
@Composable
internal fun QrSetupScannerScreen(onResult: (String) -> Unit, onDismiss: () -> Unit) {
    val cameraPermission = rememberCameraPermission()
    var frozen by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        if (!cameraPermission.granted) cameraPermission.requests()
    }
    // The image shows a sign-in code: in a photo it would sign in a foreign device.
    Sichtschutz()

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        when {
            cameraPermission.granted -> {
                // Reuse proven camera implementation with QR-only scanner
                QrCameraPreview(
                    frozen = frozen,
                    onQrFound = { value ->
                        if (!frozen) { frozen = true; onResult(value) }
                    }
                )
                // Frame and hint in the shared overlay — see
                // KameraErlaubnis.kt. Only the square stays its own.
                CameraOverlay(
                    hinweis = if (frozen) stringResource(R.string.setup_qr_detected)
                              else stringResource(R.string.setup_qr_scan_hint),
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(0.75f)
                            .aspectRatio(1f)
                            .border(2.dp,
                                if (frozen) LocalStatusFarben.current.erfolg else MaterialTheme.colorScheme.primary,
                                Formen.feld)
                    )
                }
            }
            else -> {
                // Typing it in means back to setup: that is where the address field is.
                CameraPermissionHint(stringResource(R.string.scanner_camera_zweck_qr),
                    stringResource(R.string.scanner_adresse_eintippen), onDismiss,
                    cameraPermission.permanentDenied) { cameraPermission.erlauben() }
            }
        }
        MitTooltip(stringResource(R.string.scanner_close), Modifier.align(Alignment.TopEnd)) {
            IconButton(onClick = onDismiss, Modifier.padding(Abstaende.gross)) {
                Icon(Icons.Default.Close, stringResource(R.string.scanner_close), tint = Color.White)
            }
        }
    }
}

// ExperimentalGetImage belongs here: the consent for imageProxy.image is
// this annotation; `@ExperimentalGetImage` on the local variable would be the
// marker (Lint: UnsafeOptInUsageError).
@androidx.annotation.OptIn(ExperimentalCamera2Interop::class, ExperimentalGetImage::class)
@Composable
internal fun QrCameraPreview(frozen: Boolean, onQrFound: (String) -> Unit) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val executor       = remember { java.util.concurrent.Executors.newSingleThreadExecutor() }

    val scanner = remember {
        com.google.mlkit.vision.barcode.BarcodeScanning.getClient(
            com.google.mlkit.vision.barcode.BarcodeScannerOptions.Builder()
                .setBarcodeFormats(com.google.mlkit.vision.barcode.common.Barcode.FORMAT_QR_CODE)
                .build()
        )
    }

    // remember() does not clean up (as in the barcode scanner): without this DisposableEffect
    // the analysis thread and the ML Kit client would survive every visit to the setup screen. The
    // continuous autofocus is unaffected by this.
    DisposableEffect(Unit) {
        onDispose {
            try { scanner.close() } catch (_: Exception) { /* already closed on leaving */ }
            executor.shutdown()
        }
    }

    val imageAnalyzer = remember {
        // Setup including AF mode: ui/screens/KameraAufbau.kt. 1280x720 instead of 1920x1080 as
        // in the barcode scanner: here a QR code with large modules is read, and
        // less resolution leaves the camera and preview more compute time.
        imageAnalyse(1280, 720)
            .also { analysis ->
                analysis.setAnalyzer(executor) { imageProxy ->
                    if (frozen) { imageProxy.close(); return@setAnalyzer }
                    val mediaImage = imageProxy.image
                    if (mediaImage == null) { imageProxy.close(); return@setAnalyzer }
                    val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                    scanner.process(image)
                        .addOnSuccessListener { codes ->
                            codes.firstOrNull { it.rawValue != null }?.let {
                                onQrFound(it.rawValue!!)
                            }
                        }
                        .addOnCompleteListener { imageProxy.close() }
                }
            }
    }

    AndroidView(
        factory = { ctx ->
            val previewView = cameraPreview(ctx)
            // Fetch the provider, build the preview, bind it: KameraAufbau.kt. No
            // atError: if the camera is not available, the preview deliberately
            // stays empty — unlike in the scanner, which shows a hint.
            kameraBinden(
                ctx = ctx,
                previewView = previewView,
                lifecycleOwner = lifecycleOwner,
                analyse = imageAnalyzer,
            ) { camera -> tippZumFokus(previewView) { camera.cameraControl } }
            previewView
        },
        modifier = Modifier.fillMaxSize()
    )
}
