package ch.brickinventoryapp

import org.junit.Test

/**
 * Die Reiter-Bildschirme lesen ihren Zustand selbst.
 *
 * ── Marcos Auftrag (Nachtrag 96) ────────────────────────────────────────────
 * „Gibt es noch Dinge, die man softwaretechnisch verbessern könnte? Klassen
 * abstrahieren, Funktionen auslagern?" Gemessen ergab sich unter anderem:
 * GalleryScreen 26 Parameter, FinanceScreen 21, PartsScreen 20, MinifigsScreen
 * 15 — während ManualItemDetailScreen und AcquisitionManagementScreen mit sechs
 * bis acht auskamen, weil sie `vm` nehmen und selbst lesen.
 *
 * Die breiten Signaturen waren der Grund, warum jede Erweiterung DREI Dateien
 * anfasste: Screen, Graph, ViewModel. Beim Kontofilter und beim Scroll-Zustand
 * war das jedes Mal spürbar.
 *
 * ── Wie der Umbau abgesichert wurde ─────────────────────────────────────────
 * Kotlin lässt sich in meiner Umgebung nicht kompilieren. Deshalb wurde
 * ausschliesslich der KOPF getauscht: Die Werte behalten ihre alten Namen, der
 * Rumpf darunter blieb Zeile für Zeile unverändert. Ein Tippfehler kann sich so
 * nicht durch fünfhundert Zeilen ziehen, und die Prüfung unten kann jeden
 * Zustandszugriff gegen die Datenklassen in UiState.kt halten.
 */
class ScreenViewModelWiringTest {

    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    private fun code(src: String) = src.lines()
        .joinToString("\n") { val t = it.trim(); if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else it }

    /** Die umgestellten Bildschirme und ihre Composable-Namen. */
    private val umgestellt = listOf(
        "GalleryScreen" to "ui/screens/GalleryScreen.kt",
        "PartsScreen" to "ui/screens/PartsScreen.kt",
        "MinifigsScreen" to "ui/screens/MinifigsScreen.kt",
        "FinanceScreen" to "ui/screens/FinanceScreen.kt",
        // Nachtrag 115: Katalog (13 Parameter) und Einstellungen (12) waren die
        // letzten beiden nach dem alten Muster. Solange zwei Muster
        // nebeneinander bestanden, musste man vor jeder Änderung erst
        // herausfinden, welches gilt.
        "CatalogScreen" to "ui/screens/CatalogScreen.kt",
        "SettingsScreen" to "ui/screens/SettingsScreen.kt",
    )

    /** Kopfzeilen einer Composable-Signatur (die Parameterliste). */
    private fun signatur(src: String, fn: String): List<String> {
        val i = src.indexOf("fun $fn(")
        assert(i >= 0) { "$fn nicht gefunden" }
        val ende = src.indexOf("\n) {", i)
        assert(ende > i) { "$fn: Signaturende nicht gefunden" }
        return src.substring(i, ende).lines()
            .filter { it.matches(Regex("^ {4}\\w+:.*")) }
    }

    @Test
    fun `die Reiter-Bildschirme nehmen das ViewModel statt zwanzig Parameter`() {
        for ((fn, datei) in umgestellt) {
            val src = code(read(datei))
            val params = signatur(src, fn)
            assert(params.size <= 6) {
                "$fn hat ${params.size} Parameter. Breite Signaturen sind der Grund, " +
                    "warum jede Erweiterung Screen, Graph UND ViewModel anfasst — der " +
                    "Zustand gehört vom ViewModel gelesen."
            }
            assert(params.any { it.trim().startsWith("vm: MainViewModel") }) {
                "$fn nimmt kein ViewModel entgegen"
            }
            assert(src.contains("vm.state.collectAsStateWithLifecycle()")) {
                "$fn liest den Zustand nicht selbst"
            }
        }
    }

    @Test
    fun `Navigations-Rueckrufe bleiben Parameter`() {
        // Bewusste Ausnahme, kein Versehen: Nur der Navigationsgraph kennt den
        // NavController. Ein Screen, der selbst navigiert, wäre an seinen Platz
        // im Graphen gebunden und liesse sich nicht mehr woanders einsetzen.
        //
        // Welcher Rückruf das ist, unterscheidet sich je Bildschirm — deshalb
        // hier namentlich und nicht als ein Muster für alle.
        val rueckrufe = mapOf(
            "GalleryScreen" to listOf("onSetClick", "onScanBarcode"),
            "PartsScreen" to listOf("onOpenDetail"),
            "MinifigsScreen" to listOf("onOpenDetail"),
            "FinanceScreen" to listOf("onSetClick", "onManualClick"),
            "CatalogScreen" to listOf("onSetClick"),
            // Bei den Einstellungen ist es das Abmelden: Danach wird auf den
            // Anmeldebildschirm navigiert, und das kann nur der Graph.
            "SettingsScreen" to listOf("onLogout"),
        )
        for ((fn, datei) in umgestellt) {
            val src = code(read(datei))
            val sig = signatur(src, fn)
            for (r in rueckrufe.getValue(fn)) {
                assert(sig.any { it.contains(r) }) { "$fn: Rückruf $r fehlt" }
            }
            assert(!src.contains("navController")) {
                "$fn greift selbst auf den NavController zu"
            }
        }
    }

    @Test
    fun `jeder Zustandszugriff trifft ein Feld, das es gibt`() {
        // ── Der Ersatz für den fehlenden Compiler ────────────────────────────
        //
        // `state.gibtEsNicht` wäre ein Übersetzungsfehler, den ich hier nicht
        // sehe. Diese Prüfung hält jeden Zugriff gegen die Datenklassen in
        // UiState.kt — genau die Fehlerart, die der Umbau hätte einschleppen
        // können.
        val uiState = read("ui/UiState.kt")

        fun felder(klasse: String): Set<String> {
            val i = uiState.indexOf("data class $klasse(")
            assert(i >= 0) { "$klasse nicht in UiState.kt" }
            var tiefe = 0
            var j = i
            while (j < uiState.length) {
                if (uiState[j] == '(') tiefe++
                else if (uiState[j] == ')') { tiefe--; if (tiefe == 0) break }
                j++
            }
            return Regex("val (\\w+)\\s*:").findAll(uiState.substring(i, j))
                .map { it.groupValues[1] }.toSet()
        }

        // Die Zuordnung Name -> Zustandstyp wird JE DATEI abgeleitet, nicht
        // hier aufgezählt: In CatalogScreen heisst der Katalogzustand schlicht
        // `state`. Eine feste Liste hielte ihn für den App-Zustand und meldete
        // dort fünfundzwanzig Fehlalarme (Nachtrag 115). Siehe Quellen.kt.
        val fehler = mutableListOf<String>()
        for ((_, datei) in umgestellt) {
            val src = code(read(datei))
            val zuordnung = Quellen.zustandsNamen(src)
            for ((variable, klasse) in zuordnung) {
                if (!src.contains("val $variable by vm.")) continue
                val gueltig = felder(klasse)
                for (m in Regex("(?<!vm\\.)\\b$variable\\.(\\w+)").findAll(src)) {
                    val feld = m.groupValues[1]
                    if (feld == "collectAsStateWithLifecycle") continue
                    if (feld !in gueltig) fehler += "$datei: $variable.$feld gibt es in $klasse nicht"
                }
            }
        }
        assert(fehler.isEmpty()) {
            "Zustandszugriff ins Leere:\n  " + fehler.joinToString("\n  ")
        }
    }
}
