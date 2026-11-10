package ch.brickinventoryapp.teile

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Der Barcode-Scanner der TEILELISTE zeigt keine Erfassungsfelder.
 */
class PartsListScannerTest {

    // Der Dialog steht in BarcodeResultDialog.kt; der Erfassungsrahmen zeigt ihn über dem scannenden Ziel.
    private val src: String by lazy {
        File(Quellen.wurzel, "sammlung/ui/Erfassungsrahmen.kt").readText() + "\n" +
            File(Quellen.wurzel, "sammlung/ui/dialogs/BarcodeResultDialog.kt").readText()
    }

    /** Kommentare ausblenden — die Erklärtexte nennen die geprüften Muster selbst. */
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `Eigentuemer, Kaufpreis und Zustand haengen an der Herkunft`() {
        val c = code(src)
        val bedingung = c.indexOf("""if (barcodeState.source != Scannerherkunft.TEILELISTE)""")
        assert(bedingung > 0) {
            "Die Erfassungsfelder stehen nicht mehr unter der Herkunfts-Bedingung — aus der " +
                "Teileliste wären sie wirkungslos, würden aber wie eine echte Eingabe aussehen"
        }
        // Alle drei Felder müssen NACH der Bedingung stehen.
        for ((muster, name) in listOf(
            "OwnerPicker("            to "Eigentümer-Auswahl",
            "barcode_purchase_price"  to "Kaufpreis-Feld",
            "Zustandszeile("           to "Zustands-Umschalter",
        )) {
            val pos = c.indexOf(muster, bedingung)
            assert(pos > bedingung) { "$name steht nicht innerhalb des Erfassungs-Zweigs" }
        }
    }

    @Test
    fun `das Bild bleibt in beiden Faellen sichtbar`() {
        val c = code(src)
        val bild = c.indexOf("ProduktBild(")
        val bedingung = c.indexOf("""if (barcodeState.source != Scannerherkunft.TEILELISTE)""")
        assert(bild in 1 until bedingung) {
            "Das Vorschaubild darf NICHT im Erfassungs-Zweig liegen — es ist der Grund, " +
                "warum der Dialog überhaupt erscheint: prüfen, ob das richtige Set gescannt wurde"
        }
    }

    @Test
    fun `aus der Teileliste wird nur die Setnummer uebergeben`() {
        val c = code(src)
        assert(c.contains("""aktionen.confirmAddBarcode(Erfassungswunsch(barcodeState.result))""")) {
            "Der Teilelisten-Weg soll nur die Nummer übergeben — Werte mitzuschicken, die " +
                "niemand eingeben konnte, verschleiert beim Lesen, was gemeint ist"
        }
    }
}
