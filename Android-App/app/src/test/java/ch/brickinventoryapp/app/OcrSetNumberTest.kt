package ch.brickinventoryapp.app

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Texterkennung liest die Setnummer von der ANLEITUNG. Dort gibt es keinen Barcode,
 * und die Kamera sieht mehrere Zahlen: Ohne den Filter käme ständig Unsinn heraus.
 *
 * ── Was hier NICHT mehr steht ──────────────────────────────────────────────
 * Die Auswahlregel selbst (welche Zahl im Text die Setnummer ist) wird gegen
 * den gemeinsamen Korpus geprüft, damit Web-App und Android-App dieselbe
 * Antwort geben: SetnummerKorpusTest, shared/setnummer-korpus.json.
 *
 * BEKANNTE GRENZE, bewusst so gelassen: Sind zwei Zahlen gleich plausibel,
 * kann die falsche gewinnen. Dagegen steht der Bestätigungsdialog mit Bild und
 * Name — und er sagt ausdrücklich, dass die Nummer geraten
 * ist (BarcodeUiState.unsicher). Er ist Teil des Entwurfs, nicht nur
 * Höflichkeit.
 */
class OcrSetNumberTest {

    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `Texterkennung laeuft NUR beim Erfassen, nicht im Preisvergleich`() {
        // Der Schalter steht auf AUS: So erbt kein künftiger Aufrufer die Texterkennung.
        val screen = code(File(Quellen.wurzel,
            "sammlung/ui/screens/BarcodeScannerScreen.kt").readText())
        assert(screen.contains("ocrEnabled: Boolean = false")) {
            "Der Standard muss AUS sein — sonst bekommt jeder Aufrufer die Texterkennung ungefragt"
        }

        // Der Scanner für Galerie und Teileliste schaltet sie ein …
        val tools = code(File(Quellen.wurzel,
            "app/nav/ToolsGraph.kt").readText())
        assert(tools.contains("ocrEnabled = true")) {
            "Beim Erfassen fehlt die Texterkennung — genau dort ist sie gewollt"
        }

        // … der Preisvergleich nicht.
        val comparison = code(File(Quellen.wurzel,
            "sammlung/ui/screens/ComparisonScreen.kt").readText())
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
