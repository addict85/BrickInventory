package ch.brickinventoryapp.app

import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * Ein arbeitender Knopf darf seine Beschriftung nicht verlieren.
 *
 * ── Warum dieselbe Regel hier ───────────────────────────────────────────────
 *
 * Die App macht an derselben Stelle dasselbe, nur mit anderen Mitteln: Drei
 * Knoepfe im Teilelisten-Bildschirm ersetzten waehrend der Arbeit ihren ganzen
 * Inhalt — Symbol UND Beschriftung — durch einen 16.dp-Kreisel. Der Knopf
 * schrumpft damit von seiner Beschriftungsbreite auf Kreiselbreite. Webapp und
 * App sollen gleich aussehen; ein Flackern, das nur in der Webapp behoben ist,
 * waere das Gegenteil.
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
class ButtonWidthTest {

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
        val withoutComment = roh.lines().joinToString("\n") {
            val t = it.trim()
            if (t.startsWith("//") || t.startsWith("*")) "" else it
        }
        val sb = StringBuilder()
        var i = 0
        while (i < withoutComment.length) {
            val c = withoutComment[i]
            if (c == '"') {
                val ende: Int
                if (withoutComment.startsWith("\"\"\"", i)) {
                    val j = withoutComment.indexOf("\"\"\"", i + 3)
                    ende = if (j < 0) withoutComment.length else j + 3
                } else {
                    var j = i + 1
                    while (j < withoutComment.length && withoutComment[j] != '"') {
                        if (withoutComment[j] == '\\') j++
                        j++
                    }
                    ende = minOf(j + 1, withoutComment.length)
                }
                sb.append("\"\"")
                // Umbrueche aus mehrzeiligen Zeichenketten erhalten.
                repeat(withoutComment.substring(i, ende).count { z -> z == '\n' }) { sb.append('\n') }
                i = ende
                continue
            }
            sb.append(c)
            i++
        }
        return sb.toString()
    }

    /** Das Ende der Klammer- bzw. Blockgruppe, die bei [auf] beginnt. */
    private fun groupEnd(s: String, auf: Int, zu: Char): Int {
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

    /**
     * Steht die Beschriftung AUSSCHLIESSLICH im anderen Zweig als der Kreisel ab [spinner]?
     * Dann verschwindet sie waehrend der Arbeit; steht sie daneben, ist alles gut.
     */
    private fun losesLabel(inhalt: String, spinner: Int): Boolean {
        val sonst = inhalt.indexOf("else", spinner)
        if (sonst < 0 || inhalt.substring(spinner, sonst).contains("Text(")) return false
        return branchAfter(inhalt, sonst)?.contains("Text(") == true
    }

    /** Der Zweig hinter `else` ab [sonst]: Block oder einzelner Aufruf. */
    private fun branchAfter(inhalt: String, sonst: Int): String? {
        var p = sonst + 4
        while (p < inhalt.length && inhalt[p].isWhitespace()) p++
        if (p >= inhalt.length) return null
        if (inhalt[p] == '{') return inhalt.substring(p, groupEnd(inhalt, p, '}') + 1)
        val a = inhalt.indexOf('(', p)
        return if (a < 0) inhalt.substring(p) else inhalt.substring(p, groupEnd(inhalt, a, ')') + 1)
    }

    /** The next `Button(` call from [from]; a declaration such as `fun LoadButton(` is none. */
    private fun nextButtonCall(s: String, from: Int): Int {
        var i = s.indexOf("Button(", from)
        while (i >= 0 && Regex("""\bfun\s+\w*$""").containsMatchIn(s.substring(maxOf(0, i - 60), i)))
            i = s.indexOf("Button(", i + 1)
        return i
    }

    /** Feste Breite: dort aendert der Tausch nichts. */
    private fun fixedWidth(brackets: String): Boolean =
        brackets.contains("fillMaxWidth") || brackets.contains("weight(") ||
            brackets.contains(".width(") || brackets.contains(".size(")

    @Test
    fun `no button hides its label behind the spinner`() {
        val dateien = Quellen.root
            .walkTopDown().filter { it.extension == "kt" }.toList()
        // Untergrenze: ein leerer Dateilauf liesse die Pruefung stillschweigend
        // bestehen.
        check(dateien.size >= 20) { "Zu wenige Kotlin-Dateien gefunden (${dateien.size}) — Pfad veraltet?" }

        val flicker = mutableListOf<String>()
        var geprueft = 0
        for (datei in dateien) {
            val s = code(datei.readText())
            var pos = 0
            while (true) {
                val i = nextButtonCall(s, pos)
                if (i < 0) break
                val bracketOn = i + "Button".length
                val bracketTo = groupEnd(s, bracketOn, ')')
                val brackets = s.substring(bracketOn, bracketTo + 1)
                pos = bracketTo + 1

                // Der Inhalt steht als angehaengter Block hinter den Klammern.
                var m = bracketTo + 1
                while (m < s.length && s[m].isWhitespace()) m++
                if (m >= s.length || s[m] != '{') continue
                val inhalt = s.substring(m, groupEnd(s, m, '}') + 1)

                val spinner = inhalt.indexOf("CircularProgressIndicator")
                if (spinner < 0) continue
                geprueft++
                if (losesLabel(inhalt, spinner) && !fixedWidth(brackets)) {
                    flicker += "${datei.name}:${s.substring(0, i).count { z -> z == '\n' } + 1}"
                }
            }
        }
        check(geprueft >= 3) { "Nur $geprueft Knoepfe mit Kreisel gefunden — greift die Suche noch?" }
        assert(flicker.isEmpty()) {
            "Diese Knoepfe verlieren beim Druck ihre Beschriftung und schrumpfen dabei: " +
                "${flicker.joinToString(", ")} — der Kreisel gehoert NEBEN die Beschriftung, " +
                "nicht an ihre Stelle (siehe SettingsScreen, Knopf „Suchen\")"
        }
    }
}
