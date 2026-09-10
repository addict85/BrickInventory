package ch.brickinventoryapp

import org.junit.Test

/**
 * Abstaende und Schriftgroessen kommen aus der Skala — und die Ausnahmen
 * werden weniger, nie mehr.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 * „saubere Architektur, clean Code, saubere Strukturen und in den UIs
 * einheitliche Ansichten." Die Webapp fuehrt ihre Abstaende in CSS-Klassen;
 * die App hatte gar nichts — 486 blanke Zahlen an Abstandsstellen, 109 an
 * Schriftstellen, verteilt ueber die Bildschirme.
 *
 * ── Warum eine RATSCHE und keine harte Regel ────────────────────────────────
 *
 * Gemessen, bevor irgendetwas geaendert wurde: Die App benutzte kein 4er- oder
 * 8er-Raster, sondern ein 2-dp-Kontinuum — 8 (106-mal), 6 (60), 12 (54),
 * 4 (51), 16 (44), 10 (41), 2 (28), 14 (26) … Auf die uebliche Skala
 * (2/4/8/12/16/24/32) fallen 304 dieser Stellen exakt; 175 nicht.
 *
 * Die exakten wurden umgestellt — nachgewiesen ohne jede Verschiebung: Die
 * Verteilung der tatsaechlichen Werte ist vor und nach dem Umbau dieselbe.
 *
 * Die uebrigen NICHT. Eine 6 auf 4 oder 8 zu ziehen ist keine Aufraeumarbeit,
 * sondern eine GESTALTUNGSaenderung: Die Stelle verschiebt sich sichtbar. Das
 * entscheidet, wer die App vor sich hat, nicht wer den Quelltext umschreibt —
 * und mit 60 Stellen allein fuer die 6 ist es auch keine Kleinigkeit.
 *
 * Eine harte Regel („nur noch Skalenwerte") waere deshalb entweder sofort rot
 * oder muesste 181 Ausnahmen aufzaehlen — und eine Ausnahmeliste dieser Laenge
 * liest niemand mehr. Die Ratsche loest beides: Sie haelt den Stand fest, laesst
 * ihn sinken und schlaegt an, sobald er steigt. Neue Bildschirme bekommen damit
 * die Skala, ohne dass der Bestand angefasst werden muss.
 *
 * ── Was ausdruecklich NICHT dazugehoert ─────────────────────────────────────
 *
 * `size(16.dp)` an einem Symbol, die Hoehe einer Karte, eine Strichstaerke —
 * das sind GROESSEN, keine Abstaende. Ein Abstands-Token dort waere falsch:
 * Wer die Kachelhoehe aendert, will nicht alle Innenabstaende mitaendern.
 * Geprueft werden deshalb nur padding, Arrangement.spacedBy, PaddingValues und
 * Spacer.
 */
class AbstandsskalaTest {

    /** Nur echte ABSTANDS-Stellen — nicht Groessen. Siehe KDoc. */
    private val abstandsMuster = listOf(
        Regex("""\bspacedBy\((\d+)\.dp\)"""),
        Regex("""\bpadding\((\d+)\.dp\)"""),
        Regex("""\bPaddingValues\((\d+)\.dp\)"""),
        Regex("""\b(?:horizontal|vertical|top|bottom|start|end) = (\d+)\.dp"""),
        Regex("""\bSpacer\(Modifier\.(?:width|height)\((\d+)\.dp\)\)"""),
    )
    private val schriftMuster = Regex("""\bfontSize = (\d+)\.sp""")

    /** Die Bildschirme — ui/theme selbst ist die Skala und zaehlt nicht mit. */
    private fun quellen(): List<Pair<String, String>> =
        java.io.File("src/main/java/ch/brickinventoryapp/ui")
            .walkTopDown()
            .filter { it.isFile && it.extension == "kt" && "theme" !in it.path.split(java.io.File.separator) }
            .map { it.name to Quellen.ohneKommentare(it.readText()) }
            .toList()

    private fun zaehle(muster: List<Regex>): Int =
        quellen().sumOf { (_, s) -> muster.sumOf { it.findAll(s).count() } }

    @Test
    fun `die Skala wird ueberhaupt benutzt`() {
        // ── Selbstnachweis: findet die Suche ueberhaupt etwas? ───────────
        //
        // Das ist die eigentliche Aufgabe dieser Pruefung. Wird der Ordner
        // umbenannt oder greift `quellen()` nicht mehr, zaehlt die Ratsche
        // unten NULL — und null ist kleiner als jede Schranke. Sie waere dann
        // fuer immer gruen, ohne je wieder etwas anzusehen.
        //
        // Hier stand zuerst eine andere Begruendung: die Ratsche merke einen
        // ZURUECKGEDREHTEN Umbau nicht. Das ist falsch, und die Gegenprobe hat
        // es gezeigt: Die Ratsche zaehlt jede Zahl an einer Abstandsstelle,
        // nicht nur die neben der Skala. Wer ein Token durch seine alte Zahl
        // ersetzt, laesst die Zahl steigen und faellt auf. Die falsche
        // Begruendung steht hier, weil eine gemessene Widerlegung mehr wert
        // ist als ihre stille Entfernung.
        //
        // Die zweite Zahl unten bleibt trotzdem: Sie haelt fest, wie weit die
        // Umstellung gediehen war, und macht ein schleichendes Zurueckdrehen
        // ueber viele Dateien sichtbar, das die Ratsche einzeln je Datei zwar
        // meldet, in der Summe aber nicht beziffert.
        val alle = quellen()
        assert(alle.size >= 30) { "Nur ${alle.size} Bildschirmdateien gefunden — Ordner umbenannt?" }
        val text = alle.joinToString("\n") { it.second }
        val abst = Regex("""\bAbstaende\.\w+""").findAll(text).count()
        val schr = Regex("""\bSchrift\.\w+""").findAll(text).count()
        // GEMESSEN beim Anlegen: 305 bzw. 54.
        assert(abst >= 280) {
            "Nur $abst Abstands-Token im Baum (gemessen waren es 305). Wurde die " +
                "Umstellung rueckgaengig gemacht? Die Ratsche unten faellt das nicht auf."
        }
        assert(schr >= 50) {
            "Nur $schr Schrift-Token im Baum (gemessen waren es 54). Siehe oben."
        }
    }

    @Test
    fun `die Zahl der Abstaende, die noch als Zahl dastehen, sinkt nur`() {
        // GEMESSEN beim Anlegen: 181, inzwischen 180 (die Design-Auswahl in
        // MonitoringSections ist auf die Skala gewandert). Ganz oben stehen
        // 6 (59-mal), 10 (41) und
        // 14 (26) — die drei Werte, die es auf einer Zweier-Skala nicht gibt.
        //
        // Diese Zahl darf SINKEN, wenn jemand bewusst entscheidet, eine dieser
        // Gruppen auf die Skala zu ziehen. Sie darf nicht steigen: Ein neuer
        // Bildschirm hat keinen Grund, einen Abstand zu erfinden, den es noch
        // nicht gibt.
        val ist = zaehle(abstandsMuster)
        assert(ist <= 180) {
            "$ist Abstaende stehen noch als Zahl da, gemessen waren es 180. " +
                "Ein neuer Wert ausserhalb von Abstaende gehoert begruendet — oder " +
                "in die Skala. Sinkt die Zahl, gehoert sie hier nachgezogen."
        }
    }

    @Test
    fun `die Zahl der Schriftgroessen, die noch als Zahl dastehen, sinkt nur`() {
        // GEMESSEN beim Anlegen: 55. Groesster Posten ist 13.sp (22-mal) —
        // direkt neben 12.sp (24-mal). Zwei Groessen, die sich um einen Punkt
        // unterscheiden, sind nebeneinander nicht als Unterschied lesbar; das
        // ist der Kandidat, den man als Erstes zusammenlegen wuerde.
        val ist = zaehle(listOf(schriftMuster))
        assert(ist <= 55) {
            "$ist Schriftgroessen stehen noch als Zahl da, gemessen waren es 55. " +
                "Siehe die Abstandsregel daneben."
        }
    }
}
