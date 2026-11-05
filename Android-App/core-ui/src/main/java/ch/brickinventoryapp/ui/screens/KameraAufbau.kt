package ch.brickinventoryapp.ui.screens

import android.hardware.camera2.CaptureRequest
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import android.content.Context
import android.view.MotionEvent
import android.view.ViewGroup
import androidx.camera.core.Camera
import androidx.camera.core.CameraControl
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy

/**
 * Der Kamera-Aufbau, den beide Scanner teilen (Barcodescanner und SetupScreen).
 * Eine Datei, weil zwei Fassungen einer Regel an jeder Stelle richtig aussehen und
 * erst auffallen, wenn eine geändert wird — dann arbeitet die andere still weiter.
 */

/**
 * Eine Bildanalyse mit den Einstellungen, die für beide Scanner gelten.
 * Ausführlich: docs/begruendungen/core-ui/ui/screens/KameraAufbau.kt.md#bildanalyse
 */
fun bildAnalyse(breite: Int, hoehe: Int): ImageAnalysis =
    ImageAnalysis.Builder()
        .also { autofokusDauerhaft(it) }
        .setResolutionSelector(
            ResolutionSelector.Builder()
                .setResolutionStrategy(
                    ResolutionStrategy(
                        android.util.Size(breite, hoehe),
                        ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                    )
                ).build()
        )
        // Nur das neueste Bild: Ein Rückstau wäre hier Verzögerung, kein Gewinn —
        // ein Barcode von vor zwei Sekunden interessiert niemanden mehr.
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        // YUV, weil ML Kit damit direkt arbeitet; RGBA wäre eine Umwandlung je Bild.
        .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
        .build()

/**
 * Kontinuierlichen Autofokus auf einem Use Case erzwingen. Ein einmaliger
 * Fokus-Trigger beim Start ist geräteabhängig unzuverlässig; CONTINUOUS_PICTURE
 * fokussiert selbst nach. Eine Funktion für beide Use Cases, damit der Modus an
 * beiden dieselbe Zeile ist.
 */
@androidx.annotation.OptIn(ExperimentalCamera2Interop::class)
fun autofokusDauerhaft(bauer: ImageAnalysis.Builder) {
    Camera2Interop.Extender(bauer).setCaptureRequestOption(
        CaptureRequest.CONTROL_AF_MODE,
        CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
    )
}

/** Dasselbe für die Vorschau — siehe [autofokusDauerhaft]. */
@androidx.annotation.OptIn(ExperimentalCamera2Interop::class)
fun autofokusDauerhaft(bauer: Preview.Builder) {
    Camera2Interop.Extender(bauer).setCaptureRequestOption(
        CaptureRequest.CONTROL_AF_MODE,
        CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
    )
}

/**
 * Vorschau und Bildanalyse an den Lebenszyklus binden — für beide Scanner. Zwei
 * Regeln stecken darin:
 * Ausführlich: docs/begruendungen/core-ui/ui/screens/KameraAufbau.kt.md#kamerabinden
 */
fun kameraBinden(
    ctx: Context,
    previewView: PreviewView,
    lifecycleOwner: LifecycleOwner,
    analyse: ImageAnalysis,
    beiFehler: () -> Unit = {},
    beiKamera: (Camera) -> Unit,
) {
    val future = ProcessCameraProvider.getInstance(ctx)
    future.addListener({
        // Siehe Regel 1 oben: Das try umschliesst den GESAMTEN Rueckruf.
        try {
            val provider = future.get()
            val previewBuilder = Preview.Builder()
            autofokusDauerhaft(previewBuilder)
            val preview = previewBuilder.build()
                .also { it.setSurfaceProvider(previewView.surfaceProvider) }
            try {
                provider.unbindAll()
                beiKamera(
                    provider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analyse
                    )
                )
            } catch (_: Exception) {
                // Bewusst still: Das Binden scheitert praktisch nur, wenn der Lebenszyklus schon
                // beendet ist — dann gibt es niemanden mehr, dem man etwas melden könnte.
                // beiFehler() gehört an den äusseren Fall, wo die Kamera gar nicht erst verfügbar
                // ist.
            }
        } catch (_: Exception) {
            // Kamera nicht verfuegbar (belegt, Hardware-Fehler). Was daraus
            // folgt, entscheidet der Aufrufer: Der Scanner zeigt einen Hinweis
            // statt eines schwarzen Bildes, der SetupScreen laesst die Vorschau
            // bewusst leer.
            beiFehler()
        }
    }, ContextCompat.getMainExecutor(ctx))
}

/** Die Vorschau beider Scanner: füllt die Fläche und rechnet schnell statt kompatibel. */
fun kameraVorschau(ctx: Context): PreviewView = PreviewView(ctx).apply {
    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    scaleType = PreviewView.ScaleType.FILL_CENTER
    implementationMode = PreviewView.ImplementationMode.PERFORMANCE
}

/**
 * Tippen stellt an dieser Stelle scharf und misst dort die Belichtung: Bei einer
 * Anleitung dicht vor der Linse liegt der Dauer-Autofokus gern daneben. disableAutoCancel(),
 * sonst fiele die Kamera nach Sekunden auf ihre eigene Wahl zurück. [steuerung] ist null,
 * solange die Kamera nicht gebunden ist.
 */
fun tippZumFokus(previewView: PreviewView, steuerung: () -> CameraControl?) {
    previewView.setOnTouchListener { v, ev ->
        if (ev.action == MotionEvent.ACTION_UP) {
            val punkt = previewView.meteringPointFactory.createPoint(ev.x, ev.y)
            val aktion = FocusMeteringAction.Builder(punkt, FocusMeteringAction.FLAG_AF)
                .addPoint(punkt, FocusMeteringAction.FLAG_AE)
                .disableAutoCancel()
                .build()
            // Kamera noch nicht bereit oder schon weg: Der Tipp bleibt ohne Wirkung.
            runCatching { steuerung()?.startFocusAndMetering(aktion) }
            v.performClick()
        }
        true
    }
}
