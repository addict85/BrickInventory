package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * Safeguarding of the 16 KB memory page compatibility.
 *
 * Four native libraries lay in the APK, all with 4 KB alignment:
 *
 * Each of these decisions can be undone with a single line in
 * libs.versions.toml without it standing out —
 * hence this test.
 */
class SixteenKbAlignmentTest {

    private val toml: String by lazy {
        val f = File("../gradle/libs.versions.toml")
        assert(f.exists()) { "gradle/libs.versions.toml nicht gefunden" }
        f.readText()
    }

    private val gradle: String by lazy {
        val f = File("build.gradle.kts")
        assert(f.exists()) { "app/build.gradle.kts nicht gefunden" }
        f.readText().lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")
    }

    private val manifest: String by lazy {
        val f = Sources.manifest
        assert(f.exists()) { "AndroidManifest.xml nicht gefunden" }
        f.readText().replace(Regex("""<!--.*?-->""", RegexOption.DOT_MATCHES_ALL), "")
    }

    @Test
    fun `CameraX is at least 1_4`() {
        val m = Regex("""camerax\s*=\s*"(\d+)\.(\d+)\.""").find(toml)
        assert(m != null) { "camerax-Version nicht gefunden" }
        val major = m!!.groupValues[1].toInt()
        val minor = m.groupValues[2].toInt()
        assert(major > 1 || minor >= 4) {
            "CameraX $major.$minor: erst ab 1.4.0 ist libimage_processing_util_jni.so " +
                "auf 16 KB ausgerichtet."
        }
    }

    @Test
    fun `ML Kit runs unbundled via Play services`() {
        assert(toml.contains("play-services-mlkit-barcode-scanning")) {
            "Das gebündelte ML Kit (com.google.mlkit:barcode-scanning) ist zurück. " +
                "Dessen libbarhopper_v3.so war auch in 17.3.0 noch 4-KB-ausgerichtet — " +
                "die einzige verlässliche Lösung ist das unbundled Paket, bei dem das " +
                "Modell in den Play-Diensten liegt und gar nicht erst ins APK kommt."
        }
        assert(!Regex("""name\s*=\s*"barcode-scanning"""").containsMatchIn(toml)) {
            "Es ist noch ein gebündeltes barcode-scanning-Artefakt deklariert"
        }
    }

    /**
     * Without this entry the model loads only on the first scan — then the
     * first scan does not work without network.
     */
    @Test
    fun `the barcode module is requested on installation`() {
        assert(manifest.contains("com.google.mlkit.vision.DEPENDENCIES")) {
            "meta-data com.google.mlkit.vision.DEPENDENCIES fehlt im Manifest"
        }
        assert(Regex("""android:value\s*=\s*"barcode"""").containsMatchIn(manifest)) {
            "Der DEPENDENCIES-Eintrag fordert nicht das barcode-Modul an"
        }
    }

    @Test
    fun `DataStore is pinned to ONE version`() {
        // ── What this check NO longer does ──────────────────────────────────
        //
        // Here stood `== "1.1.7"`: a specific NUMBER, because 1.2.0 had lost the
        // 16 KB alignment. That had two gaps, and both
        // are fundamental:
        //
        //   1. It checks the number, not the alignment. If Google aligns
        //      a later version again, the bolt stays closed
        //      anyway. If ANOTHER library falls back, nobody notices.
        //
        // This is now measured on the RESULT: `tools/apk-alignment.py` reads
        // the ELF headers of all .so in the built APK and reports every alignment
        // below 16 KB. The action calls it after the release build.
        //
        // What REMAINS here is what a text test can do and that measurement
        // cannot: that the version is PINNED at all. Without the
        // force block another dependency would pull the version up transitively,
        // and the APK would next time be different from the checked one.
        assert(Regex("""datastore\s*=\s*"([\d.]+)"""").containsMatchIn(toml)) { "datastore-Version nicht gefunden" }
        val block = gradle.substringAfter("resolutionStrategy", "")
        assert("libs.versions.datastore.get()" in gradle && "force(\"androidx.datastore:\$it:\$datastore\")" in block) {
            "DataStore wird nicht auf die Fassung des Katalogs festgenagelt"
        }
        for (artifact in listOf("datastore", "datastore-android", "datastore-core",
                                "datastore-core-android", "datastore-preferences",
                                "datastore-preferences-android")) {
            assert("\"$artifact\"" in block) {
                "androidx.datastore:$artifact wird nicht festgenagelt. Eine " +
                    "transitive Anhebung wuerde ein anderes APK ergeben als das geprüfte."
            }
        }
    }

    /**
     * graphics-path otherwise comes in transitively via Compose. The direct
     * entry raises it to its own, newer version line — without
     * touching the Compose BOM, which would be a broad change across the
     * UI.
     */
    @Test
    fun `graphics-path is set directly`() {
        assert(toml.contains("graphics-path")) {
            "graphics-path wird nicht mehr direkt deklariert — dann zieht Compose " +
                "wieder die transitive 1.0.x-Fassung mit der 4-KB-ausgerichteten " +
                "libandroidx.graphics.path.so herein."
        }
        val m = Regex("""graphicsPath\s*=\s*"(\d+)\.(\d+)\.""").find(toml)
        assert(m != null) { "graphicsPath-Version nicht gefunden" }
        val major = m!!.groupValues[1].toInt()
        val minor = m.groupValues[2].toInt()
        assert(major > 1 || minor >= 1) {
            "graphics-path $major.$minor liegt unter 1.1 — das ist die Fassung, " +
                "mit der die Ausrichtung überhaupt erst eine Chance hat."
        }
    }

    @Test
    fun `native libraries are packaged uncompressed`() {
        assert(gradle.contains("useLegacyPackaging = false")) {
            "useLegacyPackaging steht wieder auf true. Legacy Packaging komprimiert " +
                "die .so-Dateien und entpackt sie bei der Installation — an der " +
                "ELF-Ausrichtung im Bibliothekskörper ändert das nichts. Unkomprimiert " +
                "richtet AGP ab 8.5.1 die Dateien im Archiv auf 16 KB aus."
        }
    }
}
