package ch.brickinventoryapp.login.ui.screens

/*
 * Autofokus: CONTROL_AF_MODE_CONTINUOUS_PICTURE an Preview UND ImageAnalysis, weil
 * CameraX alle Use Cases zu einem Request zusammenführt; kein periodisches
 * startFocusAndMetering, das lässt den Fokus wandern. Beides prüft
 * CameraFocusConfigTest — bei Rot den Code richten, nicht den Test.
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
 * Rückfrage nach einem gescannten Code: Er kann von jedem stammen, darum nennt sie das
 * Ziel und lässt bei Bedarf den Fingerabdruck abtippen. [onUebernehmen] bekommt den
 * abgetippten Wert oder null, wenn nichts abzutippen war.
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
    // Ein Code mit anderem Schlüssel als dem bestätigten: wie „Zertifikat geändert“, mit beiden Werten.
    val bisher = remember(vorschlag) { bisherigerPin(vorschlag.url, vorschlag.fingerabdruck) }
    val abtippen = remember(vorschlag) { mussAbtippen(vorschlag.url, vorschlag.fingerabdruck) }
    // Wie CertificateDialog: Ein Code kann von jedem stammen, also den neuen Wert abschreiben lassen.
    var eingabe by remember(vorschlag) { mutableStateOf("") }
    var finding by remember(vorschlag) { mutableStateOf<Transcript?>(null) }
    var targetConfirmed by remember(vorschlag) { mutableStateOf(false) }
    val titel = stringResource(if (bisher != null) R.string.zert_titel_geaendert else R.string.setup_qr_titel)
    AlertDialog(
        containerColor = fensterFlaeche(),
        onDismissRequest = onAbbrechen,
        modifier = Modifier.semantics { paneTitle = titel },
        // Wie CertificateDialog: Daneben tippen verwirft nichts Abgetipptes, Zurück nur ein leeres Feld.
        properties = DialogProperties(dismissOnBackPress = eingabe.isEmpty(), dismissOnClickOutside = false),
        title = { Text(titel, Modifier.semantics { heading() }) },
        text = {
            // Die Bestätigung schickt die Anmeldung an diesen Server: kein Tippen durch eine Überlagerung.
            Ueberdeckungsschutz()
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                // Geparst statt roh: Ein Code wie `https://mein.server@fremd.example` oder mit
                // Zeilenumbruch zeigte sonst einen Namen, der nicht das Ziel ist.
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
                    // Wie CertificateDialog: Den neuen Wert nennt der Code selbst, abgetippt
                    // wird er aus der Webapp; hier steht nur sein Anfang.
                    Text(stringResource(R.string.zert_beginnt_mit), style = MaterialTheme.typography.labelMedium)
                    Text(fingerprintStart(fp), fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                } else if (fp != null) {
                    // Erstes Einrichten: Ohne Tippen gilt nur eine System-Wurzel; einen eigenen
                    // Schlüssel könnte der Code eines Fremden genauso nennen.
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
    // Das Bild zeigt einen Anmeldecode: In einer Aufnahme meldete er ein fremdes Gerät an.
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
                // Rahmen und Hinweis in der gemeinsamen Ueberlagerung — siehe
                // KameraErlaubnis.kt. Eigen bleibt nur das Quadrat.
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
                // Eintippen heisst zurück zur Einrichtung: Dort steht das Adressfeld.
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

// ExperimentalGetImage gehört hierher: Das Einverständnis für imageProxy.image ist
// diese Annotation; `@ExperimentalGetImage` an der lokalen Variablen wäre die
// Markierung (Lint: UnsafeOptInUsageError).
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

    // remember() räumt nicht auf (wie im Barcodescanner): Ohne dieses DisposableEffect
    // überleben Analyse-Thread und ML-Kit-Client jeden Besuch des Setup-Screens. Der
    // kontinuierliche Autofokus bleibt davon unberührt.
    DisposableEffect(Unit) {
        onDispose {
            try { scanner.close() } catch (_: Exception) { /* beim Verlassen schon geschlossen */ }
            executor.shutdown()
        }
    }

    val imageAnalyzer = remember {
        // Aufbau samt AF-Modus: ui/screens/KameraAufbau.kt. 1280x720 statt 1920x1080 wie
        // im Barcodescanner: Hier wird ein QR-Code mit grossen Modulen gelesen, und
        // weniger Auflösung lässt Kamera und Vorschau mehr Rechenzeit.
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
            // Anbieter holen, Vorschau bauen, binden: KameraAufbau.kt. Kein
            // atError: Ist die Kamera nicht verfügbar, bleibt die Vorschau
            // bewusst leer — anders als im Scanner, der einen Hinweis zeigt.
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
