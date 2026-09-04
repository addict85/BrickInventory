package ch.brickinventoryapp

import org.junit.Test

/**
 * Texterkennung liest die Setnummer von der ANLEITUNG (Nachtrag 60).
 *
 * ── Marcos Wunsch ───────────────────────────────────────────────────────────
 * „Beim OCR wird direkt die Setnummer gelesen. Das heisst bei dieser Erkennung
 * entfällt die Auflösung der EAN-Nummer via Rebrickable. Bitte das Modul fest
 * einbauen."
 *
 * Auf der Anleitung gibt es keinen Barcode — die Nummer steht nur gedruckt da.
 * Der Filter ist deshalb der Kern der Sache: Die Kamera sieht auf so einer
 * Seite mehrere Zahlen, und ohne Einschränkung käme ständig Unsinn heraus.
 *
 * ── Was hier NICHT mehr steht ──────────────────────────────────────────────
 * Die Auswahlregel selbst (welche Zahl im Text die Setnummer ist) wird gegen
 * den gemeinsamen Korpus geprüft, damit Web-App und Android-App dieselbe
 * Antwort geben: SetnummerKorpusTest, shared/setnummer-korpus.json.
 *
 * BEKANNTE GRENZE, bewusst so gelassen: Sind zwei Zahlen gleich plausibel,
 * kann die falsche gewinnen. Dagegen steht der Bestätigungsdialog mit Bild und
 * Name — und seit Marcos Meldung sagt er ausdrücklich, dass die Nummer geraten
 * ist (BarcodeUiState.unsicher). Er ist Teil des Entwurfs, nicht nur
 * Höflichkeit.
 */
class OcrSetNumberTest {

    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `Texterkennung laeuft NUR beim Erfassen, nicht im Preisvergleich`() {
        // ── Nachtrag 61, Marcos Vorgabe ─────────────────────────────────────
        // „Nur bei Set hinzufügen und Teileliste hinzufügen. Beim Preisvergleich
        // wird diese Erkennung nicht benötigt."
        //
        // Der Schalter steht auf AUS als Standard: Wer die Texterkennung will,
        // schaltet sie ein. Damit erbt sie auch kein künftiger Aufrufer
        // versehentlich — genau die Sorte stiller Ausbreitung, die in diesem
        // Projekt schon mehrfach für Überraschungen gesorgt hat.
        val screen = code(java.io.File(
            "src/main/java/ch/brickinventoryapp/ui/screens/BarcodeScannerScreen.kt").readText())
        assert(screen.contains("ocrEnabled: Boolean = false")) {
            "Der Standard muss AUS sein — sonst bekommt jeder Aufrufer die Texterkennung ungefragt"
        }

        // Der Scanner für Galerie und Teileliste schaltet sie ein …
        val tools = code(java.io.File(
            "src/main/java/ch/brickinventoryapp/nav/ToolsGraph.kt").readText())
        assert(tools.contains("ocrEnabled = true")) {
            "Beim Erfassen fehlt die Texterkennung — genau dort ist sie gewollt"
        }

        // … der Preisvergleich nicht.
        val comparison = code(java.io.File(
            "src/main/java/ch/brickinventoryapp/ui/screens/ComparisonScreen.kt").readText())
        assert(!comparison.contains("ocrEnabled")) {
            "Der Preisvergleich schaltet die Texterkennung ein — dort ist sie ausdrücklich nicht gewollt"
        }
    }

    // Die Kandidaten-Regel selbst (Suffix, Stellenzahlen, Bestell- und
    // Elementnummern, Jahre, Mengenangaben, dreistellige Altsets) steht nicht
    // mehr hier: Sie muss in BEIDEN Apps gleich ausfallen und wird deshalb
    // gegen den gemeinsamen Korpus geprueft — SetnummerKorpusTest und
    // shared/setnummer-korpus.json. Hier stand dieselbe Aufzaehlung ein zweites
    // Mal, und nur die App-Seite war damit gedeckt.
}
