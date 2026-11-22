package ch.brickinventoryapp.parts

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Sources

/**
 * The PARTS LIST's barcode scanner shows no entry fields.
 */
class PartsListScannerTest {

    // The dialog lives in BarcodeResultDialog.kt; the capture frame shows it above the scanning target.
    private val src: String by lazy {
        File(Sources.root, "collection/ui/EntryFrame.kt").readText() + "\n" +
            File(Sources.root, "collection/ui/dialogs/BarcodeResultDialog.kt").readText()
    }

    /** Hide comments — the explanatory texts name the checked patterns themselves. */
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `owner, purchase price and condition depend on the origin`() {
        val c = code(src)
        val condition = c.indexOf("""if (barcodeState.source != ScannerOrigin.PART_LIST)""")
        assert(condition > 0) {
            "Die Erfassungsfelder stehen nicht mehr unter der Herkunfts-Bedingung — aus der " +
                "Teileliste wären sie wirkungslos, würden aber wie eine echte Eingabe aussehen"
        }
        // All three fields must stand AFTER the condition.
        for ((pattern, name) in listOf(
            "OwnerPicker("            to "Eigentümer-Auswahl",
            "barcode_purchase_price"  to "Kaufpreis-Feld",
            "ConditionRow("           to "Zustands-Umschalter",
        )) {
            val pos = c.indexOf(pattern, condition)
            assert(pos > condition) { "$name steht nicht innerhalb des Erfassungs-Zweigs" }
        }
    }

    @Test
    fun `the image stays visible in both cases`() {
        val c = code(src)
        val image = c.indexOf("ProductImage(")
        val condition = c.indexOf("""if (barcodeState.source != ScannerOrigin.PART_LIST)""")
        assert(image in 1 until condition) {
            "Das Vorschaubild darf NICHT im Erfassungs-Zweig liegen — es ist der Grund, " +
                "warum der Dialog überhaupt erscheint: prüfen, ob das richtige Set gescannt wurde"
        }
    }

    @Test
    fun `from the parts list only the set number is passed`() {
        val c = code(src)
        assert(c.contains("""actions.confirmAddBarcode(EntryRequest(barcodeState.result))""")) {
            "Der Teilelisten-Weg soll nur die Nummer übergeben — Werte mitzuschicken, die " +
                "niemand eingeben konnte, verschleiert beim Lesen, was gemeint ist"
        }
    }
}
