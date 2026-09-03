package ch.brickinventoryapp

import ch.brickinventoryapp.ui.screens.setNumberCandidates
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
 * ── Was sich geändert hat (Marcos Meldung „falsche Nummern") ────────────────
 * Hier stand „die längste Zahl gewinnt", und die Prüfung unten schrieb die
 * Annahme fest: „Die Setnummer ist auf der Seite fast immer die längste Zahl."
 *
 * Auf einer Anleitung stimmt das nicht. Dort stehen sechs- und siebenstellige
 * Zahlen, die KEINE Setnummern sind — die Bestellnummer des Hefts auf dem
 * Umschlag, die Elementnummern in der Teileliste. Die Setnummer hat vier oder
 * fünf Stellen. Die alte Regel griff also regelmässig daneben.
 *
 * BEKANNTE GRENZE, bewusst so gelassen: Sind zwei Zahlen gleich plausibel,
 * kann die falsche gewinnen. Dagegen steht der Bestätigungsdialog mit Bild und
 * Name — und seit dieser Meldung sagt er ausdrücklich, dass die Nummer geraten
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

    @Test
    fun `die Setnummer wird aus einer Anleitungsseite gelesen`() {
        // Wie auf Marcos Beispielbild: Nummer gross, Altersangabe daneben.
        val k = setNumberCandidates("LEGO 60445-1\n8+\n1215")
        assert(k.firstOrNull() == "60445-1") {
            "Erwartet 60445-1 als ersten Kandidaten, bekam: $k"
        }
    }

    @Test
    fun `eine nackte Setnummer wird erkannt`() {
        assert(setNumberCandidates("31142").firstOrNull() == "31142")
    }

    @Test
    fun `zu kurze Zahlen fallen raus`() {
        // Altersangaben und Seitenzahlen dürfen KEINEN Dialog auslösen —
        // sonst wird der Scanner auf jeder zweiten Seite zudringlich.
        assert(setNumberCandidates("8+  Ages  12  Seite 7").isEmpty()) {
            "drei- und zweistellige Zahlen dürfen nicht als Setnummer gelten"
        }
    }

    @Test
    fun `die plausiblere Stellenzahl steht vorn`() {
        // Fünfstellig schlägt vierstellig — das ist die häufigste Form einer
        // Setnummer, und die Teilezahl daneben hat meist vier.
        val k = setNumberCandidates("1215 Teile  75192")
        assert(k.first() == "75192") { "Reihenfolge falsch: $k" }
    }

    @Test
    fun `die Bestellnummer des Hefts gewinnt NICHT`() {
        // Genau Marcos Fall: Auf dem Umschlag einer Anleitung steht die
        // siebenstellige Bestellnummer gross oben, die Setnummer daneben. Die
        // alte Regel („die längste gewinnt") nahm die Bestellnummer.
        val k = setNumberCandidates("6284070\n75192\n1215")
        assert(k.first() == "75192") {
            "Die siebenstellige Bestellnummer hat gewonnen: $k"
        }
    }

    @Test
    fun `die Elementnummer aus der Teileliste gewinnt NICHT`() {
        // Sechsstellige Elementnummern stehen in jeder Teileliste.
        val k = setNumberCandidates("Teile: 302326 4211525\nSet 31142")
        assert(k.first() == "31142") { "Elementnummer hat gewonnen: $k" }
    }

    @Test
    fun `die eindeutige Schreibweise mit Suffix schlaegt alles`() {
        // `60445-1` ist die einzige Form, die auf der Seite nichts anderes
        // sein kann.
        val k = setNumberCandidates("6284070  60445-1  75192")
        assert(k.first() == "60445-1") { "Suffix-Form nicht vorn: $k" }
    }
}
