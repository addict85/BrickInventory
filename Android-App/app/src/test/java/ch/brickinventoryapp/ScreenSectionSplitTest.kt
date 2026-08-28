package ch.brickinventoryapp

import org.junit.Test

/**
 * Die grossen Bildschirme sind in Abschnitte aufgeteilt.
 *
 * ── Warum (Nachtrag 98) ─────────────────────────────────────────────────────
 *
 * `SetDetailScreen()` war 526 Zeilen, `FinanceScreen()` 482 — die ganze Datei
 * enthielt jeweils EIN Composable, obwohl daneben `SetDetailComponents.kt` mit
 * neun kleinen liegt. Die Aufteilung war angefangen und nicht zu Ende geführt.
 *
 * ── Ein Messfehler vorweg ───────────────────────────────────────────────────
 * Aufgefallen ist das spät, weil mein Werkzeug zum Messen von Funktionslängen
 * bei MEHRZEILIGEN Signaturen zu früh abbrach — also bei fast allen
 * Compose-Funktionen. `SetDetailScreen` wurde als „2 Zeilen" gezählt. Wer hier
 * misst, muss erst die Klammern der Signatur schliessen und dann den Rumpf
 * suchen.
 */
class ScreenSectionSplitTest {

    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /** Die Abschnittsdateien und die Bildschirme, aus denen sie stammen. */
    private val paare = listOf(
        "ui/screens/SetDetailScreen.kt" to "ui/screens/SetDetailSections.kt",
        "ui/screens/FinanceScreen.kt" to "ui/screens/FinanceSections.kt",
        "ui/screens/CatalogScreen.kt" to "ui/screens/CatalogSections.kt",
        "ui/screens/MonitoringScreen.kt" to "ui/screens/MonitoringSections.kt",
    )

    @Test
    fun `jeder aufgeteilte Bildschirm hat seine Abschnittsdatei`() {
        for ((screen, sections) in paare) {
            assert(read(screen).isNotEmpty())
            assert(read(sections).isNotEmpty())
        }
    }

    /**
     * Länge einer benannten Funktion.
     *
     * ── Zwei Anläufe, bis es stimmte (Nachtrag 98) ──────────────────────────
     * Ein naiver Zähler ab der `fun`-Zeile bricht bei MEHRZEILIGEN Signaturen
     * sofort ab — die enthalten kein `{`. So wurde `SetDetailScreen` als zwei
     * Zeilen gemeldet, und die 526 Zeilen fielen lange nicht auf.
     *
     * Der zweite Anlauf zählte geschweifte Klammern und verzählte sich an
     * denen in Zeichenketten und Kommentaren.
     *
     * Deshalb hier weder das eine noch das andere: Eine Funktion endet in
     * diesem Projekt auf einer schliessenden Klammer in SPALTE 0. Das ist
     * robust gegen beides und braucht keinen Parser.
     */
    private fun funktionslaenge(src: String, name: String): Int {
        val lines = src.lines()
        val start = lines.indexOfFirst {
            Regex("""^(?:private |internal )?fun $name\s*\(""").containsMatchIn(it)
        }
        assert(start >= 0) { "Funktion $name nicht gefunden" }
        for (j in start + 1 until lines.size) {
            if (lines[j] == "}") return j - start + 1
        }
        return lines.size - start
    }

    @Test
    fun `die Bildschirm-Composables bleiben in einer lesbaren Groesse`() {
        // Gemessen wird die FUNKTION, nicht die Datei: Eine Datei darf mehrere
        // Composables halten (SetDetailComponents.kt hat neun). Was nicht sein
        // soll, ist EIN Composable von 526 Zeilen.
        val grenzen = listOf(
            "ui/screens/SetDetailScreen.kt" to "SetDetailScreen",
            "ui/screens/FinanceScreen.kt" to "FinanceScreen",
            "ui/screens/CatalogScreen.kt" to "CatalogScreen",
        )
        for ((datei, fn) in grenzen) {
            val n = funktionslaenge(read(datei), fn)
            assert(n < 300) {
                "$fn hat $n Zeilen. Gehört ein Abschnitt in die zugehörige " +
                    "Sections-Datei?"
            }
        }
    }

    @Test
    fun `Listenabschnitte sind LazyListScope-Erweiterungen`() {
        // Sie tragen `item { … }` in eine LazyColumn ein. Als @Composable
        // liessen sie sich dort gar nicht aufrufen — der Unterschied ist keine
        // Geschmacksfrage.
        for (datei in listOf("ui/screens/SetDetailSections.kt", "ui/screens/FinanceSections.kt")) {
            val src = read(datei)
            assert(src.contains("fun LazyListScope.")) {
                "$datei enthält keine LazyListScope-Erweiterung"
            }
            assert(!Regex("""@Composable\s*\nfun (setDetail|finance)""").containsMatchIn(src)) {
                "$datei erklärt einen Listenabschnitt als @Composable — in einer " +
                    "LazyColumn ist das nicht aufrufbar"
            }
        }
    }

    @Test
    fun `veraenderlicher Zustand wird als MutableState uebergeben`() {
        // Drei Abschnitte SETZEN Zustand, der im Bildschirm lebt
        // (Nachladeversuch des Bildes, Kategoriefilter, die drei Katalog-Blätter).
        // Als Wert übergeben wäre es eine Kopie — die Zuweisung ginge ins Leere.
        // Deshalb halten die Bildschirme sie als `val x = remember { mutableStateOf(…) }`
        // statt per `by`.
        val faelle = listOf(
            "ui/screens/SetDetailScreen.kt" to "detailRetryState",
            "ui/screens/FinanceScreen.kt" to "activeCategory",
            "ui/screens/CatalogScreen.kt" to "showThemeSheet",
        )
        for ((datei, name) in faelle) {
            val src = read(datei)
            assert(Regex("""val $name\s*=\s*remember""").containsMatchIn(src)) {
                "$datei hält $name nicht als State-Objekt — eine Kopie kann der " +
                    "Abschnitt nicht setzen"
            }
            assert(!Regex("""var $name by remember""").containsMatchIn(src)) {
                "$datei hält $name wieder per `by` — dann wird eine Kopie übergeben"
            }
        }
    }

    @Test
    fun `die Bildanalyse steht getrennt von der Kamera-Vorschau`() {
        // ── Warum (Nachtrag 99) ─────────────────────────────────────────────
        // `CameraPreviewBarcode()` war 289 Zeilen und tat zwei verschiedene
        // Dinge: eine ImageAnalysis-Schleife aufbauen (Barcode-Leser,
        // Texterkennung, Bestätigungszählung, Drosselung) und die Kamera-
        // Vorschau in die Compose-Welt einbetten. Wer an der Erkennung etwas
        // ändert, hat mit PreviewView, Lebenszyklus und Fokus-Gesten nichts zu
        // tun — und umgekehrt.
        val analyzer = read("ui/screens/BarcodeAnalyzer.kt")
        val screen = read("ui/screens/BarcodeScannerScreen.kt")

        assert(analyzer.contains("fun rememberBarcodeAnalyzer(")) {
            "Die Analyse-Schleife ist nicht mehr eigenständig"
        }
        assert(screen.contains("rememberBarcodeAnalyzer(")) {
            "Der Bildschirm ruft die Analyse gar nicht mehr auf"
        }
        // Die Vorschau bleibt im Bildschirm, die Analyse hat damit nichts zu tun.
        assert(!analyzer.contains("AndroidView")) {
            "Die Kamera-Vorschau ist in die Analyse gewandert"
        }
        // Umgekehrt: Der Bildschirm baut keine Erkennung mehr auf.
        assert(!screen.contains("BarcodeScanning.getClient")) {
            "Der Bildschirm baut wieder selbst einen Barcode-Leser auf"
        }
        // Die Kamerasteuerung gehört zur VORSCHAU — beim Herauslösen war sie
        // zuerst mitgewandert.
        assert(screen.contains("_kameraCtrl")) {
            "Die Kamerasteuerung ist aus dem Bildschirm verschwunden"
        }
        assert(!analyzer.contains("_kameraCtrl")) {
            "Die Kamerasteuerung liegt in der Analyse — sie wird erst beim " +
                "Binden der Vorschau gefüllt"
        }
        assert(funktionslaenge(screen, "CameraPreviewBarcode") < 200) {
            "CameraPreviewBarcode ist wieder zu lang"
        }
    }
}
