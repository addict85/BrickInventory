package ch.brickinventoryapp.collection.ui.screens

import androidx.camera.core.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import ch.brickinventoryapp.ui.screens.imageAnalyse
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.concurrent.Executors

/**
 * The image-analysis part of the barcode scanner: barcode reader, text recognition,
 * confirmation counting and throttling. Separate from embedding the camera preview, because
 * whoever works on recognition has nothing to do with PreviewView, lifecycle and focus gestures.
 */
// Opt-in for imageProxy.image: `@androidx.annotation.OptIn` is the form
// for a marker defined in Java — `@ExperimentalGetImage` on the local
// variable would be the annotation, not the opt-in (Lint:
// UnsafeOptInUsageError). The same pattern as in CameraSetup.kt.
@androidx.annotation.OptIn(ExperimentalGetImage::class)
@Composable
internal fun rememberBarcodeAnalyzer(
    frozen: Boolean,
    ocrEnabled: Boolean,
    onBarcodeFound: (String) -> Unit,
    /** SET NUMBER read via text recognition — needs NO EAN resolution. */
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
     * Minimum gap between two text recognitions: small enough that a
     * held-up instruction booklet is read right away, large enough that the analysis thread
     * gets free in between and focus doesn't feel sluggish. The barcode reader keeps
     * running on every frame regardless.
     */
    val OCR_INTERVAL_MS = 700L
    val lastOcr = remember { java.util.concurrent.atomic.AtomicLong(0L) }

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
    // Text recognition next to the barcode reader. DEFAULT_OPTIONS is the Latin
    // model — it's bundled in the APK, so it downloads nothing.
    val textRecognizer = remember { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
    DisposableEffect(Unit) { onDispose { textRecognizer.close() } }

    // remember() has no cleanup hook: without this DisposableEffect, the
    // analysis thread and ML Kit client (native resources) would leak on every visit
    // to the scanner. The camera itself hangs on the lifecycleOwner and is released by CameraX.
    DisposableEffect(Unit) {
        onDispose {
            try { barcodeScanner.close() } catch (_: Exception) { /* already closed on leaving */ }
            executor.shutdown()
        }
    }
    val imageAnalyzer = remember {
        // Setup including AF mode: ui/screens/CameraSetup.kt — the same
        // settings as in SetupScreen, only with more resolution for
        // small EAN bars and text recognition.
        imageAnalyse(1920, 1080)
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
                                // No barcode in the frame → text recognition. The order is
                                // deliberate: the barcode is unambiguous, the read number only
                                // probable — on the box the barcode wins, text
                                // recognition applies on the instructions.
                                val now = System.currentTimeMillis()
                                if (now - lastOcr.get() < OCR_INTERVAL_MS) {
                                    onStatus(aimHint)
                                    imageProxy.close()
                                    return@addOnSuccessListener
                                }
                                lastOcr.set(now)

                                if (!ocrEnabled) {
                                    // Text recognition not wanted here — only the target hint, and
                                    // the image buffer must still be released.
                                    onStatus(aimHint)
                                    imageProxy.close()
                                    return@addOnSuccessListener
                                }
                                textRecognizer.process(image)
                                    .addOnSuccessListener { result ->
                                        val candidate = setNumberCandidates(result.text).firstOrNull()
                                        if (candidate != null) {
                                            // The same multi-confirmation as for the
                                            // barcode: a single misread shouldn't
                                            // immediately trigger a dialog.
                                            if (candidate == lastValue) confirmCount++
                                            else { lastValue = candidate; confirmCount = 1 }
                                            if (confirmCount >= CONFIRM_NEEDED) onSetNumberFound(candidate)
                                            else onStatus(confirmingHint)
                                        } else onStatus(aimHint)
                                    }
                                    .addOnFailureListener { onStatus(aimHint) }
                                    .addOnCompleteListener { imageProxy.close() }
                                return@addOnSuccessListener
                            }
                        }
                        .addOnFailureListener { onStatus(errorHint); imageProxy.close() }
                    // No addOnCompleteListener: on the barcode task it fired as soon as it
                    // reported "no barcode" and closed the frame that text recognition was
                    // only just starting on — silently, with no result. That's why every exit closes the image buffer
                    // itself, exactly once: barcode found, barcode error, text recognition off,
                    // text recognition done.
                }
            }
    }

    return imageAnalyzer
}
