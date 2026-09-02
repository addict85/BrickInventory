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
     *
     * ── Gegenprobe (Lauf 33635964430) ───────────────────────────────────────
     * Die erweiterte Prüfung wurde ABSICHTLICH allein veröffentlicht, vor der
     * Behebung. Der Lauf meldete `354 tests completed, 1 failed`, und zwar
     * genau diesen Test. Der Fehler war also echt und nicht nachgestellt —
     * ein künstlich eingebauter Bruch hätte nur gezeigt, dass die Prüfung
     * greift, nicht dass sie etwas gefunden hat.
     *
     * Gefunden hat den Befund übrigens nicht dieser Test, sondern ein
     * Vergleich gleicher Codeblöcke über den ganzen Baum. Eine Regel, die an
     * zwei Stellen steht, sieht an jeder einzelnen Stelle richtig aus.
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

    /**
     * Der AF-Modus steht an genau EINER Stelle — und jede Vorschau holt ihn dort.
     *
     * ── Was sich geändert hat ───────────────────────────────────────────────
     * Bis hierher zählte dieser Test das Vorkommen der Zeichenfolge
     * `CONTROL_AF_MODE_CONTINUOUS_PICTURE` in den einzelnen Bildschirmdateien:
     * einmal im Scanner, einmal im Analyzer, ZWEIMAL im SetupScreen. Das prüfte
     * die Formulierung an jeder Kopie — und dass es Kopien gab, war der
     * eigentliche Fehler.
     *
     * Der Aufbau der Bildanalyse stand zweimal im Baum, zwanzig Zeilen lang und
     * bis auf die Auflösung zeichengleich. Genau in dieser Doppelung hat die
     * Behebung aus Nachtrag 112 eine Kopie nicht erreicht.
     *
     * Jetzt steht der Modus in `KameraAufbau.kt`, in `autofokusDauerhaft()`.
     * Geprüft wird deshalb anders herum: Die Zeile darf NUR dort stehen, und
     * jede Datei, die eine Vorschau baut, muss die Funktion aufrufen.
     */
    @Test
    fun `der AF-Modus steht nur in KameraAufbau`() {
        val ordner = java.io.File("src/main/java/ch/brickinventoryapp/ui/screens")
        val marke = "CONTROL_AF_MODE_CONTINUOUS_PICTURE"
        val dateien = ordner.listFiles { f -> f.extension == "kt" } ?: emptyArray()
        assert(dateien.size >= 5) {
            "Nur ${dateien.size} Bildschirmdateien gefunden — der Pfad stimmt nicht, " +
                "und ein leeres Ergebnis würde diesen Test stillschweigend bestehen lassen."
        }

        val mitMarke = dateien.filter { code(it.readText()).contains(marke) }.map { it.name }
        assert(mitMarke == listOf("KameraAufbau.kt")) {
            "Der AF-Modus steht in ${mitMarke.joinToString()} statt nur in " +
                "KameraAufbau.kt. Jede weitere Stelle ist eine zweite Fassung " +
                "derselben Regel — und genau daran ist der Tap-to-Focus im " +
                "SetupScreen hängengeblieben."
        }
    }

    @Test
    fun `jede Vorschau setzt den AF-Modus`() {
        // CameraX führt die Konfigurationen aller gebundenen Use Cases zu EINEM
        // Repeating-Request zusammen. Steht der AF-Modus nur an der Analyse,
        // entscheidet je nach Gerät die Vorschau-Konfiguration mit — und deren
        // Vorgabe ist nicht zwingend CONTINUOUS_PICTURE.
        //
        // Die Liste wird gefunden, nicht aufgezählt: Wer eine dritte Vorschau
        // baut, ist mitgeprüft.
        val ordner = java.io.File("src/main/java/ch/brickinventoryapp/ui/screens")
        val bauer = (ordner.listFiles { f -> f.extension == "kt" } ?: emptyArray())
            .filter { code(it.readText()).contains("Preview.Builder()") }
        assert(bauer.size >= 2) {
            "Nur ${bauer.size} Datei(en) mit Preview.Builder() gefunden. Erwartet " +
                "werden mindestens Barcodescanner und SetupScreen."
        }
        for (datei in bauer) {
            assert(code(datei.readText()).contains("autofokusDauerhaft(")) {
                "${datei.name} baut eine Vorschau, ohne autofokusDauerhaft() zu " +
                    "rufen. Auf manchen Geräten bleibt das Bild dann unscharf, " +
                    "obwohl der Code richtig aussieht."
            }
        }
    }

    @Test
    fun `die Bildanalyse kommt aus dem gemeinsamen Aufbau`() {
        // Sonst nützt die Regel oben nichts: Wer sich seine ImageAnalysis selbst
        // baut, umgeht autofokusDauerhaft() — und sieht dabei richtig aus.
        val ordner = java.io.File("src/main/java/ch/brickinventoryapp/ui/screens")
        val selbstgebaut = (ordner.listFiles { f -> f.extension == "kt" } ?: emptyArray())
            .filter { it.name != "KameraAufbau.kt" }
            .filter { code(it.readText()).contains("ImageAnalysis.Builder()") }
            .map { it.name }
        assert(selbstgebaut.isEmpty()) {
            "${selbstgebaut.joinToString()} baut die Bildanalyse selbst statt über " +
                "bildAnalyse(). Genau diese Doppelung hat die Behebung aus " +
                "Nachtrag 112 an einer Kopie vorbeilaufen lassen."
        }
    }

    /**
     * Kein „Fokus-Pump" — in KEINER Kameradatei.
     *
     * ── Warum das hier zusammengezogen ist ──────────────────────────────────
     * Diese Regel stand VIERMAL im Testbaum: hier zweimal (Scanner und
     * SetupScreen getrennt), in CameraXUpgradeTest und in
     * SessionAndLifecycleTest. Drei davon zaehlten ausserdem das Vorkommen von
     * CONTROL_AF_MODE_CONTINUOUS_PICTURE je Datei.
     *
     * Aufgefallen ist das erst, als der Kamera-Aufbau in KameraAufbau.kt
     * zusammengefasst wurde und drei dieser Pruefungen rot wurden — nicht weil
     * die Regel verletzt war, sondern weil sie an Kopien gemessen hatten, die
     * es nicht mehr gibt. Das ist dieselbe Fehlerklasse, gegen die der Umbau
     * gerichtet war, nur eine Ebene hoeher: nicht die Regel stand doppelt,
     * sondern ihre Pruefung.
     *
     * Das Muster ist bewusst das WEITERE der beiden, die im Baum standen:
     * `while | delay | Timer | fixedRate` statt nur `LaunchedEffect | while`.
     * Beim Zusammenlegen gewinnt die schaerfere Fassung, sonst geht beim
     * Aufraeumen Deckung verloren.
     */
    @Test
    fun `kein periodisches Nachfokussieren`() {
        // Ein im Takt laufendes startFocusAndMetering unterbricht den
        // kontinuierlichen Autofokus immer wieder. Fokussiert wird NUR beim
        // Antippen.
        val pump = Regex(
            """(while\s*\(|delay\s*\(|Timer\(|fixedRate|LaunchedEffect)[\s\S]{0,400}?startFocusAndMetering""")
        val ordner = java.io.File("src/main/java/ch/brickinventoryapp/ui/screens")
        val dateien = (ordner.listFiles { f -> f.extension == "kt" } ?: emptyArray())
            .filter { code(it.readText()).contains("startFocusAndMetering") }
        assert(dateien.size >= 2) {
            "Nur ${dateien.size} Datei(en) mit startFocusAndMetering gefunden — " +
                "erwartet werden mindestens Barcodescanner und SetupScreen. " +
                "Ein leeres Ergebnis wuerde diesen Test stillschweigend bestehen lassen."
        }
        for (datei in dateien) {
            assert(!pump.containsMatchIn(code(datei.readText()))) {
                "${datei.name}: startFocusAndMetering laeuft in einer Schleife, hinter " +
                    "einem Timer oder in einem Effekt (Fokus-Pump) — das zwingt die " +
                    "Kamera dauernd in einen neuen Suchlauf."
            }
        }
    }
}
