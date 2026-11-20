package ch.brickinventoryapp.collection.ui.screens

/*
 * Autofokus: CONTINUOUS_PICTURE an Vorschau UND Bildanalyse, weil CameraX beide zu einem Request
 * zusammenführt; kein periodisches Nachfokussieren, das die Kamera dauernd neu messen liesse.
 */

import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.*
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.resources.R
import androidx.compose.foundation.background
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FlashlightOff
import androidx.compose.material.icons.filled.FlashlightOn
import androidx.compose.foundation.BorderStroke
import ch.brickinventoryapp.ui.components.withFont
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.screens.CameraPermissionHint
import ch.brickinventoryapp.ui.screens.CameraOverlay
import ch.brickinventoryapp.ui.screens.kameraBinden
import ch.brickinventoryapp.ui.screens.cameraPreview
import ch.brickinventoryapp.ui.screens.rememberCameraPermission
import ch.brickinventoryapp.ui.screens.tippZumFokus

@Composable
fun BarcodeScannerScreen(
    onResult: (String) -> Unit,
    /**
     * Texterkennung zusätzlich zum Barcode, nur beim Erfassen von Sets und in der
     * Teileliste. Vorgabe aus: Im Preisvergleich ist eine nur wahrscheinlich richtige
     * Zahl ein Risiko, und jeder künftige Aufrufer soll sie bewusst einschalten.
     */
    ocrEnabled: Boolean = false,
    /** Per Texterkennung gelesene SETNUMMER — nur relevant, wenn ocrEnabled. */
    onSetNumberResult: (String) -> Unit = onResult,
    onDismiss: () -> Unit,
    /** Ohne Kamera die Nummer eintippen; ohne eigenen Weg zurück zum Aufrufer, wo das Feld steht. */
    typeInOn: () -> Unit = onDismiss,
    /** Nur die Überlagerung ohne Kamerabild — für Bildschirmfotos, wo es keine Kamera gibt. */
    ohneKamera: Boolean = false,
) {
    val cameraPermission = rememberCameraPermission()
    val defaultHint = stringResource(R.string.scanner_hint_default)
    val detectedHintFmt = stringResource(R.string.scanner_hint_detected)
    var statusText by rememberSaveable { mutableStateOf(defaultHint) }
    var frozen    by rememberSaveable { mutableStateOf(false) }
    var torchOn   by rememberSaveable { mutableStateOf(false) }
    var cameraCtrl by remember { mutableStateOf<CameraControl?>(null) }

    LaunchedEffect(Unit) {
        if (!ohneKamera && !cameraPermission.granted) cameraPermission.requests()
    }

    // Toggle torch when state changes
    LaunchedEffect(torchOn) { cameraCtrl?.enableTorch(torchOn) }

    // Kein periodischer Fokus-Trigger: Der Autofokus läuft über CONTINUOUS_PICTURE
    // (autofocusPermanent() in KameraAufbau.kt); ein Takt liesse die Kamera dauernd
    // nachpumpen. Manuell fokussiert wird nur beim Antippen.

    // Der Treffer ist auch zu spüren: Wer auf die Schachtel zielt, sieht nicht aufs Telefon.
    val haptics = androidx.compose.ui.platform.LocalHapticFeedback.current

    // Ein Treffer friert die Anzeige ein; was danach noch erkannt wird, zählt nicht mehr.
    fun gefunden(wert: String, weiter: (String) -> Unit) {
        if (frozen) return
        frozen = true
        haptics.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.Confirm)
        statusText = detectedHintFmt.replace("%1\$s", wert)
        weiter(wert)
    }

    val borderColor by animateColorAsState(
        if (frozen) LocalStatusFarben.current.erfolg else MaterialTheme.colorScheme.primary,
        label = "border"
    )

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        when {
            ohneKamera || cameraPermission.granted -> {
                if (!ohneKamera) CameraPreviewBarcode(
                    frozen = frozen,
                    ocrEnabled = ocrEnabled,
                    onBarcodeFound = { gefunden(it, onResult) },
                    // Getrennter Rückweg: Was hier ankommt, ist schon die Setnummer und darf nicht
                    // wie eine EAN durch die Auflösung laufen — die schlüge fehl und kostete
                    // Kontingent.
                    onSetNumberFound = { gefunden(it, onSetNumberResult) },
                    onStatus   = { if (!frozen) statusText = it },
                    onCamera   = { cameraCtrl = it }
                )

                // Rahmen, Schild und Gewichtung in der gemeinsamen
                // Ueberlagerung — siehe KameraErlaubnis.kt. Eigen bleiben hier
                // das breite Rechteck mit den Eckwinkeln und der Lampenknopf.
                CameraOverlay(
                    hinweis = statusText,
                    unten = {
                        Spacer(Modifier.height(Abstaende.gross))
                        LightButton(torchOn) { torchOn = !torchOn }
                    },
                ) { ScanFrame(borderColor) }
            }
            else -> {
                CameraPermissionHint(stringResource(R.string.scanner_camera_zweck_barcode),
                    stringResource(R.string.scanner_nummer_eintippen), typeInOn,
                    cameraPermission.permanentDenied) { cameraPermission.erlauben() }
            }
        }
        // Oben links wie jedes Schliessen einer Vollbildseite (BackButton).
        MitTooltip(stringResource(R.string.scanner_close), Modifier.align(Alignment.TopStart)) {
            IconButton(onClick = onDismiss, modifier = Modifier.padding(Abstaende.gross)) {
                Icon(Icons.Default.Close, stringResource(R.string.scanner_close), tint = Color.White)
            }
        }
    }
}

/** Das breite Rechteck mit Eckwinkeln: Ein Strichcode liegt quer, nicht im Quadrat. */
@Composable
private fun ScanFrame(farbe: Color) {
    Box(
        Modifier
            .fillMaxWidth(0.88f)
            .aspectRatio(1.8f)
            .border(2.dp, farbe, Formen.feld)
    ) {
        val lang = 20.dp
        val dick = 3.dp
        for (corner in listOf(Alignment.TopStart, Alignment.TopEnd, Alignment.BottomStart, Alignment.BottomEnd)) {
            Box(Modifier.size(lang, dick).align(corner).background(farbe))
            Box(Modifier.size(dick, lang).align(corner).background(farbe))
        }
    }
}

/**
 * Die Lampe als Knopf mit Rand und Symbol: Schwarz auf schwarzem Grund las sich „Licht
 * ein“ wie ein Hinweis, nicht wie etwas zum Antippen. Deckende Flächen wie das Schild
 * darüber: Auf hellem Motiv war Weiss auf durchscheinendem Weiss nicht zu lesen.
 */
@Composable
private fun LightButton(an: Boolean, toggleOn: () -> Unit) {
    OutlinedButton(
        onClick = toggleOn,
        border = BorderStroke(1.dp, Color.White),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = if (an) Color.White else Color.Black.copy(alpha = 0.72f),
            contentColor = if (an) Color.Black else Color.White,
        ),
    ) {
        Icon(if (an) Icons.Default.FlashlightOff else Icons.Default.FlashlightOn, null, Modifier.size(withFont(18.dp)))
        Spacer(Modifier.width(Abstaende.klein))
        Text(stringResource(if (an) R.string.scanner_torch_off else R.string.scanner_torch_on),
            style = MaterialTheme.typography.bodyMedium)
    }
}

/**
 * Kandidaten für eine Setnummer aus erkanntem Text, in absteigender Güte. Auf
 * einer Anleitung stehen viele Zahlen (Alter, Teilezahl, Seite, Jahr, Heft- und
 * Elementnummern); die längste ist selten die Setnummer.
 */

/**
 * Wörter, die eine Zahl als Mengenangabe ausweisen — wortgleich mit QUANTITY_WORD in
 * produkttitel.ts. `(?iu)`, weil IGNORE_CASE ohne `u` nur ASCII kennt.
 */
private val QUANTITY_WORD = Regex(
    "(?iu)^\\s*(?:x\\s*)?(?:pcs?|pieces?|piece|teil(?:e|en)?|stück(?:e|en)?|" +
    "stueck(?:e|en)?|stein(?:e|en)?|bricks?|parts?|element(?:e|en|s)?)\\b"
)

/**
 * Stellenzahlen in absteigender Guete. Unbekannte Laengen landen dahinter.
 * Muss mit `QUALITY` in Web-App/utils/produkttitel.ts uebereinstimmen.
 */
internal val QUALITY = listOf(5, 4, 6, 7, 3)

/**
 * Drei bis sieben Ziffern, optional mit `#` davor und Variantenzusatz. Oben statt
 * in der Funktion, weil sie alle 700 ms in der Kameraschleife läuft. Wortgleich
 * mit `pattern` in produkttitel.ts.
 */
private val SET_NUMBER_PATTERN = Regex("(#\\s*)?\\b(\\d{3,7})(-\\d{1,2})?\\b")

private data class SetNumberCandidate(
    val wert: String,
    val withSuffix: Boolean,
    val withHash: Boolean,
    val jahr: Boolean,
    val quality: Int,
)

internal fun setNumberCandidates(text: String): List<String> {
    val yearLimit = java.time.Year.now().value + 1
    val gefunden = ArrayList<SetNumberCandidate>()
    for (treffer in SET_NUMBER_PATTERN.findAll(text)) {
        val digits = treffer.groupValues[2]
        val suffix = treffer.groupValues[3]
        // Regel 1: Was ein Mengenwort hinter sich hat, ist eine Teilezahl.
        val danach = text.substring(treffer.range.last + 1)
        if (QUANTITY_WORD.containsMatchIn(danach)) continue
        val zahl = digits.toIntOrNull() ?: continue
        // Mit Variantenzusatz ist es keine Jahreszahl mehr, sondern eine
        // Setnummer in ihrer eindeutigen Schreibweise.
        val jahr = suffix.isEmpty() && digits.length == 4 && zahl >= 1949 && zahl <= yearLimit
        // Unbekannte Laenge ganz nach hinten statt an den Anfang: indexOf
        // liefert sonst -1 und die Zahl gewaenne alles.
        val quality = QUALITY.indexOf(digits.length).let { if (it < 0) QUALITY.size else it }
        gefunden.add(SetNumberCandidate(digits + suffix, suffix.isNotEmpty(),
            treffer.groupValues[1].isNotEmpty(), jahr, quality))
    }
    // sortedWith ist stabil, also bleibt bei Gleichstand die Reihenfolge im Text.
    return gefunden.distinctBy { it.wert }
        .sortedWith(
            compareByDescending<SetNumberCandidate> { it.withSuffix }
                .thenByDescending { it.withHash }
                .thenBy { it.jahr }
                .thenBy { it.quality }
        )
        .map { it.wert }
}

@androidx.annotation.OptIn(ExperimentalCamera2Interop::class)
@Composable
internal fun CameraPreviewBarcode(
    frozen: Boolean,
    ocrEnabled: Boolean,
    onBarcodeFound: (String) -> Unit,
    /** Per Texterkennung gelesene SETNUMMER — braucht KEINE EAN-Auflösung. */
    onSetNumberFound: (String) -> Unit,
    onStatus: (String) -> Unit,
    onCamera: (CameraControl) -> Unit,
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val confirmingHint = stringResource(R.string.scanner_hint_confirming)
    val aimHint = stringResource(R.string.scanner_hint_aim)
    val errorHint = stringResource(R.string.scanner_hint_error)
    // Der Tipp-Listener wird im factory-Block gesetzt, die Kamerasteuerung gibt es
    // erst nach dem Binden — deshalb eine Referenz, die beim Binden gefüllt wird.
    val _kameraCtrl = remember { java.util.concurrent.atomic.AtomicReference<CameraControl?>(null) }

    // Die Analyse-Schleife (Barcode, Texterkennung, Bestätigung, Drosselung) steht in
    // BarcodeAnalyzer.kt.
    val imageAnalyzer = rememberBarcodeAnalyzer(
        frozen, ocrEnabled, onBarcodeFound, onSetNumberFound, onStatus,
        confirmingHint, aimHint, errorHint,
    )

    AndroidView(
        factory = { ctx ->
            val previewView = cameraPreview(ctx)
            tippZumFokus(previewView) { _kameraCtrl.get() }

            // Anbieter holen, Vorschau bauen, binden: KameraAufbau.kt. Hier
            // bleibt nur, was den Scanner betrifft.
            kameraBinden(
                ctx = ctx,
                previewView = previewView,
                lifecycleOwner = lifecycleOwner,
                analyse = imageAnalyzer,
                atError = {
                    // Kamera nicht verfügbar (belegt, Hardware-Fehler): Hinweis
                    // zeigen statt schwarzem Bild ohne Erklärung.
                    onStatus(errorHint)
                },
            ) { camera ->
                onCamera(camera.cameraControl)
                // Die Kamerasteuerung für das Tippen bereitstellen. Nur ein Listener:
                // setOnTouchListener ersetzt, ein zweiter überschriebe den oben in der factory.
                _kameraCtrl.set(camera.cameraControl)
            }
            previewView
        },
        modifier = Modifier.fillMaxSize()
    )
}
