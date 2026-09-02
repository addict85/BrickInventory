package ch.brickinventoryapp

import org.junit.Test

/**
 * Die Fokus-Einstellungen des Barcodescanners.
 *
 * ── Marcos Befund (Nachtrag 112) ────────────────────────────────────────────
 * „Die Kamera im Barcodescanner stellt WIEDER nicht scharf."
 *
 * Das „wieder" traf zu: Der Dateikopf von BarcodeScannerScreen.kt verweist seit
 * jeher auf einen `CameraFocusConfigTest` — den es nicht gab. Er ist irgendwann
 * verschwunden, und damit war die Regel unbewacht. Diese Datei stellt ihn her.
 *
 * ── Der Fehler ──────────────────────────────────────────────────────────────
 * Auf derselben `previewView` standen ZWEI `setOnTouchListener`. Das fügt nicht
 * hinzu, es ERSETZT: Der zweite lief später (im Kamera-Rückruf) und überschrieb
 * den ersten stillschweigend.
 *
 * Wirksam war damit die Fassung mit `setAutoCancelDuration(3, SECONDS)` — und
 * genau davor warnt der Kommentar im Code: „Bewusst mit disableAutoCancel():
 * Ohne das fällt die Kamera nach wenigen Sekunden auf ihre eigene Wahl zurück."
 * Man tippt, es wird scharf, und Sekunden später ist es wieder weg.
 */
class CameraFocusConfigTest {

    private fun scanner(): String =
        java.io.File("src/main/java/ch/brickinventoryapp/ui/screens/BarcodeScannerScreen.kt").readText()

    private fun analyzer(): String =
        java.io.File("src/main/java/ch/brickinventoryapp/ui/screens/BarcodeAnalyzer.kt").readText()

    private fun setup(): String =
        java.io.File("src/main/java/ch/brickinventoryapp/ui/screens/SetupScreen.kt").readText()

    private fun code(src: String) = src.lines()
        .joinToString("\n") { val t = it.trim(); if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else it }

    @Test
    fun `genau EIN Tap-to-Focus-Listener`() {
        val c = code(scanner())
        val anzahl = Regex("""previewView\.setOnTouchListener""").findAll(c).count()
        assert(anzahl == 1) {
            "$anzahl Touch-Listener auf previewView. setOnTouchListener ERSETZT — " +
                "der zuletzt gesetzte gewinnt, und welcher das ist, hängt davon ab, " +
                "wann der Kamera-Rückruf eintrifft. Genau daran ist der Autofokus " +
                "in Nachtrag 112 gescheitert."
        }
    }

    /**
     * Jede Datei, die Tap-to-Focus anbietet — nicht nur der Scanner.
     *
     * Bis hierher sah dieser Test allein in BarcodeScannerScreen.kt nach. Der
     * SetupScreen bietet dasselbe an und stand die ganze Zeit auf
     * `setAutoCancelDuration(3, SECONDS)` — also genau der Fassung, die der
     * Test zwei Zeilen weiter als Ursache von Nachtrag 112 verbietet. Behoben
     * wurde damals nur die Kopie, die der Test ansah.
     *
     * Die Liste wird deshalb nicht aufgezählt, sondern GEFUNDEN: Wer eine
     * dritte Kamera-Ansicht baut, ist sofort mitgeprüft, ohne diese Datei
     * anzufassen. Eine aufgezählte Liste wäre die dritte Fassung derselben
     * Regel gewesen.
     */
    private fun mitTapToFocus(): List<java.io.File> {
        val ordner = java.io.File("src/main/java/ch/brickinventoryapp/ui/screens")
        val treffer = ordner.listFiles { f -> f.extension == "kt" }
            ?.filter { code(it.readText()).contains("startFocusAndMetering(") }
            ?: emptyList()
        assert(treffer.size >= 2) {
            "Nur ${treffer.size} Datei(en) mit Tap-to-Focus gefunden. Erwartet " +
                "werden mindestens der Barcodescanner und der SetupScreen — " +
                "findet die Suche weniger, prüft dieser Test nichts und wäre " +
                "trotzdem grün."
        }
        return treffer
    }

    @Test
    fun `der Tap-to-Focus haelt den Fokus`() {
        for (datei in mitTapToFocus()) {
            val c = code(datei.readText())
            assert(c.contains("disableAutoCancel()")) {
                "${datei.name}: Ohne disableAutoCancel() fällt die Kamera nach " +
                    "wenigen Sekunden auf ihre eigene Wahl zurück — der Nutzer " +
                    "stellt gezielt scharf, und es ist gleich wieder weg."
            }
            assert(!c.contains("setAutoCancelDuration")) {
                "${datei.name}: setAutoCancelDuration ist da. Das ist das Gegenteil " +
                    "von disableAutoCancel() und war die Ursache in Nachtrag 112."
            }
        }
    }

    @Test
    fun `CONTINUOUS_PICTURE steht an BEIDEN Use Cases`() {
        // CameraX führt die Konfigurationen aller gebundenen Use Cases zu EINEM
        // Repeating-Request zusammen. Steht der AF-Modus nur am Preview,
        // entscheidet je nach Gerät die Analyse-Konfiguration mit — und deren
        // Vorgabe ist nicht zwingend CONTINUOUS_PICTURE.
        //
        // Seit Nachtrag 99 stehen die beiden in verschiedenen Dateien: die
        // Vorschau in BarcodeScannerScreen.kt, die Analyse in BarcodeAnalyzer.kt.
        val marke = "CONTROL_AF_MODE_CONTINUOUS_PICTURE"
        assert(code(scanner()).contains(marke)) {
            "Der Vorschau fehlt der AF-Modus"
        }
        assert(code(analyzer()).contains(marke)) {
            "Der Bildanalyse fehlt der AF-Modus — auf manchen Geräten bleibt das " +
                "Bild dann unscharf, obwohl der Code richtig aussieht."
        }
    }

    @Test
    fun `kein periodisches Nachfokussieren`() {
        // „Fokus-Pump": Ein im Takt laufendes startFocusAndMetering unterbricht
        // den kontinuierlichen Autofokus immer wieder. Fokussiert wird NUR beim
        // Antippen.
        val c = code(scanner()) + "\n" + code(analyzer())
        for (muster in listOf("""LaunchedEffect[\s\S]{0,400}?startFocusAndMetering""",
                              """while\s*\([^)]*\)[\s\S]{0,400}?startFocusAndMetering""")) {
            assert(!Regex(muster).containsMatchIn(c)) {
                "startFocusAndMetering läuft wieder in einer Schleife oder einem " +
                    "Effekt — das zwingt die Kamera dauernd in einen neuen Suchlauf."
            }
        }
    }

    @Test
    fun `SetupScreen setzt den AF-Modus an BEIDEN Use Cases`() {
        // SetupScreen bindet Vorschau UND Analyse selbst, in EINER Datei —
        // anders als der Scanner, dessen Analyse seit Nachtrag 99 in
        // BarcodeAnalyzer.kt liegt. Hier zaehlt deshalb die Anzahl, nicht das
        // blosse Vorkommen: EIN Use Case mit AF-Modus reicht nicht, weil
        // CameraX beide Konfigurationen zu einem Repeating-Request verschmilzt.
        //
        // Diese Pruefung stand bis Nachtrag 119 in einer zweiten, veralteten
        // Fassung dieser Klasse in ResponseCacheContractTest.kt. Sie erwartete
        // die zwei Stellen auch in BarcodeScannerScreen.kt — was seit der
        // Auslagerung des Analyzers nicht mehr zutrifft. Die Doppelung war ein
        // Uebersetzungsfehler (Redeclaration); erhalten bleibt der Teil, der
        // stimmt: SetupScreen.
        val marke = "CONTROL_AF_MODE_CONTINUOUS_PICTURE"
        val anzahl = Regex(marke).findAll(code(setup())).count()
        assert(anzahl == 2) {
            "In SetupScreen.kt steht der AF-Modus $anzahl mal statt zweimal — " +
                "er muss an Preview UND ImageAnalysis stehen. NICHT diesen Test " +
                "anpassen, sondern die fehlende Stelle ergaenzen."
        }
    }

    @Test
    fun `kein periodisches Nachfokussieren im SetupScreen`() {
        val c = code(setup())
        for (muster in listOf("""LaunchedEffect[\s\S]{0,400}?startFocusAndMetering""",
                              """while\s*\([^)]*\)[\s\S]{0,400}?startFocusAndMetering""")) {
            assert(!Regex(muster).containsMatchIn(c)) {
                "startFocusAndMetering laeuft im SetupScreen in einer Schleife " +
                    "oder einem Effekt — das zwingt die Kamera dauernd in einen " +
                    "neuen Suchlauf."
            }
        }
    }
}
