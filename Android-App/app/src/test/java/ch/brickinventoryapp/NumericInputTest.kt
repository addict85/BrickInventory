package ch.brickinventoryapp

import ch.brickinventoryapp.util.NumericInput
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Zahlenfelder: Zahlenpad und erlaubte Zeichen — eine Fassung.
 *
 * ── Marcos Wunsch ───────────────────────────────────────────────────────────
 * „Die Felder mit der Setnummer (beim Erfassen) sollen nur Zahlen erlauben, und
 * wenn darin geklickt wird, soll nur das Zahlenpad angezeigt werden. Bei allen
 * Preis- und Anzahlfeldern ebenfalls."
 *
 * ── Warum beides zusammengehört ─────────────────────────────────────────────
 * Die Tastaturwahl ist eine BITTE an die Tastatur-App, keine Zusicherung: Viele
 * Tastaturen zeigen auf `Number` trotzdem eine Umschalttaste zu Buchstaben, und
 * über Einfügen aus der Zwischenablage kommt ohnehin alles herein. Deshalb
 * prüft dieser Test beides — die Filterung UND dass kein Zahlenfeld ohne
 * Tastaturwahl dasteht.
 */
class NumericInputTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()

    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    // ── Die Filterung ────────────────────────────────────────────────────────

    @Test
    fun `die Setnummer laesst Buchstaben nicht durch`() {
        assertEquals("42200", NumericInput.setNumber("42200"))
        assertEquals("42200", NumericInput.setNumber("abc42200xyz"))
        assertEquals("", NumericInput.setNumber("Police Truck"))
    }

    @Test
    fun `der Varianten-Bindestrich bleibt erlaubt`() {
        // „Nur Zahlen" heisst: keine BUCHSTABEN. LEGO-Setnummern tragen die
        // Variante hinter dem Strich (10179-2). Verböte das Feld ihn, liesse
        // sich jede Variante ausser der ersten gar nicht mehr erfassen — die
        // App ergänzt beim Erfassen nur „-1", wenn nichts angegeben ist.
        assertEquals("10179-2", NumericInput.setNumber("10179-2"))
    }

    @Test
    fun `die Menge nimmt nur Ziffern`() {
        assertEquals("12", NumericInput.quantity("1x2"))
        assertEquals("12", NumericInput.quantity("-12"))
        assertEquals("", NumericInput.quantity("zwei"))
    }

    @Test
    fun `der Preis nimmt genau ein Trennzeichen`() {
        assertEquals("12.50", NumericInput.price("12.50"))
        assertEquals("12,50", NumericInput.price("12,50"))   // deutsche Tastatur
        // Ohne diese Begrenzung wäre „12.3.4" tippbar und fiele erst beim
        // Umwandeln auf — dann still als Preis null.
        assertEquals("12.34", NumericInput.price("12.3.4"))
        assertEquals("1250", NumericInput.price("CHF 1250"))
    }

    // ── Die Tastatur ─────────────────────────────────────────────────────────

    /**
     * Jeder OutlinedTextField-Aufruf im Quellbaum: Datei, Zeile, ganzer Aufruf.
     *
     * Das Ende des Aufrufs kommt über die Klammerbilanz, nicht über ein festes
     * Fenster — ein Fenster reichte in den nächsten Aufruf hinein (die Falle,
     * die in diesem Projekt schon fünfmal zugeschlagen hat). Gelesen wird ohne
     * Kommentarzeilen: Sonst genügte ein Kommentar, der den gesuchten Namen
     * nennt, und die Regel wäre zufrieden.
     */
    private fun textfelder(): List<Triple<String, Int, String>> {
        val dateien = java.io.File("src/main/java/ch/brickinventoryapp")
            .walkTopDown().filter { it.extension == "kt" }.toList()
            .also {
                // Untergrenze (Nachtrag 118): ein leerer Dateilauf lässt jede
                // Sammelprüfung darunter stillschweigend bestehen.
                check(it.size >= 20) { "Zu wenige Kotlin-Dateien gefunden (${it.size}) — Pfad veraltet?" }
            }
        val treffer = mutableListOf<Triple<String, Int, String>>()
        for (datei in dateien) {
            val s = code(datei.readText())
            var pos = 0
            while (true) {
                val i = s.indexOf("OutlinedTextField(", pos)
                if (i < 0) break
                var tiefe = 0
                var j = i + "OutlinedTextField".length
                var k = j
                while (k < s.length) {
                    if (s[k] == '(') tiefe++
                    else if (s[k] == ')') { tiefe--; if (tiefe == 0) { j = k; break } }
                    k++
                }
                val zeile = s.substring(0, i).count { c -> c == '\n' } + 1
                treffer += Triple(datei.name, zeile, s.substring(i, minOf(j + 1, s.length)))
                pos = j + 1
            }
        }
        check(treffer.size >= 10) { "Nur ${treffer.size} Textfelder gefunden — greift die Suche noch?" }
        return treffer
    }

    @Test
    fun `kein Zahlenfeld steht ohne Tastaturwahl da`() {
        val ohne = textfelder().filter { (_, _, block) ->
            val istZahlenfeld = block.contains("NumericInput.quantity(") ||
                block.contains("NumericInput.price(") ||
                block.contains("NumericInput.setNumber(")
            istZahlenfeld && !block.contains("keyboardOptions")
        }.map { (datei, zeile, _) -> "$datei:$zeile" }
        assert(ohne.isEmpty()) {
            "Zahlenfelder ohne Tastaturwahl: ${ohne.joinToString(", ")} — dort muss " +
                "man auf dem Telefon erst zu den Zahlen umschalten"
        }
    }

    @Test
    fun `jedes Setnummernfeld nimmt Filter und Zahlenpad`() {
        // ── Marcos Meldung vom 22.09. ────────────────────────────────────────
        // „Wenn ich in der Android-App im Reiter Teileliste ins Feld klicke,
        // soll sich analog den anderen Feldern nicht die Tastatur sondern nur
        // das Zahlenfeld angezeigt werden."
        //
        // Das Feld in PartsListScreen war das einzige der drei
        // Setnummernfelder, das weder Filter noch Tastaturwahl trug. Die Regel
        // darüber konnte es nicht sehen: Sie greift erst, wenn ein Feld
        // NumericInput SCHON benutzt — ein Feld, das gar nicht erst als
        // Zahlenfeld gebaut ist, fällt durch ihr Raster.
        //
        // Erkannt werden die Felder an der Beschriftung, denn die steht als
        // Textbaustein daneben und lässt sich nicht mit einer Umbenennung der
        // Zustandsvariablen verlieren.
        val felder = textfelder().filter { (_, _, block) ->
            Regex("""R\.string\.[A-Za-z0-9_]*set_number[A-Za-z0-9_]*""").containsMatchIn(block)
        }
        // Drei sind es heute: Galerie („Set hinzufügen"), Merkliste und
        // Teileliste. Weniger heisst: Die Suche greift nicht mehr.
        assert(felder.size >= 3) {
            "Nur ${felder.size} Setnummernfelder gefunden — greift die Suche noch?"
        }
        val luecken = mutableListOf<String>()
        for ((datei, zeile, block) in felder) {
            if (!block.contains("NumericInput.setNumber("))
                luecken += "$datei:$zeile (ohne Filter)"
            if (!block.contains("keyboardOptions"))
                luecken += "$datei:$zeile (ohne Tastaturwahl)"
        }
        assert(luecken.isEmpty()) {
            "Setnummernfelder ohne das Paar aus NumericInput: " +
                "${luecken.joinToString(", ")} — dort geht die Buchstabentastatur auf"
        }
    }

    @Test
    fun `keine Ansicht filtert Zahlen mehr selbst`() {
        // Sonst gäbe es wieder mehrere Fassungen derselben Regel — und die
        // Preis-Fassung mit nur EINEM Trennzeichen fehlte den anderen.
        val dateien = java.io.File("src/main/java/ch/brickinventoryapp")
            .walkTopDown().filter { it.extension == "kt" && it.name != "NumericInput.kt" }
        for (datei in dateien) {
            val s = code(datei.readText())
            assert(!s.contains("filter(Char::isDigit)")) {
                "${datei.name} filtert Ziffern selbst — das gehört in NumericInput"
            }
            assert(!s.contains("c.isDigit() || c == '.'")) {
                "${datei.name} filtert Preise selbst — das gehört in NumericInput"
            }
        }
    }
}
