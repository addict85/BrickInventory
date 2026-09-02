package ch.brickinventoryapp.ui.screens

import android.hardware.camera2.CaptureRequest
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy

/**
 * Der Kamera-Aufbau, den beide Scanner teilen.
 *
 * ── Warum das eine eigene Datei ist ─────────────────────────────────────────
 * Der Aufbau der Bildanalyse stand zweimal im Baum — in `BarcodeAnalyzer.kt`
 * und in `SetupScreen.kt` —, zwanzig Zeilen lang und bis auf EINE Zeile
 * zeichengleich, samt des Erklärkommentars zum AF-Modus.
 *
 * Was diese Doppelung gekostet hat, steht nicht im Konjunktiv: Der
 * Tap-to-Focus im SetupScreen fiel nach drei Sekunden zurück, weil die
 * Behebung aus Nachtrag 112 nur in der einen Kopie ankam. Marcos Satz dazu —
 * „man tippt, es wird scharf, und Sekunden später ist es wieder weg" — galt
 * dort noch, lange nachdem er im Barcodescanner behoben war.
 *
 * Zwei Fassungen einer Regel sehen an jeder einzelnen Stelle richtig aus. Sie
 * fallen erst auf, wenn eine geändert wird — dann arbeitet die andere still
 * weiter.
 */

/**
 * Eine Bildanalyse mit den Einstellungen, die für BEIDE Scanner gelten.
 *
 * ── Der AF-Modus muss AUCH hier stehen, nicht nur am Preview ────────────────
 * CameraX führt die Konfigurationen aller gebundenen Use Cases zu EINEM
 * Repeating-Request zusammen. Steht CONTROL_AF_MODE nur am Preview, entscheidet
 * je nach Gerät und CameraX-Fassung die Analyse-Konfiguration mit — und deren
 * Vorgabe ist nicht zwingend CONTINUOUS_PICTURE. Auf solchen Geräten bleibt das
 * Bild unscharf, obwohl der Code richtig aussieht. Das ist die Tücke, und der
 * Scanner ist daran schon mehrfach gescheitert.
 *
 * Beide Use Cases auf denselben Modus zu setzen macht das Ergebnis unabhängig
 * davon, welcher die Führung übernimmt.
 *
 * ── Warum die Auflösung ein Parameter ist ───────────────────────────────────
 * Sie ist der EINZIGE Unterschied zwischen den beiden Aufrufern, und er ist
 * gewollt: Der Setup-Bildschirm liest einen QR-Code mit grossen Modulen, der
 * Barcodescanner kleine EAN-Striche und Setnummern per Texterkennung. Mehr
 * Auflösung kostet je Bild Rechenzeit, die sich Kamera und Vorschau teilen —
 * genau daran hing Marcos träger Fokus in Nachtrag 71.
 *
 * Als Parameter steht der Unterschied da, wo man ihn sieht. Als zweite Kopie
 * stand er da, wo man ihn übersieht.
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
 * Kontinuierlichen Autofokus auf einem Use Case erzwingen.
 *
 * Der frühere einmalige Fokus-Trigger beim Start war geräteabhängig
 * unzuverlässig; CONTINUOUS_PICTURE fokussiert permanent selbstständig nach.
 *
 * Bewusst als eigene Funktion für BEIDE Use Cases: Genau die Frage „steht der
 * Modus auch am anderen?" ist in dieser Reihe mehrfach falsch beantwortet
 * worden. Jetzt ist es dieselbe Zeile.
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
