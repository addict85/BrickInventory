package ch.brickinventoryapp.anmeldung.ui.screens

/*
 * Autofokus: CONTROL_AF_MODE_CONTINUOUS_PICTURE an Preview UND ImageAnalysis, weil
 * CameraX alle Use Cases zu einem Request zusammenführt; kein periodisches
 * startFocusAndMetering, das lässt den Fokus wandern. Beides prüft
 * CameraFocusConfigTest — bei Rot den Code richten, nicht den Test.
 */

import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.sicherheit.bestaetigtFingerabdruck
import ch.brickinventoryapp.sicherheit.fingerabdruckAnfang
import ch.brickinventoryapp.sicherheit.fingerabdruckLesbar
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.text.font.FontFamily
import ch.brickinventoryapp.anmeldung.ui.QrLoginPayload
import ch.brickinventoryapp.anmeldung.ui.qrWechseltServer
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.ui.screens.KameraErlaubnisHinweis
import ch.brickinventoryapp.ui.screens.KameraUeberlagerung
import ch.brickinventoryapp.ui.screens.bildAnalyse
import ch.brickinventoryapp.ui.screens.kameraBinden
import ch.brickinventoryapp.ui.screens.kameraVorschau
import ch.brickinventoryapp.ui.screens.rememberKameraErlaubnis
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
    val qrGesperrt = NetworkPolicy.adressfehler(vorschlag.url, entwicklung) != null
    // Ein Code mit anderem Schlüssel als dem bestätigten: wie „Zertifikat geändert“, mit beiden Werten.
    val bisher = remember(vorschlag) { bisherigerPin(vorschlag.url, vorschlag.fingerabdruck) }
    val abtippen = remember(vorschlag) { mussAbtippen(vorschlag.url, vorschlag.fingerabdruck) }
    // Wie ZertifikatDialog: Ein Code kann von jedem stammen, also den neuen Wert abschreiben lassen.
    var eingabe by remember(vorschlag) { mutableStateOf("") }
    var falsch by remember(vorschlag) { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onAbbrechen,
        title = { Text(stringResource(if (bisher != null) R.string.zert_titel_geaendert else R.string.setup_qr_titel)) },
        text = {
            // Die Bestätigung schickt die Anmeldung an diesen Server: kein Tippen durch eine Überlagerung.
            Ueberdeckungsschutz()
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                // Geparst statt roh: Ein Code wie `https://mein.server@fremd.example` oder mit
                // Zeilenumbruch zeigte sonst einen Namen, der nicht das Ziel ist.
                val ansicht = remember(vorschlag) { NetworkPolicy.ansicht(vorschlag.url) }
                val bisherHost = remember(vorschlag, currentUrl) { qrWechseltServer(currentUrl, vorschlag.url) }
                Text(stringResource(R.string.setup_qr_ziel))
                if (ansicht != null) {
                    Text(ansicht.host, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.titleMedium)
                    Text(ansicht.adresse, fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (ansicht.international) Text(stringResource(R.string.setup_qr_international),
                        color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                Text(stringResource(R.string.setup_qr_hinweis))
                if (bisherHost != null) Text(stringResource(R.string.setup_qr_anderer_server, bisherHost),
                    color = MaterialTheme.colorScheme.error)
                val fp = vorschlag.fingerabdruck
                if (bisher != null && fp != null) {
                    Text(stringResource(R.string.setup_qr_pin_geaendert), color = MaterialTheme.colorScheme.error)
                    Text(stringResource(R.string.zert_bisher), style = MaterialTheme.typography.labelMedium)
                    Text(fingerabdruckLesbar(bisher), fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    // Wie ZertifikatDialog: Den neuen Wert nennt der Code selbst, abgetippt
                    // wird er aus der Webapp; hier steht nur sein Anfang.
                    Text(stringResource(R.string.zert_beginnt_mit), style = MaterialTheme.typography.labelMedium)
                    Text(fingerabdruckAnfang(fp), fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                } else if (fp != null) {
                    // Erstes Einrichten: Ohne Tippen gilt nur eine System-Wurzel; einen eigenen
                    // Schlüssel könnte der Code eines Fremden genauso nennen.
                    Text(stringResource(if (abtippen) R.string.setup_qr_pin_abtippen else R.string.setup_qr_pin),
                        color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    Text(stringResource(R.string.zert_beginnt_mit), style = MaterialTheme.typography.labelMedium)
                    Text(fingerabdruckAnfang(fp), fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall)
                }
                if (abtippen && fp != null) {
                    OutlinedTextField(
                        shape = Formen.feld,
                        value = eingabe,
                        onValueChange = { eingabe = it; falsch = false },
                        label = { Text(stringResource(if (bisher != null) R.string.zert_geaendert_eingabe else R.string.zert_unbekannt_eingabe)) },
                        isError = falsch,
                        supportingText = if (falsch) { { Text(stringResource(R.string.zert_eingabe_falsch)) } } else null,
                        textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (qrGesperrt) Text(stringResource(R.string.setup_qr_klartext_abgelehnt), color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            TextButton(enabled = !qrGesperrt && (!abtippen || eingabe.isNotBlank()), onClick = {
                val fp = vorschlag.fingerabdruck
                if (abtippen && (fp == null || !bestaetigtFingerabdruck(eingabe, fp))) {
                    falsch = true
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
fun QrSetupScannerScreen(onResult: (String) -> Unit, onDismiss: () -> Unit) {
    val cameraPermission = rememberKameraErlaubnis()
    var frozen by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        if (!cameraPermission.erteilt) cameraPermission.anfragen()
    }
    // Das Bild zeigt einen Anmeldecode: In einer Aufnahme meldete er ein fremdes Gerät an.
    Sichtschutz()

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        when {
            cameraPermission.erteilt -> {
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
                                Formen.feld)
                    )
                }
            }
            else -> {
                KameraErlaubnisHinweis { cameraPermission.anfragen() }
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
            val previewView = kameraVorschau(ctx)
            // Anbieter holen, Vorschau bauen, binden: KameraAufbau.kt. Kein
            // beiFehler: Ist die Kamera nicht verfügbar, bleibt die Vorschau
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
