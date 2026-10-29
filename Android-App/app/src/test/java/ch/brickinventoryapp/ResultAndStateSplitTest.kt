package ch.brickinventoryapp

import org.junit.Test

/**
 * Absicherung der beiden Umbauten: erschöpfende `when`-Ausdrücke über
 * [Result] und die Aufteilung von AppUiState.
 */
class ResultAndStateSplitTest {

    private val root = java.io.File("src/main/java/ch/brickinventoryapp")

    private fun read(rel: String): String {
        val f = java.io.File(root, rel)
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    private fun kotlinSources(): List<java.io.File> =
        root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
            .also {
                // Untergrenze (Nachtrag 118): ein leerer Dateilauf lässt jede
                // Sammelprüfung darunter stillschweigend bestehen.
                check(it.size >= 20) { "Zu wenige Kotlin-Dateien gefunden (${'$'}{it.size}) — Pfad veraltet?" }
            }

    private fun code(src: String): String {
        val s = src.replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        return s.lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")
    }

    /** Zeilenbereiche aller `when`-Blöcke einer Datei. */
    private fun whenBlocks(lines: List<String>): List<IntRange> {
        val out = mutableListOf<IntRange>()
        for (i in lines.indices) {
            if (!Regex("""\bwhen\s*\(""").containsMatchIn(lines[i])) continue
            var depth = 0
            var started = false
            for (j in i until lines.size) {
                for (c in lines[j]) {
                    if (c == '{') { depth++; started = true } else if (c == '}') depth--
                }
                if (started && depth <= 0) { out.add(i..j); break }
            }
        }
        return out
    }

    // ── Result ohne Loading ──────────────────────────────────────────────────

    /**
     * Alle Dateien der Datenschicht als EIN Text (Nachtrag 155).
     *
     * Vorher stand hier "data/repository/BrickRepository.kt" — ein Dateiname.
     * Die 78 Funktionen liegen seither in fuenf Klassen nach Sachgebieten,
     * die gemeinsame Mechanik in RepoBasis. Gemeint ist DIE DATENSCHICHT,
     * nicht eine Datei.
     */
    private fun datenschicht(): String =
        java.io.File("src/main/java/ch/brickinventoryapp/data/repository")
            .listFiles { f -> f.extension == "kt" }
            .orEmpty().sortedBy { it.name }
            .joinToString("\n") { it.readText() }

    @Test
    fun `Result hat genau zwei Varianten`() {
        val src = code(datenschicht())
        assert(!src.contains("Loading")) {
            "Result.Loading ist zurück. Die Variante wurde nie erzeugt — safeCall() " +
                "liefert nur Success oder Error — erzwang aber in jedem `when` einen " +
                "else-Zweig. Und `else -> {}` verschluckt stillschweigend jeden Fall, " +
                "der später dazukommt."
        }
        assert(src.contains("data class Success") && src.contains("data class Error")) {
            "Success/Error fehlen in Result"
        }
    }

    @Test
    fun `kein when ueber Result hat einen else-Zweig`() {
        val offenders = mutableListOf<String>()
        for (f in kotlinSources()) {
            val lines = code(f.readText()).lines()
            for (range in whenBlocks(lines)) {
                // Nur Zweige auf der obersten Ebene DIESES Blocks betrachten,
                // sonst zählt ein verschachteltes when fälschlich mit.
                var depth = 0
                var started = false
                val top = mutableListOf<String>()
                for (j in range) {
                    val before = depth
                    for (c in lines[j]) {
                        if (c == '{') { depth++; started = true } else if (c == '}') depth--
                    }
                    if (started && before <= 1) top.add(lines[j])
                }
                val body = top.joinToString("\n")
                if (!body.contains("is Result.Success")) continue
                if (Regex("""^\s*else\s*->""", RegexOption.MULTILINE).containsMatchIn(body)) {
                    offenders += "${f.name}:${range.first + 1} (else-Zweig)"
                }
                if (!body.contains("is Result.Error")) {
                    offenders += "${f.name}:${range.first + 1} (kein Error-Zweig)"
                }
            }
        }
        assert(offenders.isEmpty()) {
            "Mit nur zwei Varianten ist jedes `when` über Result erschöpfend — ein " +
                "else-Zweig macht künftige Varianten wieder unsichtbar, ein fehlender " +
                "Error-Zweig kompiliert gar nicht: ${offenders.joinToString(", ")}"
        }
    }

    // ── Aufgeteilter Zustand ─────────────────────────────────────────────────

    @Test
    fun `Teile und Finanzen haben eigene Zustandsklassen`() {
        val src = code(Quellen.zustaende())
        assert(src.contains("data class PartsUiState")) { "PartsUiState fehlt" }
        assert(src.contains("data class FinanceUiState")) { "FinanceUiState fehlt" }
        assert(src.contains("data class BarcodeUiState")) { "BarcodeUiState fehlt" }

        // Die verschobenen Felder dürfen NICHT mehr im Haupt-State stehen.
        val appBlock = src.substringAfter("data class AppUiState(").substringBefore("\n)")
        for (field in listOf(
            "val parts:", "val partsLoading:", "val minifigs:", "val partsStats:",
            "val valuation:", "val pnl:", "val historyPoints:", "val historyPeriod:",
            // Nachtrag 117: Ein Scan erzeugt viele Zwischenstände (Auflösen,
            // Sperre gegen den zweiten Klick). Lagen sie im Haupt-Zustand,
            // rekomponierte jeder davon Galerie, Teile, Minifiguren und
            // Finanzen mit — obwohl der Scanner sie nichts angeht.
            "val barcodeResult:", "val scannerSource:", "val barcodeAdding:",
            "val barcodeSetName:", "val barcodeForPartsList:",
            "val manuelleErfassungAnfordern:",
        )) {
            assert(!appBlock.contains(field)) {
                "$field liegt wieder in AppUiState. Dann rekomponiert jedes Laden in " +
                    "der Teileliste oder im Finanzbereich erneut die gesamte App."
            }
        }
    }

    @Test
    fun `die neuen Flows sind im ViewModel veroeffentlicht`() {
        for ((datei, namen) in listOf(
            "ui/viewmodel/TeileViewModel.kt" to listOf("partsState"),
            "ui/viewmodel/FinanzViewModel.kt" to listOf("_financeState", "financeState"),
            "ui/viewmodel/ErfassungViewModel.kt" to listOf("_barcodeState", "barcodeState"),
        )) {
            val src = code(read(datei))
            for (name in namen) assert(src.contains(name)) { "$name fehlt in $datei" }
        }
    }

    @Test
    fun `MainActivity sammelt nur das Design, nicht den ganzen Zustand`() {
        val src = code(read("MainActivity.kt"))
        assert(src.contains("vm.appTheme")) {
            "MainActivity sammelt wieder den kompletten AppUiState für ein einziges " +
                "Feld — damit invalidiert jede Zustandsänderung die Wurzel der " +
                "Composition und darüber die ganze App."
        }
        assert(!src.contains("vm.state.collectAsStateWithLifecycle()")) {
            "MainActivity sammelt weiterhin den ganzen Zustand"
        }
        assert(code(read("ui/AppViewModel.kt")).contains("distinctUntilChanged()")) {
            "vm.appTheme filtert unveränderte Werte nicht heraus"
        }
    }

    @Test
    fun `beim Abmelden werden alle Zustands-Flows zurueckgesetzt`() {
        // Seit dem Schnitt in Bereichs-ViewModels leert jedes seinen Zustand
        // selbst, auf Sitzung.abgemeldet() hin. Ausgeführt prüfen das die
        // ViewModel-Tests („nach dem Abmelden …“); hier steht die Regel für
        // jedes künftige: Wer Zustand hält, überschreibt zuruecksetzen().
        // Gegenprobe (28.10.2026): HaushaltViewModel ohne override → rot.
        val app = code(read("ui/AppViewModel.kt"))
        for (reset in listOf("sitzung.abgemeldet()", "blickfeldDienst.zuruecksetzen()", "CsvImportUiState()")) {
            assert(app.contains(reset)) { "logout() ruft $reset nicht mehr" }
        }
        val bereiche = Quellen.unter("ui/viewmodel").filter {
            code(it.readText()).contains(": BereichsViewModel(dienste)")
        }
        assert(bereiche.size >= 10) { "Nur ${bereiche.size} Bereichs-ViewModels gefunden — Muster veraltet?" }
        val vergesslich = bereiche.filter {
            val c = code(it.readText())
            (c.contains("MutableStateFlow(") || c.contains("SavedStateHandle")) &&
                !c.contains("override fun zuruecksetzen()")
        }.map { it.name }
        assert(vergesslich.isEmpty()) {
            "Diese ViewModels halten Zustand, leeren ihn beim Abmelden aber nicht — der " +
                "nächste Nutzer auf demselben Gerät sähe fremde Daten: ${vergesslich.joinToString()}"
        }
    }

    @Test
    fun `keine verwaisten Zugriffe auf verschobene Felder`() {
        val moved = listOf(
            "parts", "partsTotal", "partsPage", "partsLoading", "minifigs", "minifigsLoading",
            "partsStats", "partsColors", "valuation", "partsValuation", "figsValuation",
            "pnl", "historyLoading", "historyPoints", "historyYAxis", "historyPeriod",
            "historyPeriodChangePct",
        )
        val pattern = Regex("""(?<![A-Za-z])state\.(${moved.joinToString("|")})\b""")
        val offenders = mutableListOf<String>()
        for (f in kotlinSources()) {
            for ((i, line) in code(f.readText()).lines().withIndex()) {
                // partsState./financeState. sind die neuen, richtigen Zugriffe
                val cleaned = line.replace("partsState.", "").replace("financeState.", "")
                if (pattern.containsMatchIn(cleaned)) offenders += "${f.name}:${i + 1}"
            }
        }
        assert(offenders.isEmpty()) {
            "Zugriff auf ein verschobenes Feld über den Haupt-Zustand: " +
                offenders.joinToString(", ")
        }
    }
}
