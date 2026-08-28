package ch.brickinventoryapp

import org.junit.Test

/**
 * Absicherung der Aufräumrunde: lokalisierte Service-Benachrichtigungen,
 * Status-Icon, eingegrenzter FileProvider und der vom api-Client abgeleitete
 * PDF-Download.
 *
 * Alle Prüfungen lesen nur Quell- und Ressourcendateien.
 */
class ServicePolishTest {

    private fun read(rel: String): String {
        val f = java.io.File("src/main/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /** Kommentare (Kotlin und XML) ausblenden — Erklärtexte nennen die Muster selbst. */
    private fun code(src: String): String {
        var s = src.replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        s = s.replace(Regex("""<!--.*?-->""", RegexOption.DOT_MATCHES_ALL), "")
        return s.lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")
    }

    // ── Lokalisierte Foreground-Services ─────────────────────────────────────

    @Test
    fun `Service-Benachrichtigungen kommen aus Ressourcen, nicht hartkodiert`() {
        for (rel in listOf(
            "java/ch/brickinventoryapp/service/CsvImportService.kt",
            "java/ch/brickinventoryapp/service/PdfExportService.kt",
            "java/ch/brickinventoryapp/service/PdfExportManager.kt",
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
    fun `Services benutzen den lokalisierten Context`() {
        // setApplicationLocales() lokalisiert nur Activities. Ein Service, der
        // getString() auf seinem eigenen Context aufruft, bekommt unterhalb
        // von Android 13 die SYSTEM-Sprache — der Wrapper aus LanguageManager
        // ist deshalb Pflicht, sonst ist die Lokalisierung nur scheinbar da.
        for (rel in listOf(
            "java/ch/brickinventoryapp/service/CsvImportService.kt",
            "java/ch/brickinventoryapp/service/PdfExportService.kt",
        )) {
            assert(code(read(rel)).contains("LanguageManager.localizedContext(this)")) {
                "$rel ruft getString() ohne LanguageManager.localizedContext() auf"
            }
        }
        assert(code(read("java/ch/brickinventoryapp/util/LanguageManager.kt"))
            .contains("createConfigurationContext")) {
            "LanguageManager.localizedContext() fehlt oder wrappt den Context nicht mehr"
        }
    }

    @Test
    fun `neue Strings existieren in beiden Sprachen`() {
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
    fun `Benachrichtigungen benutzen das monochrome Status-Icon`() {
        assert(java.io.File("src/main/res/drawable/ic_stat_brick.xml").exists()) {
            "drawable/ic_stat_brick.xml fehlt"
        }
        for (rel in listOf(
            "java/ch/brickinventoryapp/service/CsvImportService.kt",
            "java/ch/brickinventoryapp/service/PdfExportService.kt",
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

    // ── FileProvider-Eingrenzung ─────────────────────────────────────────────

    @Test
    fun `FileProvider teilt nur das pdf-Unterverzeichnis`() {
        val fp = code(read("res/xml/file_paths.xml"))
        assert(!fp.contains("path=\".\"")) {
            "file_paths.xml gibt wieder ein Wurzelverzeichnis frei — damit ist auch der " +
                "API-Cache (Inventar im Klartext-JSON) über die Provider-Authority erreichbar"
        }
        assert(!fp.contains("cache-path")) {
            "file_paths.xml teilt den Cache — dort liegt nichts, das über den Provider " +
                "weitergegeben wird"
        }
        assert(fp.contains("path=\"pdf/\"")) {
            "file_paths.xml deckt das pdf/-Verzeichnis nicht mehr ab — das Öffnen des " +
                "exportierten Teilelisten-PDFs bricht dann mit SecurityException ab"
        }
        // Und der Export muss auch dort ablegen, wo der Provider hinzeigt:
        val mgr = code(read("java/ch/brickinventoryapp/service/PdfExportManager.kt"))
        assert(mgr.contains("\"pdf\"")) {
            "PdfExportManager schreibt das PDF nicht mehr ins pdf/-Unterverzeichnis — " +
                "ausserhalb des freigegebenen Pfads wirft FileProvider.getUriForFile()"
        }
    }

    // ── PdfViewer-Client ─────────────────────────────────────────────────────

    @Test
    fun `der PdfViewer leitet seinen Client vom api-Client ab`() {
        val pv = code(read("java/ch/brickinventoryapp/ui/screens/PdfViewerScreen.kt"))
        assert(!pv.contains("OkHttpClient.Builder()")) {
            "PdfViewerScreen baut wieder einen eigenständigen OkHttpClient. Der läuft am " +
                "DI-Interceptor vorbei: kein Bearer-Token, kein Klartext-Verbot, keine " +
                "401-Meldung — jede dieser Regeln müsste dort von Hand nachgezogen werden."
        }
        assert(pv.contains(".newBuilder()")) {
            "PdfViewerScreen leitet den Download-Client nicht per newBuilder() ab"
        }
        assert(code(read("java/ch/brickinventoryapp/ui/MainViewModel.kt"))
            .contains("apiHttpClient")) {
            "MainViewModel stellt den api-Client nicht mehr bereit"
        }
    }

    // ── ProGuard ─────────────────────────────────────────────────────────────

    @Test
    fun `keine tote Gson-Regel in ProGuard`() {
        // proguard-rules.pro liegt im Modulwurzelverzeichnis, nicht unter src/
        val f = java.io.File("proguard-rules.pro")
        assert(f.exists()) { "proguard-rules.pro nicht gefunden" }
        assert(!f.readText().contains("SerializedName")) {
            "Die Gson-Keep-Regel ist zurück — das Projekt serialisiert mit " +
                "kotlinx.serialization, Gson ist keine Abhängigkeit. Die Regel tut " +
                "nichts und führt beim Lesen in die Irre."
        }
    }
}
