package ch.brickinventoryapp.login.ui.screens

/*
 * Autofocus: CONTROL_AF_MODE_CONTINUOUS_PICTURE on both Preview AND ImageAnalysis, because
 * CameraX merges all use cases into one request; no periodic
 * startFocusAndMetering, which lets the focus drift. CameraFocusConfigTest checks
 * both — on red, fix the code, not the test.
 */

import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.LocalLifecycleOwner
import ch.brickinventoryapp.login.ui.QrLoginPayload
import ch.brickinventoryapp.login.ui.qrAdoptable
import ch.brickinventoryapp.login.ui.qrSwitchesServer
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.security.Transcript
import ch.brickinventoryapp.security.fingerprintReadable
import ch.brickinventoryapp.security.fingerprintStart
import ch.brickinventoryapp.ui.components.FingerprintField
import ch.brickinventoryapp.ui.components.OverlayGuard
import ch.brickinventoryapp.ui.components.PrivacyShield
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.screens.CameraOverlay
import ch.brickinventoryapp.ui.screens.CameraPermissionHint
import ch.brickinventoryapp.ui.screens.cameraBind
import ch.brickinventoryapp.ui.screens.cameraPreview
import ch.brickinventoryapp.ui.screens.imageAnalyse
import ch.brickinventoryapp.ui.screens.rememberCameraPermission
import ch.brickinventoryapp.ui.screens.tapToFocus
import ch.brickinventoryapp.ui.theme.LocalStatusColors
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.windowSurface
import com.google.mlkit.vision.common.InputImage

/**
 * Confirmation prompt for a scanned code: it can come from anyone, so it names the
 * destination and lets the fingerprint be typed off if needed. [onAdopt] gets the
 * typed-off value, or null if there was nothing to type off.
 */
@Composable
internal fun QrSuggestionDialog(
    suggestion: QrLoginPayload,
    currentUrl: String,
    development: Boolean,
    previousPin: (url: String, fingerprint: String?) -> String?,
    mustTypeIn: (url: String, fingerprint: String?) -> Boolean,
    onCancel: () -> Unit,
    onAdopt: (typed: String?) -> Unit,
) {
    val qrLocked = NetworkPolicy.addressError(suggestion.url, development) != null
    // A code with a different key than the confirmed one: like "certificate changed", with both values.
    val previous = remember(suggestion) { previousPin(suggestion.url, suggestion.fingerprint) }
    val type = remember(suggestion) { mustTypeIn(suggestion.url, suggestion.fingerprint) }
    // Like CertificateDialog: a code can come from anyone, so have the new value typed off.
    var input by remember(suggestion) { mutableStateOf("") }
    var finding by remember(suggestion) { mutableStateOf<Transcript?>(null) }
    var targetConfirmed by remember(suggestion) { mutableStateOf(false) }
    val title = stringResource(if (previous != null) R.string.cert_title_changed else R.string.setup_qr_title)
    AlertDialog(
        containerColor = windowSurface(),
        onDismissRequest = onCancel,
        modifier = Modifier.semantics { paneTitle = title },
        // Like CertificateDialog: tapping next to it discards nothing typed off, back only clears the field.
        properties = DialogProperties(dismissOnBackPress = input.isEmpty(), dismissOnClickOutside = false),
        title = { Text(title, Modifier.semantics { heading() }) },
        text = {
            // The confirmation sends the sign-in to this server: no tap through an overlay.
            OverlayGuard()
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
                QrTarget(suggestion, currentUrl, targetConfirmed) { targetConfirmed = it }
                val fp = suggestion.fingerprint
                if (fp != null) QrPin(fp, previous, type)
                if (type && fp != null) {
                    QrFingerprintInput(input, finding, changed = previous != null) { input = it; finding = null }
                }
                if (qrLocked) Text(stringResource(R.string.setup_qr_plaintext_declined), color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            TextButton(enabled = qrAdoptable(qrLocked, targetConfirmed, type, input), onClick = {
                val fp = suggestion.fingerprint
                val check = if (type) fp?.let { Transcript.of(input, it) } ?: Transcript.FITS_NOT else Transcript.MATCHES
                if (check != Transcript.MATCHES) {
                    finding = check
                } else {
                    onAdopt(input.takeIf { type })
                }
            }) {
                Text(stringResource(if (previous != null) R.string.setup_qr_pin_adopt else R.string.setup_qr_adopt),
                    color = if (previous != null) MaterialTheme.colorScheme.error else Color.Unspecified)
            }
        },
        dismissButton = {
            TextButton(onClick = onCancel) { Text(stringResource(R.string.common_cancel)) }
        },
    )
}

/**
 * Where the code leads, parsed instead of raw: a code like `https://mein.server@foreign.example`
 * or with a line break would otherwise show a name that is not the destination.
 */
@Composable
private fun QrTarget(suggestion: QrLoginPayload, currentUrl: String, confirmed: Boolean, onConfirmed: (Boolean) -> Unit) {
    val view = remember(suggestion) { NetworkPolicy.view(suggestion.url) }
    val sofarHost = remember(suggestion, currentUrl) { qrSwitchesServer(currentUrl, suggestion.url) }
    Text(stringResource(R.string.setup_qr_target))
    if (view != null) {
        Text(view.host, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.titleMedium)
        Text(view.address, fontFamily = FontFamily.Monospace,
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (view.international) Text(stringResource(R.string.setup_qr_international),
            color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        Row(
            Modifier.fillMaxWidth().toggleable(confirmed, role = Role.Checkbox, onValueChange = onConfirmed),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(checked = confirmed, onCheckedChange = null)
            Text(stringResource(R.string.setup_qr_target_confirm, view.host), fontWeight = FontWeight.Bold)
        }
    }
    Text(stringResource(R.string.setup_qr_hint))
    if (sofarHost != null) Text(stringResource(R.string.setup_qr_other_server, sofarHost),
        color = MaterialTheme.colorScheme.error)
}

/** The code's key: against the remembered one if it changed, otherwise its start and why it counts. */
@Composable
private fun QrPin(fp: String, previous: String?, type: Boolean) {
    if (previous != null) {
        Text(stringResource(R.string.setup_qr_pin_changed), color = MaterialTheme.colorScheme.error)
        Text(stringResource(R.string.cert_previous), style = MaterialTheme.typography.labelMedium)
        Text(fingerprintReadable(previous), fontFamily = FontFamily.Monospace,
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        // Like CertificateDialog: the code itself names the new value, it is typed off
        // from the web app; only its start stands here.
        Text(stringResource(R.string.cert_starts_with), style = MaterialTheme.typography.labelMedium)
        Text(fingerprintStart(fp), fontFamily = FontFamily.Monospace,
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    } else {
        // First setup: without typing it off, only a system root applies; a code
        // from someone else could just as well name its own key.
        Text(stringResource(if (type) R.string.setup_qr_pin_type else R.string.setup_qr_pin),
            color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        Text(stringResource(R.string.cert_starts_with), style = MaterialTheme.typography.labelMedium)
        Text(fingerprintStart(fp), fontFamily = FontFamily.Monospace,
            style = MaterialTheme.typography.bodySmall)
    }
}

/** The field for typing off the fingerprint, with what was wrong about the last attempt. */
@Composable
private fun QrFingerprintInput(input: String, finding: Transcript?, changed: Boolean, onInput: (String) -> Unit) {
    FingerprintField(
        input = input,
        onInput = onInput,
        needed = Transcript.NEEDED,
        help = stringResource(if (changed) R.string.cert_changed_input else R.string.cert_unknown_input),
        error = { counted ->
            when (finding) {
                null, Transcript.MATCHES -> null
                Transcript.EMPTY, Transcript.TO_SHORT ->
                    stringResource(R.string.cert_input_too_short, counted, Transcript.NEEDED)
                Transcript.FITS_NOT -> stringResource(R.string.cert_input_wrong)
            }
        },
    )
}

/** QR scanner for setup — reuses the proven CameraPreviewBarcode with QR_CODE format */
@Composable
internal fun QrSetupScannerScreen(onResult: (String) -> Unit, onDismiss: () -> Unit) =
    QrScannerScreen(
        scanHint = stringResource(R.string.setup_qr_scan_hint),
        purpose = stringResource(R.string.scanner_camera_purpose_qr),
        // Typing it in means back to setup: that is where the address field is.
        typeIn = stringResource(R.string.scanner_address_type_in),
        onResult = onResult,
        onDismiss = onDismiss,
    )

/**
 * The same scanner for the certificate question: it reads the code from the web app's
 * certificate section; without a camera, back to the dialog to compare by hand.
 */
@Composable
fun CertificateQrScanner(onResult: (String) -> Unit, onDismiss: () -> Unit) =
    QrScannerScreen(
        scanHint = stringResource(R.string.cert_scan_hint),
        purpose = stringResource(R.string.scanner_camera_purpose_cert),
        typeIn = stringResource(R.string.cert_scan_compare_instead),
        onResult = onResult,
        onDismiss = onDismiss,
    )

@Composable
private fun QrScannerScreen(
    scanHint: String,
    purpose: String,
    typeIn: String,
    onResult: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val cameraPermission = rememberCameraPermission()
    var frozen by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        if (!cameraPermission.granted) cameraPermission.requests()
    }
    // The image shows a sign-in code: in a photo it would sign in a foreign device. The
    // certificate code is public, the shield costs it nothing.
    PrivacyShield()

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
                // CameraPermission.kt. Only the square stays its own.
                CameraOverlay(
                    hint = if (frozen) stringResource(R.string.setup_qr_detected) else scanHint,
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(0.75f)
                            .aspectRatio(1f)
                            .border(2.dp,
                                if (frozen) LocalStatusColors.current.success else MaterialTheme.colorScheme.primary,
                                Shapes.field)
                    )
                }
            }
            else -> {
                CameraPermissionHint(purpose, typeIn, onDismiss,
                    cameraPermission.permanentDenied) { cameraPermission.allow() }
            }
        }
        WithTooltip(stringResource(R.string.scanner_close), Modifier.align(Alignment.TopEnd)) {
            IconButton(onClick = onDismiss, Modifier.padding(Spacing.large)) {
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
        // Setup including AF mode: ui/screens/CameraSetup.kt. 1280x720 instead of 1920x1080 as
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
            // Fetch the provider, build the preview, bind it: CameraSetup.kt. No
            // atError: if the camera is not available, the preview deliberately
            // stays empty — unlike in the scanner, which shows a hint.
            cameraBind(
                ctx = ctx,
                previewView = previewView,
                lifecycleOwner = lifecycleOwner,
                analyse = imageAnalyzer,
            ) { camera -> tapToFocus(previewView) { camera.cameraControl } }
            previewView
        },
        modifier = Modifier.fillMaxSize()
    )
}
