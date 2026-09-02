package ch.brickinventoryapp

import org.junit.Test

/**
 * Absicherung des CameraX-Sprungs 1.3.4 → 1.6.1.
 *
 * Zwei Dinge macht diese Aktualisierung heikel, und beide prüft diese Klasse:
 *  - Ab 1.4.0 prüft CameraX strenger, ob die Kamera verfügbar ist.
 *    `future.get()` kann werfen, wo 1.3.4 stumm blieb.
 *  - 1.6.0 hat den kompletten Kamera-Unterbau auf CameraPipe umgestellt.
 *    Der Autofokus hängt an `Camera2Interop` und ist damit direkt betroffen.
 */
class CameraXUpgradeTest {

    private val screens = listOf(
        "ui/screens/BarcodeScannerScreen.kt",
        "ui/screens/SetupScreen.kt",
    )

    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    private fun code(src: String): String {
        val s = src.replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        return s.lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")
    }

    /** Kamerabildschirm samt Analyse und gemeinsamem Aufbau — siehe [Quellen.kameraQuelle]. */
    private fun mitAnalyse(rel: String): String = Quellen.kameraQuelle(rel)

    @Test
    fun `CameraX steht auf einer 16-KB-tauglichen Fassung`() {
        val toml = java.io.File("../gradle/libs.versions.toml")
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
     * `future.get()` muss im try stehen, nicht davor. Der Aufruf liefert unter
     * 1.4.0+ eine Ausnahme, wenn die Kamera belegt oder defekt ist — ungefangen
     * stürzt die App ab, statt nur kein Bild zu zeigen.
     */
    @Test
    fun `der Kamera-Provider wird abgesichert geholt`() {
        for (rel in screens) {
            val src = code(mitAnalyse(rel))
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

    // Hier stand eine zweite Fassung der Autofokus-Regel: Zaehlen von
    // CONTROL_AF_MODE_CONTINUOUS_PICTURE je Bildschirmdatei plus die Suche nach
    // einem getakteten Fokus-Trigger. Beides steht jetzt in
    // CameraFocusConfigTest, und zwar strukturell statt zaehlend: Der AF-Modus
    // hat seit KameraAufbau.kt genau EINE Stelle, und jede Vorschau holt ihn
    // dort.
    //
    // Aufgefallen ist die Doppelung, als der Kamera-Aufbau zusammengefasst
    // wurde und diese Pruefung rot wurde — nicht weil die Regel verletzt war,
    // sondern weil sie an Kopien gemessen hat, die es nicht mehr gibt.


    /**
     * Die Analyse läuft auf YUV. Wird das auf RGBA umgestellt, greift CameraX
     * auf libimage_processing_util_jni.so zurück — dieselbe native Bibliothek,
     * um die es beim 16-KB-Thema geht.
     */
    @Test
    fun `die Bildanalyse bleibt auf YUV`() {
        val src = code(mitAnalyse("ui/screens/BarcodeScannerScreen.kt"))
        assert(src.contains("OUTPUT_IMAGE_FORMAT_YUV_420_888")) {
            "Die ImageAnalysis läuft nicht mehr auf YUV_420_888. ML Kit bekommt das " +
                "mediaImage bisher direkt; bei RGBA würde CameraX zusätzlich seine " +
                "native Umwandlung laden und Rechenzeit je Bild kosten."
        }
    }
}
