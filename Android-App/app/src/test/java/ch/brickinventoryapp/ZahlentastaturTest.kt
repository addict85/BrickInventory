package ch.brickinventoryapp

import org.junit.Test

/**
 * Wo eine Zahl hingehoert, erscheint die Zahlentastatur.
 *
 * ── Marcos Vorgabe vom 28.09. ───────────────────────────────────────────────
 *
 *   „Beim Preisvergleich in der Android-App soll nur das Zahlenfeld erscheinen
 *    wenn man in das Eingabefeld klickt. Bitte sicherstellen, dass dies so in
 *    allen Feldern in der Android-App der Fall ist."
 *
 * ── Woran man ein Zahlenfeld erkennt ────────────────────────────────────────
 *
 * Nicht an der Beschriftung — „Teilenummer" klingt nach Zahl und heisst
 * „3001pb01", „Figurennummer" heisst „sw0001". Eine Zahlentastatur machte
 * beide unbenutzbar.
 *
 * Sondern daran, dass das Feld seine Eingabe durch einen der Filter aus
 * util/NumericInput.kt schickt. Wer `NumericInput.quantity()` schreibt, hat
 * bereits entschieden, dass hier nur Ziffern hineingehoeren — dann muss die
 * Tastatur mitziehen. Die beiden gehoeren zusammen, und diese Regel haelt
 * genau das fest.
 *
 * ── Warum der Filter nicht reicht und die Tastatur nicht ────────────────────
 *
 * Der Filter ohne Tastatur: Man bekommt die Buchstaben angeboten, tippt sie,
 * und sie verschwinden beim Tippen wieder. Das sieht aus wie ein Fehler.
 *
 * Die Tastatur ohne Filter: Eine angeschlossene Tastatur, die Zwischenablage
 * und manche Bildschirmtastaturen liefern trotzdem Buchstaben. Der Wert
 * landet dann als Text im Feld und faellt erst beim Umwandeln auf — still,
 * als Null.
 *
 * ── Gegenproben (durchgefuehrt, Ergebnis im Commit) ─────────────────────────
 *   a) keyboardOptions im Katalog-Detail entfernt → Schritt 1 rot
 *   b) Filter im Preisvergleich entfernt          → Schritt 2 rot
 */
class ZahlentastaturTest {

    /** Ein TextField-Aufruf samt Rumpf — grob, aber fuer diese Frage genug. */
    private fun textfelder(quelle: String): List<String> {
        val blocks = mutableListOf<String>()
        var i = Regex("""\b(Outlined)?TextField\(""").find(quelle)?.range?.first ?: return blocks
        while (true) {
            var tiefe = 0
            var j = quelle.indexOf('(', i)
            var ende = j
            while (ende < minOf(j + 4000, quelle.length)) {
                when (quelle[ende]) {
                    '(' -> tiefe++
                    ')' -> { tiefe--; if (tiefe == 0) break }
                }
                ende++
            }
            blocks += quelle.substring(i, minOf(ende + 1, quelle.length))
            i = Regex("""\b(Outlined)?TextField\(""")
                .find(quelle, minOf(ende + 1, quelle.length))?.range?.first ?: break
        }
        return blocks
    }

    private val filter = Regex("""NumericInput\.(setNumber|quantity|price)\b""")
    private val tastatur = Regex(
        """keyboardType\s*=\s*KeyboardType\.\w+|NumericInput\.(ganzzahl|preis)Tastatur""")

    @Test
    fun `wer Zahlen filtert, zeigt auch die Zahlentastatur`() {
        val fehler = mutableListOf<String>()
        var gesehen = 0
        for (datei in Quellen.alle()) {
            val s = Quellen.ohneKommentare(datei.readText())
            for (blk in textfelder(s)) {
                if (!filter.containsMatchIn(blk)) continue
                gesehen++
                if (!tastatur.containsMatchIn(blk)) fehler += datei.name
            }
        }
        // Selbstnachweis gegen die stille Null: Findet die Suche ueberhaupt
        // Felder? Ohne das waere eine leere Fehlerliste fuer immer gruen.
        assert(gesehen >= 15) { "Nur $gesehen gefilterte Felder gefunden — Muster veraltet?" }
        assert(fehler.isEmpty()) {
            "Diese Felder lassen nur Ziffern zu, bieten aber die Texttastatur an:\n  " +
                fehler.joinToString("\n  ") +
                "\nDer Filter aus NumericInput gehoert mit der passenden Tastatur zusammen."
        }
    }

    /**
     * Der Preisvergleich im Besonderen.
     *
     * Er stand hier nicht zufaellig: Das Feld war eine Freitextsuche, und
     * Marco hat den Tausch ausdruecklich gewaehlt. Steht der Filter wieder
     * auf Freitext, ist die Entscheidung stillschweigend zurueckgenommen.
     */
    @Test
    fun `der Preisvergleich nimmt Ziffern und Bindestrich`() {
        val s = Quellen.ohneKommentare(Quellen.lies("ui/screens/ComparisonScreen.kt"))
        assert(s.contains("NumericInput.setNumber(")) {
            "Das Suchfeld filtert nicht mehr auf Ziffern und Bindestrich."
        }
        assert(s.contains("NumericInput.ganzzahlTastatur(")) {
            "Das Suchfeld zeigt nicht mehr die Zahlentastatur — genau das hat " +
                "Marco am 28.09. verlangt."
        }
        // Die Suchtaste MUSS bleiben: Das Feld loest die Suche ueber
        // ImeAction.Search aus, und ohne sie gaebe es keinen Weg, sie
        // auszuloesen ausser dem Knopf daneben.
        assert(s.contains("ImeAction.Search")) {
            "Die Suchtaste der Tastatur ist weg."
        }
    }
}
