package ch.brickinventoryapp

import org.junit.Test

/**
 * Absicherung der Aufräumrunde: Kamera-Ressourcen, PDF-Cache-Budget,
 * Bild-Cache beim Abmelden, feste Debug-Version und die Zusammenführung
 * der beiden CSV-Statuspfade.
 */
class ResourceAndCacheTest {

    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    private fun code(src: String): String {
        val s = src.replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        return s.lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")
    }

    // ── Kamera-Ressourcen ────────────────────────────────────────────────────

    @Test
    fun `beide Kamera-Screens geben Executor und ML-Kit-Client frei`() {
        for ((rel, close) in listOf(
            "ui/screens/BarcodeScannerScreen.kt" to "barcodeScanner.close()",
            "ui/screens/SetupScreen.kt" to "scanner.close()",
        )) {
            val src = code(read(rel))
            assert(src.contains("DisposableEffect(Unit)") && src.contains("onDispose")) {
                "$rel räumt nicht auf. remember() hat KEINEN Aufräum-Hook: Analyse-Thread " +
                    "und ML-Kit-Client (native Ressourcen) überleben sonst jeden Besuch " +
                    "des Screens — zwanzig Scans in einer Sortier-Session = zwanzig Threads."
            }
            assert(src.contains(close)) { "$rel schliesst den ML-Kit-Client nicht" }
            assert(src.contains("executor.shutdown()")) { "$rel beendet den Executor nicht" }
        }
    }

    /**
     * Der Autofokus darf durch das Aufräumen nicht angefasst werden — die
     * Regel steht in INVARIANTEN.md und wurde schon mehrfach unbeabsichtigt
     * gebrochen. Hier für BEIDE Kamera-Screens geprüft.
     */
    @Test
    fun `der kontinuierliche Autofokus bleibt in beiden Kamera-Screens intakt`() {
        for (rel in listOf(
            "ui/screens/BarcodeScannerScreen.kt",
            "ui/screens/SetupScreen.kt",
        )) {
            val src = code(read(rel))
            val hits = Regex("CONTROL_AF_MODE_CONTINUOUS_PICTURE").findAll(src).count()
            assert(hits >= 2) {
                "$rel: CONTROL_AF_MODE_CONTINUOUS_PICTURE steht nur ${hits}x — der Modus " +
                    "muss an Preview UND ImageAnalysis hängen, sonst entscheidet je nach " +
                    "Gerät die andere Konfiguration mit."
            }
            assert(!Regex("""(while\s*\(|delay\s*\(|Timer\(|fixedRate)[\s\S]{0,200}?startFocusAndMetering""")
                .containsMatchIn(src)) {
                "$rel: startFocusAndMetering hinter Schleife/Timer (\"Fokus-Pump\") — " +
                    "der Fokus wandert dann dauernd"
            }
        }
    }

    // ── PDF-Cache ────────────────────────────────────────────────────────────

    @Test
    fun `der PDF-Ansichts-Cache hat eine Obergrenze`() {
        val src = code(read("ui/screens/PdfViewerScreen.kt"))
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

    // ── Abmelden ─────────────────────────────────────────────────────────────

    @Test
    fun `beim Abmelden werden API- UND Bild-Cache geleert`() {
        val src = code(read("ui/SessionFeature.kt"))
        assert(src.contains("repo.clearCache()")) { "API-Cache wird nicht geleert" }
        assert(src.contains("imageLoader.diskCache?.clear()")) {
            "Der Coil-Disk-Cache bleibt beim Abmelden liegen — inkonsistent zur " +
                "Begründung, mit der repo.clearCache() eingeführt wurde"
        }
        val mem = src.indexOf("memoryCache?.clear()")
        val disk = src.indexOf("diskCache?.clear()")
        assert(mem in 0 until disk) {
            "Memory-Cache muss VOR dem Disk-Cache geleert werden — sonst schreibt Coil " +
                "beim nächsten Speicher-Treffer sofort wieder auf die Platte"
        }
    }

    // ── Debug-Version ────────────────────────────────────────────────────────

    @Test
    fun `Debug-Builds haben eine feste Version`() {
        val bg = java.io.File("build.gradle.kts")
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

    // ── CSV-Status: ein Pfad ─────────────────────────────────────────────────

    @Test
    fun `der CSV-Service teilt sich den SSE-Client mit dem ViewModel`() {
        val src = code(read("service/CsvImportService.kt"))
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
    fun `eine erste idle-Antwort beendet den Service nicht sofort`() {
        val src = code(read("service/CsvImportService.kt"))
        assert(src.contains("sawRunning") && src.contains("GRACE_MS")) {
            "Kein Anlaufschutz in applyStatus(). Der Service startet im selben Moment " +
                "wie der Upload; bis der Import-Job angelegt ist, meldet der Server " +
                "\"idle\". Ohne Anlauffenster beendet die erste idle-Antwort den Service, " +
                "und der Nutzer sieht nie einen Fortschritt."
        }
    }
}
