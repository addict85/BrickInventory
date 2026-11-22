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
        assert(f.exists()) { "gradle/libs.versions.toml not found" }
        f.readText()
    }

    private val gradle: String by lazy {
        val f = File("build.gradle.kts")
        assert(f.exists()) { "app/build.gradle.kts not found" }
        f.readText().lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")
    }

    private val manifest: String by lazy {
        val f = Sources.manifest
        assert(f.exists()) { "AndroidManifest.xml not found" }
        f.readText().replace(Regex("""<!--.*?-->""", RegexOption.DOT_MATCHES_ALL), "")
    }

    @Test
    fun `CameraX is at least 1_4`() {
        val m = Regex("""camerax\s*=\s*"(\d+)\.(\d+)\.""").find(toml)
        assert(m != null) { "camerax version not found" }
        val major = m!!.groupValues[1].toInt()
        val minor = m.groupValues[2].toInt()
        assert(major > 1 || minor >= 4) {
            "CameraX $major.$minor: only from 1.4.0 on is libimage_processing_util_jni.so " +
                "aligned to 16 KB."
        }
    }

    @Test
    fun `ML Kit runs unbundled via Play services`() {
        assert(toml.contains("play-services-mlkit-barcode-scanning")) {
            "The bundled ML Kit (com.google.mlkit:barcode-scanning) is back. " +
                "Its libbarhopper_v3.so was still 4 KB aligned in 17.3.0 — " +
                "the only reliable solution is the unbundled package, where the " +
                "model lives in Play services and never gets into the APK."
        }
        assert(!Regex("""name\s*=\s*"barcode-scanning"""").containsMatchIn(toml)) {
            "a bundled barcode-scanning artifact is still declared"
        }
    }

    /**
     * Without this entry the model loads only on the first scan — then the
     * first scan does not work without network.
     */
    @Test
    fun `the barcode module is requested on installation`() {
        assert(manifest.contains("com.google.mlkit.vision.DEPENDENCIES")) {
            "meta-data com.google.mlkit.vision.DEPENDENCIES is missing in the manifest"
        }
        assert(Regex("""android:value\s*=\s*"barcode"""").containsMatchIn(manifest)) {
            "the DEPENDENCIES entry does not request the barcode module"
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
        assert(Regex("""datastore\s*=\s*"([\d.]+)"""").containsMatchIn(toml)) { "datastore version not found" }
        val block = gradle.substringAfter("resolutionStrategy", "")
        assert("libs.versions.datastore.get()" in gradle && "force(\"androidx.datastore:\$it:\$datastore\")" in block) {
            "DataStore is not pinned to the catalog's version"
        }
        for (artifact in listOf("datastore", "datastore-android", "datastore-core",
                                "datastore-core-android", "datastore-preferences",
                                "datastore-preferences-android")) {
            assert("\"$artifact\"" in block) {
                "androidx.datastore:$artifact is not pinned. A " +
                    "transitive raise would produce a different APK than the checked one."
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
            "graphics-path is no longer declared directly — then Compose pulls " +
                "in the transitive 1.0.x version with the 4 KB aligned " +
                "libandroidx.graphics.path.so herein."
        }
        val m = Regex("""graphicsPath\s*=\s*"(\d+)\.(\d+)\.""").find(toml)
        assert(m != null) { "graphicsPath version not found" }
        val major = m!!.groupValues[1].toInt()
        val minor = m.groupValues[2].toInt()
        assert(major > 1 || minor >= 1) {
            "graphics-path $major.$minor is below 1.1 — that is the version " +
                "with which the alignment even has a chance."
        }
    }

    @Test
    fun `native libraries are packaged uncompressed`() {
        assert(gradle.contains("useLegacyPackaging = false")) {
            "useLegacyPackaging is true again. Legacy packaging compresses " +
                "the .so files and unpacks them on installation — that changes nothing " +
                "about the ELF alignment in the library body. Uncompressed, " +
                "AGP from 8.5.1 aligns the files in the archive to 16 KB."
        }
    }
}
