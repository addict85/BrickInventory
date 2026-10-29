package ch.brickinventoryapp.ui.screens

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  NICHT ÄNDERN OHNE ZU LESEN: Autofokus
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Der Scanner stellte in dieser Datei schon MEHRFACH nicht mehr scharf. Es
 *  waren jedes Mal dieselben zwei Fehler:
 *
 *  1. CONTROL_AF_MODE_CONTINUOUS_PICTURE muss an BEIDEN Use Cases stehen —
 *     am Preview UND an der ImageAnalysis. CameraX führt die Konfigurationen
 *     aller gebundenen Use Cases zu EINEM Repeating-Request zusammen; steht
 *     der Modus nur an einem, entscheidet je nach Gerät die andere
 *     Konfiguration mit, und das Bild bleibt unscharf. Der Code sieht dabei
 *     völlig richtig aus — das ist die Tücke.
 *
 *  2. KEIN periodisches startFocusAndMetering ("Fokus-Pump"). Ein im Takt
 *     laufender Aufruf zwingt die Kamera immer wieder in eine neue Messung,
 *     der Fokus wandert dauernd. Tap-to-Focus im Touch-Listener ist in
 *     Ordnung — eine Schleife, ein Timer oder ein delay() davor nicht.
 *
 *  Beides prüft CameraFocusConfigTest in app/src/test/. Schlägt der Test
 *  fehl, ist eine dieser Regeln verletzt — nicht den Test anpassen, sondern
 *  den Code.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.view.ViewGroup
import androidx.camera.core.*
import android.view.MotionEvent
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.border
import androidx.compose.material.icons.filled.Close
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import com.google.mlkit.vision.common.InputImage
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.R
import ch.brickinventoryapp.util.NetworkPolicy
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.Role
import ch.brickinventoryapp.ui.theme.Abstaende


data class QrLoginPayload(val url: String, val token: String)

fun parseQrPayload(raw: String): QrLoginPayload? {
    return try {
        val obj = org.json.JSONObject(raw)
        val url   = obj.getString("url")
        val token = obj.getString("token")
        if (url.isNotBlank() && token.startsWith("bim:")) QrLoginPayload(url, token) else null
    } catch (_: Exception) { null }
}

@Composable
fun SetupScreen(
    currentUrl: String,
    onSave: (url: String, klartextBestaetigt: Boolean) -> Unit,
    onQrScanned: ((url: String, token: String, klartextBestaetigt: Boolean) -> Unit)? = null
) {
    var url          by rememberSaveable { mutableStateOf(currentUrl) }
    var showScanner  by rememberSaveable { mutableStateOf(false) }
    var scanError    by remember { mutableStateOf<String?>(null) }
    // Ein QR-Code kann von jedem stammen: Die Adresse wird erst nach einem Ja übernommen.
    var qrVorschlag  by remember { mutableStateOf<QrLoginPayload?>(null) }
    // Klartext zu einem öffentlich aussehenden Host nur nach ausdrücklicher
    // Bestätigung (NetworkPolicy.isCleartextAllowed).
    val klartextHost = NetworkPolicy.klartextHost(url)
    var klartextOk   by rememberSaveable(klartextHost) { mutableStateOf(false) }
    val invalidQrMsg = stringResource(R.string.setup_invalid_qr)
    val keyboard     = LocalSoftwareKeyboardController.current

    fun save() {
        val cleaned = url.trim().trimEnd('/')
        if (cleaned.isBlank() || (klartextHost != null && !klartextOk)) return
        keyboard?.hide(); onSave(cleaned, klartextHost != null && klartextOk)
    }

    if (showScanner) {
        // Temporarily expand scanner to support QR codes too
        QrSetupScannerScreen(
            onResult = { raw ->
                showScanner = false
                val payload = parseQrPayload(raw)
                if (payload != null) {
                    qrVorschlag = payload
                } else {
                    scanError = invalidQrMsg
                }
            },
            onDismiss = { showScanner = false }
        )
        return
    }

    qrVorschlag?.let { vorschlag ->
        val klartext = NetworkPolicy.klartextNachAussen(vorschlag.url)
        AlertDialog(
            onDismissRequest = { qrVorschlag = null },
            title = { Text(stringResource(R.string.setup_qr_titel)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    Text(stringResource(R.string.setup_qr_text, vorschlag.url))
                    if (klartext) Text(stringResource(R.string.setup_qr_klartext), color = MaterialTheme.colorScheme.error)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    qrVorschlag = null
                    url = vorschlag.url
                    onQrScanned?.invoke(vorschlag.url, vorschlag.token, NetworkPolicy.klartextHost(vorschlag.url) != null)
                }) { Text(stringResource(R.string.setup_qr_uebernehmen)) }
            },
            dismissButton = {
                TextButton(onClick = { qrVorschlag = null }) { Text(stringResource(R.string.common_cancel)) }
            },
        )
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(Abstaende.riesig),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(Modifier.size(80.dp), contentAlignment = Alignment.Center) {
            Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.primary, modifier = Modifier.size(80.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    androidx.compose.foundation.Image(
                        painter = androidx.compose.ui.res.painterResource(ch.brickinventoryapp.R.drawable.ic_logo),
                        contentDescription = null, modifier = Modifier.size(64.dp)
                    )
                }
            }
        }
        Spacer(Modifier.height(20.dp))
        Text(stringResource(R.string.app_name), fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.setup_subtitle), style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)

        Spacer(Modifier.height(Abstaende.riesig))

        // QR scan option
        FilledTonalButton(
            onClick = { scanError = null; showScanner = true },
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(Icons.Default.QrCodeScanner, null, Modifier.size(20.dp))
            Spacer(Modifier.width(Abstaende.klein))
            Text(stringResource(R.string.setup_scan_qr), fontWeight = FontWeight.SemiBold)
        }

        if (scanError != null) {
            Spacer(Modifier.height(Abstaende.klein))
            Text(scanError!!, color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(Abstaende.gross))

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            HorizontalDivider(Modifier.weight(1f))
            Text(stringResource(R.string.setup_or_manual), style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            HorizontalDivider(Modifier.weight(1f))
        }

        Spacer(Modifier.height(Abstaende.gross))

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Cloud, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(Abstaende.klein))
                    Text(stringResource(R.string.setup_server_url), fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.height(Abstaende.mittel))
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text(stringResource(R.string.setup_url_label)) },
                    placeholder = { Text(stringResource(R.string.setup_url_placeholder)) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { save() }),
                    supportingText = {
                        if (NetworkPolicy.klartextNachAussen(url))
                            Text(stringResource(R.string.setup_url_klartext), color = MaterialTheme.colorScheme.error)
                        else Text(stringResource(R.string.setup_url_supporting))
                    },
                    isError = NetworkPolicy.klartextNachAussen(url),
                )
                if (klartextHost != null) {
                    Row(
                        Modifier.fillMaxWidth().toggleable(value = klartextOk, role = Role.Checkbox,
                            onValueChange = { klartextOk = it }),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(checked = klartextOk, onCheckedChange = null)
                        Spacer(Modifier.width(Abstaende.klein))
                        Text(stringResource(R.string.setup_url_klartext_bestaetigen, klartextHost),
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
                Spacer(Modifier.height(Abstaende.gross))
                Button(
                    onClick = ::save, modifier = Modifier.fillMaxWidth(),
                    enabled = url.isNotBlank() && (klartextHost == null || klartextOk),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                ) { Text(stringResource(R.string.setup_continue), fontWeight = FontWeight.Bold) }
            }
        }
        Spacer(Modifier.height(Abstaende.gross))
        Text(
            // Aus BuildConfig statt als Literal: versionName entsteht bei jedem Build
            // (app/build.gradle.kts), ein fest eingetragener Stand veraltet unbemerkt.
            stringResource(R.string.setup_build, ch.brickinventoryapp.BuildConfig.VERSION_NAME),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
            modifier = Modifier.align(Alignment.CenterHorizontally)
        )
    }
}

/** QR scanner for setup — reuses the proven CameraPreviewBarcode with QR_CODE format */
@OptIn(ExperimentalPermissionsApi::class)
@Composable
fun QrSetupScannerScreen(onResult: (String) -> Unit, onDismiss: () -> Unit) {
    val cameraPermission = rememberPermissionState(android.Manifest.permission.CAMERA)
    var frozen by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        if (!cameraPermission.status.isGranted) cameraPermission.launchPermissionRequest()
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        when {
            cameraPermission.status.isGranted -> {
                // Reuse proven camera implementation with QR-only scanner
                QrCameraPreview(
                    frozen = frozen,
                    onQrFound = { value ->
                        if (!frozen) { frozen = true; onResult(value) }
                    }
                )
                // Rahmen und Hinweis in der gemeinsamen Ueberlagerung — siehe
                // KameraErlaubnis.kt. Eigen bleibt nur das Quadrat.
                KameraUeberlagerung(
                    hinweis = if (frozen) stringResource(R.string.setup_qr_detected)
                              else stringResource(R.string.setup_qr_scan_hint),
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(0.75f)
                            .aspectRatio(1f)
                            .border(2.dp,
                                if (frozen) LocalStatusFarben.current.erfolg else MaterialTheme.colorScheme.primary,
                                Formen.knopf)
                    )
                }
            }
            else -> {
                KameraErlaubnisHinweis { cameraPermission.launchPermissionRequest() }
            }
        }
        IconButton(onClick = onDismiss, Modifier.align(Alignment.TopEnd).padding(Abstaende.gross)) {
            Icon(Icons.Default.Close, stringResource(R.string.scanner_close), tint = Color.White)
        }
    }
}

// ExperimentalGetImage gehört hierher: Das Einverständnis für imageProxy.image ist
// diese Annotation; `@ExperimentalGetImage` an der lokalen Variablen wäre die
// Markierung (Lint: UnsafeOptInUsageError).
@androidx.annotation.OptIn(ExperimentalCamera2Interop::class, ExperimentalGetImage::class)
@Composable
fun QrCameraPreview(frozen: Boolean, onQrFound: (String) -> Unit) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val executor       = remember { java.util.concurrent.Executors.newSingleThreadExecutor() }

    val scanner = remember {
        com.google.mlkit.vision.barcode.BarcodeScanning.getClient(
            com.google.mlkit.vision.barcode.BarcodeScannerOptions.Builder()
                .setBarcodeFormats(com.google.mlkit.vision.barcode.common.Barcode.FORMAT_QR_CODE)
                .build()
        )
    }

    // remember() räumt nicht auf (wie im Barcodescanner): Ohne dieses DisposableEffect
    // überleben Analyse-Thread und ML-Kit-Client jeden Besuch des Setup-Screens. Der
    // kontinuierliche Autofokus bleibt davon unberührt.
    DisposableEffect(Unit) {
        onDispose {
            try { scanner.close() } catch (_: Exception) {}
            executor.shutdown()
        }
    }

    val imageAnalyzer = remember {
        // Aufbau samt AF-Modus: ui/screens/KameraAufbau.kt. 1280x720 statt 1920x1080 wie
        // im Barcodescanner: Hier wird ein QR-Code mit grossen Modulen gelesen, und
        // weniger Auflösung lässt Kamera und Vorschau mehr Rechenzeit.
        bildAnalyse(1280, 720)
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
            val previewView = PreviewView(ctx).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                scaleType = PreviewView.ScaleType.FILL_CENTER
                implementationMode = PreviewView.ImplementationMode.PERFORMANCE
            }
            // Anbieter holen, Vorschau bauen, binden: KameraAufbau.kt. Kein
            // beiFehler: Ist die Kamera nicht verfügbar, bleibt die Vorschau
            // bewusst leer — anders als im Scanner, der einen Hinweis zeigt.
            kameraBinden(
                ctx = ctx,
                previewView = previewView,
                lifecycleOwner = lifecycleOwner,
                analyse = imageAnalyzer,
            ) { camera ->
                // Tap-to-Focus — bewusst mit disableAutoCancel(): Der Nutzer tippt, weil der
                // kontinuierliche Autofokus gerade danebenliegt. Fiele die Kamera nach ein paar
                // Sekunden auf ihre eigene Wahl zurück, wäre genau das wieder da, wogegen der
                // Tipper gerichtet war — man tippt, es wird scharf, und kurz danach ist es wieder
                // weg.
                previewView.setOnTouchListener { v, event ->
                    if (event.action == MotionEvent.ACTION_UP) {
                        try {
                            val point = previewView.meteringPointFactory
                                .createPoint(event.x, event.y)
                            val action = FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF)
                                .addPoint(point, FocusMeteringAction.FLAG_AE)
                                .disableAutoCancel()
                                .build()
                            camera.cameraControl.startFocusAndMetering(action)
                        } catch (_: Exception) {}
                        v.performClick()
                    }
                    true
                }
            }
            previewView
        },
        modifier = Modifier.fillMaxSize()
    )
}
