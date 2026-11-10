package ch.brickinventoryapp.app

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Der Scanner darf die Kamera nicht ausbremsen.
 */
class ScannerPerformanceTest {

    // Beide Dateien des Scanners: Der Bildschirm traegt den Tap-to-Focus, die
    // Drosselung der Texterkennung steht in BarcodeAnalyzer.kt.
    // Die Reihenfolge-Pruefungen unten bleiben gueltig — barcodeScanner.process(),
    // letzteOcr und textRecognizer.process() stehen ausschliesslich in der
    // Analyse-Datei, ihre Reihenfolge zueinander aendert das Voranstellen nicht.
    private val src: String by lazy {
        val w = "sammlung/ui/screens/"
        File(Quellen.wurzel, w + "BarcodeScannerScreen.kt").readText() + "\n" +
            File(Quellen.wurzel, w + "BarcodeAnalyzer.kt").readText()
    }
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `die Texterkennung ist gedrosselt, der Barcode-Leser nicht`() {
        val c = code(src)
        assert(c.contains("OCR_INTERVALL_MS")) {
            "Ohne Drosselung läuft die Texterkennung auf jedem Bild und blockiert den " +
                "Analyse-Thread — Vorschau und Autofokus werden dadurch träge"
        }
        val drossel = c.indexOf("letzteOcr.get() < OCR_INTERVALL_MS")
        val ocr = c.indexOf("textRecognizer.process(")
        assert(drossel in 1 until ocr) {
            "Die Zeitschranke muss VOR dem Aufruf der Texterkennung greifen"
        }
        // Der Barcode-Leser darf NICHT gedrosselt sein — er ist billig und soll
        // sofort auslösen.
        val barcode = c.indexOf("barcodeScanner.process(")
        assert(barcode in 1 until drossel) {
            "Der Barcode-Leser wurde mitgedrosselt — er soll auf jedem Bild laufen"
        }
    }

    @Test
    fun `Tippen stellt scharf`() {
        val c = code(src)
        assert(c.contains("tippZumFokus(")) {
            "Ohne Tippen zum Scharfstellen bleibt nur der kontinuierliche Autofokus, " +
                "der bei nahen Vorlagen lange braucht"
        }
        // Dass der Tipper den Fokus auch HÄLT (disableAutoCancel), stand hier
        // als fünfte Kopie derselben Regel. Sie steht jetzt vollständig in
        // CameraFocusConfigTest, dort für JEDE Datei mit Tap-to-Focus statt für
        // eine aufgezählte Auswahl — genau daran ist der SetupScreen
        // vorbeigelaufen. Hier bleibt, was zum Thema dieser Datei gehört: dass
        // es das Tippen überhaupt gibt.
        assert(c.contains("_kameraCtrl.set(")) {
            "Die Kamerasteuerung wird dem Listener nie übergeben — Tippen bliebe wirkungslos"
        }
    }
}
