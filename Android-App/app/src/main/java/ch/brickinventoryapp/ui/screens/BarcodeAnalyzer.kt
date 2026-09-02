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
 * Der Bildanalyse-Teil des Barcode-Scanners.
 *
 * ── Warum eigene Datei (Nachtrag 99) ────────────────────────────────────────
 *
 * `CameraPreviewBarcode()` war 289 Zeilen und tat zwei völlig verschiedene
 * Dinge: eine ImageAnalysis-Schleife aufbauen (Barcode-Leser, Texterkennung,
 * Bestätigungszählung, Drosselung) und daneben die Kamera-Vorschau in die
 * Compose-Welt einbetten.
 *
 * Nur das erste ist Bildverarbeitung; das zweite ist Einbettung von
 * Android-Views. Wer an der Erkennung etwas ändert, hat mit PreviewView,
 * Lebenszyklus und Fokus-Gesten nichts zu tun — und umgekehrt.
 *
 * ── Was hier mit hereinkam ──────────────────────────────────────────────────
 * Die Zählerstände (`lastValue`, `confirmCount`), die OCR-Drosselung und die
 * beiden ML-Kit-Clients wurden im Bildschirm gehalten, aber AUSSCHLIESSLICH in
 * dieser Schleife benutzt. Sie gehören hierher; das Aufräumen (DisposableEffect)
 * ebenfalls, denn es räumt genau diese Objekte weg.
 *
 * Der Rumpf ist wortgleich übernommen, verändert wurde nur die Einrückung.
 */
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
     * Mindestabstand zwischen zwei Texterkennungen (Nachtrag 71).
     *
     * 700 ms ist der Kompromiss aus Marcos Meldung „der Fokus ist sehr träge":
     * klein genug, dass das Lesen einer vorgehaltenen Anleitung sofort wirkt,
     * gross genug, dass der Analyse-Thread zwischendurch frei wird. Der
     * Barcode-Leser läuft weiterhin auf JEDEM Bild.
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
    // Texterkennung neben dem Barcode-Leser (Nachtrag 60). DEFAULT_OPTIONS ist
    // das lateinische Modell — es liegt fest im APK, lädt also nichts nach.
    val textRecognizer = remember { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
    DisposableEffect(Unit) { onDispose { textRecognizer.close() } }


    // remember() hat KEINEN Aufräum-Hook: Ohne dieses DisposableEffect bleiben
    // der Analyse-Thread und der ML-Kit-Client (native Ressourcen) bei jedem
    // Besuch des Scanners liegen. Wer während einer Sortier-Session zwanzigmal
    // scannt, sammelt zwanzig Threads.
    //
    // Betrifft NUR das Aufräumen NACH dem Verlassen des Screens — die Kamera
    // selbst hängt am lifecycleOwner und wird von CameraX entbunden. Der
    // kontinuierliche Autofokus (CONTROL_AF_MODE_CONTINUOUS_PICTURE, unten an
    // beiden Use Cases) ist davon nicht berührt.
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
                    @androidx.camera.core.ExperimentalGetImage
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
                                // Kein Barcode im Bild → Texterkennung versuchen
                                // (Nachtrag 60). Reihenfolge ist Absicht: Der
                                // Barcode ist eindeutig, die gelesene Zahl nur
                                // wahrscheinlich. Auf der Verpackung gewinnt
                                // also weiterhin der Barcode; die Texterkennung
                                // greift dort, wo es keinen gibt — auf der
                                // Anleitung.
                                // ── Texterkennung DROSSELN (Nachtrag 71) ──────
                                //
                                // Marcos Beobachtung: „Der Fokus im Scanner ist
                                // sehr träge." Ursache ist nicht der Autofokus
                                // selbst, sondern die Last daneben: Seit
                                // Nachtrag 60 lief die Texterkennung auf JEDEM
                                // Bild ohne Barcode — bei 1920×1080 kostet das
                                // je Bild ein Vielfaches der Barcode-Suche und
                                // hält den Analyse-Thread dauerhaft belegt. Die
                                // Kamera teilt sich die Rechenzeit mit dieser
                                // Auswertung, also wirken Vorschau UND
                                // Scharfstellen zäh.
                                //
                                // Eine gedruckte Setnummer läuft nicht weg, also
                                // genügt ein Versuch alle 700 ms.
                                val jetzt = System.currentTimeMillis()
                                if (jetzt - letzteOcr.get() < OCR_INTERVALL_MS) {
                                    onStatus(aimHint)
                                    imageProxy.close()
                                    return@addOnSuccessListener
                                }
                                letzteOcr.set(jetzt)

                                if (!ocrEnabled) {
                                    // Texterkennung hier nicht gewünscht
                                    // (Nachtrag 61) — wie vor dem Umbau nur der
                                    // Zielhinweis, und der Bildpuffer muss
                                    // trotzdem freigegeben werden.
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
                    // KEIN addOnCompleteListener mehr (Nachtrag 63).
                    //
                    // Hier lag der Fehler, warum die Texterkennung nie etwas
                    // lieferte: Der Listener hing am BARCODE-Task und feuerte,
                    // sobald DIESER fertig war — also unmittelbar nachdem er
                    // „kein Barcode" gemeldet hatte. Die Texterkennung war da
                    // gerade erst gestartet und arbeitete auf einem Bild, das
                    // in derselben Millisekunde geschlossen wurde. Ergebnis:
                    // still gar nichts, ohne Fehlermeldung.
                    //
                    // Jetzt schliesst JEDER Ausgang den Bildpuffer selbst,
                    // genau einmal: Barcode gefunden, Barcode-Fehler,
                    // Texterkennung aus, Texterkennung fertig.
                }
            }
    }

    return imageAnalyzer
}
