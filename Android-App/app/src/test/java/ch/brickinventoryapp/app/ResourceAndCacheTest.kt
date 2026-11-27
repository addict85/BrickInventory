package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * Construction rules that without a device only stand in the source: camera resources (ML Kit clients
 * cannot be created under Robolectric) and fixed debug version. The single CSV status path
 * (CsvImportWatchTest), the PDF cache budget (InstructionCacheBudgetTest), the CSV worker's startup window (CsvStartupGraceTest) and that
 * sign-out empties all caches (LogoutCleansEverythingTest) are checked executed.
 */
class ResourceAndCacheTest {

    private fun code(src: String): String {
        val s = src.replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        return s.lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")
    }

    /** Camera screen including analysis and common setup — see [Sources.cameraSource]. */
    private fun withAnalyse(rel: String): String = Sources.cameraSource(rel)

    // ── Camera resources ─────────────────────────────────────────────────────

    @Test
    fun `both camera screens release executor and ML Kit client`() {
        for ((rel, close) in listOf(
            "collection/ui/screens/BarcodeScannerScreen.kt" to "barcodeScanner.close()",
            "login/ui/screens/SetupScreen.kt" to "scanner.close()",
        )) {
            val src = code(withAnalyse(rel))
            assert(src.contains("DisposableEffect(Unit)") && src.contains("onDispose")) {
                "$rel does not clean up. remember() has NO cleanup hook: the analysis thread " +
                    "and the ML Kit client (native resources) otherwise survive every visit " +
                    "of the screen — twenty scans in one sorting session = twenty threads."
            }
            assert(src.contains(close)) { "$rel does not close the ML Kit client" }
            assert(src.contains("executor.shutdown()")) { "$rel does not shut down the executor" }
        }
    }

    // The autofocus rule stood here a third time. It does not belong to the
    // topic of this file (cleaning up resources) and now stands
    // completely in CameraFocusConfigTest.

    // ── Debug-Version ────────────────────────────────────────────────────────

    @Test
    fun `debug builds have a fixed version`() {
        val bg = File("build.gradle.kts")
        assert(bg.exists()) { "app/build.gradle.kts not found" }
        val src = code(bg.readText())
        assert(src.contains("withBuildType(\"debug\")")) {
            "Debug builds still inherit the time-based version from LocalDateTime.now() — " +
                "the manifest tasks are therefore \"out of date\" on every build, even without " +
                "a change. buildTypes { debug { … } } is not enough: there only " +
                "a versionNameSuffix could be set, the name itself would keep changing every minute."
        }
        assert(src.contains("versionCode.set(1)") && src.contains("versionName.set(")) {
            "the variant override does not set both fields"
        }
    }

    /**
     * The same commit yields the same version; CI fetches the whole
     * history for that. Counter-check: `fetch-depth: 0` removed from
     * android.yml → red; `LocalDateTime.now()` back → red.
     */
    @Test
    fun `the version comes from Git, not from the clock`() {
        val src = code(File("build.gradle.kts").readText())
        assert(src.contains("git(\"rev-list\", \"--count\", \"HEAD\")") && src.contains("\"describe\", \"--tags\"")) {
            "versionCode/-Name do not come from Git"
        }
        assert(!src.contains("LocalDateTime.now()")) { "the version hangs on the build time again" }
        val build = Sources.workflow().substringAfter("  build:").substringBefore("  release:")
        assert(Regex("""actions/checkout@\S+.*\n\s+with:\n\s+fetch-depth: 0""").containsMatchIn(build)) {
            "the build job clones shallow: every build would be commit number 1"
        }
    }
}
