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
import android.hardware.camera2.CaptureRequest
import android.view.MotionEvent
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import java.util.concurrent.TimeUnit
import androidx.compose.foundation.background
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.filled.Close
import androidx.core.content.ContextCompat
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import com.google.mlkit.vision.common.InputImage
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.R


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
    onSave: (String) -> Unit,
    onQrScanned: ((url: String, token: String) -> Unit)? = null
) {
    var url          by remember { mutableStateOf(currentUrl) }
    var showScanner  by remember { mutableStateOf(false) }
    var scanError    by remember { mutableStateOf<String?>(null) }
    val invalidQrMsg = stringResource(R.string.setup_invalid_qr)
    val keyboard     = LocalSoftwareKeyboardController.current

    fun save() {
        val cleaned = url.trim().trimEnd('/')
        if (cleaned.isNotBlank()) { keyboard?.hide(); onSave(cleaned) }
    }

    if (showScanner) {
        // Temporarily expand scanner to support QR codes too
        QrSetupScannerScreen(
            onResult = { raw ->
                showScanner = false
                val payload = parseQrPayload(raw)
                if (payload != null) {
                    url = payload.url
                    onQrScanned?.invoke(payload.url, payload.token)
                } else {
                    scanError = invalidQrMsg
                }
            },
            onDismiss = { showScanner = false }
        )
        return
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
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
        Text(stringResource(R.string.app_name), fontWeight = FontWeight.ExtraBold, fontSize = 24.sp)
        Text(stringResource(R.string.setup_subtitle), style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)

        Spacer(Modifier.height(32.dp))

        // QR scan option
        FilledTonalButton(
            onClick = { scanError = null; showScanner = true },
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(Icons.Default.QrCodeScanner, null, Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.setup_scan_qr), fontWeight = FontWeight.SemiBold)
        }

        if (scanError != null) {
            Spacer(Modifier.height(8.dp))
            Text(scanError!!, color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(16.dp))

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            HorizontalDivider(Modifier.weight(1f))
            Text(stringResource(R.string.setup_or_manual), style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            HorizontalDivider(Modifier.weight(1f))
        }

        Spacer(Modifier.height(16.dp))

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Cloud, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.setup_server_url), fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text(stringResource(R.string.setup_url_label)) },
                    placeholder = { Text(stringResource(R.string.setup_url_placeholder)) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { save() }),
                    supportingText = { Text(stringResource(R.string.setup_url_supporting)) }
                )
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = ::save, modifier = Modifier.fillMaxWidth(), enabled = url.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                ) { Text(stringResource(R.string.setup_continue), fontWeight = FontWeight.Bold) }
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(
            // Aus BuildConfig statt als Literal: Das fest eingetragene Datum
            // stammte vom Juni 2026 und wurde bei keinem Build seither
            // nachgeführt — die Zeile zeigte also verlässlich das Falsche.
            // versionName wird bei jedem Build erzeugt (app/build.gradle.kts).
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
    var frozen by remember { mutableStateOf(false) }

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
                Column(
                    Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Spacer(Modifier.weight(0.2f))
                    Box(
                        Modifier
                            .fillMaxWidth(0.75f)
                            .aspectRatio(1f)
                            .border(2.dp,
                                if (frozen) LocalStatusFarben.current.erfolg else MaterialTheme.colorScheme.primary,
                                Formen.knopf)
                    )
                    Spacer(Modifier.height(20.dp))
                    Surface(
                        color = Color.Black.copy(alpha = 0.72f),
                        shape = Formen.kachel
                    ) {
                        Text(
                            if (frozen) stringResource(R.string.setup_qr_detected) else stringResource(R.string.setup_qr_scan_hint),
                            Modifier.padding(horizontal = 18.dp, vertical = 10.dp),
                            color = Color.White, fontSize = 13.sp,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center
                        )
                    }
                    Spacer(Modifier.weight(0.8f))
                }
            }
            else -> {
                Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(stringResource(R.string.scanner_camera_needed), color = Color.White, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(12.dp))
                        Button(onClick = { cameraPermission.launchPermissionRequest() }) { Text(stringResource(R.string.scanner_allow)) }
                    }
                }
            }
        }
        IconButton(onClick = onDismiss, Modifier.align(Alignment.TopEnd).padding(16.dp)) {
            Icon(Icons.Default.Close, stringResource(R.string.scanner_close), tint = Color.White)
        }
    }
}

@androidx.annotation.OptIn(ExperimentalCamera2Interop::class)
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

    // Siehe BarcodeScannerScreen: remember() räumt nicht auf. Ohne dieses
    // DisposableEffect überleben Analyse-Thread und ML-Kit-Client jeden
    // Besuch des Setup-Screens. Betrifft nur das Aufräumen nach dem
    // Verlassen — der kontinuierliche Autofokus bleibt unberührt.
    DisposableEffect(Unit) {
        onDispose {
            try { scanner.close() } catch (_: Exception) {}
            executor.shutdown()
        }
    }

    val imageAnalyzer = remember {
        ImageAnalysis.Builder()
            // AF-Modus AUCH hier setzen, nicht nur am Preview.
            //
            // CameraX führt die Konfigurationen aller gebundenen Use Cases zu
            // EINEM Repeating-Request zusammen. Steht CONTROL_AF_MODE nur am
            // Preview, entscheidet je nach Gerät und CameraX-Fassung die
            // Analyse-Konfiguration mit — und deren Vorgabe ist nicht
            // zwingend CONTINUOUS_PICTURE. Auf solchen Geräten bleibt das Bild
            // unscharf, obwohl der Code richtig aussieht.
            //
            // Beide Use Cases auf denselben Modus zu setzen macht das Ergebnis
            // unabhängig davon, welcher die Führung übernimmt.
            .also {
                androidx.camera.camera2.interop.Camera2Interop.Extender(it).setCaptureRequestOption(
                    CaptureRequest.CONTROL_AF_MODE,
                    CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
                )
            }
            .setResolutionSelector(
                androidx.camera.core.resolutionselector.ResolutionSelector.Builder()
                    .setResolutionStrategy(
                        androidx.camera.core.resolutionselector.ResolutionStrategy(
                            android.util.Size(1280, 720),
                            androidx.camera.core.resolutionselector.ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                        )
                    ).build()
            )
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
            .build()
            .also { analysis ->
                analysis.setAnalyzer(executor) { imageProxy ->
                    if (frozen) { imageProxy.close(); return@setAnalyzer }
                    @ExperimentalGetImage
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
            val future = ProcessCameraProvider.getInstance(ctx)
            future.addListener({
                // Siehe BarcodeScannerScreen: future.get() kann seit CameraX 1.4.0
                // werfen, wenn die Kamera nicht verfügbar ist. Das try umschliesst
                // den gesamten Listener, sonst stürzt die App statt eines leeren
                // Vorschaubilds ab.
                try {
                val provider = future.get()
                // Kontinuierlichen Autofokus explizit erzwingen — der frühere
                // einmalige Fokus-Trigger beim Start war geräteabhängig unzuverlässig;
                // CONTINUOUS_PICTURE fokussiert permanent selbstständig nach.
                val previewBuilder = Preview.Builder()
                Camera2Interop.Extender(previewBuilder).setCaptureRequestOption(
                    CaptureRequest.CONTROL_AF_MODE,
                    CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
                )
                val preview = previewBuilder.build()
                    .also { it.setSurfaceProvider(previewView.surfaceProvider) }
                try {
                    provider.unbindAll()
                    val camera = provider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        imageAnalyzer
                    )
                    // Tap-to-Focus mit Auto-Cancel: kehrt nach 3s zum Continuous-AF zurück
                    previewView.setOnTouchListener { v, event ->
                        if (event.action == MotionEvent.ACTION_UP) {
                            try {
                                val point = previewView.meteringPointFactory
                                    .createPoint(event.x, event.y)
                                val action = FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF)
                                    .addPoint(point, FocusMeteringAction.FLAG_AE)
                                    .setAutoCancelDuration(3, TimeUnit.SECONDS)
                                    .build()
                                camera.cameraControl.startFocusAndMetering(action)
                            } catch (_: Exception) {}
                            v.performClick()
                        }
                        true
                    }
                } catch (_: Exception) {}
                } catch (_: Exception) { /* Kamera nicht verfügbar — Vorschau bleibt leer */ }
            }, ContextCompat.getMainExecutor(ctx))
            previewView
        },
        modifier = Modifier.fillMaxSize()
    )
}
