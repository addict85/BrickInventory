package ch.brickinventoryapp.ui.screens

/*
 * Autofokus: CONTROL_AF_MODE_CONTINUOUS_PICTURE an Preview UND ImageAnalysis, weil
 * CameraX alle Use Cases zu einem Request zusammenführt; kein periodisches
 * startFocusAndMetering, das lässt den Fokus wandern. Beides prüft
 * CameraFocusConfigTest — bei Rot den Code richten, nicht den Test.
 */

import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Info
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
import com.google.mlkit.vision.common.InputImage
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.util.bestaetigtFingerabdruck
import ch.brickinventoryapp.util.fingerabdruckAnfang
import ch.brickinventoryapp.util.fingerabdruckLesbar
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import ch.brickinventoryapp.ui.theme.mittigBis
import androidx.compose.ui.text.font.FontFamily
import ch.brickinventoryapp.ui.QrLoginPayload
import ch.brickinventoryapp.ui.parseQrPayload
import ch.brickinventoryapp.ui.qrWechseltServer
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Server einrichten: per QR-Code oder von Hand, nur mit https. Steht noch eine
 * http-Adresse aus einer älteren Fassung da, erklärt eine Karte oben den Weg.
 */
@Composable
fun SetupScreen(
    currentUrl: String,
    onSave: (url: String) -> Unit,
    /** Zweiter Wert: bei abweichendem Pin der abgeschriebene neue Fingerabdruck, sonst null. */
    onQrScanned: ((QrLoginPayload, String?) -> Unit)? = null,
    entwicklung: Boolean = NetworkPolicy.entwicklung,
    /** Der gemerkte Pin für Adresse und Fingerabdruck des Codes, wenn er abweicht. */
    bisherigerPin: (url: String, fingerabdruck: String?) -> String? = { _, _ -> null },
) {
    var url          by rememberSaveable { mutableStateOf(currentUrl) }
    var showScanner  by rememberSaveable { mutableStateOf(false) }
    var scanError    by remember { mutableStateOf<String?>(null) }
    // Ein QR-Code kann von jedem stammen: Die Adresse wird erst nach einem Ja übernommen.
    var qrVorschlag  by remember { mutableStateOf<QrLoginPayload?>(null) }
    val invalidQrMsg = stringResource(R.string.setup_invalid_qr)
    val keyboard     = LocalSoftwareKeyboardController.current
    val altbestand   = NetworkPolicy.klartextAltbestand(currentUrl, entwicklung)
    val fehler       = if (url.isBlank()) null else NetworkPolicy.adressfehler(url, entwicklung)

    fun save() {
        if (url.isBlank() || fehler != null) return
        keyboard?.hide(); onSave(NetworkPolicy.normalisiere(url))
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
        val qrGesperrt = NetworkPolicy.adressfehler(vorschlag.url, entwicklung) != null
        // Ein Code mit anderem Schlüssel als dem bestätigten: wie „Zertifikat geändert“, mit beiden Werten.
        val bisher = remember(vorschlag) { bisherigerPin(vorschlag.url, vorschlag.fingerabdruck) }
        // Wie ZertifikatDialog: Ein Code kann von jedem stammen, also den neuen Wert abschreiben lassen.
        var eingabe by remember(vorschlag) { mutableStateOf("") }
        var falsch by remember(vorschlag) { mutableStateOf(false) }
        AlertDialog(
            onDismissRequest = { qrVorschlag = null },
            title = { Text(stringResource(if (bisher != null) R.string.zert_titel_geaendert else R.string.setup_qr_titel)) },
            text = {
                // Die Bestätigung schickt die Anmeldung an diesen Server: kein Tippen durch eine Überlagerung.
                ch.brickinventoryapp.ui.components.Ueberdeckungsschutz()
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
                        OutlinedTextField(
                            value = eingabe,
                            onValueChange = { eingabe = it; falsch = false },
                            label = { Text(stringResource(R.string.zert_geaendert_eingabe)) },
                            isError = falsch,
                            supportingText = if (falsch) { { Text(stringResource(R.string.zert_eingabe_falsch)) } } else null,
                            textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    } else if (fp != null) {
                        // Erstes Einrichten: Der Code bestimmt allein, welchem Schlüssel die App
                        // künftig für diese Adresse traut. Abtippen hiesse, den QR-Code zu
                        // entwerten; darum die Warnung und der Anfang zum Vergleich mit der Webapp.
                        Text(stringResource(R.string.setup_qr_pin), color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall)
                        Text(stringResource(R.string.zert_beginnt_mit), style = MaterialTheme.typography.labelMedium)
                        Text(fingerabdruckAnfang(fp), fontFamily = FontFamily.Monospace,
                            style = MaterialTheme.typography.bodySmall)
                    }
                    if (qrGesperrt) Text(stringResource(R.string.setup_qr_klartext_abgelehnt), color = MaterialTheme.colorScheme.error)
                }
            },
            confirmButton = {
                TextButton(enabled = !qrGesperrt && (bisher == null || eingabe.isNotBlank()), onClick = {
                    val fp = vorschlag.fingerabdruck
                    if (bisher != null && (fp == null || !bestaetigtFingerabdruck(eingabe, fp))) {
                        falsch = true
                    } else {
                        qrVorschlag = null
                        url = vorschlag.url
                        onQrScanned?.invoke(vorschlag, eingabe.takeIf { bisher != null })
                    }
                }) {
                    Text(stringResource(if (bisher != null) R.string.setup_qr_pin_uebernehmen else R.string.setup_qr_uebernehmen),
                        color = if (bisher != null) MaterialTheme.colorScheme.error else androidx.compose.ui.graphics.Color.Unspecified)
                }
            },
            dismissButton = {
                TextButton(onClick = { qrVorschlag = null }) { Text(stringResource(R.string.common_cancel)) }
            },
        )
    }

    // Rollbar wie die Anmeldung (bei 200 % Schrift reichte die Höhe nicht), mittig
    // solange es passt, und auf dem Tablet nicht breiter als ein Formular.
    BoxWithConstraints(Modifier.fillMaxSize()) {
    Column(
        modifier = Modifier.verticalScroll(rememberScrollState()).heightIn(min = maxHeight)
            .mittigBis(ch.brickinventoryapp.ui.theme.Lesebreite.formular).padding(Abstaende.riesig),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(Modifier.size(80.dp), contentAlignment = Alignment.Center) {
            // Auf surface statt primary: Der rote Stein des Logos verschwand auf manchem
            // primary (noppe dunkel 1,2:1); auf surface steht er in jedem Design.
            Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface,
                border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                modifier = Modifier.size(80.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    androidx.compose.foundation.Image(
                        painter = androidx.compose.ui.res.painterResource(ch.brickinventoryapp.ressourcen.R.drawable.ic_logo),
                        contentDescription = null, modifier = Modifier.size(64.dp)
                    )
                }
            }
        }
        Spacer(Modifier.height(20.dp))
        Text(stringResource(R.string.app_name), fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.setup_subtitle), style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)

        if (altbestand) {
            Spacer(Modifier.height(Abstaende.gross))
            // Ein Hinweis mit Anleitung, kein Fehler: in der Infofarbe (primaryContainer)
            // mit Symbol. Im Fehlerrot las sich der lange Text wie eine Störung.
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer),
            ) {
                Row(Modifier.padding(Abstaende.gross), horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
                    Icon(Icons.Default.Info, null)
                    Column(verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                        Text(stringResource(R.string.setup_altbestand_titel), fontWeight = FontWeight.Bold)
                        Text(stringResource(R.string.setup_altbestand_text, currentUrl),
                            style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }

        Spacer(Modifier.height(Abstaende.riesig))

        // Der QR-Code ist der empfohlene Weg (Adresse und Zertifikat in einem Schritt) und
        // deshalb die gefüllte Hauptaktion; die Eingabe von Hand darunter ist der Ausweg.
        Button(
            onClick = { scanError = null; showScanner = true },
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)
        ) {
            Icon(Icons.Default.QrCodeScanner, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(20.dp)))
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

        // Die Karte auf surface mit Rand: Der graue Vorgabeton lag grau auf dem grauen
        // Hintergrund und verschwamm mit ihm.
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
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
                        when (fehler) {
                            NetworkPolicy.Adressfehler.KLARTEXT ->
                                Text(stringResource(R.string.setup_klartext_abgelehnt), color = MaterialTheme.colorScheme.error)
                            NetworkPolicy.Adressfehler.UNLESBAR ->
                                Text(stringResource(R.string.setup_url_unlesbar), color = MaterialTheme.colorScheme.error)
                            NetworkPolicy.Adressfehler.BENUTZERANGABE ->
                                Text(stringResource(R.string.setup_url_benutzerangabe), color = MaterialTheme.colorScheme.error)
                            NetworkPolicy.Adressfehler.ZUSATZ ->
                                Text(stringResource(R.string.setup_url_zusatz), color = MaterialTheme.colorScheme.error)
                            null -> Text(stringResource(R.string.setup_url_supporting))
                        }
                    },
                    isError = fehler != null,
                )
                Spacer(Modifier.height(Abstaende.gross))
                // Tonal: Neben dem gefüllten QR-Knopf oben gibt es nur EINE Hauptaktion.
                FilledTonalButton(
                    onClick = ::save, modifier = Modifier.fillMaxWidth(),
                    enabled = url.isNotBlank() && fehler == null,
                ) { Text(stringResource(R.string.setup_continue), fontWeight = FontWeight.Bold) }
            }
        }
        // Aus der App-Fassung statt als Literal: versionName entsteht bei jedem Build
        // (app/build.gradle.kts). Ohne Namen (Vorschau, Test) bliebe nur „Build “ stehen.
        val fassung = ch.brickinventoryapp.ui.components.LocalAppFassung.current.name
        if (fassung.isNotBlank()) {
            Spacer(Modifier.height(Abstaende.gross))
            Text(
                stringResource(R.string.setup_build, fassung),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.align(Alignment.CenterHorizontally)
            )
        }
    }
    }
}

/** QR scanner for setup — reuses the proven CameraPreviewBarcode with QR_CODE format */
@Composable
fun QrSetupScannerScreen(onResult: (String) -> Unit, onDismiss: () -> Unit) {
    val cameraPermission = rememberKameraErlaubnis()
    var frozen by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        if (!cameraPermission.erteilt) cameraPermission.anfragen()
    }

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
