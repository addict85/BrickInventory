package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * Safeguarding of the cleanup round: localized worker notifications,
 * status icon and the parts list without FileProvider. That the PDF download goes via the
 * api client is checked by InstructionDownloadTest, executed.
 *
 * All checks only read source and resource files.
 *
 * Counter-check: in the manifest the FileProvider put next to the
 * PartListsProvider → red “the parts list goes out only via the own
 * provider” (counter-checks/fileprovider-external.patch).
 */
class ServicePolishTest {

    private fun read(rel: String): String {
        // Sources and resources across all modules; the manifest lies in app/.
        val f = when {
            rel.startsWith("java/ch/brickinventoryapp/") -> File(Sources.root, rel.removePrefix("java/ch/brickinventoryapp/"))
            rel.startsWith("res/") -> File(Sources.res, rel.removePrefix("res/"))
            else -> File(Sources.project, "app/src/main/$rel")
        }
        assert(f.exists()) { "File not found: $rel" }
        return f.readText()
    }

    /** Hide comments (Kotlin and XML) — explanatory texts name the patterns themselves. */
    private fun code(src: String): String {
        var s = src.replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        s = s.replace(Regex("""<!--.*?-->""", RegexOption.DOT_MATCHES_ALL), "")
        return s.lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")
    }

    // ── Localized notifications ──────────────────────────────────────────────

    @Test
    fun `worker notifications come from resources, not hard-coded`() {
        for (rel in listOf(
            "java/ch/brickinventoryapp/services/service/CsvImportNotifier.kt",
            "java/ch/brickinventoryapp/services/service/PdfExportNotifier.kt",
            "java/ch/brickinventoryapp/services/service/PdfExportWorker.kt",
            "java/ch/brickinventoryapp/services/service/PdfExportManager.kt",
        )) {
            val src = code(read(rel))
            val hard = Regex(
                """"(CSV-Import läuft|Importiere…|Import abgeschlossen|BrickInventory – |""" +
                    """PDF-Export läuft|PDF bereit|PDF-Export fehlgeschlagen|Starte Export|""" +
                    """Bilder werden geladen|Lade PDF herunter|PDF wird|Keine Exportdaten|Unbekannter Fehler)"""
            ).find(src)
            assert(hard == null) {
                "$rel contains a hard-coded German text again (${hard?.value}…) — " +
                    "English-speaking users then get German notifications. " +
                    "Texts belong in strings.xml/strings-de.xml."
            }
        }
    }

    @Test
    fun `notifiers use the localized context`() {
        // setApplicationLocales() only localizes activities. A worker that
        // calls getString() on the application context gets the SYSTEM language below
        // Android 13 — the wrapper from LanguageManager
        // is therefore mandatory, otherwise the localization is only apparently there.
        for (rel in listOf(
            "java/ch/brickinventoryapp/services/service/CsvImportNotifier.kt",
            "java/ch/brickinventoryapp/services/service/PdfExportNotifier.kt",
        )) {
            assert(code(read(rel)).contains("LanguageManager.localizedContext(context)")) {
                "$rel calls getString() without LanguageManager.localizedContext()"
            }
        }
        assert(code(read("java/ch/brickinventoryapp/data/util/LanguageManager.kt"))
            .contains("createConfigurationContext")) {
            "LanguageManager.localizedContext() is missing or no longer wraps the Context"
        }
    }

    @Test
    fun `new strings exist in both languages`() {
        val en = read("res/values/strings.xml")
        val de = read("res/values-de/strings.xml")
        for (key in listOf(
            "notif_csv_title", "notif_csv_running", "notif_csv_done",
            "notif_pdf_title", "notif_pdf_done_tap", "notif_pdf_failed",
            "pdfexp_starting", "pdfexp_unknown_error", "pdfexp_creating_eta",
        )) {
            assert(en.contains("name=\"$key\"")) { "$key is missing in values/strings.xml" }
            assert(de.contains("name=\"$key\"")) { "$key is missing in values-de/strings.xml" }
        }
    }

    // ── Status-Icon ──────────────────────────────────────────────────────────

    @Test
    fun `notifications use the monochrome status icon`() {
        assert(File(Sources.res, "drawable/ic_stat_brick.xml").exists()) {
            "drawable/ic_stat_brick.xml is missing"
        }
        for (rel in listOf(
            "java/ch/brickinventoryapp/services/service/CsvImportNotifier.kt",
            "java/ch/brickinventoryapp/services/service/PdfExportNotifier.kt",
        )) {
            val src = code(read(rel))
            assert(!src.contains("setSmallIcon(R.mipmap")) {
                "$rel uses the adaptive launcher icon as setSmallIcon again — Android " +
                    "renders status icons only via the alpha channel, the launcher icon " +
                    "appears as a grey square on many devices."
            }
            assert(src.contains("setSmallIcon(R.drawable.ic_stat_brick)")) {
                "$rel does not use ic_stat_brick"
            }
        }
    }

    // ── Parts list without cleartext release ─────────────────────────────────────

    @Test
    fun `the parts list goes out only via the own provider, no FileProvider`() {
        val manifest = code(read("AndroidManifest.xml"))
        assert(!manifest.contains("FileProvider")) {
            "The manifest carries a FileProvider again — it only passes on plain-text files, " +
                "the parts list would then lie open in filesDir again"
        }
        val entry = Regex("""<provider[^>]*PartListsProvider[^>]*>""").find(manifest)?.value
            ?: error("the PartListsProvider is missing in the manifest")
        assert(entry.contains("android:exported=\"false\"")) { "the PartListsProvider is exported" }
        assert(entry.contains("android:grantUriPermissions=\"true\"")) {
            "without grantUriPermissions the chosen app does not open the parts list"
        }
        assert(!File(Sources.res, "xml/file_paths.xml").exists()) { "file_paths.xml is back" }
    }

    // ── ProGuard ─────────────────────────────────────────────────────────────

    @Test
    fun `no dead Gson rule in ProGuard`() {
        // proguard-rules.pro lies in the module root directory, not under src/
        val f = File("proguard-rules.pro")
        assert(f.exists()) { "proguard-rules.pro not found" }
        assert(!f.readText().contains("SerializedName")) {
            "The Gson keep rule is back — the project serializes with " +
                "kotlinx.serialization, Gson is not a dependency. The rule does " +
                "nothing and misleads when reading."
        }
    }
}
