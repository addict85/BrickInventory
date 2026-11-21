package ch.brickinventoryapp.app

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * The scanner must not slow down the camera.
 */
class ScannerPerformanceTest {

    // Both files of the scanner: the screen carries the tap-to-focus, the
    // throttling of text recognition stands in BarcodeAnalyzer.kt.
    // The order checks below stay valid — barcodeScanner.process(),
    // letzteOcr and textRecognizer.process() stand exclusively in the
    // analysis file, prepending does not change their order relative to each other.
    private val src: String by lazy {
        val w = "collection/ui/screens/"
        File(Quellen.root, w + "BarcodeScannerScreen.kt").readText() + "\n" +
            File(Quellen.root, w + "BarcodeAnalyzer.kt").readText()
    }
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `text recognition is throttled, the barcode reader is not`() {
        val c = code(src)
        assert(c.contains("OCR_INTERVALL_MS")) {
            "Ohne Drosselung läuft die Texterkennung auf jedem Bild und blockiert den " +
                "Analyse-Thread — Vorschau und Autofokus werden dadurch träge"
        }
        val throttle = c.indexOf("letzteOcr.get() < OCR_INTERVALL_MS")
        val ocr = c.indexOf("textRecognizer.process(")
        assert(throttle in 1 until ocr) {
            "Die Zeitschranke muss VOR dem Aufruf der Texterkennung greifen"
        }
        // The barcode reader must NOT be throttled — it is cheap and should
        // trigger immediately.
        val barcode = c.indexOf("barcodeScanner.process(")
        assert(barcode in 1 until throttle) {
            "Der Barcode-Leser wurde mitgedrosselt — er soll auf jedem Bild laufen"
        }
    }

    @Test
    fun `tapping focuses`() {
        val c = code(src)
        assert(c.contains("tippZumFokus(")) {
            "Ohne Tippen zum Scharfstellen bleibt nur der kontinuierliche Autofokus, " +
                "der bei nahen Vorlagen lange braucht"
        }
        // That the tapper also HOLDS the focus (disableAutoCancel) stood here
        // as a fifth copy of the same rule. It now stands completely in
        // CameraFocusConfigTest, there for EVERY file with tap-to-focus instead of for
        // an enumerated selection — exactly that is what the SetupScreen
        // slipped past. What remains here is what belongs to this file's topic: that
        // tapping exists at all.
        assert(c.contains("_kameraCtrl.set(")) {
            "Die Kamerasteuerung wird dem Listener nie übergeben — Tippen bliebe wirkungslos"
        }
    }
}
