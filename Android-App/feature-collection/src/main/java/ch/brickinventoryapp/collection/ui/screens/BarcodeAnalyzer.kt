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

/** The scanner's status lines, in the app's language. */
internal class ScanHints(val confirming: String, val aim: String, val error: String)

/** What the scanner reports: a barcode, a set number read as text, or a status line. */
internal class ScanCallbacks(
    val onBarcodeFound: (String) -> Unit,
    /** SET NUMBER read via text recognition — needs NO EAN resolution. */
    val onSetNumberFound: (String) -> Unit,
    val onStatus: (String) -> Unit,
)

/**
 * The scanner's decisions per frame, without camera and ML Kit: a value counts once it was read
 * [CONFIRM_NEEDED] times in a row; text recognition runs only on frames without a barcode and at
 * most every [OCR_INTERVAL_MS], so the analysis thread gets free in between and focus doesn't
 * feel sluggish. The barcode reader runs on every frame regardless.
 */
internal class ScanDecider(private val ocrEnabled: Boolean, private val now: () -> Long = System::currentTimeMillis) {
    /** What to do with a frame. */
    sealed interface Step {
        data class Found(val value: String) : Step
        data class Status(val confirming: Boolean) : Step
        /** No barcode: hand the frame to text recognition. */
        data object ReadText : Step
    }

    private var lastValue = ""
    private var confirmCount = 0
    private var lastOcr = 0L

    /** The barcode reader's result for a frame, null without a barcode. */
    fun onBarcode(value: String?): Step {
        if (value != null) return confirm(value)
        // No barcode in the frame → text recognition. The order is deliberate: the barcode is
        // unambiguous, the read number only probable — on the box the barcode wins, text
        // recognition applies on the instructions.
        val time = now()
        if (time - lastOcr < OCR_INTERVAL_MS) return Step.Status(confirming = false)
        lastOcr = time
        return if (ocrEnabled) Step.ReadText else Step.Status(confirming = false)
    }

    /** Text recognition's best set number for a frame, null without one. */
    fun onText(candidate: String?): Step =
        // The same multi-confirmation as for the barcode: a single misread shouldn't
        // immediately trigger a dialog.
        if (candidate != null) confirm(candidate) else Step.Status(confirming = false)

    private fun confirm(value: String): Step {
        if (value == lastValue) confirmCount++ else { lastValue = value; confirmCount = 1 }
        return if (confirmCount >= CONFIRM_NEEDED) Step.Found(value) else Step.Status(confirming = true)
    }

    companion object {
        const val CONFIRM_NEEDED = 2

        /**
         * Minimum gap between two text recognitions: small enough that a held-up instruction
         * booklet is read right away, large enough that the analysis thread gets free in between.
         */
        const val OCR_INTERVAL_MS = 700L
    }
}

/**
 * The image-analysis part of the barcode scanner: barcode reader, text recognition,
 * confirmation counting and throttling ([ScanDecider]). Separate from embedding the camera preview,
 * because whoever works on recognition has nothing to do with PreviewView, lifecycle and focus gestures.
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
    callbacks: ScanCallbacks,
    hints: ScanHints,
): ImageAnalysis {
    val executor       = remember { Executors.newSingleThreadExecutor() }
    val decider = remember { ScanDecider(ocrEnabled) }

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
    val report: (ScanDecider.Step, Boolean) -> Unit = { step, asText ->
        when (step) {
            is ScanDecider.Step.Found -> if (asText) callbacks.onSetNumberFound(step.value) else callbacks.onBarcodeFound(step.value)
            is ScanDecider.Step.Status -> callbacks.onStatus(if (step.confirming) hints.confirming else hints.aim)
            ScanDecider.Step.ReadText -> Unit
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
                            val step = decider.onBarcode(barcodes.firstOrNull { it.rawValue != null }?.rawValue)
                            if (step != ScanDecider.Step.ReadText) {
                                report(step, false)
                                imageProxy.close()
                                return@addOnSuccessListener
                            }
                            textRecognizer.process(image)
                                .addOnSuccessListener { result ->
                                    report(decider.onText(setNumberCandidates(result.text).firstOrNull()), true)
                                }
                                .addOnFailureListener { callbacks.onStatus(hints.aim) }
                                .addOnCompleteListener { imageProxy.close() }
                        }
                        .addOnFailureListener { callbacks.onStatus(hints.error); imageProxy.close() }
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
