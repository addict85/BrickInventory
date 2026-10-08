package ch.brickinventoryapp

import org.junit.Test

/**
 * Die GANZE Anleitungszeile oeffnet das PDF — nicht nur das Symbol rechts.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 *
 * „Kannst du noch anpassen, dass die ganze Anleitung in der Android-App auf dem
 *  Detail-Dialog klickbar ist (zum PDF öffnen) und nicht nur das Icon rechts
 *  daneben?"
 *
 * Antippbar war allein ein 36-dp-Knopf am rechten Rand. Links davon lagen eine
 * 38-dp-Kachel mit PDF-Symbol und zwei Zeilen Text, und die Adresse stand in
 * der Akzentfarbe — in der Farbe also, die in dieser Oberflaeche „hier geht
 * etwas auf" heisst. Es sah aus wie ein Verweis und war keiner.
 *
 * ── Warum das eine Pruefung braucht ─────────────────────────────────────────
 *
 * Eine Antippflaeche ist nichts, was man im Quelltext SIEHT: `clickable` steht
 * an einem Modifier, drei Zeilen ueber dem, was es antippbar macht. Wer die
 * Zeile spaeter umbaut — ein Symbol dazu, die Spalten anders geschnitten —,
 * nimmt den Modifier mit und merkt nichts davon, weil alles weiter aussieht wie
 * vorher. Genau dieser Befund kam von Marco und nicht aus einem Lauf.
 *
 * Geprueft wird deshalb die STRUKTUR und nicht, dass irgendwo „clickable"
 * vorkommt: Daran haengt die Handlung (`oeffneAnleitung`), am Symbol haengt
 * KEIN zweiter Knopf mehr, und der Papierkorb hat weiter seinen eigenen.
 */
class AnleitungZeileTest {

    private val quelle by lazy {
        Quellen.ohneKommentare(Quellen.lies("ui/screens/SetDetailSections.kt"))
    }

    /**
     * Selbstnachweis gegen die stille Null: Liest diese Pruefung die falsche
     * Datei, findet sie nichts und waere gruen, ohne etwas geprueft zu haben.
     */
    private fun zeilen(): List<String> {
        assert(quelle.contains("fun LazyListScope.setDetailInstructionsSection")) {
            "In dieser Datei steht der Anleitungs-Abschnitt nicht (mehr) — dann " +
                "prueft hier nichts etwas, und zwar lautlos."
        }
        return quelle.lines()
    }

    /**
     * Der ganze Aufruf ab einer Fundzeile — bis die Klammerbilanz wieder auf
     * null steht.
     *
     * ── Warum nicht ein paar Zeilen davor ───────────────────────────────────
     *
     * Die erste Fassung dieser Datei schnitt sechs Zeilen oberhalb des Symbols
     * und sah nach, ob dort ein IconButton steht. Die Gegenprobe gegen den
     * ALTEN Stand hat sie widerlegt: Dort lagen zwischen `IconButton(` und dem
     * Symbol siebzehn Zeilen Handlung, das Fenster griff daneben, und die
     * Pruefung war am kaputten Stand GRUEN. Eine Pruefung, die ihren eigenen
     * Anlass nicht faengt, prueft nichts.
     *
     * Deshalb wird jetzt der Block gelesen statt eine Umgebung geschaetzt.
     */
    private fun block(ab: Int): String {
        val z = zeilen()
        var tiefe = 0
        val sb = StringBuilder()
        for (i in ab until z.size) {
            sb.append(z[i]).append('\n')
            for (c in z[i]) when (c) {
                '(', '{' -> tiefe++
                ')', '}' -> tiefe--
            }
            if (i > ab && tiefe <= 0) break
        }
        return sb.toString()
    }

    /** Die Zeilen VOR einem Fundort, Kommentare sind schon raus. */
    private fun davor(treffer: String, wieViele: Int): String {
        val z = zeilen()
        val i = z.indexOfFirst { it.contains(treffer) }
        assert(i >= 0) {
            "$treffer steht nicht mehr in der Datei — diese Pruefung anpassen."
        }
        return z.subList(maxOf(0, i - wieViele), i).joinToString("\n")
    }

    @Test
    fun `die ganze Zeile oeffnet die Anleitung`() {
        // In ZEILEN gemessen und nicht in Zeichen (siehe Quellen): Ein
        // wachsender Erklaerabsatz hat in dieser Reihe schon viermal eine
        // Pruefung gebrochen, die ein festes Zeichenfenster schnitt.
        assert(Regex("""clickable\([^)]*oeffneAnleitung""").containsMatchIn(quelle)) {
            "Am `clickable` der Anleitungszeile haengt nicht `oeffneAnleitung`. " +
                "Dann ist wieder nur ein Teil der Zeile antippbar — genau Marcos Befund."
        }
    }

    @Test
    fun `das Oeffnen haengt an keinem Knopf`() {
        // Kein IconButton dieser Datei darf das Oeffnen tragen — weder
        // unmittelbar (onOpenPdf) noch ueber die benannte Handlung. Ein Knopf
        // daneben waere ein zweites Ziel fuer dasselbe, und die Sprachausgabe
        // nennte ihn als eigenes Bedienelement neben der Zeile, die schon
        // dasselbe tut.
        val z = zeilen()
        val schuldig = z.indices
            .filter { "IconButton(" in z[it] }
            .filter { i -> block(i).let { "onOpenPdf(" in it || "oeffneAnleitung" in it } }
        assert(schuldig.isEmpty()) {
            "Das Oeffnen der Anleitung haengt wieder an einem IconButton " +
                "(Zeile " + schuldig.joinToString { (it + 1).toString() } + "). " +
                "Dann ist nur das Symbol antippbar und nicht die Zeile — genau " +
                "Marcos Befund."
        }
    }

    @Test
    fun `das Symbol bleibt als Hinweis stehen`() {
        // Ohne es sieht die Zeile aus wie Text. Es ist der einzige Hinweis
        // darauf, dass sich hier etwas oeffnet — Antippflaechen sind
        // unsichtbar.
        assert(quelle.contains("Icons.AutoMirrored.Filled.OpenInNew")) {
            "Das Oeffnen-Symbol ist aus der Anleitungszeile verschwunden. Dann " +
                "ist nicht mehr zu sehen, dass die Zeile etwas tut."
        }
    }

    @Test
    fun `der Papierkorb bleibt ein eigener Knopf`() {
        // Loeschen darf NICHT an der Zeile haengen: Es liegt ausserhalb des
        // antippbaren Bereichs, als Geschwister und nicht als Kind. Damit haengt
        // nichts daran, welcher von zwei verschachtelten Antippbereichen ein
        // Tippen bekommt — und ein Fehlgriff tut hier weh.
        assert(davor("onAnleitungLoeschen(id)", 3).contains("IconButton(")) {
            "Das Loeschen einer Anleitung haengt an keinem eigenen Knopf mehr."
        }
    }
}
