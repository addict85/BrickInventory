package ch.brickinventoryapp.ui.screens

import android.hardware.camera2.CaptureRequest
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import android.content.Context
import androidx.camera.core.Camera
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
 *
 * Der AF-Modus steht auch hier, nicht nur am Preview: CameraX führt alle
 * gebundenen Use Cases zu einem Repeating-Request zusammen, und je nach Gerät
 * entscheidet die Analyse-Konfiguration mit — deren Vorgabe ist nicht zwingend
 * CONTINUOUS_PICTURE. Derselbe Modus an beiden macht das Ergebnis unabhängig
 * davon, welcher führt.
 *
 * Die Auflösung ist der einzige gewollte Unterschied: Der Setup liest einen
 * QR-Code mit grossen Modulen, der Barcodescanner kleine EAN-Striche und
 * Setnummern. Mehr Auflösung kostet je Bild Rechenzeit, die sich Kamera und
 * Vorschau teilen.
 *
 * @param breite Bildbreite in Pixeln, z. B. 1920
 * @param hoehe  Bildhöhe in Pixeln, z. B. 1080
 */
internal fun bildAnalyse(breite: Int, hoehe: Int): ImageAnalysis =
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
internal fun autofokusDauerhaft(bauer: ImageAnalysis.Builder) {
    Camera2Interop.Extender(bauer).setCaptureRequestOption(
        CaptureRequest.CONTROL_AF_MODE,
        CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
    )
}

/** Dasselbe für die Vorschau — siehe [autofokusDauerhaft]. */
@androidx.annotation.OptIn(ExperimentalCamera2Interop::class)
internal fun autofokusDauerhaft(bauer: Preview.Builder) {
    Camera2Interop.Extender(bauer).setCaptureRequestOption(
        CaptureRequest.CONTROL_AF_MODE,
        CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
    )
}

/**
 * Vorschau und Bildanalyse an den Lebenszyklus binden — für beide Scanner. Zwei
 * Regeln stecken darin:
 *
 * 1. Das `try` umschliesst den gesamten Rückruf. `future.get()` kann werfen, seit
 * CameraX 1.4.0 prüft, ob die Kamera verfügbar ist (etwa weil eine andere App sie
 * belegt). Ohne die Absicherung stürzt die App ab, statt nur kein Bild zu zeigen.
 *
 * 2. `unbindAll()` vor dem Binden. Sonst bleibt eine frühere Bindung an derselben
 * Kamera hängen.
 *
 * @param analyse die Bildanalyse aus [bildAnalyse]
 * @param beiFehler wird gerufen, wenn die Kamera nicht verfügbar ist. Der Scanner
 *         meldet das; der SetupScreen lässt die Vorschau bewusst leer — deshalb
 *         ein Rückruf und keine feste Behandlung hier.
 * @param beiKamera bekommt die gebundene Kamera. Hier hängen die Aufrufer an, was
 *         nur sie betrifft.
 */
internal fun kameraBinden(
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
