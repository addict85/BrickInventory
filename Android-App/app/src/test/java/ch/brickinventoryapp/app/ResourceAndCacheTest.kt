package ch.brickinventoryapp.app

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Sources

/**
 * Construction rules that without a device only stand in the source: camera resources, PDF cache budget,
 * fixed debug version and one CSV status path. That sign-out empties all caches is checked by
 * LogoutCleansEverythingTest, executed.
 */
class ResourceAndCacheTest {

    private fun read(rel: String): String {
        val f = File(Sources.root, "$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    private fun code(src: String): String {
        val s = src.replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        return s.lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")
    }

    /** Camera screen including analysis and common setup — see [Sources.cameraSource]. */
    private fun withAnalyse(rel: String): String = Sources.cameraSource(rel)

    // ── Kamera-Ressourcen ────────────────────────────────────────────────────

    @Test
    fun `both camera screens release executor and ML Kit client`() {
        for ((rel, close) in listOf(
            "collection/ui/screens/BarcodeScannerScreen.kt" to "barcodeScanner.close()",
            "login/ui/screens/SetupScreen.kt" to "scanner.close()",
        )) {
            val src = code(withAnalyse(rel))
            assert(src.contains("DisposableEffect(Unit)") && src.contains("onDispose")) {
                "$rel räumt nicht auf. remember() hat KEINEN Aufräum-Hook: Analyse-Thread " +
                    "und ML-Kit-Client (native Ressourcen) überleben sonst jeden Besuch " +
                    "des Screens — zwanzig Scans in einer Sortier-Session = zwanzig Threads."
            }
            assert(src.contains(close)) { "$rel schliesst den ML-Kit-Client nicht" }
            assert(src.contains("executor.shutdown()")) { "$rel beendet den Executor nicht" }
        }
    }

    // The autofocus rule stood here a third time. It does not belong to the
    // topic of this file (cleaning up resources) and now stands
    // completely in CameraFocusConfigTest.

    // ── PDF-Cache ────────────────────────────────────────────────────────────

    @Test
    fun `the PDF view cache has an upper limit`() {
        val src = code(read("data/InstructionRepository.kt"))
        assert(src.contains("private fun prunePdfCache")) {
            "Kein Aufräumen des PDF-Caches. Angesehene Anleitungen bleiben absichtlich " +
                "liegen (Resume, erneutes Öffnen ohne Neudownload) — bei bis zu 300 MB " +
                "pro Datei braucht das aber eine Obergrenze."
        }
        assert(src.contains("PDF_CACHE_BUDGET_BYTES")) { "Kein Budget definiert" }
        assert(src.contains("prunePdfCache(ctx.cacheDir")) {
            "prunePdfCache() wird vor dem Download nicht aufgerufen"
        }
        assert(src.contains("keep.absolutePath")) {
            "Die gerade angeforderte Datei ist nicht vom Löschen ausgenommen — ihr " +
                "Teil-Download ginge verloren und der Resume-Mechanismus liefe ins Leere"
        }
    }

    // ── Debug-Version ────────────────────────────────────────────────────────

    @Test
    fun `debug builds have a fixed version`() {
        val bg = File("build.gradle.kts")
        assert(bg.exists()) { "app/build.gradle.kts nicht gefunden" }
        val src = code(bg.readText())
        assert(src.contains("withBuildType(\"debug\")")) {
            "Debug-Builds erben weiter die zeitbasierte Version aus LocalDateTime.now() — " +
                "die Manifest-Tasks sind damit bei jedem Build \"out of date\", auch ohne " +
                "Änderung. buildTypes { debug { … } } genügt nicht: dort liesse sich nur " +
                "ein versionNameSuffix setzen, der Name selbst wechselte weiter minütlich."
        }
        assert(src.contains("versionCode.set(1)") && src.contains("versionName.set(")) {
            "Die Variant-Überschreibung setzt nicht beide Felder"
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
            "versionCode/-Name kommen nicht aus Git"
        }
        assert(!src.contains("LocalDateTime.now()")) { "Die Version hängt wieder an der Bauzeit" }
        val build = Sources.workflow().substringAfter("  build:").substringBefore("  release:")
        assert(Regex("""actions/checkout@\S+.*\n\s+with:\n\s+fetch-depth: 0""").containsMatchIn(build)) {
            "Der Bau-Job klont flach: Jeder Bau wäre Commit Nummer 1"
        }
    }

    // ── CSV status: one path ─────────────────────────────────────────────────

    @Test
    fun `the CSV service shares the SSE client with the ViewModel`() {
        val src = code(read("services/service/CsvImportService.kt"))
        assert(src.contains("sseClient")) {
            "CsvImportService pollt wieder eigenständig, statt den CsvImportSseClient " +
                "zu benutzen — zwei getrennte Implementierungen desselben Sachverhalts"
        }
        val applyCount = Regex("""private fun applyStatus""").findAll(src).count()
        assert(applyCount == 1) {
            "Die Statuslogik steht nicht mehr an genau einer Stelle ($applyCount Treffer)"
        }
        assert(src.contains("pollOnce()")) {
            "Die Polling-Rückfallebene fehlt — bei SSE-Ausfall gäbe es keinen Fortschritt mehr"
        }
    }

    @Test
    fun `a first idle response does not end the service immediately`() {
        val src = code(read("services/service/CsvImportService.kt"))
        assert(src.contains("sawRunning") && src.contains("GRACE_MS")) {
            "Kein Anlaufschutz in applyStatus(). Der Service startet im selben Moment " +
                "wie der Upload; bis der Import-Job angelegt ist, meldet der Server " +
                "\"idle\". Ohne Anlauffenster beendet die erste idle-Antwort den Service, " +
                "und der Nutzer sieht nie einen Fortschritt."
        }
    }
}
