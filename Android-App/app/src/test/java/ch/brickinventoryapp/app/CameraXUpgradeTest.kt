package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * Safeguarding of the CameraX jump 1.3.4 → 1.6.1.
 *
 * Two things make this update delicate, and this class checks both:
 *  - From 1.4.0 CameraX checks more strictly whether the camera is available.
 *    `future.get()` can throw where 1.3.4 stayed silent.
 *  - 1.6.0 switched the complete camera base to CameraPipe.
 *    Autofocus hangs on `Camera2Interop` and is thus directly affected.
 */
class CameraXUpgradeTest {

    private val screens = listOf(
        "collection/ui/screens/BarcodeScannerScreen.kt",
        "login/ui/screens/SetupScreen.kt",
    )

    private fun code(src: String): String {
        val s = src.replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        return s.lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")
    }

    /** Camera screen including analysis and common setup — see [Sources.cameraSource]. */
    private fun withAnalyse(rel: String): String = Sources.cameraSource(rel)

    @Test
    fun `CameraX is on a 16 KB capable version`() {
        val toml = File("../gradle/libs.versions.toml")
        assert(toml.exists()) { "gradle/libs.versions.toml nicht gefunden" }
        val m = Regex("""camerax\s*=\s*"(\d+)\.(\d+)\.(\d+)"""").find(toml.readText())
        assert(m != null) { "camerax-Version nicht in libs.versions.toml gefunden" }
        val (major, minor) = m!!.groupValues.let { it[1].toInt() to it[2].toInt() }
        assert(major > 1 || minor >= 4) {
            "CameraX $major.$minor liegt unter 1.4. Erst ab 1.4.0 ist " +
                "libimage_processing_util_jni.so auf 16-KB-Speicherseiten ausgerichtet."
        }
    }

    /**
     * `future.get()` must be inside the try, not before it. Under 1.4.0+ the call
     * delivers an exception when the camera is busy or defective — uncaught
     * the app crashes instead of merely showing no image.
     */
    @Test
    fun `the camera provider is fetched safely`() {
        for (rel in screens) {
            val src = code(withAnalyse(rel))
            val idx = src.indexOf("val provider = future.get()")
            assert(idx >= 0) { "$rel: future.get() nicht gefunden — Test veraltet?" }
            assert(src.substring(0, idx).trimEnd().endsWith("try {")) {
                "$rel: future.get() steht nicht direkt in einem try-Block. Seit " +
                    "CameraX 1.4.0 wirft der Aufruf, wenn die Kamera nicht verfügbar " +
                    "ist (andere App, Hardware-Fehler) — unter 1.3.4 gab es diese " +
                    "Prüfung noch nicht, deshalb fällt es beim Sprung erst auf."
            }
        }
    }

    // A second version of the autofocus rule used to be here: counting
    // CONTROL_AF_MODE_CONTINUOUS_PICTURE per screen file plus the search for
    // a timed focus trigger. Both now live in
    // CameraFocusConfigTest, structurally instead of counting: the AF mode
    // has had exactly ONE place since CameraSetup.kt, and every preview gets it
    // there.
    //
    // The duplication stood out when the camera setup was merged
    // and this check turned red — not because the rule was violated,
    // but because it measured copies that no longer exist.

    /**
     * The analysis runs on YUV. If that is switched to RGBA, CameraX falls back
     * on libimage_processing_util_jni.so — the same native library
     * the 16 KB topic is about.
     */
    @Test
    fun `image analysis stays on YUV`() {
        val src = code(withAnalyse("collection/ui/screens/BarcodeScannerScreen.kt"))
        assert(src.contains("OUTPUT_IMAGE_FORMAT_YUV_420_888")) {
            "Die ImageAnalysis läuft nicht mehr auf YUV_420_888. ML Kit bekommt das " +
                "mediaImage bisher direkt; bei RGBA würde CameraX zusätzlich seine " +
                "native Umwandlung laden und Rechenzeit je Bild kosten."
        }
    }
}
