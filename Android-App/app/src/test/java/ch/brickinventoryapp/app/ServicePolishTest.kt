package ch.brickinventoryapp.app

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Sources

/**
 * Safeguarding of the cleanup round: localized service notifications,
 * status icon and the parts list without FileProvider. That the PDF download goes via the
 * api client is checked by InstructionDownloadTest, executed.
 *
 * All checks only read source and resource files.
 *
 * Counter-check: in the manifest the FileProvider put next to the
 * PartListsProvider → red “the parts list goes out only via the own
 * provider” (counter-checks/fileprovider-extern.patch).
 */
class ServicePolishTest {

    private fun read(rel: String): String {
        // Sources and resources across all modules; the manifest lies in app/.
        val f = when {
            rel.startsWith("java/ch/brickinventoryapp/") -> File(Sources.root, rel.removePrefix("java/ch/brickinventoryapp/"))
            rel.startsWith("res/") -> File(Sources.res, rel.removePrefix("res/"))
            else -> File(Sources.project, "app/src/main/$rel")
        }
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /** Hide comments (Kotlin and XML) — explanatory texts name the patterns themselves. */
    private fun code(src: String): String {
        var s = src.replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        s = s.replace(Regex("""<!--.*?-->""", RegexOption.DOT_MATCHES_ALL), "")
        return s.lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")
    }

    // ── Lokalisierte Foreground-Services ─────────────────────────────────────

    @Test
    fun `service notifications come from resources, not hard-coded`() {
        for (rel in listOf(
            "java/ch/brickinventoryapp/services/service/CsvImportService.kt",
            "java/ch/brickinventoryapp/services/service/PdfExportService.kt",
            "java/ch/brickinventoryapp/services/service/PdfExportManager.kt",
        )) {
            val src = code(read(rel))
            val hard = Regex(
                """"(CSV-Import läuft|Importiere…|Import abgeschlossen|BrickInventory – |""" +
                    """PDF-Export läuft|PDF bereit|PDF-Export fehlgeschlagen|Starte Export|""" +
                    """Bilder werden geladen|Lade PDF herunter|PDF wird|Keine Exportdaten|Unbekannter Fehler)"""
            ).find(src)
            assert(hard == null) {
                "$rel enthält wieder einen hartkodierten deutschen Text (${hard?.value}…) — " +
                    "englischsprachige Nutzer bekommen dann deutsche Benachrichtigungen. " +
                    "Texte gehören in strings.xml/strings-de.xml."
            }
        }
    }

    @Test
    fun `services use the localized context`() {
        // setApplicationLocales() only localizes activities. A service that
        // calls getString() on its own context gets the SYSTEM language below
        // Android 13 — the wrapper from LanguageManager
        // is therefore mandatory, otherwise the localization is only apparently there.
        for (rel in listOf(
            "java/ch/brickinventoryapp/services/service/CsvImportService.kt",
            "java/ch/brickinventoryapp/services/service/PdfExportService.kt",
        )) {
            assert(code(read(rel)).contains("LanguageManager.localizedContext(this)")) {
                "$rel ruft getString() ohne LanguageManager.localizedContext() auf"
            }
        }
        assert(code(read("java/ch/brickinventoryapp/data/util/LanguageManager.kt"))
            .contains("createConfigurationContext")) {
            "LanguageManager.localizedContext() fehlt oder wrappt den Context nicht mehr"
        }
    }

    @Test
    fun `new strings exist in both languages`() {
        val en = read("res/values/strings.xml")
        val de = read("res/values-de/strings.xml")
        for (key in listOf(
            "notif_csv_title", "notif_csv_running", "notif_csv_done",
            "notif_pdf_title", "notif_pdf_running", "notif_pdf_done_tap", "notif_pdf_failed",
            "pdfexp_starting", "pdfexp_unknown_error", "pdfexp_creating_eta",
        )) {
            assert(en.contains("name=\"$key\"")) { "$key fehlt in values/strings.xml" }
            assert(de.contains("name=\"$key\"")) { "$key fehlt in values-de/strings.xml" }
        }
    }

    // ── Status-Icon ──────────────────────────────────────────────────────────

    @Test
    fun `notifications use the monochrome status icon`() {
        assert(File(Sources.res, "drawable/ic_stat_brick.xml").exists()) {
            "drawable/ic_stat_brick.xml fehlt"
        }
        for (rel in listOf(
            "java/ch/brickinventoryapp/services/service/CsvImportService.kt",
            "java/ch/brickinventoryapp/services/service/PdfExportService.kt",
        )) {
            val src = code(read(rel))
            assert(!src.contains("setSmallIcon(R.mipmap")) {
                "$rel benutzt wieder das adaptive Launcher-Icon als setSmallIcon — Android " +
                    "rendert Status-Icons nur über den Alpha-Kanal, das Launcher-Icon " +
                    "erscheint auf vielen Geräten als graues Quadrat."
            }
            assert(src.contains("setSmallIcon(R.drawable.ic_stat_brick)")) {
                "$rel benutzt ic_stat_brick nicht"
            }
        }
    }

    // ── Parts list without cleartext release ─────────────────────────────────────

    @Test
    fun `the parts list goes out only via the own provider, no FileProvider`() {
        val manifest = code(read("AndroidManifest.xml"))
        assert(!manifest.contains("FileProvider")) {
            "Das Manifest trägt wieder einen FileProvider — er gibt nur Klartext-Dateien weiter, " +
                "die Teileliste läge dann wieder offen in filesDir"
        }
        val entry = Regex("""<provider[^>]*PartListsProvider[^>]*>""").find(manifest)?.value
            ?: error("Der PartListsProvider fehlt im Manifest")
        assert(entry.contains("android:exported=\"false\"")) { "Der PartListsProvider ist exportiert" }
        assert(entry.contains("android:grantUriPermissions=\"true\"")) {
            "Ohne grantUriPermissions öffnet die gewählte App die Teileliste nicht"
        }
        assert(!File(Sources.res, "xml/file_paths.xml").exists()) { "file_paths.xml ist zurück" }
    }

    // ── ProGuard ─────────────────────────────────────────────────────────────

    @Test
    fun `no dead Gson rule in ProGuard`() {
        // proguard-rules.pro lies in the module root directory, not under src/
        val f = File("proguard-rules.pro")
        assert(f.exists()) { "proguard-rules.pro nicht gefunden" }
        assert(!f.readText().contains("SerializedName")) {
            "Die Gson-Keep-Regel ist zurück — das Projekt serialisiert mit " +
                "kotlinx.serialization, Gson ist keine Abhängigkeit. Die Regel tut " +
                "nichts und führt beim Lesen in die Irre."
        }
    }
}
