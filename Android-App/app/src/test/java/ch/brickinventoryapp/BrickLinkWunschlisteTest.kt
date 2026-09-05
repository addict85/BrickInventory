package ch.brickinventoryapp

import ch.brickinventoryapp.util.BrickLinkWunschliste
import ch.brickinventoryapp.util.BrickLinkWunschliste.Posten
import org.junit.Test

/**
 * Die BrickLink-Wunschliste — die einzige Stelle dieser Reihe, an der die App
 * eine Datei erzeugt, die ein FREMDES System einliest.
 *
 * Das macht den Unterschied zu den übrigen Prüfungen hier: Ein Fehler zeigt
 * sich nicht in der App, sondern erst bei BrickLink, als abgewiesener Import
 * ohne brauchbare Meldung. Deshalb wird hier die Ausgabe selbst verglichen und
 * nicht nur, dass sie entsteht.
 */
class BrickLinkWunschlisteTest {

    @Test
    fun `fehlend ist gebraucht minus vorhanden, Rest null faellt weg`() {
        val gebraucht = listOf(
            Posten("P", "3001", 5, 10),
            Posten("P", "3002", 1, 4),
            Posten("P", "3003", 0, 2),
        )
        val vorhanden = mapOf("P|3001|5" to 3, "P|3002|1" to 4)
        val fehlend = BrickLinkWunschliste.ausBestand(gebraucht, vorhanden) {
            "${it.typ}|${it.teil}|${it.farbe ?: 0}"
        }
        // 3001: 10-3 = 7 bleibt. 3002: 4-4 = 0 faellt weg. 3003: nichts
        // eingetragen, also 2 - 0 = 2 — ein leeres Feld heisst „habe keins",
        // nicht „ueberspringen".
        assert(fehlend == listOf(Posten("P", "3001", 5, 7), Posten("P", "3003", 0, 2))) {
            "Falsche Differenz: $fehlend"
        }
    }

    @Test
    fun `mehr vorhanden als gebraucht faellt weg statt negativ zu werden`() {
        val fehlend = BrickLinkWunschliste.ausBestand(
            listOf(Posten("P", "3001", 5, 2)), mapOf("P|3001|5" to 9)
        ) { "${it.typ}|${it.teil}|${it.farbe ?: 0}" }
        // Eine negative MINQTY waere fuer BrickLink ein Fehler in der Datei;
        // gemeint ist ohnehin „fehlt nicht".
        assert(fehlend.isEmpty()) { "Negativer Posten durchgelassen: $fehlend" }
    }

    @Test
    fun `gleiche Teile werden zusammengezaehlt, Reihenfolge bleibt`() {
        val zusammen = BrickLinkWunschliste.zusammenfassen(listOf(
            Posten("P", "3001", 5, 2),
            Posten("P", "3002", 1, 1),
            Posten("P", "3001", 5, 3),
            // Dieselbe Nummer in anderer Farbe ist ein ANDERER Posten.
            Posten("P", "3001", 4, 1),
        ))
        assert(zusammen == listOf(
            Posten("P", "3001", 5, 5),
            Posten("P", "3002", 1, 1),
            Posten("P", "3001", 4, 1),
        )) { "Falsch zusammengefasst: $zusammen" }
    }

    @Test
    fun `XML entspricht dem der Webapp`() {
        val xml = BrickLinkWunschliste.xml(
            listOf(Posten("P", "3001", 5, 7), Posten("M", "sw0001a", 0, 1)),
            BrickLinkWunschliste.ZUSTAND_EGAL
        )
        // Wortgleich mit dem, was 08-init.js (plExportBricklink) schreibt —
        // dieselbe Feldreihenfolge, dieselbe Einrueckung, COLOR nur bei Teilen.
        val erwartet = """
            <?xml version="1.0" encoding="UTF-8"?>
            <INVENTORY>
              <ITEM>
                <ITEMTYPE>P</ITEMTYPE>
                <ITEMID>3001</ITEMID>
                <COLOR>5</COLOR>
                <MINQTY>7</MINQTY>
                <CONDITION>X</CONDITION>
              </ITEM>
              <ITEM>
                <ITEMTYPE>M</ITEMTYPE>
                <ITEMID>sw0001a</ITEMID>
                <MINQTY>1</MINQTY>
                <CONDITION>X</CONDITION>
              </ITEM>
            </INVENTORY>
        """.trimIndent()
        assert(xml == erwartet) { "Andere Ausgabe als die Webapp:\n$xml" }
    }

    @Test
    fun `COLOR null steht auch bei einem Teil nicht in der Datei`() {
        val xml = BrickLinkWunschliste.xml(
            listOf(Posten("P", "3001", null, 1)), BrickLinkWunschliste.ZUSTAND_NEU)
        // Ein leeres <COLOR></COLOR> weist BrickLink ab; kein Feld heisst
        // „egal welche Farbe" und wird angenommen.
        assert(!xml.contains("COLOR")) { "Leeres Farbfeld geschrieben:\n$xml" }
        assert(xml.contains("<CONDITION>N</CONDITION>")) { "Zustand fehlt:\n$xml" }
    }

    @Test
    fun `Sonderzeichen werden maskiert`() {
        val xml = BrickLinkWunschliste.xml(
            listOf(Posten("P", "3001&x", 5, 1)), BrickLinkWunschliste.ZUSTAND_GEBRAUCHT)
        // Die Webapp schreibt hier ungeprueft; das Ergebnis waere kein
        // gueltiges XML mehr, und der Fehler faellt erst bei BrickLink auf.
        assert(xml.contains("<ITEMID>3001&amp;x</ITEMID>")) { "Nicht maskiert:\n$xml" }
    }

    /**
     * Der Schlüssel, über den Eingabe und Export sich finden, wird an ZWEI
     * Stellen gebildet: im Bildschirm beim Tippen und im Export beim
     * Abgleichen. Beide rufen dieselbe Funktion — und genau das prüft dieser
     * Test, statt es zu glauben.
     *
     * Warum es das wert ist: Liefen die beiden auseinander, fände der Export
     * keine einzige Eingabe und meldete jedes Teil als fehlend. Das sähe aus
     * wie ein leeres Formular, nicht wie ein Fehler — die Sorte Defekt, die
     * niemand meldet.
     */
    @Test
    fun `Bildschirm und Export bilden den Schluessel an derselben Stelle`() {
        val src = Quellen.lies("ui/PartsListFeature.kt")
        val screen = Quellen.lies("ui/screens/PartsListScreen.kt")
        assert(Quellen.ohneKommentare(src).contains("plSchluessel(")) {
            "Der Export baut den Schluessel selbst statt plSchluessel() zu rufen"
        }
        assert(Regex("""fun plSchluessel\(""").findAll(screen).count() == 2) {
            "plSchluessel steht nicht mehr genau zweimal (Wert + Zeile) in PartsListScreen.kt"
        }
    }
}
