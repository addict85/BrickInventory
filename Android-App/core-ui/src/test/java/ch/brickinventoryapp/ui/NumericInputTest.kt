package ch.brickinventoryapp.ui

import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import ch.brickinventoryapp.ui.util.NumericInput
import org.junit.Assert.assertEquals
import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * Zahlenfelder: Zahlenpad und erlaubte Zeichen — eine Fassung.
 *
 * ── Warum beides zusammengehört ─────────────────────────────────────────────
 * Die Tastaturwahl ist eine BITTE an die Tastatur-App, keine Zusicherung: Viele
 * Tastaturen zeigen auf `Number` trotzdem eine Umschalttaste zu Buchstaben, und
 * über Einfügen aus der Zwischenablage kommt ohnehin alles herein. Deshalb
 * braucht jedes Zahlenfeld beides: den Filter und die Tastaturwahl.
 *
 * Hier steht seit dem 28.09. die FILTERUNG — was NumericInput mit einer
 * Eingabe macht — und die Sonderregel für die Setnummernfelder, die ihre
 * Felder an der Beschriftung erkennt. Die Sammelregel „jedes gefilterte Feld
 * zeigt auch die Zahlentastatur" steht in ZahlentastaturTest; siehe die
 * Notiz unten, wo sie vorher stand.
 *
 * Seit 8.11. lässt die Setnummer auch Buchstaben durch (llca30, comcon001), wie
 * normalisiereSetNummer der Web-App; ihre Felder zeigen dafür die Texttastatur.
 * Gegenprobe (gegenproben/setnummer-nur-ziffern.patch): der Filter wieder nur
 * Ziffern und „-" → rot „die Setnummer laesst Buchstaben und Ziffern durch …".
 *
 * Betrag und Menge: leseBetrag folgt leseBetrag der Web-App (format.js).
 * Gegenprobe (gegenproben/betrag-tausenderpunkt.patch): price() schneidet wieder am
 * zweiten Trenner ab → rot „eine eingefuegte Zahl mit Tausendertrennung bleibt ihr Wert".
 */
class NumericInputTest {

    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    // ── Die Filterung ────────────────────────────────────────────────────────

    @Test
    fun `die Setnummer laesst Buchstaben und Ziffern durch, sonst nichts`() {
        assertEquals("42200", NumericInput.setNumber("42200"))
        // Wie normalisiereSetNummer der Web-App: Buchstaben und Ziffern, Rest fällt weg.
        assertEquals("llca30", NumericInput.setNumber("llca30"))
        assertEquals("comcon001", NumericInput.setNumber("comcon001"))
        assertEquals("42200xyz", NumericInput.setNumber("42 200 xyz"))
        assertEquals("PoliceTruck", NumericInput.setNumber("Police Truck!"))
        assertEquals("", NumericInput.setNumber("äö €#"))
        // Nicht-ASCII-Ziffern (arabisch-indisch) und Umlaute trafen in der Web-App keine Zeile.
        assertEquals("", NumericInput.setNumber("\u0663\u00e4"))
    }

    @Test
    fun `die Setnummer-Tastatur ist eine Texttastatur ohne Grossschreibung`() {
        val t = NumericInput.setnummerTastatur()
        assertEquals(KeyboardType.Ascii, t.keyboardType)
        assertEquals(KeyboardCapitalization.None, t.capitalization)
        assertEquals(ImeAction.Done, NumericInput.setnummerTastatur(ImeAction.Done).imeAction)
    }

    @Test
    fun `der Varianten-Bindestrich bleibt erlaubt`() {
        // LEGO-Setnummern tragen die Variante hinter dem Strich (10179-2). Verböte das
        // Feld ihn, liesse sich jede Variante ausser der ersten nicht mehr erfassen.
        assertEquals("10179-2", NumericInput.setNumber("10179-2"))
    }

    /**
     * Gegenprobe: setnummerMuster auf `\d+` verkürzt → "10294-1" rot; auf `.*` geweitet → "--" rot.
     */
    @Test
    fun `eine Setnummer hat Ziffern und hoechstens eine Variante`() {
        for (gut in listOf("10294", "10294-1", "75192-12", " 75192 ")) assertEquals(gut, true, NumericInput.istSetnummer(gut))
        for (schlecht in listOf("", "-", "--", "10294-", "-1", "1-2-3", "10294-1234", "abc!!")) {
            assertEquals(schlecht, false, NumericInput.istSetnummer(schlecht))
        }
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

    @Test
    fun `ein Betrag wird gelesen wie in der Web-App`() {
        val de = '.'
        val en = ','
        // Beide Schreibweisen mit Tausendertrennung, in jeder Sprache gleich.
        assertEquals(1299.0, NumericInput.leseBetrag("1.299,00", de)!!, 0.0)
        assertEquals(1299.0, NumericInput.leseBetrag("1.299,00", en)!!, 0.0)
        assertEquals(1299.5, NumericInput.leseBetrag("1,299.50", de)!!, 0.0)
        assertEquals(1299.5, NumericInput.leseBetrag("1,299.50", en)!!, 0.0)
        assertEquals(1234567.0, NumericInput.leseBetrag("1.234.567", de)!!, 0.0)
        assertEquals(149.95, NumericInput.leseBetrag("149,95", de)!!, 0.0)
        assertEquals(149.95, NumericInput.leseBetrag("149.95", en)!!, 0.0)
        assertEquals(12.0, NumericInput.leseBetrag("12,", de)!!, 0.0)
        assertEquals(0.5, NumericInput.leseBetrag(",5", de)!!, 0.0)
        assertEquals(1299.0, NumericInput.leseBetrag("1'299.00", en)!!, 0.0)
        assertEquals(12.5, NumericInput.leseBetrag("€ 12,50", de)!!, 0.0)
        // Ein einzelner Trenner vor drei Ziffern: Tausender nur, wenn er das Gruppenzeichen ist.
        assertEquals(1299.0, NumericInput.leseBetrag("1.299", de)!!, 0.0)
        assertEquals(1.299, NumericInput.leseBetrag("1.299", en)!!, 0.0)
        assertEquals(1.299, NumericInput.leseBetrag("1,299", de)!!, 0.0)
        assertEquals(1299.0, NumericInput.leseBetrag("1,299", en)!!, 0.0)
        assertEquals(0.123, NumericInput.leseBetrag("0.123", de)!!, 0.0)
    }

    @Test
    fun `ein unlesbarer Betrag ist null, ein leerer auch, aber nur der unlesbare ist ungueltig`() {
        for (roh in listOf("", " ", ".", ",", "12.3.4", "1.29.900", "12,50.1", "abc", "1,2,3")) {
            assertEquals("'$roh'", null, NumericInput.leseBetrag(roh, '.'))
        }
        assertEquals(false, NumericInput.preisUngueltig("", '.'))
        assertEquals(false, NumericInput.preisUngueltig("1.299,00", '.'))
        assertEquals(true, NumericInput.preisUngueltig(",", '.'))
        assertEquals(true, NumericInput.preisUngueltig("12.3.4", '.'))
    }

    @Test
    fun `eine eingefuegte Zahl mit Tausendertrennung bleibt ihr Wert`() {
        // Das Abschneiden am zweiten Trenner machte aus „1.299,00" den Preis 1,299.
        assertEquals("1299,00", NumericInput.price("1.299,00", '.'))
        assertEquals("1299.50", NumericInput.price("1,299.50", ','))
        assertEquals("1299000", NumericInput.price("1.299.000", '.'))
        // Beim Tippen: der zweite Trenner nach den Tausendern setzt das Dezimalzeichen.
        assertEquals("1299,", NumericInput.price("1.299,", '.'))
        // Kein gültiger Betrag mit zwei Trennern: wie bisher der erste Trenner.
        assertEquals("12.34", NumericInput.price("12.3.4", '.'))
        // Der gefilterte Text ergibt denselben Wert wie der eingefügte.
        assertEquals(1299.0, NumericInput.leseBetrag(NumericInput.price("1.299,00", '.'), '.')!!, 0.0)
    }

    @Test
    fun `eine Menge ist leer oder eine Zahl ab 1`() {
        assertEquals(false, NumericInput.mengeUngueltig(""))
        assertEquals(false, NumericInput.mengeUngueltig("1"))
        assertEquals(false, NumericInput.mengeUngueltig("250"))
        assertEquals(true, NumericInput.mengeUngueltig("0"))
        assertEquals(true, NumericInput.mengeUngueltig("00"))
        // Über Int: Das wurde bisher still zu 1.
        assertEquals(true, NumericInput.mengeUngueltig("99999999999"))
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
        val dateien = Quellen.wurzel
            .walkTopDown().filter { it.extension == "kt" }.toList()
            .also {
                // Untergrenze: ein leerer Dateilauf lässt jede
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

    // ── Hier stand „kein Zahlenfeld steht ohne Tastaturwahl da" ──────────────
    //
    // Die Regel ist nicht weggefallen, sie ist umgezogen: nach
    // ZahlentastaturTest, „wer Zahlen filtert, zeigt auch die
    // Zahlentastatur". Beide sagten dasselbe — ein Feld mit NumericInput-
    // Filter braucht die passende Tastatur —, und die Gegenprobe am 28.09.
    //
    // Geblieben ist die schaerfere der beiden:
    //   · Sie sieht auch `TextField(`, nicht nur `OutlinedTextField(`.
    //
    // Zwei Fassungen derselben Regel sind nicht doppelt sicher, sondern
    // gefaehrlich: Wer die eine entschaerft, sieht die andere nicht, und wer
    // beide sieht, pflegt am Ende nur noch die, die zuerst rot wird.

    @Test
    fun `jedes Setnummernfeld nimmt Filter und Zahlenpad`() {
        // Auch ein Feld, das nicht als Zahlenfeld gebaut ist; erkannt an der Beschriftung,
        // die eine Umbenennung der Zustandsvariablen übersteht.
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
        val dateien = Quellen.wurzel
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
