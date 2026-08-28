package ch.brickinventoryapp

import org.junit.Test

/**
 * Der Barcode-Scanner der TEILELISTE zeigt keine Erfassungsfelder.
 *
 * ── Woher dieser Test kommt (Marcos Wunsch, Nachtrag 56) ────────────────────
 * „Im Reiter Teileliste soll der Barcodescanner nur das Bild anzeigen ohne
 * Konto, Kaufpreis und Zustand. Beim Klick auf Hinzufügen soll das Set nur in
 * die Teileliste hinzugefügt werden, um die Liste zu generieren."
 *
 * Der zweite Teil war bereits erfüllt: confirmAddBarcode() verzweigt bei
 * `scannerSource == "partslist"` und reicht die Nummer nur an die Teileliste
 * weiter — es entsteht KEIN Bestand. Genau deshalb waren die Felder aber
 * besonders unangenehm: Eigentümer, Kaufpreis und Zustand liessen sich
 * ausfüllen, und nichts davon wurde je gespeichert. Eine Eingabe, die aussieht,
 * als zählte sie, ist schlimmer als gar keine.
 *
 * Bild, Name, Setnummer und die Kennzahlen bleiben sichtbar — sie helfen beim
 * Prüfen, ob das richtige Set gescannt wurde, und darum geht es hier.
 *
 * Der Test liest nur die Quelldatei — kein Gerät, kein Compose.
 */
class PartsListScannerTest {

    private val src: String by lazy {
        java.io.File("src/main/java/ch/brickinventoryapp/AppNavigation.kt").readText()
    }

    /** Kommentare ausblenden — die Erklärtexte nennen die geprüften Muster selbst. */
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `Eigentuemer, Kaufpreis und Zustand haengen an der Herkunft`() {
        val c = code(src)
        val bedingung = c.indexOf("""if (barcodeState.source != "partslist")""")
        assert(bedingung > 0) {
            "Die Erfassungsfelder stehen nicht mehr unter der Herkunfts-Bedingung — aus der " +
                "Teileliste wären sie wirkungslos, würden aber wie eine echte Eingabe aussehen"
        }
        // Alle drei Felder müssen NACH der Bedingung stehen.
        for ((muster, name) in listOf(
            "OwnerPicker("            to "Eigentümer-Auswahl",
            "barcode_purchase_price"  to "Kaufpreis-Feld",
            "ConditionToggle("        to "Zustands-Umschalter",
        )) {
            val pos = c.indexOf(muster, bedingung)
            assert(pos > bedingung) { "$name steht nicht innerhalb des Erfassungs-Zweigs" }
        }
    }

    @Test
    fun `das Bild bleibt in beiden Faellen sichtbar`() {
        val c = code(src)
        val bild = c.indexOf("AsyncImage(")
        val bedingung = c.indexOf("""if (barcodeState.source != "partslist")""")
        assert(bild in 1 until bedingung) {
            "Das Vorschaubild darf NICHT im Erfassungs-Zweig liegen — es ist der Grund, " +
                "warum der Dialog überhaupt erscheint: prüfen, ob das richtige Set gescannt wurde"
        }
    }

    @Test
    fun `aus der Teileliste wird nur die Setnummer uebergeben`() {
        val c = code(src)
        assert(c.contains("""vm.confirmAddBarcode(barcodeState.result!!)""")) {
            "Der Teilelisten-Weg soll nur die Nummer übergeben — Werte mitzuschicken, die " +
                "niemand eingeben konnte, verschleiert beim Lesen, was gemeint ist"
        }
    }

    @Test
    fun `der Teilelisten-Zweig legt keinen Bestand an`() {
        val feature = code(
            java.io.File("src/main/java/ch/brickinventoryapp/ui/BarcodeFeature.kt").readText())
        val zweig = feature.indexOf("""if (_barcodeState.value.source == "partslist")""")
        assert(zweig > 0) { "der Teilelisten-Zweig in confirmAddBarcode fehlt" }
        val bisReturn = feature.substring(zweig, feature.indexOf("return", zweig))
        assert(!bisReturn.contains("repo.addSet")) {
            "Aus der Teileliste darf KEIN Set in die Sammlung erfasst werden — die Nummer " +
                "wird nur an die Liste weitergereicht"
        }
        assert(bisReturn.contains("fuerTeileliste")) {
            "die gescannte Nummer muss an die Teileliste weitergereicht werden"
        }
    }
}
