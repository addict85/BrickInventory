package ch.brickinventoryapp.app

import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * A working button must not lose its label.
 *
 * ── Why the same rule here ───────────────────────────────────────────────────
 *
 * The app does the same thing in the same place, only with other means: three
 * buttons in the parts list screen replaced their whole content during work
 * — icon AND label — with a 16.dp spinner. The button thus
 * shrinks from its label width to spinner width. Web app and
 * app should look the same; a flicker fixed only in the web app
 * would be the opposite.
 *
 * Right is what SettingsScreen already showed (button „Suchen"): the
 * spinner steps NEXT to the label, not into its place.
 *
 * ── What the rule exempts ────────────────────────────────────────────────────
 *
 * Buttons with a fixed width — fillMaxWidth(), weight(), width(), size().
 * There the swap changes nothing about the width, and that is exactly how the
 * sign-in button and the CSV buttons in the settings work.
 *
 * ── Counter-check (performed, result in the commit) ──────────────────────────
 * The three places in PartsListScreen turned back to the old form → the
 * rule reports exactly these three.
 */
class ButtonWidthTest {

    /**
     * Remove comment lines, empty strings.
     *
     * Both are necessary: a comment that mentions „Text(" would otherwise make the rule
     * blind (this trap has struck several times in this project
     * already), and a bracket in a string would upset the
     * bracket balance. Line breaks stay so that the reported
     * line number is right.
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
                // Keep line breaks from multi-line strings.
                repeat(withoutComment.substring(i, ende).count { z -> z == '\n' }) { sb.append('\n') }
                i = ende
                continue
            }
            sb.append(c)
            i++
        }
        return sb.toString()
    }

    /** The end of the bracket or block group that begins at [auf]. */
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
     * Is the label EXCLUSIVELY in the other branch than the spinner from [spinner]?
     * Then it disappears during work; if it stands next to it, all is well.
     */
    private fun losesLabel(inhalt: String, spinner: Int): Boolean {
        val sonst = inhalt.indexOf("else", spinner)
        if (sonst < 0 || inhalt.substring(spinner, sonst).contains("Text(")) return false
        return branchAfter(inhalt, sonst)?.contains("Text(") == true
    }

    /** The branch after `else` from [sonst]: block or single call. */
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

    /** Fixed width: there the swap changes nothing. */
    private fun fixedWidth(brackets: String): Boolean =
        brackets.contains("fillMaxWidth") || brackets.contains("weight(") ||
            brackets.contains(".width(") || brackets.contains(".size(")

    @Test
    fun `no button hides its label behind the spinner`() {
        val dateien = Quellen.root
            .walkTopDown().filter { it.extension == "kt" }.toList()
        // Lower bound: an empty file walk would let the check pass
        // silently.
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

                // The content stands as a trailing block after the brackets.
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
