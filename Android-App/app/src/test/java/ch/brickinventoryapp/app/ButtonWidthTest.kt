package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test

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
 * Right is what SettingsScreen already showed (button „Suchen“): the
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
     * Both are necessary: a comment that mentions „Text(“ would otherwise make the rule
     * blind (this trap has struck several times in this project
     * already), and a bracket in a string would upset the
     * bracket balance. Line breaks stay so that the reported
     * line number is right.
     */
    private fun code(raw: String): String {
        val withoutComment = raw.lines().joinToString("\n") {
            val t = it.trim()
            if (t.startsWith("//") || t.startsWith("*")) "" else it
        }
        val sb = StringBuilder()
        var i = 0
        while (i < withoutComment.length) {
            val c = withoutComment[i]
            if (c == '"') {
                val end: Int
                if (withoutComment.startsWith("\"\"\"", i)) {
                    val j = withoutComment.indexOf("\"\"\"", i + 3)
                    end = if (j < 0) withoutComment.length else j + 3
                } else {
                    var j = i + 1
                    while (j < withoutComment.length && withoutComment[j] != '"') {
                        if (withoutComment[j] == '\\') j++
                        j++
                    }
                    end = minOf(j + 1, withoutComment.length)
                }
                sb.append("\"\"")
                // Keep line breaks from multi-line strings.
                repeat(withoutComment.substring(i, end).count { z -> z == '\n' }) { sb.append('\n') }
                i = end
                continue
            }
            sb.append(c)
            i++
        }
        return sb.toString()
    }

    /** The end of the bracket or block group that begins at [on]. */
    private fun groupEnd(s: String, on: Int, too: Char): Int {
        val open = s[on]
        var depth = 0
        var i = on
        while (i < s.length) {
            if (s[i] == open) depth++
            else if (s[i] == too) { depth--; if (depth == 0) return i }
            i++
        }
        return s.length - 1
    }

    /**
     * Is the label EXCLUSIVELY in the other branch than the spinner from [spinner]?
     * Then it disappears during work; if it stands next to it, all is well.
     */
    private fun losesLabel(content: String, spinner: Int): Boolean {
        val otherwise = content.indexOf("else", spinner)
        if (otherwise < 0 || content.substring(spinner, otherwise).contains("Text(")) return false
        return branchAfter(content, otherwise)?.contains("Text(") == true
    }

    /** The branch after `else` from [otherwise]: block or single call. */
    private fun branchAfter(content: String, otherwise: Int): String? {
        var p = otherwise + 4
        while (p < content.length && content[p].isWhitespace()) p++
        if (p >= content.length) return null
        if (content[p] == '{') return content.substring(p, groupEnd(content, p, '}') + 1)
        val a = content.indexOf('(', p)
        return if (a < 0) content.substring(p) else content.substring(p, groupEnd(content, a, ')') + 1)
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
        val files = Sources.root
            .walkTopDown().filter { it.extension == "kt" }.toList()
        // Lower bound: an empty file walk would let the check pass
        // silently.
        check(files.size >= 20) { "Too few Kotlin files found (${files.size}) — path outdated?" }

        val flicker = mutableListOf<String>()
        var checked = 0
        for (file in files) {
            val s = code(file.readText())
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
                val content = s.substring(m, groupEnd(s, m, '}') + 1)

                val spinner = content.indexOf("CircularProgressIndicator")
                if (spinner < 0) continue
                checked++
                if (losesLabel(content, spinner) && !fixedWidth(brackets)) {
                    flicker += "${file.name}:${s.substring(0, i).count { z -> z == '\n' } + 1}"
                }
            }
        }
        check(checked >= 3) { "Only $checked buttons with a spinner found — does the search still apply?" }
        assert(flicker.isEmpty()) {
            "These buttons lose their label when pressed and shrink: " +
                "${flicker.joinToString(", ")} — the spinner belongs NEXT TO the label, " +
                "not in its place (see SettingsScreen, button “Suchen\")"
        }
    }
}
