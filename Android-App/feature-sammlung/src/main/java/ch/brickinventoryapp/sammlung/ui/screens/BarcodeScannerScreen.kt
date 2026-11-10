package ch.brickinventoryapp.sammlung.ui.screens

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
import ch.brickinventoryapp.ressourcen.R
import androidx.compose.foundation.background
import androidx.compose.material.icons.filled.Close
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.screens.KameraErlaubnisHinweis
import ch.brickinventoryapp.ui.screens.KameraUeberlagerung
import ch.brickinventoryapp.ui.screens.kameraBinden
import ch.brickinventoryapp.ui.screens.kameraVorschau
import ch.brickinventoryapp.ui.screens.rememberKameraErlaubnis
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
    /** Nur die Überlagerung ohne Kamerabild — für Bildschirmfotos, wo es keine Kamera gibt. */
    ohneKamera: Boolean = false,
) {
    val cameraPermission = rememberKameraErlaubnis()
    val defaultHint = stringResource(R.string.scanner_hint_default)
    val detectedHintFmt = stringResource(R.string.scanner_hint_detected)
    val confirmingHint = stringResource(R.string.scanner_hint_confirming)
    val aimHint = stringResource(R.string.scanner_hint_aim)
    val errorHint = stringResource(R.string.scanner_hint_error)
    var statusText by rememberSaveable { mutableStateOf(defaultHint) }
    var frozen    by rememberSaveable { mutableStateOf(false) }
    var torchOn   by rememberSaveable { mutableStateOf(false) }
    var cameraCtrl by remember { mutableStateOf<CameraControl?>(null) }

    LaunchedEffect(Unit) {
        if (!ohneKamera && !cameraPermission.erteilt) cameraPermission.anfragen()
    }

    // Toggle torch when state changes
    LaunchedEffect(torchOn) { cameraCtrl?.enableTorch(torchOn) }

    // Kein periodischer Fokus-Trigger: Der Autofokus läuft über CONTINUOUS_PICTURE
    // (autofokusDauerhaft() in KameraAufbau.kt); ein Takt liesse die Kamera dauernd
    // nachpumpen. Manuell fokussiert wird nur beim Antippen.

    // Der Treffer ist auch zu spüren: Wer auf die Schachtel zielt, sieht nicht aufs Telefon.
    val haptik = androidx.compose.ui.platform.LocalHapticFeedback.current
    val treffer = { haptik.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.Confirm) }

    val borderColor by animateColorAsState(
        if (frozen) LocalStatusFarben.current.erfolg else MaterialTheme.colorScheme.primary,
        label = "border"
    )

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        when {
            ohneKamera || cameraPermission.erteilt -> {
                if (!ohneKamera) CameraPreviewBarcode(
                    frozen = frozen,
                    ocrEnabled = ocrEnabled,
                    onBarcodeFound = { value ->
                        if (!frozen) {
                            frozen = true
                            treffer()
                            statusText = detectedHintFmt.replace("%1\$s", value)
                            onResult(value)
                        }
                    },
                    // Getrennter Rückweg: Was hier ankommt, ist schon die Setnummer und darf nicht
                    // wie eine EAN durch die Auflösung laufen — die schlüge fehl und kostete
                    // Kontingent.
                    onSetNumberFound = { value ->
                        if (!frozen) {
                            frozen = true
                            treffer()
                            statusText = detectedHintFmt.replace("%1\$s", value)
                            onSetNumberResult(value)
                        }
                    },
                    onStatus   = { if (!frozen) statusText = it },
                    confirmingHint = confirmingHint,
                    aimHint = aimHint,
                    errorHint = errorHint,
                    onCamera   = { cameraCtrl = it }
                )

                // Rahmen, Schild und Gewichtung in der gemeinsamen
                // Ueberlagerung — siehe KameraErlaubnis.kt. Eigen bleiben hier
                // das breite Rechteck mit den Eckwinkeln und der Lampenknopf.
                KameraUeberlagerung(
                    hinweis = statusText,
                    unten = {
                        Spacer(Modifier.height(Abstaende.gross))
                        FilledTonalButton(
                            onClick = { torchOn = !torchOn },
                            // Deckende Flächen wie das Schild darüber: Auf hellem Motiv war Weiss
                            // auf durchscheinendem Weiss nicht zu lesen.
                            colors = ButtonDefaults.filledTonalButtonColors(
                                containerColor = if (torchOn) Color.White else Color.Black.copy(alpha = 0.72f),
                                contentColor   = if (torchOn) Color.Black else Color.White
                            )
                        ) {
                            Text(if (torchOn) stringResource(R.string.scanner_torch_off) else stringResource(R.string.scanner_torch_on), style = MaterialTheme.typography.bodyMedium)
                        }
                    },
                ) {
                    // Scanning frame
                    Box(
                        Modifier
                            .fillMaxWidth(0.88f)
                            .aspectRatio(1.8f)
                            .border(2.dp, borderColor, Formen.feld)
                    ) {
                        // Corner accents
                        val accent = borderColor
                        val cs = 20.dp
                        val ct = 3.dp
                        // Top-left
                        Box(Modifier.size(cs, ct).align(Alignment.TopStart).background(accent))
                        Box(Modifier.size(ct, cs).align(Alignment.TopStart).background(accent))
                        // Top-right
                        Box(Modifier.size(cs, ct).align(Alignment.TopEnd).background(accent))
                        Box(Modifier.size(ct, cs).align(Alignment.TopEnd).background(accent))
                        // Bottom-left
                        Box(Modifier.size(cs, ct).align(Alignment.BottomStart).background(accent))
                        Box(Modifier.size(ct, cs).align(Alignment.BottomStart).background(accent))
                        // Bottom-right
                        Box(Modifier.size(cs, ct).align(Alignment.BottomEnd).background(accent))
                        Box(Modifier.size(ct, cs).align(Alignment.BottomEnd).background(accent))
                    }
                }
            }
            else -> {
                KameraErlaubnisHinweis { cameraPermission.anfragen() }
            }
        }
        MitTooltip(stringResource(R.string.scanner_close), Modifier.align(Alignment.TopEnd)) {
            IconButton(onClick = onDismiss, modifier = Modifier.padding(Abstaende.gross)) {
                Icon(Icons.Default.Close, stringResource(R.string.scanner_close), tint = Color.White)
            }
        }
    }
}

/**
 * Kandidaten für eine Setnummer aus erkanntem Text, in absteigender Güte. Auf
 * einer Anleitung stehen viele Zahlen (Alter, Teilezahl, Seite, Jahr, Heft- und
 * Elementnummern); die längste ist selten die Setnummer.
 */

/**
 * Wörter, die eine Zahl als Mengenangabe ausweisen — wortgleich mit MENGENWORT in
 * produkttitel.ts. `(?iu)`, weil IGNORE_CASE ohne `u` nur ASCII kennt.
 */
private val MENGENWORT = Regex(
    "(?iu)^\\s*(?:x\\s*)?(?:pcs?|pieces?|piece|teil(?:e|en)?|stück(?:e|en)?|" +
    "stueck(?:e|en)?|stein(?:e|en)?|bricks?|parts?|element(?:e|en|s)?)\\b"
)

/**
 * Stellenzahlen in absteigender Guete. Unbekannte Laengen landen dahinter.
 * Muss mit `GUETE` in Web-App/utils/produkttitel.ts uebereinstimmen.
 */
internal val GUETE = listOf(5, 4, 6, 7, 3)

/**
 * Drei bis sieben Ziffern, optional mit `#` davor und Variantenzusatz. Oben statt
 * in der Funktion, weil sie alle 700 ms in der Kameraschleife läuft. Wortgleich
 * mit `muster` in produkttitel.ts.
 */
private val SETNUMMER_MUSTER = Regex("(#\\s*)?\\b(\\d{3,7})(-\\d{1,2})?\\b")

private data class SetnummerKandidat(
    val wert: String,
    val mitSuffix: Boolean,
    val mitRaute: Boolean,
    val jahr: Boolean,
    val guete: Int,
)

internal fun setNumberCandidates(text: String): List<String> {
    val jahrGrenze = java.time.Year.now().value + 1
    val gefunden = ArrayList<SetnummerKandidat>()
    for (treffer in SETNUMMER_MUSTER.findAll(text)) {
        val ziffern = treffer.groupValues[2]
        val suffix = treffer.groupValues[3]
        // Regel 1: Was ein Mengenwort hinter sich hat, ist eine Teilezahl.
        val danach = text.substring(treffer.range.last + 1)
        if (MENGENWORT.containsMatchIn(danach)) continue
        val zahl = ziffern.toIntOrNull() ?: continue
        // Mit Variantenzusatz ist es keine Jahreszahl mehr, sondern eine
        // Setnummer in ihrer eindeutigen Schreibweise.
        val jahr = suffix.isEmpty() && ziffern.length == 4 && zahl >= 1949 && zahl <= jahrGrenze
        // Unbekannte Laenge ganz nach hinten statt an den Anfang: indexOf
        // liefert sonst -1 und die Zahl gewaenne alles.
        val guete = GUETE.indexOf(ziffern.length).let { if (it < 0) GUETE.size else it }
        gefunden.add(SetnummerKandidat(ziffern + suffix, suffix.isNotEmpty(),
            treffer.groupValues[1].isNotEmpty(), jahr, guete))
    }
    // sortedWith ist stabil, also bleibt bei Gleichstand die Reihenfolge im Text.
    return gefunden.distinctBy { it.wert }
        .sortedWith(
            compareByDescending<SetnummerKandidat> { it.mitSuffix }
                .thenByDescending { it.mitRaute }
                .thenBy { it.jahr }
                .thenBy { it.guete }
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
    confirmingHint: String,
    aimHint: String,
    errorHint: String
) {
    val lifecycleOwner = LocalLifecycleOwner.current
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
            val previewView = kameraVorschau(ctx)
            tippZumFokus(previewView) { _kameraCtrl.get() }

            // Anbieter holen, Vorschau bauen, binden: KameraAufbau.kt. Hier
            // bleibt nur, was den Scanner betrifft.
            kameraBinden(
                ctx = ctx,
                previewView = previewView,
                lifecycleOwner = lifecycleOwner,
                analyse = imageAnalyzer,
                beiFehler = {
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
