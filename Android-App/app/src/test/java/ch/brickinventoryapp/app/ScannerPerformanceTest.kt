package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * The scanner must not slow down the camera: tapping focuses.
 */
class ScannerPerformanceTest {

    // Both files of the scanner: the screen carries the tap-to-focus. The throttling of text
    // recognition is checked by running it (ScanDeciderTest in feature-collection).
    private val src: String by lazy {
        val w = "collection/ui/screens/"
        File(Sources.root, w + "BarcodeScannerScreen.kt").readText() + "\n" +
            File(Sources.root, w + "BarcodeAnalyzer.kt").readText()
    }
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `tapping focuses`() {
        val c = code(src)
        assert(c.contains("tapToFocus(")) {
            "Without tap to focus only continuous autofocus remains, " +
                "which takes long for close-up subjects"
        }
        // That the tapper also HOLDS the focus (disableAutoCancel) stood here
        // as a fifth copy of the same rule. It now stands completely in
        // CameraFocusConfigTest, there for EVERY file with tap-to-focus instead of for
        // an enumerated selection — exactly that is what the SetupScreen
        // slipped past. What remains here is what belongs to this file's topic: that
        // tapping exists at all.
        assert(c.contains("_cameraCtrl.set(")) {
            "the camera control is never passed to the listener — tapping would have no effect"
        }
    }
}
