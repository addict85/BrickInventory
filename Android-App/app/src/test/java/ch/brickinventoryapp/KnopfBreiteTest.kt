package ch.brickinventoryapp

import org.junit.Test

/**
 * Ein arbeitender Knopf darf seine Beschriftung nicht verlieren.
 *
 * ── Marcos Video vom 22.09. ─────────────────────────────────────────────────
 *
 * Aufgenommen war die WEBAPP, Reiter „Teileliste": Beim Druck auf „Bereits
 * vorhandene Teile eintragen" zuckt die ganze Zeile kurz zusammen und springt
 * zurueck. Nachgemessen an den Einzelbildern (1458×576, 30 Bilder/s): zweimal
 * je sieben Bilder, also gut 0,2 s, und veraendert ist der Streifen ueber die
 * volle Zeilenbreite — Knopf UND die beiden Kaestchen daneben.
 *
 * Ursache dort: Der Helfer knopfBesetzt() tauscht die Beschriftung gegen „…".
 * Das ist rund 200 px schmaler, und in einer flex-Zeile rutscht alles rechts
 * daneben mit. Die Webapp friert die Breite jetzt ein (01-core.js).
 *
 * ── Warum dieselbe Regel hier ───────────────────────────────────────────────
 *
 * Die App macht an derselben Stelle dasselbe, nur mit anderen Mitteln: Drei
 * Knoepfe im Teilelisten-Bildschirm ersetzten waehrend der Arbeit ihren ganzen
 * Inhalt — Symbol UND Beschriftung — durch einen 16.dp-Kreisel. Der Knopf
 * schrumpft damit von seiner Beschriftungsbreite auf Kreiselbreite. Marcos
 * Vorgabe ist „in den UIs einheitliche Ansichten"; ein Flackern, das in der
 * Webapp behoben ist und in der App bleibt, waere genau das Gegenteil.
 *
 * Richtig ist, was SettingsScreen schon vorgemacht hat (Knopf „Suchen"): Der
 * Kreisel tritt NEBEN die Beschriftung, nicht an ihre Stelle.
 *
 * ── Was die Regel ausnimmt ──────────────────────────────────────────────────
 *
 * Knoepfe mit festgelegter Breite — fillMaxWidth(), weight(), width(), size().
 * Dort aendert der Tausch nichts an der Breite, und genau so arbeiten der
 * Anmeldeknopf und die CSV-Knoepfe in den Einstellungen.
 *
 * ── Gegenprobe (durchgefuehrt, Ergebnis im Commit) ──────────────────────────
 * Die drei Stellen in PartsListScreen auf die alte Form zurueckgedreht → die
 * Regel meldet genau diese drei.
 */
class KnopfBreiteTest {

    /**
     * Kommentarzeilen raus, Zeichenketten leeren.
     *
     * Beides ist noetig: Ein Kommentar, der „Text(" erwaehnt, machte die Regel
     * sonst blind (diese Falle hat in diesem Projekt schon mehrfach
     * zugeschlagen), und eine Klammer in einer Zeichenkette wuerfe die
     * Klammerbilanz um. Zeilenumbrueche bleiben stehen, damit die gemeldete
     * Zeilennummer stimmt.
     */
    private fun code(roh: String): String {
        val ohneKommentar = roh.lines().joinToString("\n") {
            val t = it.trim()
            if (t.startsWith("//") || t.startsWith("*")) "" else it
        }
        val sb = StringBuilder()
        var i = 0
        while (i < ohneKommentar.length) {
            val c = ohneKommentar[i]
            if (c == '"') {
                val ende: Int
                if (ohneKommentar.startsWith("\"\"\"", i)) {
                    val j = ohneKommentar.indexOf("\"\"\"", i + 3)
                    ende = if (j < 0) ohneKommentar.length else j + 3
                } else {
                    var j = i + 1
                    while (j < ohneKommentar.length && ohneKommentar[j] != '"') {
                        if (ohneKommentar[j] == '\\') j++
                        j++
                    }
                    ende = minOf(j + 1, ohneKommentar.length)
                }
                sb.append("\"\"")
                // Umbrueche aus mehrzeiligen Zeichenketten erhalten.
                repeat(ohneKommentar.substring(i, ende).count { z -> z == '\n' }) { sb.append('\n') }
                i = ende
                continue
            }
            sb.append(c)
            i++
        }
        return sb.toString()
    }

    /** Das Ende der Klammer- bzw. Blockgruppe, die bei [auf] beginnt. */
    private fun gruppeEnde(s: String, auf: Int, zu: Char): Int {
        val offen = s[auf]
        var tiefe = 0
        var i = auf
        while (i < s.length) {
            if (s[i] == offen) tiefe++
            else if (s[i] == zu) { tiefe--; if (tiefe == 0) return i }
            i++
        }
        return s.length - 1
    }

    @Test
    fun `kein Knopf versteckt seine Beschriftung hinter dem Kreisel`() {
        val dateien = java.io.File("src/main/java/ch/brickinventoryapp")
            .walkTopDown().filter { it.extension == "kt" }.toList()
        // Untergrenze: ein leerer Dateilauf liesse die Pruefung stillschweigend
        // bestehen.
        check(dateien.size >= 20) { "Zu wenige Kotlin-Dateien gefunden (${dateien.size}) — Pfad veraltet?" }

        val flackern = mutableListOf<String>()
        var geprueft = 0
        for (datei in dateien) {
            val s = code(datei.readText())
            var pos = 0
            while (true) {
                val i = s.indexOf("Button(", pos)
                if (i < 0) break
                val klammerAuf = i + "Button".length
                val klammerZu = gruppeEnde(s, klammerAuf, ')')
                val klammern = s.substring(klammerAuf, klammerZu + 1)
                pos = klammerZu + 1

                // Der Inhalt steht als angehaengter Block hinter den Klammern.
                var m = klammerZu + 1
                while (m < s.length && s[m].isWhitespace()) m++
                if (m >= s.length || s[m] != '{') continue
                val inhalt = s.substring(m, gruppeEnde(s, m, '}') + 1)

                val kreisel = inhalt.indexOf("CircularProgressIndicator")
                if (kreisel < 0) continue
                geprueft++

                val sonst = inhalt.indexOf("else", kreisel)
                if (sonst < 0) continue
                // Steht die Beschriftung NEBEN dem Kreisel, ist alles gut.
                if (inhalt.substring(kreisel, sonst).contains("Text(")) continue
                // Der andere Zweig: Block oder einzelner Aufruf.
                var p = sonst + 4
                while (p < inhalt.length && inhalt[p].isWhitespace()) p++
                if (p >= inhalt.length) continue
                val zweig = if (inhalt[p] == '{') {
                    inhalt.substring(p, gruppeEnde(inhalt, p, '}') + 1)
                } else {
                    val a = inhalt.indexOf('(', p)
                    if (a < 0) inhalt.substring(p) else inhalt.substring(p, gruppeEnde(inhalt, a, ')') + 1)
                }
                // Nur wenn die Beschriftung AUSSCHLIESSLICH im anderen Zweig
                // steht, verschwindet sie waehrend der Arbeit.
                if (!zweig.contains("Text(")) continue
                // Feste Breite: dort aendert der Tausch nichts.
                val fest = klammern.contains("fillMaxWidth") || klammern.contains("weight(") ||
                    klammern.contains(".width(") || klammern.contains(".size(")
                if (fest) continue
                flackern += "${datei.name}:${s.substring(0, i).count { z -> z == '\n' } + 1}"
            }
        }
        check(geprueft >= 3) { "Nur $geprueft Knoepfe mit Kreisel gefunden — greift die Suche noch?" }
        assert(flackern.isEmpty()) {
            "Diese Knoepfe verlieren beim Druck ihre Beschriftung und schrumpfen dabei: " +
                "${flackern.joinToString(", ")} — der Kreisel gehoert NEBEN die Beschriftung, " +
                "nicht an ihre Stelle (siehe SettingsScreen, Knopf „Suchen\")"
        }
    }
}
