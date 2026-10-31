package ch.brickinventoryapp.ui.screens

import androidx.camera.core.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import com.google.accompanist.permissions.*
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

/**
 * Der Bildanalyse-Teil des Barcode-Scanners: Barcode-Leser, Texterkennung,
 * Bestätigungszählung und Drosselung. Getrennt von der Einbettung der
 * Kamera-Vorschau, weil wer an der Erkennung arbeitet, mit PreviewView,
 * Lebenszyklus und Fokus-Gesten nichts zu tun hat. Zählerstände, Drosselung, die
 * ML-Kit-Clients und ihr Aufräumen liegen hier, weil nur diese Schleife sie
 * benutzt.
 */
// Einverständnis für imageProxy.image: `@androidx.annotation.OptIn` ist die Form
// für einen in Java definierten Marker — `@ExperimentalGetImage` an der lokalen
// Variablen wäre die Markierung, kein Einverständnis (Lint:
// UnsafeOptInUsageError). Dasselbe Muster wie in KameraAufbau.kt.
@androidx.annotation.OptIn(ExperimentalGetImage::class)
@Composable
fun rememberBarcodeAnalyzer(
    frozen: Boolean,
    ocrEnabled: Boolean,
    onBarcodeFound: (String) -> Unit,
    /** Per Texterkennung gelesene SETNUMMER — braucht KEINE EAN-Auflösung. */
    onSetNumberFound: (String) -> Unit,
    onStatus: (String) -> Unit,
    confirmingHint: String,
    aimHint: String,
    errorHint: String,
): ImageAnalysis {
    val executor       = remember { Executors.newSingleThreadExecutor() }

    var lastValue    = remember { "" }
    var confirmCount = remember { 0 }
    val CONFIRM_NEEDED = 2
    /**
     * Mindestabstand zwischen zwei Texterkennungen: klein genug, dass eine
     * vorgehaltene Anleitung sofort gelesen wird, gross genug, dass der Analyse-Thread
     * zwischendurch frei wird und der Fokus nicht träge wirkt. Der Barcode-Leser läuft
     * weiterhin auf jedem Bild.
     */
    val OCR_INTERVALL_MS = 700L
    val letzteOcr = remember { java.util.concurrent.atomic.AtomicLong(0L) }

    val barcodeScanner = remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(
                    Barcode.FORMAT_EAN_13,
                    Barcode.FORMAT_UPC_A
                )
                .build()
        )
    }
    // Texterkennung neben dem Barcode-Leser. DEFAULT_OPTIONS ist das lateinische
    // Modell — es liegt fest im APK, lädt also nichts nach.
    val textRecognizer = remember { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
    DisposableEffect(Unit) { onDispose { textRecognizer.close() } }


    // remember() hat keinen Aufräum-Hook: Ohne dieses DisposableEffect blieben
    // Analyse-Thread und ML-Kit-Client (native Ressourcen) bei jedem Besuch des
    // Scanners liegen. Die Kamera selbst hängt am lifecycleOwner und wird von CameraX
    // entbunden.
    DisposableEffect(Unit) {
        onDispose {
            try { barcodeScanner.close() } catch (_: Exception) {}
            executor.shutdown()
        }
    }
    val imageAnalyzer = remember {
        // Aufbau samt AF-Modus: ui/screens/KameraAufbau.kt — dieselbe
        // Einstellung wie im SetupScreen, nur mit mehr Aufloesung fuer
        // kleine EAN-Striche und die Texterkennung.
        bildAnalyse(1920, 1080)
            .also { analysis ->
                analysis.setAnalyzer(executor) { imageProxy ->
                    if (frozen) { imageProxy.close(); return@setAnalyzer }
                    val mediaImage = imageProxy.image
                    if (mediaImage == null) { imageProxy.close(); return@setAnalyzer }
                    val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                    barcodeScanner.process(image)
                        .addOnSuccessListener { barcodes ->
                            val barcode = barcodes.firstOrNull { it.rawValue != null }
                            if (barcode?.rawValue != null) {
                                val value = barcode.rawValue!!
                                if (value == lastValue) confirmCount++
                                else { lastValue = value; confirmCount = 1 }
                                if (confirmCount >= CONFIRM_NEEDED) onBarcodeFound(value)
                                else onStatus(confirmingHint)
                                imageProxy.close()
                            } else {
                                // Kein Barcode im Bild → Texterkennung. Die Reihenfolge ist
                                // Absicht: Der Barcode ist eindeutig, die gelesene Zahl nur
                                // wahrscheinlich — auf der Verpackung gewinnt der Barcode, die
                                // Texterkennung greift auf der Anleitung.
                                //
                                // Gedrosselt, weil sie bei 1920×1080 je Bild ein Vielfaches der
                                // Barcode-Suche kostet und die Kamera sich die Rechenzeit teilt —
                                // Vorschau und Scharfstellen würden zäh. Eine gedruckte Setnummer
                                // läuft nicht weg.
                                val jetzt = System.currentTimeMillis()
                                if (jetzt - letzteOcr.get() < OCR_INTERVALL_MS) {
                                    onStatus(aimHint)
                                    imageProxy.close()
                                    return@addOnSuccessListener
                                }
                                letzteOcr.set(jetzt)

                                if (!ocrEnabled) {
                                    // Texterkennung hier nicht gewünscht — nur der Zielhinweis, und
                                    // der Bildpuffer muss trotzdem freigegeben werden.
                                    onStatus(aimHint)
                                    imageProxy.close()
                                    return@addOnSuccessListener
                                }
                                textRecognizer.process(image)
                                    .addOnSuccessListener { result ->
                                        val kandidat = setNumberCandidates(result.text).firstOrNull()
                                        if (kandidat != null) {
                                            // Dieselbe Mehrfachbestätigung wie beim
                                            // Barcode: Eine einzelne Fehllesung soll
                                            // nicht sofort einen Dialog auslösen.
                                            if (kandidat == lastValue) confirmCount++
                                            else { lastValue = kandidat; confirmCount = 1 }
                                            if (confirmCount >= CONFIRM_NEEDED) onSetNumberFound(kandidat)
                                            else onStatus(confirmingHint)
                                        } else onStatus(aimHint)
                                    }
                                    .addOnFailureListener { onStatus(aimHint) }
                                    .addOnCompleteListener { imageProxy.close() }
                                return@addOnSuccessListener
                            }
                        }
                        .addOnFailureListener { onStatus(errorHint); imageProxy.close() }
                    // Kein addOnCompleteListener: Am Barcode-Task feuerte er, sobald dieser „kein
                    // Barcode“ meldete, und schloss das Bild, auf dem die Texterkennung gerade erst
                    // anfing — still ohne Ergebnis. Darum schliesst jeder Ausgang den Bildpuffer
                    // selbst, genau einmal: Barcode gefunden, Barcode-Fehler, Texterkennung aus,
                    // Texterkennung fertig.
                }
            }
    }

    return imageAnalyzer
}
