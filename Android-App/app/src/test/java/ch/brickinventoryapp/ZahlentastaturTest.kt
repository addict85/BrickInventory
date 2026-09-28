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
 * ── Gegenproben (durchgefuehrt, Lauf 306 vom 28.09.) ─────────────────────
 *
 * Zwei Eingriffe in einen Wegwerf-Zweig, einer je Testmethode, beide Anker
 * vorher auf Eindeutigkeit geprueft:
 *
 *   a) `keyboardOptions` beim Mengenfeld im Katalog-Detail entfernt, den
 *      `NumericInput.quantity()`-Filter absichtlich stehen gelassen.
 *   b) im Preisvergleich `NumericInput.setNumber(it)` → `it`, die Tastatur
 *      absichtlich stehen gelassen — damit wirklich nur der Filter fehlt.
 *
 * GEMESSEN (506 tests completed, 3 failed):
 *
 *   ZahlentastaturTest > wer Zahlen filtert, zeigt auch die Zahlentastatur
 *   ZahlentastaturTest > der Preisvergleich nimmt Ziffern und Bindestrich
 *   NumericInputTest   > kein Zahlenfeld steht ohne Tastaturwahl da
 *
 * Erwartet hatte ich ZWEI. Die dritte war kein Zufallstreffer, sondern der
 * eigentliche Fund der Gegenprobe: Es gab die Regel schon, seit dem 22.09.,
 * in NumericInputTest — ich hatte sie ein zweites Mal geschrieben, ohne es zu
 * merken. Ein Eingriff, zwei rote Tests: genau so sieht eine doppelte Regel
 * aus.
 *
 * Aufgeloest: Die aeltere, schwaechere Fassung ist entfernt (die Notiz an
 * ihrer Stelle in NumericInputTest sagt, warum diese hier die schaerfere ist);
 * ihre Zeilennummer-Meldung ist hierher uebernommen. Der Eingriff a) macht
 * seitdem genau EINEN Test rot.
 *
 * Was das ueber die Gegenprobe sagt: Sie hat hier nicht bewiesen, dass die
 * Regel greift — das auch —, sondern dass sie eine zu viel war. Ohne sie
 * waeren zwei Fassungen derselben Regel nebeneinander stehen geblieben.
 */
class ZahlentastaturTest {

    /**
     * Jeder TextField-Aufruf samt Rumpf und Zeilennummer.
     *
     * Die Zeilennummer steht hier, weil die Fehlermeldung sonst nur die Datei
     * nennt — und CatalogDetailScreen.kt hat sieben Textfelder. Die abgeloeste
     * Fassung in NumericInputTest konnte das; das sollte beim Umzug nicht
     * verloren gehen.
     */
    private fun textfelder(quelle: String): List<Pair<Int, String>> {
        val blocks = mutableListOf<Pair<Int, String>>()
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
            val zeile = quelle.substring(0, i).count { c -> c == '\n' } + 1
            blocks += zeile to quelle.substring(i, minOf(ende + 1, quelle.length))
            i = Regex("""\b(Outlined)?TextField\(""")
                .find(quelle, minOf(ende + 1, quelle.length))?.range?.first ?: break
        }
        return blocks
    }

    private val filter = Regex("""NumericInput\.(setNumber|quantity|price)\b""")
    private val tastatur = Regex(
        """keyboardType\s*=\s*KeyboardType\.\w+|NumericInput\.(ganzzahl|preis)Tastatur""")

    /**
     * Nur die ZAHLEN-Tastaturen — Email, Password und Phone gehoeren nicht
     * dazu. `Number` und `Decimal` sind genau die beiden, die NumericInput
     * ausgibt.
     */
    private val zahlentastatur = Regex(
        """KeyboardType\.(Number|Decimal)\b|NumericInput\.(ganzzahl|preis)Tastatur""")

    @Test
    fun `wer Zahlen filtert, zeigt auch die Zahlentastatur`() {
        val fehler = mutableListOf<String>()
        var gesehen = 0
        for (datei in Quellen.alle()) {
            val s = Quellen.ohneKommentare(datei.readText())
            for ((zeile, blk) in textfelder(s)) {
                if (!filter.containsMatchIn(blk)) continue
                gesehen++
                if (!tastatur.containsMatchIn(blk)) fehler += "${datei.name}:$zeile"
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
     * Die Gegenrichtung: Wer die Zahlentastatur zeigt, filtert auch.
     *
     * ── Warum es diese Regel gibt ───────────────────────────────────────────
     *
     * Die Regel darueber haengt am FILTER. Damit kann sie ein Feld, das die
     * Tastatur hat und den Filter nicht, grundsaetzlich nicht sehen — es faellt
     * schon in der ersten Zeile aus ihrer Schleife. Genau dieser blinde Fleck
     * hat am 28.09. zwei Felder verdeckt, und ich habe trotzdem „alle 19 Felder
     * in Ordnung" gemeldet. Die Zahl stimmte; sie beantwortete nur eine andere
     * Frage als Marcos.
     *
     * GEFUNDEN wurden dadurch (gemessen, nicht geschaetzt): 21 Felder mit
     * Zahlentastatur, davon 2 ohne Filter —
     *   · SettingsScreen.kt, Schwelle eines bestehenden Preisalarms
     *   · SetDetailSections.kt, Schwelle beim Anlegen
     *
     * ── Warum die fehlende Haelfte hier die gefaehrlichere ist ──────────────
     *
     * Filter ohne Tastatur ist haesslich: Man tippt Buchstaben und sie
     * verschwinden wieder. Man SIEHT es.
     *
     * Tastatur ohne Filter ist still. Die Tastaturwahl ist eine Bitte an die
     * Tastatur-App, keine Zusicherung — eine angestoepselte Tastatur und die
     * Zwischenablage liefern trotzdem Buchstaben. Im Feld in SettingsScreen
     * wurde daraus ueber `?: 0.0` eine Schwelle von 0.
     */
    @Test
    fun `wer die Zahlentastatur zeigt, filtert auch`() {
        val fehler = mutableListOf<String>()
        var gesehen = 0
        for (datei in Quellen.alle()) {
            val s = Quellen.ohneKommentare(datei.readText())
            for ((zeile, blk) in textfelder(s)) {
                if (!zahlentastatur.containsMatchIn(blk)) continue
                gesehen++
                if (!filter.containsMatchIn(blk)) fehler += "${datei.name}:$zeile"
            }
        }
        // Selbstnachweis gegen die stille Null, gemessen am 28.09.: 21.
        assert(gesehen >= 15) { "Nur $gesehen Felder mit Zahlentastatur — Muster veraltet?" }
        assert(fehler.isEmpty()) {
            "Diese Felder zeigen die Zahlentastatur, lassen aber alles herein:\n  " +
                fehler.joinToString("\n  ") +
                "\nDie Tastaturwahl ist eine Bitte, keine Zusicherung — der Filter fehlt."
        }
    }

    /**
     * Der Preisvergleich im Besonderen.
     *
     * Er stand hier nicht zufaellig: Das Feld war eine Freitextsuche, und
     * Marco hat den Tausch ausdruecklich gewaehlt. Steht der Filter wieder
     * auf Freitext, ist die Entscheidung stillschweigend zurueckgenommen.
     *
     * ── Warum das keine dritte Fassung derselben Regel ist ──────────────────
     *
     * Die beiden Regeln darueber sagen BEDINGT etwas: Wenn ein Feld ein
     * Zahlenfeld ist, braucht es beide Haelften. Nimmt man diesem Feld Filter
     * UND Tastatur zugleich, faellt es aus beiden Schleifen und keine der
     * beiden wird rot — es ist dann eben kein Zahlenfeld mehr.
     *
     * Diese Regel sagt UNBEDINGT etwas: Dieses eine Feld IST ein Zahlenfeld,
     * weil Marco das am 28.09. so entschieden hat. Das kann keine Regel
     * wissen, die Felder nur an ihrer Bauart erkennt — dieselbe Luecke, die in
     * NumericInputTest schon „jedes Setnummernfeld nimmt Filter und Zahlenpad"
     * schliesst.
     *
     * Dazu die Suchtaste, von der sonst niemand etwas sagt.
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
